/**
 * Sculpting for CAD programs (`sdf` in program.ts): organic shapes — figures,
 * animals, characters, soft grips — from distance fields. A shape is a
 * function «how far is this point from the surface» (negative inside), so
 * shapes blend with a chosen radius like clay (smooth min), which B-rep
 * fillets of fused ellipsoids cannot do. Manifold's levelSet turns the field
 * into a closed mesh for printing.
 *
 * The primitives and blends follow the formulas everyone draws shaders with
 * (Inigo Quilez's distance functions), so a model writes them the way it has
 * seen them. Units are mm, Z up; every shape knows a box that holds it.
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';

type V3 = [number, number, number];
type Field = (x: number, y: number, z: number) => number;

/** Mesh resolution: a side of this many cells across the largest size, unless asked. */
const CELLS = 110;
/** Grid cells one mesh may take; past it the cells grow. */
const MAX_CELLS = 6_000_000;

/**
 * Arguments are checked where the call is made, and a wrong one fails there
 * with the signature: on prod an axis passed where the rounding goes made the
 * field NaN, and «empty» came only at sdf.mesh, lines later, nine builds running.
 */
const shown = (v: unknown) =>
	v === undefined ? 'undefined' : (JSON.stringify(v)?.slice(0, 40) ?? typeof v);

function num(sig: string, name: string, v: unknown, min = -Infinity): number {
	if (typeof v !== 'number' || !Number.isFinite(v) || v < min) {
		const what = min === 0 ? 'a number ≥ 0' : min > 0 ? 'a number above 0' : 'a number';
		throw new Error(`${sig}: ${name} must be ${what}, got ${shown(v)}`);
	}
	return v;
}

function vec(sig: string, name: string, v: unknown): V3 {
	if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => Number.isFinite(x))) {
		throw new Error(`${sig}: ${name} must be [x, y, z], got ${shown(v)}`);
	}
	return v as V3;
}

function shapeArg(sig: string, name: string, v: unknown): Sdf {
	if (!(v instanceof Sdf)) throw new Error(`${sig}: ${name} is not an sdf shape, got ${shown(v)}`);
	return v;
}

const SIG = {
	sphere: 'sdf.sphere(r, [center])',
	ellipsoid: 'sdf.ellipsoid([rx, ry, rz], [center])',
	box: 'sdf.box([sx, sy, sz], [center], round)',
	cylinder: 'sdf.cylinder(r, h, [base], [direction], round)',
	capsule: 'sdf.capsule([a], [b], r | [ra, rb])',
	torus: 'sdf.torus(R, r, [center])',
	tube: 'sdf.tube([[x, y, z, r], …], k)',
	union: 'sdf.union(k, ...shapes)',
	cut: 'sdf.cut(k, shape, ...tools)',
	intersect: 'sdf.intersect(k, a, b)'
} as const;

export class Sdf {
	constructor(
		/** Signed distance: negative inside, in mm. */
		readonly d: Field,
		/** A box that holds the shape. */
		readonly min: V3,
		readonly max: V3
	) {}

	/** Moved by (dx, dy, dz). */
	move(dx: number, dy = 0, dz = 0): Sdf {
		const sig = '.move(dx, dy, dz)';
		[dx, dy, dz] = [num(sig, 'dx', dx), num(sig, 'dy', dy), num(sig, 'dz', dz)];
		const d = this.d;
		return new Sdf(
			(x, y, z) => d(x - dx, y - dy, z - dz),
			[this.min[0] + dx, this.min[1] + dy, this.min[2] + dz],
			[this.max[0] + dx, this.max[1] + dy, this.max[2] + dz]
		);
	}

	/** The same as move, named as solids name it. */
	translate(dx: number, dy = 0, dz = 0): Sdf {
		return this.move(dx, dy, dz);
	}

