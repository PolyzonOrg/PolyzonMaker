/**
 * «Большая модель по частям» on manifold-3d: the scaled model turned the
 * way that needs the fewest parts, cut by the plan (plan.ts), a dowel
 * socket pair across every joint, each part turned to print on the bed it
 * fits, and the order to glue them in. Runs in the worker; the tests call
 * `bigPrint` directly with the package's own WASM.
 */
import type { CrossSection, Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d';
import { fromManifold } from '../solid';
import { bounds } from '../stl';
import { Bin } from '../booleans/kit';
import {
	CONNECTOR_DEFAULTS,
	dowelShape,
	pinReach,
	pinsIn,
	pinWall,
	socketShape,
	type ConnectorParams
} from '../stl-slicer/model';
import {
	orientations,
	cloudPoints,
	FACE_AXES,
	IDENTITY,
	leavesOf,
	planCuts,
	rotatePoints,
	type Axis,
	type Mat3,
	type Orientation,
	type PlanNode,
	type Sections,
	type Vec3
} from './plan';

export interface Printer {
	id: string;
	label: string;
	/** Build volume X × Y × Z, mm. */
	size: Vec3;
}

/** Build volumes from the makers' specifications. */
export const PRINTERS: readonly Printer[] = [
	{ id: 'a1mini', label: 'A1 mini, Prusa MINI', size: [180, 180, 180] },
	{ id: 'bambu', label: 'Bambu A1, P1S, X1', size: [256, 256, 256] },
	{ id: 'ender3', label: 'Ender-3, K1', size: [220, 220, 250] },
	{ id: 'mk4s', label: 'Prusa MK4S', size: [250, 210, 220] },
	{ id: 'coreone', label: 'Prusa CORE One', size: [250, 220, 270] },
	{ id: 'k1max', label: 'K1 Max', size: [300, 300, 300] }
];

export interface BigPrintParams {
	/** The printer's build volume X × Y × Z, mm. */
	bed: Vec3;
	/** Kept free on every axis (skirt, brim, a margin of safety), mm. */
	margin: number;
	pins: boolean;
	/** Dowel diameter, mm. */
	pinDiameter: number;
	/** Gap between a dowel and its socket, on each side, mm. */
	clearance: number;
}

/**
 * Bambu Lab's 256 mm cube (the most common bed today), 5 mm kept free,
 * 6 mm printed dowels 9 mm into each part with a 0.2 mm push fit.
 */
export const BIG_PRINT_DEFAULTS: BigPrintParams = {
	bed: [256, 256, 256],
	margin: 5,
	pins: true,
	pinDiameter: 6,
	clearance: 0.2
};

/** The dowels these parameters make: round, 1.5 diameters into each part. */
export function connectorOf(p: BigPrintParams): ConnectorParams {
	const d = Math.min(12, Math.max(3, p.pinDiameter));
	return {
		...CONNECTOR_DEFAULTS,
		enabled: p.pins,
		mode: 'dowel',
		shape: 'round',
		diameter: d,
		depth: Math.round(d * 1.5 * 2) / 2,
		count: 0,
		clearance: Math.min(0.6, Math.max(0, p.clearance))
	};
}

/** The space a part may take on the bed: the build volume less the margin. */
export function usableBed(p: BigPrintParams): Vec3 {
	return p.bed.map((v) => Math.max(20, v - Math.max(0, p.margin))) as Vec3;
}

export interface PrintPart {
	/** In the model's own frame, assembled: for the scene. */
	tris: Float32Array;
	/** Turned and set on the bed: for the file. */
	printTris: Float32Array;
	volume: number;
	/** As it stands on the bed, mm. */
	size: Vec3;
	fits: boolean;
}

/** One glueing step: the parts `a[0]…a[1]` (numbers from 1) meet the parts `b[0]…b[1]`. */
export interface Joint {
	a: [number, number];
	b: [number, number];
	pins: number;
	/** The face is level in the model's own frame (otherwise upright or slanted). */
	level: boolean;
	/** Glued area, mm². */
	area: number;
}

export interface BigPrintResult {
	parts: PrintPart[];
	dowels: { tris: Float32Array; printTris: Float32Array; count: number; volume: number } | null;
	/** In the order to glue: the small blocks first, the last joint last. */
	joints: Joint[];
	orientation: Orientation;
	/** The usable build volume the parts were fitted to, mm. */
	bed: Vec3;
}

/** Column-major Mat4 (manifold's layout) of a row-major rotation and a shift. */
function mat4(r: Mat3, t: Vec3 = [0, 0, 0]): Mat4 {
	return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1];
}

