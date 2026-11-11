/**
 * Cut planes for the mesh tools (slicer, hollow box, mold, flexi): an axis,
 * a position along it and two tilts, as in a slicer's cut tool. A plane is
 * `normal · p = offset`. Pure math, shared by the pages, workers and tests.
 */

export type Axis = 'x' | 'y' | 'z';
export type Vec3 = [number, number, number];
/** Column-major 4×4, the layout manifold-3d's `transform` takes. */
export type Mat4 = [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number
];

export interface Plane {
	normal: Vec3;
	offset: number;
	/** A point on the plane (the centre the tilts turn around). */
	point: Vec3;
}

export const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/** The two axes a tilt turns towards: X → (Y, Z), Y → (X, Z), Z → (X, Y). */
const TILT_AXES: Record<Axis, [0 | 1 | 2, 0 | 1 | 2]> = { x: [1, 2], y: [0, 2], z: [0, 1] };

export function normalize(v: Vec3): Vec3 {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The axis turned by `tilt1` towards the first other axis and `tilt2` towards the second. */
export function planeNormal(axis: Axis, tilt1Deg = 0, tilt2Deg = 0): Vec3 {
	const n: Vec3 = [0, 0, 0];
	n[AXIS_INDEX[axis]] = 1;
	const [a, b] = TILT_AXES[axis];
	const clamp = (d: number) => (Math.max(-80, Math.min(80, d)) * Math.PI) / 180;
	n[a] += Math.tan(clamp(tilt1Deg));
	n[b] += Math.tan(clamp(tilt2Deg));
	return normalize(n);
}

/** The plane through `center` with its axis coordinate moved to `position`. */
export function planeAt(
	axis: Axis,
	position: number,
	center: Vec3,
	tilt1Deg = 0,
	tilt2Deg = 0
): Plane {
	const point: Vec3 = [...center];
	point[AXIS_INDEX[axis]] = position;
	const normal = planeNormal(axis, tilt1Deg, tilt2Deg);
	return { normal, point, offset: dot(normal, point) };
}

/**
 * An orthonormal frame on the plane: `toLocal` puts the plane at z = 0 with
 * its normal along +Z, `toWorld` brings local geometry back.
 */
export function planeFrame(plane: Plane, up?: Vec3): { toLocal: Mat4; toWorld: Mat4 } {
	const n = normalize(plane.normal);
	// u: the requested in-plane direction, or any axis not parallel to n.
	let u: Vec3;
	if (up && Math.abs(dot(normalize(up), n)) < 0.99) {
		const k = dot(up, n);
		u = normalize([up[0] - k * n[0], up[1] - k * n[1], up[2] - k * n[2]]);
	} else {
		const seed: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
		u = normalize(cross(cross(n, seed), n));
	}
	const v = cross(n, u);
	const p = plane.point;
	const toWorld: Mat4 = [
		u[0],
		u[1],
		u[2],
		0,
		v[0],
		v[1],
		v[2],
		0,
		n[0],
		n[1],
		n[2],
		0,
		p[0],
		p[1],
		p[2],
		1
	];
	// Inverse of a rigid frame: transpose the rotation, rotate the translation back.
	const toLocal: Mat4 = [
		u[0],
		v[0],
		n[0],
		0,
		u[1],
		v[1],
		n[1],
		0,
		u[2],
		v[2],
		n[2],
		0,
		-dot(u, p),
		-dot(v, p),
		-dot(n, p),
		1
	];
	return { toLocal, toWorld };
}

export function applyMat4(m: Mat4, p: Vec3): Vec3 {
	return [
		m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
		m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
		m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
	];
}

/** Triangles moved by a rigid transform (rotation keeps the winding). */
export function transformTriangles(tris: Float32Array, m: Mat4): Float32Array {
	const out = new Float32Array(tris.length);
	for (let i = 0; i < tris.length; i += 3) {
		const x = tris[i];
		const y = tris[i + 1];
		const z = tris[i + 2];
		out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
		out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
		out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
	}
	return out;
}

/** Rotation by 90° steps about an axis through `center`. */
export function quarterTurn(axis: Axis, turns: number, center: Vec3): Mat4 {
	const a = (((turns % 4) + 4) % 4) * (Math.PI / 2);
	const c = Math.round(Math.cos(a));
	const s = Math.round(Math.sin(a));
	// Rotation matrix rows for each axis.
	const r =
		axis === 'x'
			? [1, 0, 0, 0, c, -s, 0, s, c]
			: axis === 'y'
				? [c, 0, s, 0, 1, 0, -s, 0, c]
				: [c, -s, 0, s, c, 0, 0, 0, 1];
	const [cx, cy, cz] = center;
	const tx = cx - (r[0] * cx + r[1] * cy + r[2] * cz);
	const ty = cy - (r[3] * cx + r[4] * cy + r[5] * cz);
	const tz = cz - (r[6] * cx + r[7] * cy + r[8] * cz);
	return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, tx, ty, tz, 1];
}
