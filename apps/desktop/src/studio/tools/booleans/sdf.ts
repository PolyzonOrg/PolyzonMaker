/**
 * Signed distance to a closed triangle mesh, for manifold's `levelSet`
 * (positive inside). The hollow tool asks it for the surface `wall` mm
 * inside the model; only distances up to `band` matter, so a point farther
 * than that from every triangle answers ±band without searching.
 *
 * - inside/outside: parity of a ray along +Z, the hits of each (x, y) column
 *   cached (levelSet samples whole columns of the same x, y);
 * - distance: nearest triangle within `band`, found through a uniform grid
 *   of triangle boxes.
 *
 * Pure JS, no manifold — the tests call it directly.
 */
import { bounds, type Triangles } from '../stl';

// The ray starts a hair off the sample so it does not run exactly along an
// edge of an axis-aligned model (two triangles would both count it).
const JITTER_X = 1.137e-5;
const JITTER_Y = 2.291e-5;

export function meshSdf(tris: Triangles, band: number): (p: readonly number[]) => number {
	const count = Math.floor(tris.length / 9);
	const b = bounds(tris);
	const maxDim = Math.max(...b.size, 1e-6);
	const nearest = meshDistance(tris, band);

	// ---- 2D grid of triangle footprints for the parity ray ----
	const hc = maxDim / 160;
	const cx = Math.ceil(b.size[0] / hc) + 2;
	const cy = Math.ceil(b.size[1] / hc) + 2;
	const colOf = (v: number, o: number, n: number) =>
		Math.min(n - 1, Math.max(0, Math.floor((v - o) / hc) + 1));
	const cells2 = buildCsr(count, cx * cy, (t, emit) => {
		const [x0, y0, , x1, y1] = triBox(tris, t);
		const ix0 = colOf(x0, b.min[0], cx);
		const ix1 = colOf(x1, b.min[0], cx);
		const iy0 = colOf(y0, b.min[1], cy);
		const iy1 = colOf(y1, b.min[1], cy);
		for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) emit(y * cx + x);
	});

	const columns = new Map<number, Map<number, Float64Array>>();
	function columnHits(px: number, py: number): Float64Array {
		let row = columns.get(px);
		if (!row) columns.set(px, (row = new Map<number, Float64Array>()));
		let hits = row.get(py);
		if (hits) return hits;
		const qx = px + JITTER_X;
		const qy = py + JITTER_Y;
		const cell = colOf(qy, b.min[1], cy) * cx + colOf(qx, b.min[0], cx);
		const zs: number[] = [];
		for (let k = cells2.start[cell]; k < cells2.start[cell + 1]; k++) {
			const t = cells2.items[k] * 9;
			const ax = tris[t];
			const ay = tris[t + 1];
			const bx = tris[t + 3];
			const by = tris[t + 4];
			const qcx = tris[t + 6];
			const qcy = tris[t + 7];
			const d1 = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
			const d2 = (qcx - bx) * (qy - by) - (qcy - by) * (qx - bx);
			const d3 = (ax - qcx) * (qy - qcy) - (ay - qcy) * (qx - qcx);
			if (!((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0))) continue;
			const area = d1 + d2 + d3;
			zs.push((d2 * tris[t + 2] + d3 * tris[t + 5] + d1 * tris[t + 8]) / area);
		}
		hits = Float64Array.from(zs).sort();
		row.set(py, hits);
		return hits;
	}

	return (p) => {
		const x = p[0];
		const y = p[1];
		const z = p[2];
		if (
			x < b.min[0] ||
			x > b.max[0] ||
			y < b.min[1] ||
			y > b.max[1] ||
			z < b.min[2] ||
			z > b.max[2]
		)
			return -band;
		const hits = columnHits(x, y);
		// Hits above the point: odd → inside.
		let lo = 0;
		let hi = hits.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (hits[mid] <= z) lo = mid + 1;
			else hi = mid;
		}
		if ((hits.length - lo) % 2 === 0) return -band;
		return nearest(x, y, z);
	};
}

/**
 * Unsigned distance from a point to the nearest triangle of `tris`, or `band`
 * when none is nearer — through a uniform grid of triangle boxes.
 */
