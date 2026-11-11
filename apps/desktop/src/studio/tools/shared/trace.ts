/**
 * Raster image → polygons, for tools that turn a picture into a shape
 * (stencil, LED sign, cookie cutter…). Pure: works on a grayscale image as a
 * plain array, so the worker, the tools and the tests share it.
 *
 *   gray (0 = black … 255 = white) → blur → threshold (+ invert)
 *   → marching squares (sub-pixel contours, holes included)
 *   → smoothing → Ramer–Douglas–Peucker → rings in pixels
 *   → fitRings(): millimetres at the target size → ringsToScad(): polygon()
 *
 * Rings are closed (the last point is not repeated), y points up, outer
 * contours run counter-clockwise and holes clockwise — the convention of
 * OpenSCAD polygon(), manifold-3d and SVG even-odd paths alike.
 */
import { vec } from '../scad-literals';

export type Point = [number, number];
export type Ring = Point[];

export interface TraceOptions {
	/** 1–254: pixels darker than this are the shape (lighter, with invert). */
	threshold: number;
	/** Light shape on a dark background. */
	invert: boolean;
	/** Gaussian blur before the threshold, σ in pixels (0–5). */
	blur: number;
	/** Contour smoothing strength (0–3). */
	smooth: number;
}

export const TRACE_DEFAULTS: TraceOptions = { threshold: 128, invert: false, blur: 1, smooth: 1 };

/** Signed area: positive for counter-clockwise rings (y up). */
export function ringArea(ring: readonly Point[]): number {
	let a = 0;
	for (let i = 0, n = ring.length; i < n; i++) {
		const p = ring[i];
		const q = ring[(i + 1) % n];
		a += p[0] * q[1] - q[0] * p[1];
	}
	return a / 2;
}

export interface Box2 {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function ringsBounds(rings: readonly (readonly Point[])[]): Box2 {
	const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
	for (const r of rings)
		for (const [x, y] of r) {
			if (x < b.minX) b.minX = x;
			if (x > b.maxX) b.maxX = x;
			if (y < b.minY) b.minY = y;
			if (y > b.maxY) b.maxY = y;
		}
	return b;
}

/** Separable Gaussian blur (σ in pixels); edges clamp. */
export function blurGray(
	gray: ArrayLike<number>,
	w: number,
	h: number,
	sigma: number
): Float32Array {
	const src = Float32Array.from(gray);
	if (!(sigma > 0.05)) return src;
	const radius = Math.ceil(sigma * 3);
	const kernel = new Float32Array(radius * 2 + 1);
	let sum = 0;
	for (let i = -radius; i <= radius; i++)
		sum += kernel[i + radius] = Math.exp((-i * i) / (2 * sigma * sigma));
	for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
	const tmp = new Float32Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let v = 0;
			for (let k = -radius; k <= radius; k++) {
				const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
				v += src[y * w + xx] * kernel[k + radius];
			}
			tmp[y * w + x] = v;
		}
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let v = 0;
			for (let k = -radius; k <= radius; k++) {
				const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
				v += tmp[yy * w + x] * kernel[k + radius];
			}
			src[y * w + x] = v;
		}
	return src;
}

/**
 * Contours of the shape in a grayscale image, in pixels (y up, origin at the
 * bottom-left corner of the image). Rings smaller than `minArea` px² go.
 */
export function traceGray(
	gray: ArrayLike<number>,
	width: number,
	height: number,
	opts: TraceOptions,
	minArea = 2
): Ring[] {
	if (width < 1 || height < 1 || gray.length < width * height) return [];
	const blurred = blurGray(gray, width, height, opts.blur);
	// «Shape» is where the field is above the level; the image is padded
	// with one pixel of background so that every contour closes.
	const t = Math.min(254.5, Math.max(0.5, opts.threshold));
	const level = opts.invert ? t : 255 - t;
	const W = width + 2;
	const H = height + 2;
	const field = new Float32Array(W * H);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const g = blurred[y * width + x];
			field[(y + 1) * W + x + 1] = opts.invert ? g : 255 - g;
		}
	const raw = marchingSquares(field, W, H, level);
	const passes = Math.round(Math.max(0, Math.min(3, opts.smooth)) * 2);
	const tolerance = 0.35 + 0.1 * passes;
	const rings: Ring[] = [];
	for (const loop of raw) {
		// Grid point (i, j) is the centre of pixel (i − 1, j − 1); flip y.
		let ring: Ring = loop.map(([x, y]) => [x - 0.5, height - (y - 0.5)]);
		ring = smoothRing(ring, passes);
		ring = simplifyRing(ring, tolerance);
		if (ring.length >= 3 && Math.abs(ringArea(ring)) >= minArea) rings.push(ring);
	}
	return rings;
}

