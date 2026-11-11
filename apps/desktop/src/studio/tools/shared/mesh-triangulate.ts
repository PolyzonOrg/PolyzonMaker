/**
 * Ear clipping for one simple polygon without holes (caps of extrusions,
 * patches over holes in a mesh). O(n²), fine for outlines and hole loops.
 */

/**
 * Triangles (vertex indices) covering the polygon given as x, y pairs, in
 * the polygon's own winding. `null` when no ear can be found (the outline
 * crosses itself, or every remaining corner is collinear).
 */
export function earClip(xy: ArrayLike<number>): number[] | null {
	const n = Math.floor(xy.length / 2);
	if (n < 3) return null;
	let area2 = 0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		area2 += xy[2 * i] * xy[2 * j + 1] - xy[2 * j] * xy[2 * i + 1];
		minX = Math.min(minX, xy[2 * i]);
		maxX = Math.max(maxX, xy[2 * i]);
		minY = Math.min(minY, xy[2 * i + 1]);
		maxY = Math.max(maxY, xy[2 * i + 1]);
	}
	const sign = area2 >= 0 ? 1 : -1;
	const span = Math.max(maxX - minX, maxY - minY) || 1;
	const eps = span * span * 1e-12;

	const prev = new Int32Array(n);
	const next = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		prev[i] = (i + n - 1) % n;
		next[i] = (i + 1) % n;
	}
	const cross = (a: number, b: number, c: number) =>
		(xy[2 * b] - xy[2 * a]) * (xy[2 * c + 1] - xy[2 * a + 1]) -
		(xy[2 * b + 1] - xy[2 * a + 1]) * (xy[2 * c] - xy[2 * a]);

	const isEar = (a: number, b: number, c: number): boolean => {
		if (sign * cross(a, b, c) <= eps) return false; // reflex or flat corner
		// No other corner inside or on the candidate triangle.
		for (let p = next[c]; p !== a; p = next[p]) {
			if (
				sign * cross(a, b, p) >= -eps &&
				sign * cross(b, c, p) >= -eps &&
				sign * cross(c, a, p) >= -eps &&
				!samePoint(p, a) &&
				!samePoint(p, b) &&
				!samePoint(p, c)
			) {
				return false;
			}
		}
		return true;
	};
	const samePoint = (p: number, q: number) =>
		xy[2 * p] === xy[2 * q] && xy[2 * p + 1] === xy[2 * q + 1];

	const out: number[] = [];
	let remaining = n;
	let i = 0;
	let misses = 0;
	while (remaining > 3) {
		const a = prev[i];
		const c = next[i];
		if (isEar(a, i, c)) {
			out.push(a, i, c);
			next[a] = c;
			prev[c] = a;
			remaining--;
			misses = 0;
			i = c;
		} else {
			i = c;
			if (++misses > remaining) return null;
		}
	}
	// The last corner closes the patch even when it is flat.
	out.push(prev[i], i, next[i]);
	return out;
}