export function meshDistance(
	tris: Triangles,
	band: number
): (px: number, py: number, pz: number) => number {
	const count = Math.floor(tris.length / 9);
	const b = bounds(tris);
	const maxDim = Math.max(...b.size, 1e-6);
	const h = Math.max(band, maxDim / 128);
	const ox = b.min[0] - h;
	const oy = b.min[1] - h;
	const oz = b.min[2] - h;
	const nx = Math.ceil((b.size[0] + 2 * h) / h) + 1;
	const ny = Math.ceil((b.size[1] + 2 * h) / h) + 1;
	const nz = Math.ceil((b.size[2] + 2 * h) / h) + 1;
	const cellOf = (v: number, o: number, n: number) =>
		Math.min(n - 1, Math.max(0, Math.floor((v - o) / h)));
	const cells3 = buildCsr(count, nx * ny * nz, (t, emit) => {
		const [x0, y0, z0, x1, y1, z1] = triBox(tris, t);
		const ix0 = cellOf(x0, ox, nx);
		const ix1 = cellOf(x1, ox, nx);
		const iy0 = cellOf(y0, oy, ny);
		const iy1 = cellOf(y1, oy, ny);
		const iz0 = cellOf(z0, oz, nz);
		const iz1 = cellOf(z1, oz, nz);
		for (let z = iz0; z <= iz1; z++)
			for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) emit((z * ny + y) * nx + x);
	});

	const stamp = new Uint32Array(count);
	let pass = 0;
	function nearest(px: number, py: number, pz: number): number {
		pass++;
		let best = band * band;
		const ix0 = cellOf(px - band, ox, nx);
		const ix1 = cellOf(px + band, ox, nx);
		const iy0 = cellOf(py - band, oy, ny);
		const iy1 = cellOf(py + band, oy, ny);
		const iz0 = cellOf(pz - band, oz, nz);
		const iz1 = cellOf(pz + band, oz, nz);
		for (let z = iz0; z <= iz1; z++)
			for (let y = iy0; y <= iy1; y++)
				for (let x = ix0; x <= ix1; x++) {
					const cell = (z * ny + y) * nx + x;
					for (let k = cells3.start[cell]; k < cells3.start[cell + 1]; k++) {
						const t = cells3.items[k];
						if (stamp[t] === pass) continue;
						stamp[t] = pass;
						const d = pointTriangle2(tris, t * 9, px, py, pz);
						if (d < best) best = d;
					}
				}
		return Math.sqrt(best);
	}

	return nearest;
}

function triBox(tris: Triangles, t: number): [number, number, number, number, number, number] {
	const i = t * 9;
	return [
		Math.min(tris[i], tris[i + 3], tris[i + 6]),
		Math.min(tris[i + 1], tris[i + 4], tris[i + 7]),
		Math.min(tris[i + 2], tris[i + 5], tris[i + 8]),
		Math.max(tris[i], tris[i + 3], tris[i + 6]),
		Math.max(tris[i + 1], tris[i + 4], tris[i + 7]),
		Math.max(tris[i + 2], tris[i + 5], tris[i + 8])
	];
}

/** Compressed lists: triangles per cell, filled in two passes. */
function buildCsr(
	count: number,
	cells: number,
	visit: (t: number, emit: (cell: number) => void) => void
): { start: Uint32Array; items: Uint32Array } {
	const start = new Uint32Array(cells + 1);
	for (let t = 0; t < count; t++) visit(t, (c) => start[c + 1]++);
	for (let c = 0; c < cells; c++) start[c + 1] += start[c];
	const items = new Uint32Array(start[cells]);
	const fill = start.slice(0, cells);
	for (let t = 0; t < count; t++) visit(t, (c) => (items[fill[c]++] = t));
	return { start, items };
}

/** Squared distance from p to the triangle at `i` (Ericson, Real-Time Collision Detection 5.1.5). */
export function pointTriangle2(
	tris: Triangles,
	i: number,
	px: number,
	py: number,
	pz: number
): number {
	const ax = tris[i];
	const ay = tris[i + 1];
	const az = tris[i + 2];
	const abx = tris[i + 3] - ax;
	const aby = tris[i + 4] - ay;
	const abz = tris[i + 5] - az;
	const acx = tris[i + 6] - ax;
	const acy = tris[i + 7] - ay;
	const acz = tris[i + 8] - az;
	const apx = px - ax;
	const apy = py - ay;
	const apz = pz - az;
	const d1 = abx * apx + aby * apy + abz * apz;
	const d2 = acx * apx + acy * apy + acz * apz;
	if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
	const bpx = px - tris[i + 3];
	const bpy = py - tris[i + 4];
	const bpz = pz - tris[i + 5];
	const d3 = abx * bpx + aby * bpy + abz * bpz;
	const d4 = acx * bpx + acy * bpy + acz * bpz;
	if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const v = d1 / (d1 - d3);
		return dist2(apx - v * abx, apy - v * aby, apz - v * abz);
	}
	const cpx = px - tris[i + 6];
	const cpy = py - tris[i + 7];
	const cpz = pz - tris[i + 8];
	const d5 = abx * cpx + aby * cpy + abz * cpz;
	const d6 = acx * cpx + acy * cpy + acz * cpz;
	if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6);
		return dist2(apx - w * acx, apy - w * acy, apz - w * acz);
	}
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
		// On edge BC.
		const bcx = tris[i + 6] - tris[i + 3];
		const bcy = tris[i + 7] - tris[i + 4];
		const bcz = tris[i + 8] - tris[i + 5];
		return dist2(bpx - w * bcx, bpy - w * bcy, bpz - w * bcz);
	}
	const denom = 1 / (va + vb + vc);
	const v = vb * denom;
	const w = vc * denom;
	return dist2(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

function dist2(x: number, y: number, z: number): number {
	return x * x + y * y + z * z;
}
