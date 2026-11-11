/**
 * «Размер и поворот»: an uploaded model laid on its flattest side, turned in
 * quarter turns, mirrored and scaled to an exact size or percent, then put
 * on the bed at the origin. Pure math on triangle soup — no booleans, so it
 * works on any mesh, closed or not.
 */
import { bounds, placeOnBed, type Triangles } from '../stl';

export type SizeBy = 'scale' | 'x' | 'y' | 'z' | 'max';
export type Turn = 0 | 90 | 180 | 270;
type Vec3 = [number, number, number];

export interface ResizeParams {
	/** Lay the largest flat side down, like «Положить на грань» in a slicer */
	flat: boolean;
	turnX: Turn;
	turnY: Turn;
	turnZ: Turn;
	mirror: boolean;
	by: SizeBy;
	/** Percent when `by` is «scale», mm otherwise */
	value: number;
}

export const RESIZE_DEFAULTS: ResizeParams = {
	flat: false,
	turnX: 0,
	turnY: 0,
	turnZ: 0,
	mirror: false,
	by: 'scale',
	value: 100
};

/** Row-major 3×3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

const mul = (a: Mat3, b: Mat3): Mat3 => {
	const out = new Array(9).fill(0) as Mat3;
	for (let r = 0; r < 3; r++)
		for (let c = 0; c < 3; c++)
			out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
	return out;
};

/** A quarter turn about a world axis: exact zeros and ones, no drift. */
function quarter(axis: 0 | 1 | 2, deg: Turn): Mat3 {
	const k = (((deg / 90) % 4) + 4) % 4;
	const cos = [1, 0, -1, 0][k];
	const sin = [0, 1, 0, -1][k];
	if (axis === 0) return [1, 0, 0, 0, cos, -sin, 0, sin, cos];
	if (axis === 1) return [cos, 0, sin, 0, 1, 0, -sin, 0, cos];
	return [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
}

/** The rotation that turns unit vector `n` to −Z (Rodrigues). */
export function downFrom(n: Vec3): Mat3 {
	const [x, y, z] = n;
	if (z < -1 + 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
	if (z > 1 - 1e-9) return [1, 0, 0, 0, -1, 0, 0, 0, -1];
	// axis = n × (0,0,−1) = (−y, x, 0); cos = −z.
	const ax = -y;
	const ay = x;
	const c = -z;
	const k = 1 / (1 + c);
	return [c + ax * ax * k, ax * ay * k, ay, ax * ay * k, c + ay * ay * k, -ax, -ay, ax, c];
}

/**
 * The outward normal of the flat side the model rests best on: of the
 * directions most of its surface faces, the one whose support plane (the
 * farthest the model reaches that way) has the most triangle area lying in
 * it. Several coplanar feet count together, like a chair's legs. Null when
 * no side is flat.
 */
export function flattestSide(tris: Triangles): Vec3 | null {
	const n = tris.length / 9;
	const bins = new Map<string, { area: number; nx: number; ny: number; nz: number }>();
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
		// Bins about 2° wide.
		const key = `${Math.round((cx / len) * 30)},${Math.round((cy / len) * 30)},${Math.round((cz / len) * 30)}`;
		const bin = bins.get(key) ?? { area: 0, nx: 0, ny: 0, nz: 0 };
		bin.area += len / 2;
		bin.nx += cx / 2;
		bin.ny += cy / 2;
		bin.nz += cz / 2;
		bins.set(key, bin);
	}
	const box = bounds(tris);
	const tol = 0.02 + 1e-4 * Math.max(...box.size);
	const candidates = [...bins.values()].sort((a, b) => b.area - a.area).slice(0, 24);
	let best: Vec3 | null = null;
	let bestArea = 0;
	for (const bin of candidates) {
		const l = Math.hypot(bin.nx, bin.ny, bin.nz);
		if (l < 1e-12) continue;
		const d: Vec3 = [bin.nx / l, bin.ny / l, bin.nz / l];
		let reach = -Infinity;
		for (let i = 0; i < tris.length; i += 3) {
			const v = tris[i] * d[0] + tris[i + 1] * d[1] + tris[i + 2] * d[2];
			if (v > reach) reach = v;
		}
		let area = 0;
		for (let t = 0; t < n; t++) {
			const dot = normals[t * 3] * d[0] + normals[t * 3 + 1] * d[1] + normals[t * 3 + 2] * d[2];
			if (dot < 0.999) continue;
			const o = t * 9;
			let on = true;
			for (let k = 0; k < 9 && on; k += 3)
				on = tris[o + k] * d[0] + tris[o + k + 1] * d[1] + tris[o + k + 2] * d[2] > reach - tol;
			if (on) area += areas[t];
		}
		if (area > bestArea) {
			bestArea = area;
			best = d;
		}
	}
	// A sliver is not a side to stand on: at least 1 % of the bounding box's largest face.
	const [sx, sy, sz] = box.size;
	return bestArea > 0.01 * Math.max(sx * sy, sy * sz, sx * sz) ? best : null;
}

const rotZ = (a: number): Mat3 => [
	Math.cos(a),
	-Math.sin(a),
	0,
	Math.sin(a),
	Math.cos(a),
	0,
	0,
	0,
	1
];

/**
 * The flattest side down, then turned about Z so the footprint is the
 * smallest box and its longer side runs along X — square to the bed, as a
 * person would put it. Null when no side is flat.
 */
export function layFlat(tris: Triangles): Mat3 | null {
	const side = flattestSide(tris);
	if (!side) return null;
	const down = downFrom(side);
	const n = tris.length / 3;
	const px = new Float64Array(n);
	const py = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const [x, y, z] = [tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2]];
		px[i] = down[0] * x + down[1] * y + down[2] * z;
		py[i] = down[3] * x + down[4] * y + down[5] * z;
	}
	const hull = hull2(...outline(px, py));
	const footprint = (a: number) => {
		const c = Math.cos(a);
		const s = Math.sin(a);
		let x0 = Infinity,
			x1 = -Infinity,
			y0 = Infinity,
			y1 = -Infinity;
		for (const [px, py] of hull) {
			const x = c * px - s * py;
			const y = s * px + c * py;
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
		return { area: (x1 - x0) * (y1 - y0), wide: x1 - x0 >= y1 - y0 };
	};
	// The smallest box around a footprint has a side along an edge of its hull.
	let yaw = 0;
	let bestArea = Infinity;
	for (let i = 0; i < hull.length; i++) {
		const [ax, ay] = hull[i];
		const [bx, by] = hull[(i + 1) % hull.length];
		const a = -Math.atan2(by - ay, bx - ax);
		const { area } = footprint(a);
		if (area < bestArea - 1e-9) {
			bestArea = area;
			yaw = a;
		}
	}
	if (!footprint(yaw).wide) yaw += Math.PI / 2;
	return mul(rotZ(yaw), down);
}

