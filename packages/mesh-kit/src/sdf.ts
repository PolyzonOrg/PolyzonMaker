/**
 * Signed distance to a triangle mesh, for manifold's `levelSet` (positive
 * inside). Only distances up to `band` matter, so a point farther than that
 * from every triangle answers ±band without searching.
 *
 * - inside/outside: parity of a ray through the point, the hits of each
 *   column cached (levelSet samples whole columns of the same coordinates);
 * - distance: nearest triangle within `band`, found through a uniform grid
 *   of triangle boxes.
 *
 * `meshSdf` is the hollow tool's: a closed mesh, one ray along +Z, and the
 * outside is just «outside». `solidSdf` is for rebuilding a broken mesh
 * (`voxelRemesh`): six rays vote, so a hole or a stray face misleads one or
 * two of them, not the answer, and the distance is signed on both sides so
 * the rebuilt surface lands where the old one was. Pure JS, no manifold.
 */
import { bounds, type Triangles } from './stl.js';

// The ray starts a hair off the sample so it does not run exactly along an
// edge of an axis-aligned model (two triangles would both count it).
const JITTER_U = 1.137e-5;
const JITTER_V = 2.291e-5;

type Sdf = (p: readonly number[]) => number;

/** Signed distance to a closed mesh: +distance inside (up to `band`), −band outside. */
export function meshSdf(tris: Triangles, band: number): Sdf {
	const b = bounds(tris);
	const nearest = nearestWithin(tris, band);
	const hitsZ = rayColumns(tris, 2);
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
		const hits = hitsZ(x, y);
		// Hits above the point: odd → inside.
		if ((hits.length - countUpTo(hits, z)) % 2 === 0) return -band;
		return nearest(x, y, z);
	};
}

/**
 * Signed distance to a mesh that may have holes, flipped or stray faces:
 * inside when at least four of six axis rays (±X, ±Y, ±Z) cross the
 * surface an odd number of times; |distance| clamped to `band`.
 */
export function solidSdf(tris: Triangles, band: number): Sdf {
	const nearest = nearestWithin(tris, band);
	const columns = [rayColumns(tris, 0), rayColumns(tris, 1), rayColumns(tris, 2)];
	return (p) => {
		let votes = 0;
		for (let axis = 0; axis < 3; axis++) {
			const hits = columns[axis](p[(axis + 1) % 3], p[(axis + 2) % 3]);
			const below = countUpTo(hits, p[axis]);
			votes += (below % 2) + ((hits.length - below) % 2);
		}
		const d = nearest(p[0], p[1], p[2]);
		return votes >= 4 ? d : -d;
	};
}

export interface Deviation {
	/** mm */
	max: number;
	/** mm */
	mean: number;
	/** The max reached `band`: the real one may be larger. */
	capped: boolean;
}

/**
 * How far two surfaces of the same model are apart, both ways: every corner
 * of each measured to the other surface (at most 200 000 corners a side),
 * distances clamped to `band` mm. Corners only: a big flat face that sags
 * between them shows through the other side's corners.
 */
export function surfaceDeviation(a: Triangles, b: Triangles, band: number): Deviation {
	let max = 0;
	let sum = 0;
	let n = 0;
	for (const [from, to] of [
		[a, b],
		[b, a]
	]) {
		const nearest = nearestWithin(to, band);
		const corners = from.length / 3;
		const step = Math.max(1, Math.floor(corners / 200_000));
		for (let c = 0; c < corners; c += step) {
			const d = nearest(from[3 * c], from[3 * c + 1], from[3 * c + 2]);
			if (d > max) max = d;
			sum += d;
			n++;
		}
	}
	return { max, mean: n ? sum / n : 0, capped: max >= band };
}