const transpose = (r: Mat3): Mat3 => [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];

/** World → a frame where `axis` is Z and the face axes are X and Y (FACE_AXES). */
function toFace(axis: Axis): Mat3 {
	const [u, v] = FACE_AXES[axis];
	const r = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
	r[u] = 1;
	r[3 + v] = 1;
	r[6 + axis] = 1;
	return r;
}

/** The model's cut faces from manifold slices, cached per plane; everything freed with the bin. */
class ModelSections implements Sections {
	/** The model turned so an axis is Z, made on the first slice across it: each is a copy of the mesh. */
	private turned = new Map<string, Manifold>();
	private cache = new Map<string, CrossSection>();

	constructor(
		private wasm: ManifoldToplevel,
		private model: Manifold,
		private coarse: Manifold,
		/** Half-width of the room a dowel needs in a face, mm. */
		private room: number,
		private bin: Bin
	) {}

	slice(kind: 'fine' | 'coarse', axis: Axis, at: number): CrossSection {
		const key = `${kind}${axis}:${at}`;
		let s = this.cache.get(key);
		if (!s) {
			let solid = this.turned.get(kind + axis);
			if (!solid) {
				solid = this.bin.add(
					(kind === 'fine' ? this.model : this.coarse).transform(mat4(toFace(axis)))
				);
				this.turned.set(kind + axis, solid);
			}
			s = this.bin.add(solid.slice(at));
			this.cache.set(key, s);
		}
		return s;
	}

	/** The face inside a rectangle; the caller deletes it. */
	clip(
		kind: 'fine' | 'coarse',
		axis: Axis,
		at: number,
		lo: [number, number],
		hi: [number, number]
	) {
		const rect = this.wasm.CrossSection.square([hi[0] - lo[0], hi[1] - lo[1]]);
		const placed = rect.translate(lo);
		const out = this.slice(kind, axis, at).intersect(placed);
		rect.delete();
		placed.delete();
		return out;
	}

	bounds(axis: Axis, at: number, lo: [number, number], hi: [number, number]) {
		const face = this.clip('fine', axis, at, lo, hi);
		const r = face.isEmpty() ? null : face.bounds();
		face.delete();
		return r
			? {
					min: [r.min[0], r.min[1]] as [number, number],
					max: [r.max[0], r.max[1]] as [number, number]
				}
			: null;
	}

	/**
	 * How bad a joint this face makes. Compact faces score 0; every island
	 * that is too thin for a dowel (an arm, a mirror, a spike) adds 1.5, a
	 * ragged outline (hair, a face, lettering) up to 1, every extra island
	 * 0.4, and a face that changes fast along the axis (a flat side grazed,
	 * fine detail) up to 1. A plane through empty space scores 0: nothing
	 * to glue, nothing to spoil.
	 */
	badness(axis: Axis, at: number, lo: [number, number], hi: [number, number]): number {
		const face = this.clip('coarse', axis, at, lo, hi);
		const area = face.area();
		if (area < 1) {
			face.delete();
			return 0;
		}
		const islands = face.decompose().filter((island) => {
			const keep = island.area() > 1;
			if (!keep) island.delete();
			return keep;
		});
		let bad = 0.4 * Math.max(0, islands.length - 1);
		for (const island of islands) {
			const a = island.area();
			let perimeter = 0;
			for (const ring of island.toPolygons())
				for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
					perimeter += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
			bad += (a / area) * (1 - Math.min(1, (4 * Math.PI * a) / (perimeter * perimeter || 1)));
			const inner = island.offset(-this.room, 'Round');
			if (inner.isEmpty()) bad += 1.5;
			inner.delete();
			island.delete();
		}
		face.delete();
		// How much the face changes a few millimetres either way — the area
		// that is in one but not the other: big near a flat side (a sliver
		// would be left) and in fine detail (a nose, lettering, a mirror).
		const step = Math.max(1, Math.min(4, Math.sqrt(area) / 20));
		const below = this.clip('coarse', axis, at - step, lo, hi);
		const above = this.clip('coarse', axis, at + step, lo, hi);
		const both = below.intersect(above);
		const changed = below.area() + above.area() - 2 * both.area();
		const most = Math.max(area, below.area(), above.area());
		[below, above, both].forEach((s) => s.delete());
		return bad + Math.min(1, changed / most);
	}
}

