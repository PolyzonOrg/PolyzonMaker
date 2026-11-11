/**
 * «Большая модель по частям»: where to cut a model bigger than the printer
 * so that every part fits the build volume and there are as few parts as
 * possible. Pure geometry on a point cloud of the model — its vertices and
 * points spread over its surface — so the search is fast; how a cut face
 * looks (`Sections`) comes from the caller: manifold slices in the worker,
 * nothing at all while choosing the orientation.
 *
 * Every cut is a plane across an axis of the planning frame: each part is
 * the model inside a box (a cell), the parts stack like bricks, and every
 * joint is a flat face that prints on the bed and glues on dowels.
 */

export type Vec3 = [number, number, number];
export type Axis = 0 | 1 | 2;
/** Row-major 3×3 rotation. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface Box {
	min: Vec3;
	max: Vec3;
}

/** The space a part may take: the model inside it is the part. */
export type Cell = Box;

export interface PlanNode {
	cell: Cell;
	/** What the model takes inside the cell. */
	box: Box;
	cut?: { axis: Axis; at: number; minus: PlanNode; plus: PlanNode };
}

/** The two other axes of a cut face, in the order its 2D coordinates use. */
export const FACE_AXES: Record<Axis, [Axis, Axis]> = { 0: [1, 2], 1: [2, 0], 2: [0, 1] };

/**
 * How the model looks where a plane cuts it, inside the rectangle `lo`…`hi`
 * of the face's two axes (FACE_AXES order).
 */
export interface Sections {
	/** Bounds of the cut face, null when the plane misses the model there. */
	bounds(
		axis: Axis,
		at: number,
		lo: [number, number],
		hi: [number, number]
	): { min: [number, number]; max: [number, number] } | null;
	/** 0 for a compact face that glues well; more for thin, scattered or grazing faces. */
	badness(axis: Axis, at: number, lo: [number, number], hi: [number, number]): number;
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const PERMS: [Axis, Axis, Axis][] = [
	[0, 1, 2],
	[0, 2, 1],
	[1, 0, 2],
	[1, 2, 0],
	[2, 0, 1],
	[2, 1, 0]
];

export const sizeOf = (b: Box): Vec3 => [
	b.max[0] - b.min[0],
	b.max[1] - b.min[1],
	b.max[2] - b.min[2]
];

const pieces = (s: number, b: number) => Math.max(1, Math.ceil(s / b - 1e-6));

/**
 * Parts a box needs when cut into a plain grid, turned the best way on the
 * bed: a quick estimate for the search, exact for a box-shaped model.
 */
export function partsFor(size: Vec3, bed: Vec3): number {
	let best = Infinity;
	for (const [i, j, k] of PERMS) {
		const n = pieces(size[0], bed[i]) * pieces(size[1], bed[j]) * pieces(size[2], bed[k]);
		if (n < best) best = n;
	}
	return best;
}

/** Fits the build volume turned some way by quarter turns. */
export const fits = (size: Vec3, bed: Vec3) => partsFor(size, bed) === 1;

/**
 * Points to plan on: every vertex (a part's extremes are vertices or lie on
 * its cut faces) and points spread over the surface by area, so a low-poly
 * model's big flat faces are not empty space to the planner. At most `max`.
 */
export function cloudPoints(
	vertices: Float32Array,
	tris: Float32Array,
	max = 40_000
): Float32Array {
	const nv = vertices.length / 3;
	const keepV = Math.min(nv, Math.round(max * 0.6));
	const nt = Math.floor(tris.length / 9);
	const areas = new Float64Array(nt);
	let total = 0;
	for (let t = 0; t < nt; t++) {
		const o = t * 9;
		const ux = tris[o + 3] - tris[o];
		const uy = tris[o + 4] - tris[o + 1];
		const uz = tris[o + 5] - tris[o + 2];
		const vx = tris[o + 6] - tris[o];
		const vy = tris[o + 7] - tris[o + 1];
		const vz = tris[o + 8] - tris[o + 2];
		areas[t] = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
		total += areas[t];
	}
	const samples = max - keepV;
	const out = new Float32Array((keepV + samples + nt) * 3);
	let n = 0;
	// Evenly spread over the vertex list when there are too many of them.
	for (let k = 0; k < keepV; k++) {
		const i = Math.floor((k * nv) / keepV) * 3;
		out[n++] = vertices[i];
		out[n++] = vertices[i + 1];
		out[n++] = vertices[i + 2];
	}
	// A fixed seed: the same model always gives the same plan.
	let seed = 0x9e3779b9;
	const rand = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	let carry = 0;
	for (let t = 0; t < nt && total > 0; t++) {
		carry += (areas[t] / total) * samples;
		while (carry >= 1 && n + 3 <= out.length) {
			carry -= 1;
			let a = rand();
			let b = rand();
			if (a + b > 1) {
				a = 1 - a;
				b = 1 - b;
			}
			const o = t * 9;
			for (let k = 0; k < 3; k++)
				out[n++] =
					tris[o + k] + a * (tris[o + 3 + k] - tris[o + k]) + b * (tris[o + 6 + k] - tris[o + k]);
		}
	}
	return out.slice(0, n);
}

export function rotatePoints(points: Float32Array, m: Mat3): Float32Array {
	const out = new Float32Array(points.length);
	for (let i = 0; i < points.length; i += 3) {
		const x = points[i];
		const y = points[i + 1];
		const z = points[i + 2];
		out[i] = m[0] * x + m[1] * y + m[2] * z;
		out[i + 1] = m[3] * x + m[4] * y + m[5] * z;
		out[i + 2] = m[6] * x + m[7] * y + m[8] * z;
	}
	return out;
}

export function boxOfPoints(points: Float32Array): Box {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < points.length; i += 3)
		for (let k = 0; k < 3; k++) {
			if (points[i + k] < min[k]) min[k] = points[i + k];
			if (points[i + k] > max[k]) max[k] = points[i + k];
		}
	return { min, max };
}