/** How many sorted hits are at or below `at`. */
function countUpTo(hits: Float64Array, at: number): number {
	let lo = 0;
	let hi = hits.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (hits[mid] <= at) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * Where a ray along `axis` crosses the mesh, per column: the column is the
 * point's two other coordinates, (axis+1) % 3 and (axis+2) % 3, and the
 * answer the sorted crossings along the axis.
 */
function rayColumns(tris: Triangles, axis: 0 | 1 | 2): (pu: number, pv: number) => Float64Array {
	const u = (axis + 1) % 3;
	const v = (axis + 2) % 3;
	const count = Math.floor(tris.length / 9);
	const b = bounds(tris);
	const maxDim = Math.max(...b.size, 1e-6);
	// A 2D grid of triangle footprints on the (u, v) plane.
	const hc = maxDim / 160;
	const cu = Math.ceil(b.size[u] / hc) + 2;
	const cv = Math.ceil(b.size[v] / hc) + 2;
	const colOf = (val: number, o: number, n: number) =>
		Math.min(n - 1, Math.max(0, Math.floor((val - o) / hc) + 1));
	const cells = buildCsr(count, cu * cv, (t, emit) => {
		const box = triBox(tris, t);
		const iu0 = colOf(box[u], b.min[u], cu);
		const iu1 = colOf(box[3 + u], b.min[u], cu);
		const iv0 = colOf(box[v], b.min[v], cv);
		const iv1 = colOf(box[3 + v], b.min[v], cv);
		for (let y = iv0; y <= iv1; y++) for (let x = iu0; x <= iu1; x++) emit(y * cu + x);
	});

	const columns = new Map<number, Map<number, Float64Array>>();
	return (pu, pv) => {
		let row = columns.get(pu);
		if (!row) columns.set(pu, (row = new Map<number, Float64Array>()));
		let hits = row.get(pv);
		if (hits) return hits;
		const qu = pu + JITTER_U;
		const qv = pv + JITTER_V;
		const cell = colOf(qv, b.min[v], cv) * cu + colOf(qu, b.min[u], cu);
		const along: number[] = [];
		for (let k = cells.start[cell]; k < cells.start[cell + 1]; k++) {
			const t = cells.items[k] * 9;
			const au = tris[t + u];
			const av = tris[t + v];
			const bu = tris[t + 3 + u];
			const bv = tris[t + 3 + v];
			const cu_ = tris[t + 6 + u];
			const cv_ = tris[t + 6 + v];
			const d1 = (bu - au) * (qv - av) - (bv - av) * (qu - au);
			const d2 = (cu_ - bu) * (qv - bv) - (cv_ - bv) * (qu - bu);
			const d3 = (au - cu_) * (qv - cv_) - (av - cv_) * (qu - cu_);
			if (!((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0))) continue;
			const area = d1 + d2 + d3;
			along.push((d2 * tris[t + axis] + d3 * tris[t + 3 + axis] + d1 * tris[t + 6 + axis]) / area);
		}
		hits = Float64Array.from(along).sort();
		row.set(pv, hits);
		return hits;
	};
}

/** Distance from a point to the nearest triangle, `band` when none is closer. */
function nearestWithin(tris: Triangles, band: number): (px: number, py: number, pz: number) => number {
	const count = Math.floor(tris.length / 9);
	const b = bounds(tris);
	const maxDim = Math.max(...b.size, 1e-6);
	// A 3D grid of triangle boxes.
	const h = Math.max(band, maxDim / 128);
	const ox = b.min[0] - h;
	const oy = b.min[1] - h;
	const oz = b.min[2] - h;
	const nx = Math.ceil((b.size[0] + 2 * h) / h) + 1;
	const ny = Math.ceil((b.size[1] + 2 * h) / h) + 1;
	const nz = Math.ceil((b.size[2] + 2 * h) / h) + 1;
	const cellOf = (v: number, o: number, n: number) =>
		Math.min(n - 1, Math.max(0, Math.floor((v - o) / h)));
	const cells = buildCsr(count, nx * ny * nz, (t, emit) => {
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
	return (px, py, pz) => {
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
					for (let k = cells.start[cell]; k < cells.start[cell + 1]; k++) {
						const t = cells.items[k];
						if (stamp[t] === pass) continue;
						stamp[t] = pass;
						const d = pointTriangle2(tris, t * 9, px, py, pz);
						if (d < best) best = d;
					}
				}
		return Math.sqrt(best);
	};
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
export function pointTriangle2(tris: Triangles, i: number, px: number, py: number, pz: number): number {
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
