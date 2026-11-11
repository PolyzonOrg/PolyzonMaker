/**
 * Triangle soup ↔ indexed mesh. An STL repeats every corner once per
 * triangle; mesh libraries (manifold-3d, repair) need shared vertices, so
 * coincident corners are welded on a small grid. Pure, no dependencies.
 */
import type { Triangles } from './stl';

export interface IndexedMesh {
	/** xyz per vertex */
	positions: Float32Array;
	/** three vertex indices per triangle */
	indices: Uint32Array;
}

/**
 * Weld corners closer than `tolerance` mm; drops triangles that collapse.
 * A numeric open-addressing hash, as in mesh-repair's toWorkMesh: string keys
 * made a 2-million-triangle AI mesh take seconds and hundreds of MB.
 */
export function weld(tris: Triangles, tolerance = 1e-4): IndexedMesh {
	const corners = Math.floor(tris.length / 3);
	const inv = 1 / tolerance;
	let size = 1;
	while (size < corners * 2) size <<= 1;
	const mask = size - 1;
	const table = new Int32Array(size).fill(-1);
	const grid = new Float64Array(corners * 3);
	const positions = new Float32Array(corners * 3);
	const indices = new Uint32Array(corners);
	let vertices = 0;
	let used = 0;
	const corner = [0, 0, 0];
	for (let t = 0; t + 9 <= tris.length; t += 9) {
		for (let c = 0; c < 3; c++) {
			const x = tris[t + c * 3];
			const y = tris[t + c * 3 + 1];
			const z = tris[t + c * 3 + 2];
			const gx = Math.round(x * inv);
			const gy = Math.round(y * inv);
			const gz = Math.round(z * inv);
			let h =
				(Math.imul(gx | 0, 73856093) ^ Math.imul(gy | 0, 19349663) ^ Math.imul(gz | 0, 83492791)) &
				mask;
			for (;;) {
				const at = table[h];
				if (at < 0) {
					table[h] = vertices;
					grid[3 * vertices] = gx;
					grid[3 * vertices + 1] = gy;
					grid[3 * vertices + 2] = gz;
					positions[3 * vertices] = x;
					positions[3 * vertices + 1] = y;
					positions[3 * vertices + 2] = z;
					corner[c] = vertices++;
					break;
				}
				if (grid[3 * at] === gx && grid[3 * at + 1] === gy && grid[3 * at + 2] === gz) {
					corner[c] = at;
					break;
				}
				h = (h + 1) & mask;
			}
		}
		if (corner[0] === corner[1] || corner[1] === corner[2] || corner[0] === corner[2]) continue;
		indices[used++] = corner[0];
		indices[used++] = corner[1];
		indices[used++] = corner[2];
	}
	return { positions: positions.slice(0, vertices * 3), indices: indices.slice(0, used) };
}

/** Indexed mesh → triangle soup (typed arrays or plain number lists). */
export function unweld(mesh: {
	positions: ArrayLike<number>;
	indices: ArrayLike<number>;
}): Triangles {
	const out = new Float32Array(mesh.indices.length * 3);
	for (let i = 0; i < mesh.indices.length; i++) {
		const v = mesh.indices[i] * 3;
		out[i * 3] = mesh.positions[v];
		out[i * 3 + 1] = mesh.positions[v + 1];
		out[i * 3 + 2] = mesh.positions[v + 2];
	}
	return out;
}

/**
 * Holes in the surface: edges with no twin running the other way, after
 * welding exact corners as a slicer does (0 = closed). An edge shared by four
 * faces, where two parts of a solid touch along a line, still counts as
 * closed: it leaks nothing and slices fine.
 */
export function openEdges(tris: Triangles, tolerance = 1e-6): number {
	const { positions, indices } = weld(tris, tolerance);
	const n = positions.length / 3;
	const count = new Map<number, number>();
	for (let t = 0; t + 3 <= indices.length; t += 3) {
		for (let e = 0; e < 3; e++) {
			const key = indices[t + e] * n + indices[t + (e === 2 ? 0 : e + 1)];
			count.set(key, (count.get(key) ?? 0) + 1);
		}
	}
	let open = 0;
	for (const [key, c] of count) {
		const a = Math.floor(key / n);
		if (count.get((key - a * n) * n + a) !== c) open++;
	}
	return open;
}

/**
 * Where the surface is open: every edge only one face uses, as line
 * segments (six floats each), at most `max` of them — to draw the holes on
 * the model.
 */
export function holeSegments(tris: Triangles, max = 200_000): Float32Array {
	const { positions, indices } = weld(tris);
	const n = positions.length / 3;
	const count = new Map<number, number>();
	for (let t = 0; t + 3 <= indices.length; t += 3) {
		for (let e = 0; e < 3; e++) {
			const a = indices[t + e];
			const b = indices[t + (e === 2 ? 0 : e + 1)];
			const key = a < b ? a * n + b : b * n + a;
			count.set(key, (count.get(key) ?? 0) + 1);
		}
	}
	const out: number[] = [];
	for (const [key, c] of count) {
		if (c !== 1) continue;
		if (out.length >= max * 6) break;
		const a = Math.floor(key / n);
		const b = key - a * n;
		out.push(...positions.subarray(3 * a, 3 * a + 3), ...positions.subarray(3 * b, 3 * b + 3));
	}
	return new Float32Array(out);
}