/** The six ways a part can lie: the direction that ends up pointing down (−Z). */
const DOWN: { dir: Vec3; turn: Mat3 }[] = [
	{ dir: [0, 0, -1], turn: IDENTITY },
	{ dir: [0, 0, 1], turn: [1, 0, 0, 0, -1, 0, 0, 0, -1] },
	{ dir: [1, 0, 0], turn: [0, 0, 1, 0, 1, 0, -1, 0, 0] },
	{ dir: [-1, 0, 0], turn: [0, 0, -1, 0, 1, 0, 1, 0, 0] },
	{ dir: [0, 1, 0], turn: [1, 0, 0, 0, 0, 1, 0, -1, 0] },
	{ dir: [0, -1, 0], turn: [1, 0, 0, 0, 0, -1, 0, 1, 0] }
];
const QUARTER_Z: Mat3 = [0, -1, 0, 1, 0, 0, 0, 0, 1];

const mul = (a: Mat3, b: Mat3): Mat3 => {
	const out = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
	for (let r = 0; r < 3; r++)
		for (let c = 0; c < 3; c++)
			out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
	return out;
};

/**
 * How a part goes on the bed: of the six sides down (and a quarter turn if
 * it only fits that way), one that fits, with the most flat area on the bed
 * — a cut face is the best foundation — and the least surface overhanging
 * by more than 45°, which would need supports.
 */
export function printPose(
	tris: Float32Array,
	bed: Vec3
): { turn: Mat3; size: Vec3; fits: boolean; flat: number } {
	const n = tris.length / 9;
	const normals = new Float32Array(n * 3);
	const areas = new Float32Array(n);
	for (let t = 0; t < n; t++) {
		const o = t * 9;
		const ux = tris[o + 3] - tris[o];
		const uy = tris[o + 4] - tris[o + 1];
		const uz = tris[o + 5] - tris[o + 2];
		const vx = tris[o + 6] - tris[o];
		const vy = tris[o + 7] - tris[o + 1];
		const vz = tris[o + 8] - tris[o + 2];
		const cx = uy * vz - uz * vy;
		const cy = uz * vx - ux * vz;
		const cz = ux * vy - uy * vx;
		const len = Math.hypot(cx, cy, cz);
		if (len < 1e-12) continue;
		areas[t] = len / 2;
		normals[t * 3] = cx / len;
		normals[t * 3 + 1] = cy / len;
		normals[t * 3 + 2] = cz / len;
	}
	const b = bounds(tris);
	let best: { turn: Mat3; size: Vec3; fits: boolean; flat: number; score: number } | null = null;
	for (const { dir, turn } of DOWN) {
		const k = dir.findIndex((v) => v !== 0);
		const reach = dir[k] > 0 ? b.max[k] : -b.min[k];
		let flat = 0;
		let overhang = 0;
		for (let t = 0; t < n; t++) {
			const down =
				normals[t * 3] * dir[0] + normals[t * 3 + 1] * dir[1] + normals[t * 3 + 2] * dir[2];
			if (down <= Math.SQRT1_2) continue;
			const o = t * 9;
			let onBed = down > 0.999;
			for (let c = 0; c < 9 && onBed; c += 3) onBed = tris[o + c + k] * dir[k] > reach - 0.3;
			if (onBed) flat += areas[t];
			else overhang += areas[t];
		}
		let size: Vec3 = [b.size[0], b.size[1], b.size[2]];
		size = [0, 1, 2].map(
			(r) =>
				Math.abs(turn[r * 3]) * size[0] +
				Math.abs(turn[r * 3 + 1]) * size[1] +
				Math.abs(turn[r * 3 + 2]) * size[2]
		) as Vec3;
		let pose = turn;
		const straight = size[0] <= bed[0] && size[1] <= bed[1];
		if (!straight && size[1] <= bed[0] && size[0] <= bed[1]) {
			pose = mul(QUARTER_Z, turn);
			size = [size[1], size[0], size[2]];
		}
		const ok = size[0] <= bed[0] && size[1] <= bed[1] && size[2] <= bed[2];
		// Not fitting is worse than anything; then the smallest overflow.
		const over =
			Math.max(0, size[0] - bed[0]) + Math.max(0, size[1] - bed[1]) + Math.max(0, size[2] - bed[2]);
		const score = (ok ? 0 : 1e12 + over) + overhang - 2 * flat;
		if (!best || score < best.score) best = { turn: pose, size, fits: ok, flat, score };
	}
	return best!;
}