/** The points inside a cell, sorted along each axis. */
type Members = [Uint32Array, Uint32Array, Uint32Array];

function membersOf(points: Float32Array): Members {
	const all = Uint32Array.from({ length: points.length / 3 }, (_, i) => i);
	return [0, 1, 2].map((a) =>
		all.slice().sort((i, j) => points[i * 3 + a] - points[j * 3 + a])
	) as Members;
}

/** How many of the members along `axis` lie at or below `at`. */
function countBelow(points: Float32Array, sorted: Uint32Array, axis: Axis, at: number): number {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (points[sorted[mid] * 3 + axis] <= at) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function splitMembers(
	points: Float32Array,
	m: Members,
	axis: Axis,
	at: number
): [Members, Members] {
	const below = countBelow(points, m[axis], axis, at);
	const left: Uint32Array[] = [];
	const right: Uint32Array[] = [];
	for (let k = 0; k < 3; k++) {
		const l = new Uint32Array(below);
		const r = new Uint32Array(m[k].length - below);
		let nl = 0;
		let nr = 0;
		for (const i of m[k]) {
			if (points[i * 3 + axis] <= at) l[nl++] = i;
			else r[nr++] = i;
		}
		left.push(l);
		right.push(r);
	}
	return [left as Members, right as Members];
}

/** Running bounds of the two face axes along `axis`: [min u, max u, min v, max v] per member. */
function sweep(points: Float32Array, sorted: Uint32Array, axis: Axis) {
	const [u, v] = FACE_AXES[axis];
	const m = sorted.length;
	const pre = new Float64Array(m * 4);
	const suf = new Float64Array(m * 4);
	const acc = [Infinity, -Infinity, Infinity, -Infinity];
	const step = (k: number, into: Float64Array) => {
		const i = sorted[k] * 3;
		acc[0] = Math.min(acc[0], points[i + u]);
		acc[1] = Math.max(acc[1], points[i + u]);
		acc[2] = Math.min(acc[2], points[i + v]);
		acc[3] = Math.max(acc[3], points[i + v]);
		into.set(acc, k * 4);
	};
	for (let k = 0; k < m; k++) step(k, pre);
	acc.splice(0, 4, Infinity, -Infinity, Infinity, -Infinity);
	for (let k = m - 1; k >= 0; k--) step(k, suf);
	return { pre, suf };
}

interface Option {
	axis: Axis;
	at: number;
	left: Box;
	right: Box;
	/** Parts the two halves need by `partsFor`. */
	est: number;
	/** 0 for halves of equal length along the axis, up to 1. */
	skew: number;
}

/**
 * Where a cut may go along an axis: so that one side just fits a bed side,
 * at an even split into as many pieces as needed, and every 1/32 of the
 * length. Never closer than `thin` to either end (a sliver glues badly and
 * has no room for dowels) unless the part is that small.
 */
function positions(lo: number, hi: number, bed: Vec3, thin: number): number[] {
	const length = hi - lo;
	const keep = Math.min(thin, length / 4);
	const out = new Set<number>();
	const add = (t: number) => {
		if (t > lo + keep && t < hi - keep) out.add(Math.round(t * 100) / 100);
	};
	for (const b of new Set(bed)) {
		const n = Math.ceil(length / b - 1e-6);
		for (let k = 1; k < n; k++) {
			add(lo + (length * k) / n);
			add(lo + b * k - 0.01);
			add(hi - b * k + 0.01);
		}
	}
	for (let j = 1; j < 32; j++) add(lo + (length * j) / 32);
	return [...out];
}

function optionsFor(points: Float32Array, m: Members, box: Box, bed: Vec3, thin: number): Option[] {
	const out: Option[] = [];
	for (const axis of [0, 1, 2] as Axis[]) {
		const sorted = m[axis];
		if (sorted.length < 2) continue;
		const { pre, suf } = sweep(points, sorted, axis);
		const [u, v] = FACE_AXES[axis];
		const lo = box.min[axis];
		const hi = box.max[axis];
		for (const at of positions(lo, hi, bed, thin)) {
			const k = countBelow(points, sorted, axis, at);
			if (k === 0 || k === sorted.length) continue;
			const left: Box = { min: [...box.min], max: [...box.max] };
			const right: Box = { min: [...box.min], max: [...box.max] };
			left.max[axis] = at;
			right.min[axis] = at;
			const p = (k - 1) * 4;
			const s = k * 4;
			[left.min[u], left.max[u], left.min[v], left.max[v]] = [
				pre[p],
				pre[p + 1],
				pre[p + 2],
				pre[p + 3]
			];
			[right.min[u], right.max[u], right.min[v], right.max[v]] = [
				suf[s],
				suf[s + 1],
				suf[s + 2],
				suf[s + 3]
			];
			out.push({
				axis,
				at,
				left,
				right,
				est: partsFor(sizeOf(left), bed) + partsFor(sizeOf(right), bed),
				skew: Math.abs(at - lo - (hi - at)) / (hi - lo)
			});
		}
	}
	return out;
}

const MAX_DEPTH = 14;

/** Parts this cell needs when every cut is the best by the estimate alone. */
function greedy(
	points: Float32Array,
	m: Members,
	box: Box,
	bed: Vec3,
	thin: number,
	depth: number
): number {
	if (fits(sizeOf(box), bed)) return 1;
	const options = depth < MAX_DEPTH && m[0].length > 3 ? optionsFor(points, m, box, bed, thin) : [];
	if (!options.length) return partsFor(sizeOf(box), bed);
	const best = options.reduce((a, b) =>
		b.est < a.est || (b.est === a.est && b.skew < a.skew) ? b : a
	);
	const [lm, rm] = splitMembers(points, m, best.axis, best.at);
	return (
		greedy(points, lm, best.left, bed, thin, depth + 1) +
		greedy(points, rm, best.right, bed, thin, depth + 1)
	);
}

/** Every `n`-th of a list, at most `max` of them, ends included. */
function spread<T>(list: T[], max: number): T[] {
	if (list.length <= max) return list;
	return Array.from(
		{ length: max },
		(_, i) => list[Math.round((i * (list.length - 1)) / (max - 1))]
	);
}

export interface PlanOptions {
	/** The build volume a part must fit, mm (already less the margin). */
	bed: Vec3;
	/** Thinnest slab a cut may leave, mm. */
	thin: number;
	/** How the cut faces look; without it only the part count matters. */
	sections?: Sections;
	/** The exact bounds of the model in the planning frame (the points' bounds otherwise). */
	box?: Box;
	/**
	 * Every vertex of the model in the planning frame: with `sections`, a
	 * part's bounds are then exact — its extremes are vertices or lie on its
	 * cut faces. The points may skip vertices to stay fast.
	 */
	vertices?: Float32Array;
	/** Called with 0…1 as the cells are planned. */
	progress?: (fraction: number) => void;
}

/** How many parts the model needs, quickly: for comparing orientations. */
export function countParts(points: Float32Array, bed: Vec3, thin: number): number {
	return greedy(points, membersOf(points), boxOfPoints(points), bed, thin, 0);
}

/**
 * The cut tree. At each cell that does not fit: the cuts that need the
 * fewest parts by the estimate; of those, the ones whose halves really
 * need the fewest (each half planned greedily); of those, the one with the
 * best glue face. With `sections`, the halves' bounds are made exact with
 * their cut faces before the cut is taken.
 */
export function planCuts(points: Float32Array, o: PlanOptions): PlanNode {
	const { bed, thin, sections } = o;
	const root = o.box ?? boxOfPoints(points);
	const cell0: Cell = {
		min: root.min.map((v) => v - 1) as Vec3,
		max: root.max.map((v) => v + 1) as Vec3
	};
	const total = partsFor(sizeOf(root), bed);
	let done = 0;

	/** The model inside a cell, exact: its points and its cut faces. */
	const exactBox = (cell: Cell, m: Members): Box => {
		const box: Box = {
			min: [Infinity, Infinity, Infinity],
			max: [-Infinity, -Infinity, -Infinity]
		};
		const grow = (k: number, v: number) => {
			if (v < box.min[k]) box.min[k] = v;
			if (v > box.max[k]) box.max[k] = v;
		};
		const all = o.vertices;
		if (all) {
			for (let i = 0; i < all.length; i += 3) {
				const x = all[i];
				const y = all[i + 1];
				const z = all[i + 2];
				if (x < cell.min[0] || x > cell.max[0] || y < cell.min[1] || y > cell.max[1]) continue;
				if (z < cell.min[2] || z > cell.max[2]) continue;
				grow(0, x);
				grow(1, y);
				grow(2, z);
			}
		} else for (const i of m[0]) for (let k = 0; k < 3; k++) grow(k, points[i * 3 + k]);
		if (!sections) return box;
		for (const axis of [0, 1, 2] as Axis[]) {
			const [u, v] = FACE_AXES[axis];
			for (const at of [cell.min[axis], cell.max[axis]]) {
				if (at === cell0.min[axis] || at === cell0.max[axis]) continue;
				const face = sections.bounds(
					axis,
					at,
					[cell.min[u], cell.min[v]],
					[cell.max[u], cell.max[v]]
				);
				if (!face) continue;
				grow(axis, at);
				grow(u, face.min[0]);
				grow(u, face.max[0]);
				grow(v, face.min[1]);
				grow(v, face.max[1]);
			}
		}
		return box;
	};

	const plan = (cell: Cell, m: Members, box: Box, depth: number): PlanNode => {
		const leaf = () => {
			done++;
			o.progress?.(Math.min(1, done / Math.max(total, done + 1)));
			return { cell, box };
		};
		if (fits(sizeOf(box), bed) || depth >= MAX_DEPTH || m[0].length < 4) return leaf();
		const options = optionsFor(points, m, box, bed, thin);
		if (!options.length) return leaf();
		const fewest = Math.min(...options.map((x) => x.est));
		const sorted = options
			.filter((x) => x.est === fewest)
			.sort((a, b) => a.axis - b.axis || a.at - b.at);
		// Look one level deeper: the halves planned greedily.
		const counted = spread(sorted, 10).map((x) => {
			const [lm, rm] = splitMembers(points, m, x.axis, x.at);
			return {
				...x,
				count:
					greedy(points, lm, x.left, bed, thin, depth + 1) +
					greedy(points, rm, x.right, bed, thin, depth + 1)
			};
		});
		const least = Math.min(...counted.map((x) => x.count));
		let pool = counted.filter((x) => x.count === least);
		if (sections) {
			pool = spread(pool, 12)
				.map((x) => {
					const [u, v] = FACE_AXES[x.axis];
					const bad = sections.badness(
						x.axis,
						x.at,
						[cell.min[u], cell.min[v]],
						[cell.max[u], cell.max[v]]
					);
					return { ...x, score: bad + 0.2 * x.skew };
				})
				.sort((a, b) => a.score - b.score);
		} else pool.sort((a, b) => a.skew - b.skew);

		// The halves' exact bounds may need more parts than the points said: take
		// the first cut that keeps its promise, or the best that was tried.
		let chosen: { x: Option; halves: [Cell, Members, Box][]; est: number } | null = null;
		for (const x of pool.slice(0, sections ? 4 : 1)) {
			const [lm, rm] = splitMembers(points, m, x.axis, x.at);
			const lc: Cell = { min: [...cell.min], max: [...cell.max] };
			const rc: Cell = { min: [...cell.min], max: [...cell.max] };
			lc.max[x.axis] = x.at;
			rc.min[x.axis] = x.at;
			const lb = sections ? exactBox(lc, lm) : x.left;
			const rb = sections ? exactBox(rc, rm) : x.right;
			const est = partsFor(sizeOf(lb), bed) + partsFor(sizeOf(rb), bed);
			if (!chosen || est < chosen.est)
				chosen = {
					x,
					halves: [
						[lc, lm, lb],
						[rc, rm, rb]
					],
					est
				};
			if (est <= x.est) break;
		}
		if (!chosen) return leaf();
		const [[lc, lm, lb], [rc, rm, rb]] = chosen.halves;
		return {
			cell,
			box,
			cut: {
				axis: chosen.x.axis,
				at: chosen.x.at,
				minus: plan(lc, lm, lb, depth + 1),
				plus: plan(rc, rm, rb, depth + 1)
			}
		};
	};

	return plan(cell0, membersOf(points), root, 0);
}

export function leavesOf(node: PlanNode): PlanNode[] {
	return node.cut ? [...leavesOf(node.cut.minus), ...leavesOf(node.cut.plus)] : [node];
}

const yaw = (deg: number): Mat3 => {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/**
 * The model's main axes (principal components of its points): a scan or a
 * model saved tilted lines up with the build volume. Rows are the axes.
 */
export function principalAxes(points: Float32Array): Mat3 {
	const n = points.length / 3;
	const mean = [0, 0, 0];
	for (let i = 0; i < points.length; i++) mean[i % 3] += points[i] / n;
	const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
	for (let i = 0; i < points.length; i += 3) {
		const d = [points[i] - mean[0], points[i + 1] - mean[1], points[i + 2] - mean[2]];
		for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) c[r * 3 + k] += (d[r] * d[k]) / n;
	}
	// Jacobi rotations on the symmetric covariance; V collects the eigenvectors (columns).
	const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
	for (let sweepN = 0; sweepN < 24; sweepN++) {
		for (const [p, q] of [
			[0, 1],
			[0, 2],
			[1, 2]
		]) {
			const apq = c[p * 3 + q];
			if (Math.abs(apq) < 1e-12) continue;
			const theta = (c[q * 3 + q] - c[p * 3 + p]) / (2 * apq);
			const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
			const cs = 1 / Math.sqrt(t * t + 1);
			const sn = t * cs;
			for (let k = 0; k < 3; k++) {
				const akp = c[k * 3 + p];
				const akq = c[k * 3 + q];
				c[k * 3 + p] = cs * akp - sn * akq;
				c[k * 3 + q] = sn * akp + cs * akq;
			}
			for (let k = 0; k < 3; k++) {
				const apk = c[p * 3 + k];
				const aqk = c[q * 3 + k];
				c[p * 3 + k] = cs * apk - sn * aqk;
				c[q * 3 + k] = sn * apk + cs * aqk;
			}
			for (let k = 0; k < 3; k++) {
				const vkp = v[k * 3 + p];
				const vkq = v[k * 3 + q];
				v[k * 3 + p] = cs * vkp - sn * vkq;
				v[k * 3 + q] = sn * vkp + cs * vkq;
			}
		}
	}
	const order = [0, 1, 2].sort((a, b) => c[b * 4] - c[a * 4]);
	const rows = order.map((k) => [v[k], v[3 + k], v[6 + k]]);
	// Each axis keeps the side it pointed to before, and the frame stays right-handed.
	for (const r of rows) {
		const big = r.reduce((best, x, i) => (Math.abs(x) > Math.abs(r[best]) ? i : best), 0);
		if (r[big] < 0) for (let k = 0; k < 3; k++) r[k] = -r[k];
	}
	const [a, b] = rows;
	rows[2] = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	return rows.flat() as Mat3;
}

/** Angle between two rotations, degrees. */
function turnBetween(a: Mat3, b: Mat3): number {
	// trace(Aᵀ B) = 1 + 2 cos θ
	let tr = 0;
	for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) tr += a[r * 3 + k] * b[r * 3 + k];
	return (Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180) / Math.PI;
}