/**
 * The points that can be on the hull, a few thousand of a million: the
 * lowest and highest in each of 1024 columns and the leftmost and rightmost
 * in each row (off by a column's width at most — hundredths of a millimetre).
 * Every corner counts: a sparse flat base among a dense sculpt is the outline.
 */
function outline(px: Float64Array, py: Float64Array): [number[], number[]] {
	const BINS = 1024;
	let x0 = Infinity,
		x1 = -Infinity,
		y0 = Infinity,
		y1 = -Infinity;
	for (let i = 0; i < px.length; i++) {
		if (px[i] < x0) x0 = px[i];
		if (px[i] > x1) x1 = px[i];
		if (py[i] < y0) y0 = py[i];
		if (py[i] > y1) y1 = py[i];
	}
	const kx = (BINS - 1) / Math.max(x1 - x0, 1e-9);
	const ky = (BINS - 1) / Math.max(y1 - y0, 1e-9);
	const extremes = Array.from({ length: 4 }, () => new Int32Array(BINS).fill(-1));
	const [lowY, highY, lowX, highX] = extremes;
	for (let i = 0; i < px.length; i++) {
		const c = Math.floor((px[i] - x0) * kx);
		const r = Math.floor((py[i] - y0) * ky);
		if (lowY[c] < 0 || py[i] < py[lowY[c]]) lowY[c] = i;
		if (highY[c] < 0 || py[i] > py[highY[c]]) highY[c] = i;
		if (lowX[r] < 0 || px[i] < px[lowX[r]]) lowX[r] = i;
		if (highX[r] < 0 || px[i] > px[highX[r]]) highX[r] = i;
	}
	const keep = new Set<number>();
	for (const e of extremes) for (const i of e) if (i >= 0) keep.add(i);
	return [[...keep].map((i) => px[i]), [...keep].map((i) => py[i])];
}

