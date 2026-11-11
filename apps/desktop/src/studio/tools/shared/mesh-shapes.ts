/**
 * Flat outlines as a radius per angle: every shape here is star-shaped about
 * the origin (a ray from the centre crosses the edge once), so a polar grid
 * over it is always a valid, non-overlapping mesh. Largest radius is 1.
 */

export type RadiusFn = (theta: number) => number;

const TAU = Math.PI * 2;

/** Ellipse with X semi-axis 1 and Y semi-axis `ratio` (≤ 1). */
export function ellipseRadius(ratio: number): RadiusFn {
	const k = 1 / Math.max(0.05, Math.min(1, ratio));
	return (t) => 1 / Math.hypot(Math.cos(t), Math.sin(t) * k);
}

/**
 * Closed polygon (points in order around the origin) → radius per angle,
 * straight edges between the points.
 */
export function outlineRadius(points: readonly [number, number][]): RadiusFn {
	const pts = points
		.map(([x, y]) => ({ x, y, a: (Math.atan2(y, x) + TAU) % TAU }))
		.sort((p, q) => p.a - q.a);
	const n = pts.length;
	const angles = pts.map((p) => p.a);
	return (t) => {
		const a = ((t % TAU) + TAU) % TAU;
		// Last point at or before `a` (wrapping to the end below the first one).
		let lo = 0;
		let hi = n - 1;
		if (a < angles[0]) lo = n - 1;
		else {
			while (lo < hi) {
				const mid = (lo + hi + 1) >> 1;
				if (angles[mid] <= a) lo = mid;
				else hi = mid - 1;
			}
		}
		const p = pts[lo];
		const q = pts[(lo + 1) % n];
		const dx = Math.cos(a);
		const dy = Math.sin(a);
		const ex = q.x - p.x;
		const ey = q.y - p.y;
		const den = dx * ey - dy * ex;
		if (Math.abs(den) < 1e-12) return Math.hypot(p.x, p.y);
		return (p.x * q.y - p.y * q.x) / den;
	};
}

/** Regular polygon, circumradius 1, a corner on +X (a hexagon has flat top and bottom). */
export function polygonRadius(sides: number): RadiusFn {
	const n = Math.max(3, Math.round(sides));
	const half = Math.PI / n;
	const apothem = Math.cos(half);
	return (t) => {
		const local = (((t % (2 * half)) + 2 * half) % (2 * half)) - half;
		return apothem / Math.cos(local);
	};
}

/** Star with `points` tips at radius 1 (one pointing up) and valleys at `inner`. */
export function starRadius(points: number, inner: number): RadiusFn {
	const n = Math.max(3, Math.round(points));
	const r = Math.max(0.1, Math.min(0.95, inner));
	const outline: [number, number][] = [];
	for (let k = 0; k < 2 * n; k++) {
		const a = Math.PI / 2 + (k * Math.PI) / n;
		const rr = k % 2 === 0 ? 1 : r;
		outline.push([rr * Math.cos(a), rr * Math.sin(a)]);
	}
	return outlineRadius(outline);
}

/** Flower: `petals` rounded lobes, valleys cut `depth` (0–1) of the radius. */
export function flowerRadius(petals: number, depth: number): RadiusFn {
	const n = Math.max(2, Math.round(petals));
	const d = Math.max(0, Math.min(0.95, depth));
	return (t) => 1 - d + d * Math.abs(Math.cos((n * t) / 2));
}

/** Heart, point down, centred so that it is star-shaped about the origin. */
export const HEART_POINTS: [number, number][] = (() => {
	const pts: [number, number][] = [];
	const cy = -3;
	const n = 720;
	for (let i = 0; i < n; i++) {
		const t = (i / n) * TAU;
		const x = 16 * Math.sin(t) ** 3;
		const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
		pts.push([x, y - cy]);
	}
	const max = Math.max(...pts.map(([x, y]) => Math.hypot(x, y)));
	return pts.map(([x, y]) => [x / max, y / max] as [number, number]);
})();

export function heartRadius(): RadiusFn {
	return outlineRadius(HEART_POINTS);
}

/** Bounding box of an outline (sampled). */
export function outlineBounds(
	r: RadiusFn,
	samples = 1440
): { minX: number; maxX: number; minY: number; maxY: number } {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < samples; i++) {
		const t = (i / samples) * TAU;
		const rr = r(t);
		const x = rr * Math.cos(t);
		const y = rr * Math.sin(t);
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minY = Math.min(minY, y);
		maxY = Math.max(maxY, y);
	}
	return { minX, maxX, minY, maxY };
}