export interface Orientation {
	/** Model → planning frame. */
	rotation: Mat3;
	/** Turn about the vertical, degrees; null for the model's own main axes. */
	yaw: number | null;
	parts: number;
}

/**
 * Ways to turn the whole model before cutting, each with a quick count of
 * its parts: as it stands (first), turned about the vertical in 15° steps
 * (a long model may fit diagonally), or along its own main axes. The quick
 * count can be a part off either way, so the caller plans the model as it
 * stands for real and a turn only when its count promises fewer parts —
 * the author lined the model up for a reason, a turn must really save.
 */
export function orientations(points: Float32Array, bed: Vec3, thin: number): Orientation[] {
	const tries: { rotation: Mat3; yaw: number | null }[] = [0, 15, 30, 45, 60, 75].map((d) => ({
		rotation: d ? yaw(d) : IDENTITY,
		yaw: d
	}));
	const main = principalAxes(points);
	// The main axes in any order are the same orientation for quarter-turned parts.
	const aligned = [0, 1, 2].every((r) =>
		[0, 1, 2].some((k) => Math.abs(Math.abs(main[r * 3 + k]) - 1) < 0.02)
	);
	if (!aligned && turnBetween(main, IDENTITY) > 3) tries.push({ rotation: main, yaw: null });
	// A quarter of the points tells orientations apart well enough.
	const few = new Float32Array(Math.floor(points.length / 12) * 3);
	for (let i = 0; i < few.length; i += 3) few.set(points.subarray(i * 4, i * 4 + 3), i);
	return tries.map((t) => ({ ...t, parts: countParts(rotatePoints(few, t.rotation), bed, thin) }));
}