/**
 * Iso-contours of a scalar field (grid W×H, row-major, y down) at `level`,
 * with linear interpolation along cell edges. Inside (> level) stays on the
 * right of every segment in these y-down coordinates, so after flipping y the
 * outer contours are counter-clockwise and the holes clockwise. Saddles are
 * decided by the cell centre.
 */
export function marchingSquares(
	field: Float32Array,
	W: number,
	H: number,
	level: number
): Point[][] {
	const edgeCount = W * H * 2;
	const next = new Int32Array(edgeCount).fill(-1);
	const px = new Float32Array(edgeCount);
	const py = new Float32Array(edgeCount);
	const hEdge = (i: number, j: number) => (j * W + i) * 2;
	const vEdge = (i: number, j: number) => (j * W + i) * 2 + 1;
	const lerp = (a: number, b: number) => {
		const t = (level - a) / (b - a);
		return t < 1e-4 ? 1e-4 : t > 1 - 1e-4 ? 1 - 1e-4 : t;
	};

	for (let j = 0; j < H - 1; j++)
		for (let i = 0; i < W - 1; i++) {
			const a = field[j * W + i];
			const b = field[j * W + i + 1];
			const c = field[(j + 1) * W + i + 1];
			const d = field[(j + 1) * W + i];
			const A = a > level;
			const B = b > level;
			const C = c > level;
			const D = d > level;
			const index = (A ? 8 : 0) | (B ? 4 : 0) | (C ? 2 : 0) | (D ? 1 : 0);
			if (index === 0 || index === 15) continue;

			// Crossing points on the four edges of the cell (only those used).
			const top = () => {
				const e = hEdge(i, j);
				px[e] = i + lerp(a, b);
				py[e] = j;
				return e;
			};
			const bottom = () => {
				const e = hEdge(i, j + 1);
				px[e] = i + lerp(d, c);
				py[e] = j + 1;
				return e;
			};
			const left = () => {
				const e = vEdge(i, j);
				px[e] = i;
				py[e] = j + lerp(a, d);
				return e;
			};
			const right = () => {
				const e = vEdge(i + 1, j);
				px[e] = i + 1;
				py[e] = j + lerp(b, c);
				return e;
			};
			// A segment between two edges, oriented by a reference corner.
			const seg = (e1: number, e2: number, rx: number, ry: number, inside: boolean) => {
				const dx = px[e2] - px[e1];
				const dy = py[e2] - py[e1];
				const cross = dx * (ry - py[e1]) - dy * (rx - px[e1]);
				// Inside on the right ⇔ cross < 0 (y-down coordinates).
				if (cross < 0 === inside) next[e1] = e2;
				else next[e2] = e1;
			};
			const centre = (a + b + c + d) / 4 > level;
			switch (index) {
				case 8:
				case 7:
					seg(top(), left(), i, j, A);
					break;
				case 4:
				case 11:
					seg(top(), right(), i + 1, j, B);
					break;
				case 2:
				case 13:
					seg(right(), bottom(), i + 1, j + 1, C);
					break;
				case 1:
				case 14:
					seg(bottom(), left(), i, j + 1, D);
					break;
				case 12:
				case 3:
					seg(left(), right(), i, j, A);
					break;
				case 6:
				case 9:
					seg(top(), bottom(), i, j, A);
					break;
				case 10: // a and c inside
					if (centre) {
						seg(top(), right(), i + 1, j, false);
						seg(bottom(), left(), i, j + 1, false);
					} else {
						seg(top(), left(), i, j, true);
						seg(right(), bottom(), i + 1, j + 1, true);
					}
					break;
				case 5: // b and d inside
					if (centre) {
						seg(top(), left(), i, j, false);
						seg(right(), bottom(), i + 1, j + 1, false);
					} else {
						seg(top(), right(), i + 1, j, true);
						seg(bottom(), left(), i, j + 1, true);
					}
					break;
			}
		}

	const loops: Point[][] = [];
	const seen = new Uint8Array(edgeCount);
	for (let start = 0; start < edgeCount; start++) {
		if (next[start] < 0 || seen[start]) continue;
		const loop: Point[] = [];
		let e = start;
		while (e >= 0 && !seen[e]) {
			seen[e] = 1;
			loop.push([px[e], py[e]]);
			e = next[e];
		}
		if (loop.length >= 3) loops.push(loop);
	}
	return loops;
}