/** A solid as the planner sees it: every vertex, and the plan points (plan.ts `cloudPoints`). */
export interface PlanCloud {
	vertices: Float32Array;
	points: Float32Array;
}

export function planCloud(model: Manifold): PlanCloud {
	const mesh = model.getMesh();
	const stride = mesh.numProp;
	const vertices = new Float32Array((mesh.vertProperties.length / stride) * 3);
	for (let i = 0, o = 0; i < mesh.vertProperties.length; i += stride, o += 3) {
		vertices[o] = mesh.vertProperties[i];
		vertices[o + 1] = mesh.vertProperties[i + 1];
		vertices[o + 2] = mesh.vertProperties[i + 2];
	}
	return { vertices, points: cloudPoints(vertices, fromManifold(model)) };
}

/** Every leaf of the plan as a solid (null where the cell holds nothing), in plan order. */
function cutAll(node: PlanNode, part: Manifold, bin: Bin): (Manifold | null)[] {
	if (!node.cut) return [part.isEmpty() ? null : part];
	const normal: Vec3 = [0, 0, 0];
	normal[node.cut.axis] = 1;
	const [plus, minus] = part.splitByPlane(normal, node.cut.at).map((m) => bin.add(m));
	return [...cutAll(node.cut.minus, minus, bin), ...cutAll(node.cut.plus, plus, bin)];
}

/**
 * Cut the model (already scaled, in its own frame) for this printer.
 * `cloud` is `planCloud(model)`, `coarse` a simplified copy for judging cut
 * faces quickly.
 */
