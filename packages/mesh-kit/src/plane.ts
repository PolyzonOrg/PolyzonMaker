/**
 * Cut planes for the mesh tools (cutter, hollow box): an axis, a position
 * along it and two tilts, as in a slicer's cut tool. A plane is
 * `normal · p = offset`. Pure math.
 */
import type { Mat4 } from 'manifold-3d';
import type { Vec3 } from './stl.js';

export type Axis = 'x' | 'y' | 'z';

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
 * its normal along +Z, `toWorld` brings local geometry back. Column-major,
 * the layout manifold-3d's `transform` takes.
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