/** Laplacian smoothing of a closed ring (¼, ½, ¼), `passes` times. */
export function smoothRing(ring: Ring, passes: number): Ring {
	let r = ring;
	const n = r.length;
	if (n < 5) return r;
	for (let p = 0; p < passes; p++) {
		const out = new Array<Point>(n);
		for (let i = 0; i < n; i++) {
			const a = r[(i + n - 1) % n];
			const b = r[i];
			const c = r[(i + 1) % n];
			out[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
		}
		r = out;
	}
	return r;
}

/** Ramer–Douglas–Peucker on a closed ring: split at the farthest point. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
	const n = ring.length;
	if (n < 4 || !(tolerance > 0)) return ring;
	let far = 0;
	let best = -1;
	for (let i = 1; i < n; i++) {
		const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
		if (d > best) {
			best = d;
			far = i;
		}
	}
	const a = simplifyLine(ring.slice(0, far + 1), tolerance);
	const b = simplifyLine([...ring.slice(far), ring[0]], tolerance);
	return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Ramer–Douglas–Peucker on an open polyline (iterative). */
export function simplifyLine(points: Ring, tolerance: number): Ring {
	const n = points.length;
	if (n < 3) return points;
	const keep = new Uint8Array(n);
	keep[0] = keep[n - 1] = 1;
	const stack: [number, number][] = [[0, n - 1]];
	const tol2 = tolerance * tolerance;
	while (stack.length) {
		const [s, e] = stack.pop()!;
		const [ax, ay] = points[s];
		const dx = points[e][0] - ax;
		const dy = points[e][1] - ay;
		const len2 = dx * dx + dy * dy;
		let worst = -1;
		let at = -1;
		for (let i = s + 1; i < e; i++) {
			const qx = points[i][0] - ax;
			const qy = points[i][1] - ay;
			const d2 = len2 > 0 ? (qx * dy - qy * dx) ** 2 / len2 : qx * qx + qy * qy;
			if (d2 > worst) {
				worst = d2;
				at = i;
			}
		}
		if (at > 0 && worst > tol2) {
			keep[at] = 1;
			stack.push([s, at], [at, e]);
		}
	}
	return points.filter((_, i) => keep[i]);
}

/**
 * Rings scaled to `size` mm — the height of the drawing (`'height'`) or its
 * larger side (`'max'`) — and centred on the origin.
 */
export function fitRings(
	rings: readonly Ring[],
	size: number,
	by: 'height' | 'max' = 'max'
): Ring[] {
	const b = ringsBounds(rings);
	const w = b.maxX - b.minX;
	const h = b.maxY - b.minY;
	const span = by === 'height' ? h : Math.max(w, h);
	if (!(span > 0)) return [];
	const k = size / span;
	const cx = (b.minX + b.maxX) / 2;
	const cy = (b.minY + b.maxY) / 2;
	return rings.map((r) => r.map(([x, y]) => [(x - cx) * k, (y - cy) * k] as Point));
}

/** Drop pieces and holes smaller than a `side` × `side` square. */
export function dropSmall(rings: readonly Ring[], side: number): Ring[] {
	const min = side * side;
	return rings.filter((r) => Math.abs(ringArea(r)) >= min);
}

/** The rings as an OpenSCAD polygon (even-odd: holes are cut out). */
export function ringsToScad(rings: readonly Ring[]): string {
	const points: Point[] = [];
	const paths: number[][] = [];
	for (const r of rings) {
		paths.push(r.map((_, i) => points.length + i));
		points.push(...r);
	}
	return `polygon(points = ${vec(points)}, paths = ${vec(paths)});`;
}
