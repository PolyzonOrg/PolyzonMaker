/**
 * Where things fit inside a flat cross-section (manifold's
 * `CrossSection.toPolygons()`): connector pins on a cut face, the drain hole
 * of a hollow model. Polygons use the even-odd rule, so holes need no special care.
 * Pure 2D, no manifold.
 */

export type Pt = [number, number];
export type Polys = readonly (readonly Pt[])[];

export function insidePolys(polys: Polys, x: number, y: number): boolean {
	let inside = false;
	for (const ring of polys) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i];
			const [xj, yj] = ring[j];
			if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
		}
	}
	return inside;
}

/** Distance from a point to the nearest edge. */
export function edgeDistance(polys: Polys, x: number, y: number): number {
	let best = Infinity;
	for (const ring of polys) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [ax, ay] = ring[j];
			const [bx, by] = ring[i];
			const dx = bx - ax;
			const dy = by - ay;
			const len2 = dx * dx + dy * dy;
			const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
			const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
			if (d < best) best = d;
		}
	}
	return best;
}

export function polysBounds(polys: Polys): { min: Pt; max: Pt } {
	const min: Pt = [Infinity, Infinity];
	const max: Pt = [-Infinity, -Infinity];
	for (const ring of polys) {
		for (const [x, y] of ring) {
			if (x < min[0]) min[0] = x;
			if (y < min[1]) min[1] = y;
			if (x > max[0]) max[0] = x;
			if (y > max[1]) max[1] = y;
		}
	}
	return { min, max };
}

/** Grid points inside the polygons, about `maxSamples` of them. */
export function sampleInside(polys: Polys, maxSamples = 4000): Pt[] {
	const { min, max } = polysBounds(polys);
	const w = max[0] - min[0];
	const h = max[1] - min[1];
	if (!(w > 0 && h > 0)) return [];
	const step = Math.sqrt((w * h) / maxSamples);
	const out: Pt[] = [];
	for (let y = min[1] + step / 2; y < max[1]; y += step) {
		for (let x = min[0] + step / 2; x < max[0]; x += step) {
			if (insidePolys(polys, x, y)) out.push([x, y]);
		}
	}
	return out;
}

/** The point farthest from every edge (centre of the largest inscribed circle), approximately. */
export function deepestPoint(polys: Polys): { at: Pt; radius: number } | null {
	const samples = sampleInside(polys, 1500);
	if (!samples.length) return null;
	let [bx, by] = samples[0];
	let br = -1;
	for (const [x, y] of samples) {
		const r = edgeDistance(polys, x, y);
		if (r > br) [bx, by, br] = [x, y, r];
	}
	// Refine around the best grid point with shrinking steps.
	let step = Math.sqrt(polysArea(polys) / 1500) / 2;
	for (let k = 0; k < 12 && step > 1e-3; k++) {
		let moved = false;
		const moves: Pt[] = [
			[bx + step, by],
			[bx - step, by],
			[bx, by + step],
			[bx, by - step]
		];
		for (const [x, y] of moves) {
			if (!insidePolys(polys, x, y)) continue;
			const r = edgeDistance(polys, x, y);
			if (r > br) {
				[bx, by, br] = [x, y, r];
				moved = true;
			}
		}
		if (!moved) step /= 2;
	}
	return { at: [bx, by], radius: br };
}

export function polysArea(polys: Polys): number {
	let a = 0;
	for (const ring of polys) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
		}
	}
	return Math.abs(a / 2);
}

/**
 * `count` points spread evenly over the region (k-means over a grid of
 * samples), each snapped to a sample so it stays inside. Fewer points come
 * back when the region is too small to keep them `minGap` apart.
 */
export function spreadPoints(polys: Polys, count: number, minGap: number): Pt[] {
	const samples = sampleInside(polys, 3000);
	if (!samples.length || count < 1) return [];
	// Farthest-point start: the deepest sample first, then the farthest from the chosen ones.
	const centers: Pt[] = [];
	let first = samples[0];
	let firstR = -1;
	for (const s of samples) {
		const r = edgeDistance(polys, s[0], s[1]);
		if (r > firstR) {
			firstR = r;
			first = s;
		}
	}
	centers.push(first);
	while (centers.length < count) {
		let far = samples[0];
		let farD = -1;
		for (const s of samples) {
			let d = Infinity;
			for (const c of centers) d = Math.min(d, Math.hypot(s[0] - c[0], s[1] - c[1]));
			if (d > farD) {
				farD = d;
				far = s;
			}
		}
		if (farD <= 0) break;
		centers.push(far);
	}
	// Lloyd iterations: each centre moves to the mean of its samples.
	for (let it = 0; it < 12; it++) {
		const sum = centers.map(() => [0, 0, 0]);
		for (const s of samples) {
			let k = 0;
			let d = Infinity;
			centers.forEach((c, i) => {
				const di = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2;
				if (di < d) {
					d = di;
					k = i;
				}
			});
			sum[k][0] += s[0];
			sum[k][1] += s[1];
			sum[k][2]++;
		}
		centers.forEach((c, i) => {
			if (sum[i][2]) {
				c[0] = sum[i][0] / sum[i][2];
				c[1] = sum[i][1] / sum[i][2];
			}
		});
	}
	// Snap to the nearest sample (a mean of a curved region can fall outside it).
	const snapped = centers.map((c) => {
		let best = samples[0];
		let d = Infinity;
		for (const s of samples) {
			const di = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2;
			if (di < d) {
				d = di;
				best = s;
			}
		}
		return best;
	});
	const out: Pt[] = [];
	for (const p of snapped) {
		if (out.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= minGap)) out.push(p);
	}
	return out;
}