	/** Turned by `deg` about an axis ('x', 'y', 'z' or a vector) through `center`. */
	rotate(deg: number, axis: 'x' | 'y' | 'z' | V3 = 'z', center: V3 = [0, 0, 0]): Sdf {
		const sig = ".rotate(deg, 'x' | 'y' | 'z' | [axis], [center])";
		num(sig, 'deg', deg);
		vec(sig, 'center', center);
		const a =
			typeof axis === 'string'
				? ({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const)[axis]
				: vec(sig, 'axis', axis);
		if (!a || Math.hypot(a[0], a[1], a[2]) === 0) {
			throw new Error(`${sig}: axis must be 'x', 'y', 'z' or a direction, got ${shown(axis)}`);
		}
		const len = Math.hypot(a[0], a[1], a[2]);
		const [ux, uy, uz] = [a[0] / len, a[1] / len, a[2] / len];
		const t = (deg * Math.PI) / 180;
		const c = Math.cos(t);
		const s = Math.sin(t);
		const k = 1 - c;
		// Rodrigues: rotation matrix R; the field reads the point turned back (Rᵀ).
		const R = [
			[c + ux * ux * k, ux * uy * k - uz * s, ux * uz * k + uy * s],
			[uy * ux * k + uz * s, c + uy * uy * k, uy * uz * k - ux * s],
			[uz * ux * k - uy * s, uz * uy * k + ux * s, c + uz * uz * k]
		];
		const [cx, cy, cz] = center;
		const d = this.d;
		const field: Field = (x, y, z) => {
			const px = x - cx;
			const py = y - cy;
			const pz = z - cz;
			return d(
				R[0][0] * px + R[1][0] * py + R[2][0] * pz + cx,
				R[0][1] * px + R[1][1] * py + R[2][1] * pz + cy,
				R[0][2] * px + R[1][2] * py + R[2][2] * pz + cz
			);
		};
		const corners: V3[] = [];
		for (const x of [this.min[0], this.max[0]])
			for (const y of [this.min[1], this.max[1]])
				for (const z of [this.min[2], this.max[2]]) {
					const p = [x - cx, y - cy, z - cz];
					corners.push([
						R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + cx,
						R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + cy,
						R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + cz
					]);
				}
		return new Sdf(field, boxMin(corners), boxMax(corners));
	}

	/** Scaled by `k` about the origin. */
	scale(k: number): Sdf {
		num('.scale(k)', 'k', k, Number.MIN_VALUE);
		const d = this.d;
		return new Sdf(
			(x, y, z) => d(x / k, y / k, z / k) * k,
			this.min.map((v) => v * k) as V3,
			this.max.map((v) => v * k) as V3
		);
	}

	/** This shape and its mirror image across the plane x = 0 (or y, z): two ears, two paws. */
	mirror(axis: 'x' | 'y' | 'z' = 'x'): Sdf {
		const i = { x: 0, y: 1, z: 2 }[axis];
		if (i === undefined) {
			throw new Error(
				`.mirror('x' | 'y' | 'z'): the axis across whose zero plane, got ${shown(axis)}`
			);
		}
		const d = this.d;
		const min = [...this.min] as V3;
		const max = [...this.max] as V3;
		const reach = Math.max(Math.abs(this.min[i]), Math.abs(this.max[i]));
		min[i] = -reach;
		max[i] = reach;
		return new Sdf(
			(x, y, z) => {
				const p: V3 = [x, y, z];
				p[i] = Math.abs(p[i]);
				return Math.min(d(p[0], p[1], p[2]), d(x, y, z));
			},
			min,
			max
		);
	}

	/** Grown outward by `r` mm (softer, rounder). */
	round(r: number): Sdf {
		num('.round(r)', 'r', r);
		const d = this.d;
		return new Sdf((x, y, z) => d(x, y, z) - r, shift(this.min, -r), shift(this.max, r));
	}

	/** A hollow skin `t` mm thick around the surface (cut it open with sdf.cut to see inside). */
	shell(t: number): Sdf {
		num('.shell(t)', 't', t, Number.MIN_VALUE);
		const d = this.d;
		return new Sdf(
			(x, y, z) => Math.abs(d(x, y, z)) - t / 2,
			shift(this.min, -t),
			shift(this.max, t)
		);
	}
}

const boxMin = (ps: V3[]): V3 => [0, 1, 2].map((k) => Math.min(...ps.map((p) => p[k]))) as V3;
const boxMax = (ps: V3[]): V3 => [0, 1, 2].map((k) => Math.max(...ps.map((p) => p[k]))) as V3;
/** A box corner moved by `by` mm on every axis. */
const shift = (v: V3, by: number): V3 => [v[0] + by, v[1] + by, v[2] + by];

/** Polynomial smooth minimum: the blend `k` mm wide (0 = a hard union). */
function smin(a: number, b: number, k: number): number {
	if (k <= 0) return Math.min(a, b);
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - h * h * k * 0.25;
}

function round3(a: V3, b: V3, r: number): [V3, V3] {
	return [
		[Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r],
		[Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r]
	];
}

/** A cone between two spheres (radius ra at a, rb at b): limbs, necks, tails. */
function roundCone(a: V3, b: V3, ra: number, rb: number): Sdf {
	const bax = b[0] - a[0];
	const bay = b[1] - a[1];
	const baz = b[2] - a[2];
	const l2 = bax * bax + bay * bay + baz * baz;
	const rr = ra - rb;
	const a2 = l2 - rr * rr;
	const il2 = l2 > 0 ? 1 / l2 : 0;
	const [min, max] = round3(a, b, Math.max(ra, rb));
	if (l2 === 0) return sphere(Math.max(ra, rb), a);
	return new Sdf(
		(x, y, z) => {
			const pax = x - a[0];
			const pay = y - a[1];
			const paz = z - a[2];
			const yy = pax * bax + pay * bay + paz * baz;
			const zz = yy - l2;
			const qx = pax * l2 - bax * yy;
			const qy = pay * l2 - bay * yy;
			const qz = paz * l2 - baz * yy;
			const x2 = qx * qx + qy * qy + qz * qz;
			const y2 = yy * yy * l2;
			const z2 = zz * zz * l2;
			const k = Math.sign(rr) * rr * rr * x2;
			if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
			if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
			return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
		},
		min,
		max
	);
}

export function sphere(r: number, c: V3 = [0, 0, 0]): Sdf {
	num(SIG.sphere, 'r', r, Number.MIN_VALUE);
	vec(SIG.sphere, 'center', c);
	return new Sdf(
		(x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r,
		[c[0] - r, c[1] - r, c[2] - r],
		[c[0] + r, c[1] + r, c[2] + r]
	);
}

export const sdfApi = {
	sphere,
	/** Radii along X, Y, Z (an egg, a belly, a head). */
	ellipsoid(r: V3, c: V3 = [0, 0, 0]): Sdf {
		vec(SIG.ellipsoid, '[rx, ry, rz]', r).forEach((v, i) =>
			num(SIG.ellipsoid, `r${'xyz'[i]}`, v, Number.MIN_VALUE)
		);
		vec(SIG.ellipsoid, 'center', c);
		return new Sdf(
			(x, y, z) => {
				const px = (x - c[0]) / r[0];
				const py = (y - c[1]) / r[1];
				const pz = (z - c[2]) / r[2];
				const k0 = Math.hypot(px, py, pz);
				const k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
				return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
			},
			[c[0] - r[0], c[1] - r[1], c[2] - r[2]],
			[c[0] + r[0], c[1] + r[1], c[2] + r[2]]
		);
	},
	/** A box of size [x, y, z] centred at c, edges rounded by `round`. */
	box(size: V3, c: V3 = [0, 0, 0], round = 0): Sdf {
		vec(SIG.box, '[sx, sy, sz]', size).forEach((v, i) =>
			num(SIG.box, `s${'xyz'[i]}`, v, Number.MIN_VALUE)
		);
		vec(SIG.box, 'center', c);
		// Rounder than half the thinnest side turns the box inside out: as round as it goes.
		round = Math.min(num(SIG.box, 'round', round, 0), Math.min(...size) / 2);
		const h = size.map((v) => v / 2 - round) as V3;
		return new Sdf(
			(x, y, z) => {
				const qx = Math.abs(x - c[0]) - h[0];
				const qy = Math.abs(y - c[1]) - h[1];
				const qz = Math.abs(z - c[2]) - h[2];
				return (
					Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) +
					Math.min(Math.max(qx, qy, qz), 0) -
					round
				);
			},
			[c[0] - size[0] / 2, c[1] - size[1] / 2, c[2] - size[2] / 2],
			[c[0] + size[0] / 2, c[1] + size[1] / 2, c[2] + size[2] / 2]
		);
	},
	/**
	 * A cylinder of radius r from its base at c, h mm along `direction` (up when
	 * left out, as makeCylinder takes it), edges rounded by `round`.
	 */
	cylinder(r: number, h: number, c: V3 = [0, 0, 0], direction?: V3 | number, round?: number): Sdf {
		num(SIG.cylinder, 'r', r, Number.MIN_VALUE);
		num(SIG.cylinder, 'h', h, Number.MIN_VALUE);
		vec(SIG.cylinder, 'base', c);
		// (r, h, base, round) as well: the axis is the one argument that is a list.
		const axis = Array.isArray(direction) ? vec(SIG.cylinder, 'direction', direction) : null;
		const rounding = num(SIG.cylinder, 'round', (axis ? round : direction) ?? 0, 0);
		const rr = Math.min(rounding, r, h / 2);
		const mid = c[2] + h / 2;
		const upright = new Sdf(
			(x, y, z) => {
				const dx = Math.hypot(x - c[0], y - c[1]) - (r - rr);
				const dz = Math.abs(z - mid) - (h / 2 - rr);
				return Math.min(Math.max(dx, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) - rr;
			},
			[c[0] - r, c[1] - r, c[2]],
			[c[0] + r, c[1] + r, c[2] + h]
		);
		if (!axis) return upright;
		const len = Math.hypot(...axis);
		if (len === 0) throw new Error(`${SIG.cylinder}: direction must not be [0, 0, 0]`);
		// Z turned onto the axis: about Z × axis by the angle between them.
		const turn: V3 = [-axis[1], axis[0], 0];
		const deg = (Math.acos(Math.max(-1, Math.min(1, axis[2] / len))) * 180) / Math.PI;
		if (Math.hypot(...turn) < 1e-9) return deg < 90 ? upright : upright.rotate(180, 'x', c);
		return upright.rotate(deg, turn, c);
	},
	/** From a to b with radius r — or [ra, rb], a cone with round ends. */
	capsule(a: V3, b: V3, r: number | [number, number]): Sdf {
		vec(SIG.capsule, 'a', a);
		vec(SIG.capsule, 'b', b);
		const [ra, rb] = typeof r === 'number' ? [r, r] : Array.isArray(r) ? r : [r, r];
		return roundCone(
			a,
			b,
			num(SIG.capsule, 'r', ra, Number.MIN_VALUE),
			num(SIG.capsule, 'rb', rb, Number.MIN_VALUE)
		);
	},
	/** A ring of radius R and thickness r lying in the XY plane at c. */
	torus(R: number, r: number, c: V3 = [0, 0, 0]): Sdf {
		num(SIG.torus, 'R', R, Number.MIN_VALUE);
		num(SIG.torus, 'r', r, Number.MIN_VALUE);
		vec(SIG.torus, 'center', c);
		return new Sdf(
			(x, y, z) => Math.hypot(Math.hypot(x - c[0], y - c[1]) - R, z - c[2]) - r,
			[c[0] - R - r, c[1] - R - r, c[2] - r],
			[c[0] + R + r, c[1] + R + r, c[2] + r]
		);
	},
	/** A smooth tube through points [x, y, z, radius] — a tail, a trunk, a handle, a snake. */
	tube(points: Array<[number, number, number, number]>, k = 0): Sdf {
		if (!Array.isArray(points) || points.length < 2) {
			throw new Error(`${SIG.tube}: needs at least two points [x, y, z, r], got ${shown(points)}`);
		}
		points.forEach((p, i) => {
			if (!Array.isArray(p) || p.length !== 4 || !p.every((v) => Number.isFinite(v)) || p[3] <= 0) {
				throw new Error(`${SIG.tube}: point ${i + 1} must be [x, y, z, r], got ${shown(p)}`);
			}
		});
		const pieces = points
			.slice(1)
			.map((p, i) =>
				roundCone(points[i].slice(0, 3) as V3, p.slice(0, 3) as V3, points[i][3], p[3])
			);
		return sdfApi.union(k, ...pieces);
	},
	/** Shapes merged; `k` mm is how wide the soft seam between them is (0 = hard). */
	union(k: number, ...shapes: Sdf[]): Sdf {
		num(SIG.union, 'k', k, 0);
		if (shapes.length === 0) throw new Error(`${SIG.union}: needs shapes`);
		shapes.forEach((s, i) => shapeArg(SIG.union, `shape ${i + 1}`, s));
		const ds = shapes.map((s) => s.d);
		return new Sdf(
			(x, y, z) => {
				let d = ds[0](x, y, z);
				for (let i = 1; i < ds.length; i++) d = smin(d, ds[i](x, y, z), k);
				return d;
			},
			shift(boxMin(shapes.map((s) => s.min)), -k / 4),
			shift(boxMax(shapes.map((s) => s.max)), k / 4)
		);
	},
	/** `shape` with the tools carved out (eyes, a mouth, a hollow), the edge softened by `k`. */
	cut(k: number, shape: Sdf, ...tools: Sdf[]): Sdf {
		num(SIG.cut, 'k', k, 0);
		shapeArg(SIG.cut, 'shape', shape);
		tools.forEach((t, i) => shapeArg(SIG.cut, `tool ${i + 1}`, t));
		const d = shape.d;
		const ts = tools.map((t) => t.d);
		return new Sdf(
			(x, y, z) => {
				let v = d(x, y, z);
				for (const t of ts) v = -smin(-v, t(x, y, z), k);
				return v;
			},
			shape.min,
			shape.max
		);
	},
	/** Only where both are (a shape trimmed by another), the edge softened by `k`. */
	intersect(k: number, a: Sdf, b: Sdf): Sdf {
		num(SIG.intersect, 'k', k, 0);
		shapeArg(SIG.intersect, 'a', a);
		shapeArg(SIG.intersect, 'b', b);
		return new Sdf(
			(x, y, z) => -smin(-a.d(x, y, z), -b.d(x, y, z), k),
			[0, 1, 2].map((i) => Math.max(a.min[i], b.min[i])) as V3,
			[0, 1, 2].map((i) => Math.min(a.max[i], b.max[i])) as V3
		);
	}
};

/**
 * The closed mesh of a field. `detail`: the cell size in mm (default: the
 * largest size / 110 — about 0.7 mm on an 80 mm figure, under a second).
 */
export function meshSdf(mf: ManifoldToplevel, shape: Sdf, detail?: number): Manifold {
	shapeArg('sdf.mesh(shape, detail)', 'shape', shape);
	const size = [0, 1, 2].map((i) => shape.max[i] - shape.min[i]);
	if (!size.every((v) => Number.isFinite(v) && v > 0)) {
		throw new Error(
			'sdf shape is empty: its box has no size — sdf.intersect of shapes that do not meet?'
		);
	}
	const mid = [0, 1, 2].map((i) => (shape.min[i] + shape.max[i]) / 2);
	if (!Number.isFinite(shape.d(mid[0], mid[1], mid[2]))) {
		throw new Error('sdf shape is not a number inside: one of its calls got a wrong value');
	}
	let edge = detail ?? Math.max(...size) / CELLS;
	const cells = () => size.reduce((n, v) => n * (v / edge + 4), 1);
	while (cells() > MAX_CELLS) edge *= 1.2;
	const pad = edge * 2;
	const d = shape.d;
	const mesh = mf.Manifold.levelSet(
		// Manifold wants positive inside.
		(p: [number, number, number]) => -d(p[0], p[1], p[2]),
		{
			min: [shape.min[0] - pad, shape.min[1] - pad, shape.min[2] - pad],
			max: [shape.max[0] + pad, shape.max[1] + pad, shape.max[2] + pad]
		},
		edge
	);
	if (mesh.isEmpty()) {
		throw new Error(
			'sdf shape is empty: no point of it is inside — an sdf.cut that takes all of it, or shapes far smaller than the mesh detail'
		);
	}
	return mesh;
}