/** Convex hull of points, counter-clockwise (Andrew's monotone chain). */
function hull2(xs: number[], ys: number[]): [number, number][] {
	const pts = xs
		.map((x, i) => [x, ys[i]] as [number, number])
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (pts.length < 3) return pts;
	const turn = (o: number[], a: number[], b: number[]) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const lower: [number, number][] = [];
	for (const p of pts) {
		while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
			lower.pop();
		lower.push(p);
	}
	const upper: [number, number][] = [];
	for (let i = pts.length - 1; i >= 0; i--) {
		const p = pts[i];
		while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
			upper.pop();
		upper.push(p);
	}
	return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Rotation of the whole recipe: flat side down, then the turns about X, Y and Z. */
export function rotationOf(p: ResizeParams, flat: Mat3 | null): Mat3 {
	let m: Mat3 = p.flat && flat ? flat : [1, 0, 0, 0, 1, 0, 0, 0, 1];
	m = mul(quarter(0, p.turnX), m);
	m = mul(quarter(1, p.turnY), m);
	return mul(quarter(2, p.turnZ), m);
}

/** Turned and mirrored, not yet scaled or placed. */
export function orient(tris: Triangles, p: ResizeParams, flat: Mat3 | null): Triangles {
	const m = rotationOf(p, flat);
	const sx = p.mirror ? -1 : 1;
	const out = new Float32Array(tris.length);
	for (let i = 0; i < tris.length; i += 3) {
		const x = tris[i];
		const y = tris[i + 1];
		const z = tris[i + 2];
		out[i] = sx * (m[0] * x + m[1] * y + m[2] * z);
		out[i + 1] = m[3] * x + m[4] * y + m[5] * z;
		out[i + 2] = m[6] * x + m[7] * y + m[8] * z;
	}
	// A mirror turns the triangles inside out: swap two corners back.
	if (p.mirror)
		for (let o = 0; o < out.length; o += 9)
			for (let k = 0; k < 3; k++) {
				const a = out[o + 3 + k];
				out[o + 3 + k] = out[o + 6 + k];
				out[o + 6 + k] = a;
			}
	return out;
}

/** The scale factor that gives the asked size. */
export function scaleFor(size: readonly number[], by: SizeBy, value: number): number {
	const v = Number.isFinite(value) && value > 0 ? value : by === 'scale' ? 100 : 1;
	if (by === 'scale') return v / 100;
	const along = by === 'max' ? Math.max(...size) : size[by === 'x' ? 0 : by === 'y' ? 1 : 2];
	return along > 0 ? v / along : 1;
}

/** What the field shows for a measure: the model's current percent or millimetres. */
export function valueFor(size: readonly number[], by: SizeBy, scale: number): number {
	if (by === 'scale') return Math.round(scale * 1000) / 10;
	const along = by === 'max' ? Math.max(...size) : size[by === 'x' ? 0 : by === 'y' ? 1 : 2];
	return Math.round(along * scale * 10) / 10;
}

/** The finished model on the bed, and the scale it got. */
export function resize(
	tris: Triangles,
	p: ResizeParams,
	flat: Mat3 | null
): { tris: Triangles; scale: number } {
	const turned = orient(tris, p, flat);
	const scale = Math.min(100, Math.max(0.001, scaleFor(bounds(turned).size, p.by, p.value)));
	if (scale !== 1) for (let i = 0; i < turned.length; i++) turned[i] *= scale;
	return { tris: placeOnBed(turned), scale };
}