export function bigPrint(
	wasm: ManifoldToplevel,
	model: Manifold,
	coarse: Manifold,
	cloud: PlanCloud,
	p: BigPrintParams,
	progress: (fraction: number) => void = () => {}
): BigPrintResult {
	const bin = new Bin();
	try {
		const bed = usableBed(p);
		const c = connectorOf(p);
		const reach = pinReach(c);
		const room = c.diameter / 2 + c.clearance + pinWall(c);
		// A slab must hold a socket from each side with a floor under it.
		const thin = p.pins ? 2 * (reach + pinWall(c)) : 10;

		const turns = orientations(cloud.points, bed, thin);
		progress(0.1);
		const planFor = (o: Orientation, from: number, to: number) => {
			const r = o.rotation;
			const turned = r === IDENTITY ? model : bin.add(model.transform(mat4(r)));
			const turnedCoarse = r === IDENTITY ? coarse : bin.add(coarse.transform(mat4(r)));
			const box = turned.boundingBox();
			const sections = new ModelSections(wasm, turned, turnedCoarse, room, bin);
			const tree = planCuts(rotatePoints(cloud.points, r), {
				bed,
				thin,
				sections,
				vertices: rotatePoints(cloud.vertices, r),
				box: { min: [...box.min] as Vec3, max: [...box.max] as Vec3 },
				progress: (f) => progress(from + (to - from) * f)
			});
			const leaves = leavesOf(tree);
			return { orientation: { ...o, parts: leaves.length }, turned, sections, tree, leaves };
		};
		// The model as drawn, and a turn only if it promises fewer parts and keeps the promise.
		let plan = planFor(turns[0], 0.1, 0.45);
		const rival = turns
			.slice(1)
			.filter((t) => t.parts < plan.leaves.length)
			.sort((a, b) => a.parts - b.parts)[0];
		if (rival) {
			const turned = planFor(rival, 0.45, 0.6);
			if (turned.leaves.length < plan.leaves.length) plan = turned;
		}
		progress(0.6);
		const { orientation, turned, sections, tree, leaves } = plan;
		const r = orientation.rotation;
		const solids = cutAll(tree, turned, bin);
		progress(0.7);

		// Dowels across every joint: for each cut, each pair of parts that meet
		// on it, where both are solid to the full socket depth.
		const sockets: Manifold[] = [];
		const dowels: Manifold[] = [];
		const socket = bin.add(socketShape(wasm, c, -(c.depth + c.clearance), c.depth + c.clearance));
		const dowel = bin.add(dowelShape(wasm, c));
		const touching = new Map<PlanNode, { pins: number; area: number }>();
		const walk = (node: PlanNode) => {
			if (!node.cut) return;
			const { axis, at, minus, plus } = node.cut;
			const [u, v] = FACE_AXES[axis];
			const below = leavesOf(minus).filter((l) => l.cell.max[axis] === at);
			const above = leavesOf(plus).filter((l) => l.cell.min[axis] === at);
			let pins = 0;
			let area = 0;
			for (const a of below)
				for (const b of above) {
					const lo: [number, number] = [
						Math.max(a.cell.min[u], b.cell.min[u]),
						Math.max(a.cell.min[v], b.cell.min[v])
					];
					const hi: [number, number] = [
						Math.min(a.cell.max[u], b.cell.max[u]),
						Math.min(a.cell.max[v], b.cell.max[v])
					];
					if (hi[0] - lo[0] < 1e-6 || hi[1] - lo[1] < 1e-6) continue;
					const face = sections.clip('fine', axis, at, lo, hi);
					area += face.area();
					const deep = a.cell.min[axis] < at - reach && b.cell.max[axis] > at + reach;
					if (c.enabled && deep && !face.isEmpty()) {
						const sides = [at - reach, at + reach].map((t) =>
							bin.add(sections.clip('fine', axis, t, lo, hi))
						);
						const common = bin.add(wasm.CrossSection.intersection([face, ...sides]));
						const back = transpose(toFace(axis));
						for (const [x, y] of pinsIn(common, c, bin)) {
							const centre = [0, 0, 0] as Vec3;
							centre[u] = x;
							centre[v] = y;
							centre[axis] = at;
							const place = mat4(back, centre);
							sockets.push(bin.add(socket.transform(place)));
							dowels.push(bin.add(dowel.transform(place)));
							pins++;
						}
					}
					face.delete();
				}
			touching.set(node, { pins, area });
			walk(minus);
			walk(plus);
		};
		walk(tree);
		const holes = sockets.length ? bin.add(wasm.Manifold.union(sockets)) : null;
		progress(0.8);

		// Parts numbered from 1 in plan order: every block of the plan is a run of numbers.
		const number = new Map<PlanNode, number>();
		const parts: PrintPart[] = [];
		const back = transpose(r);
		leaves.forEach((leaf, i) => {
			let solid = solids[i];
			if (!solid) return;
			if (holes) solid = bin.add(solid.subtract(holes));
			if (solid.isEmpty()) return;
			const tris = fromManifold(solid);
			const pose = printPose(tris, bed);
			number.set(leaf, parts.length + 1);
			parts.push({
				tris: r === IDENTITY ? tris : rotatePoints(tris, back),
				printTris: rotatePoints(tris, pose.turn),
				volume: solid.volume(),
				size: pose.size,
				fits: pose.fits
			});
			progress(0.8 + (0.15 * (i + 1)) / leaves.length);
		});

		// Glue order: a joint after the joints inside both of its blocks.
		const joints: Joint[] = [];
		const range = (node: PlanNode): [number, number] | null => {
			const ids = leavesOf(node)
				.map((l) => number.get(l))
				.filter((x): x is number => x !== undefined);
			return ids.length ? [Math.min(...ids), Math.max(...ids)] : null;
		};
		const order = (node: PlanNode) => {
			if (!node.cut) return;
			order(node.cut.minus);
			order(node.cut.plus);
			const a = range(node.cut.minus);
			const b = range(node.cut.plus);
			const t = touching.get(node);
			if (!a || !b || !t || t.area < 1) return;
			const normal: Vec3 = [0, 0, 0];
			normal[node.cut.axis] = 1;
			// The face's normal back in the model's frame: level when it points up.
			const up = Math.abs(back[6] * normal[0] + back[7] * normal[1] + back[8] * normal[2]);
			joints.push({ a, b, pins: t.pins, level: up > 0.99, area: t.area });
		};
		order(tree);

		let dowelSet: BigPrintResult['dowels'] = null;
		if (dowels.length) {
			const all = bin.add(wasm.Manifold.union(dowels));
			// For printing: standing on end in rows, a gap of 3 mm between them.
			const standing = bin.add(dowel.translate([0, 0, c.depth]));
			const cols = Math.ceil(Math.sqrt(dowels.length));
			const gap = c.diameter + 3;
			const grid = bin.add(
				wasm.Manifold.union(
					dowels.map((_, i) =>
						bin.add(standing.translate([(i % cols) * gap, Math.floor(i / cols) * gap, 0]))
					)
				)
			);
			const tris = fromManifold(all);
			dowelSet = {
				tris: r === IDENTITY ? tris : rotatePoints(tris, back),
				printTris: fromManifold(grid),
				count: dowels.length,
				volume: grid.volume()
			};
		}
		progress(1);
		return { parts, dowels: dowelSet, joints, orientation, bed };
	} finally {
		bin.free();
	}
}
