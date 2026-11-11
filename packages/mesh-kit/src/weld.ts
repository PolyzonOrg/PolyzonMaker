/**
 * Triangle soup ↔ indexed mesh. An STL repeats every corner once per
 * triangle; mesh libraries (manifold-3d, repair) need shared vertices, so
 * coincident corners are welded on a small grid. Pure, no dependencies.
 */
import type { Triangles } from './stl.js';

export interface IndexedMesh {
	/** xyz per vertex */
	positions: Float32Array;
	/** three vertex indices per triangle */
	indices: Uint32Array;
}

/** mm: corners closer than this are one corner — a millionth of the model's diagonal. */
export function weldTolerance(size: readonly number[]): number {
	return Math.max(Math.hypot(size[0], size[1], size[2]) * 1e-6, 1e-9);
}

/**
 * Corners to vertices on a `tolerance` grid: a numeric open-addressing hash,
 * as in mesh-repair's toWorkMesh. String keys made a 2-million-triangle AI
 * mesh take seconds and hundreds of MB.
 */
function vertexGrid(corners: number, tolerance: number) {
	const inv = 1 / tolerance;
	let size = 1;
	while (size < corners * 2) size <<= 1;
	const mask = size - 1;
	const table = new Int32Array(size).fill(-1);
	const grid = new Float64Array(corners * 3);
	const positions = new Float32Array(corners * 3);
	let vertices = 0;
	return {
		positions,
		count: () => vertices,
		/** The vertex at this corner, new or already there. */
		at(x: number, y: number, z: number): number {
			const gx = Math.round(x * inv);
			const gy = Math.round(y * inv);
			const gz = Math.round(z * inv);
			let h =
				(Math.imul(gx | 0, 73856093) ^ Math.imul(gy | 0, 19349663) ^ Math.imul(gz | 0, 83492791)) &
				mask;
			for (;;) {
				const found = table[h];
				if (found < 0) {
					table[h] = vertices;
					grid[3 * vertices] = gx;
					grid[3 * vertices + 1] = gy;
					grid[3 * vertices + 2] = gz;
					positions[3 * vertices] = x;
					positions[3 * vertices + 1] = y;
					positions[3 * vertices + 2] = z;
					return vertices++;
				}
				if (grid[3 * found] === gx && grid[3 * found + 1] === gy && grid[3 * found + 2] === gz) return found;
				h = (h + 1) & mask;
			}
		}
	};
}

/** Weld corners closer than `tolerance` mm; drops triangles that collapse. */
export function weld(tris: Triangles, tolerance = 1e-4): IndexedMesh {
	const corners = Math.floor(tris.length / 3);
	const grid = vertexGrid(corners, tolerance);
	const indices = new Uint32Array(corners);
	let used = 0;
	for (let t = 0; t + 9 <= tris.length; t += 9) {
		const a = grid.at(tris[t], tris[t + 1], tris[t + 2]);
		const b = grid.at(tris[t + 3], tris[t + 4], tris[t + 5]);
		const c = grid.at(tris[t + 6], tris[t + 7], tris[t + 8]);
		if (a === b || b === c || a === c) continue;
		indices[used++] = a;
		indices[used++] = b;
		indices[used++] = c;
	}
	return { positions: grid.positions.slice(0, grid.count() * 3), indices: indices.slice(0, used) };
}

/** An indexed mesh with its vertices closer than `tolerance` made one, as `weld` does for a soup. */
export function weldVertices({ positions, indices }: IndexedMesh, tolerance: number): IndexedMesh {
	const n = positions.length / 3;
	const grid = vertexGrid(n, tolerance);
	const to = new Uint32Array(n);
	for (let v = 0; v < n; v++) to[v] = grid.at(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
	const out = new Uint32Array(indices.length);
	let used = 0;
	for (let t = 0; t + 3 <= indices.length; t += 3) {
		const [a, b, c] = [to[indices[t]], to[indices[t + 1]], to[indices[t + 2]]];
		if (a === b || b === c || a === c) continue;
		out[used++] = a;
		out[used++] = b;
		out[used++] = c;
	}
	return { positions: grid.positions.slice(0, grid.count() * 3), indices: out.slice(0, used) };
}

/**
 * Surfaces that touch along an edge are sound to manifold, which keeps a
 * corner of each surface there. On one spot they read as one corner to a
 * slicer, which then finds edges of four faces. So each steps `step` mm
 * towards its own neighbours, in place: the surfaces part and no face is lost.
 * Returns how many corners moved.
 */
export function partTouching({ positions, indices }: IndexedMesh, tolerance: number, step: number): number {
	const touching = onOneSpot(positions, tolerance);
	if (!touching) return 0;
	const toward = ownNeighbours(positions, indices, touching);
	let moved = 0;
	for (let v = 0; v < touching.length; v++) {
		const to = toward.subarray(3 * v, 3 * v + 3);
		const length = Math.hypot(to[0], to[1], to[2]);
		if (!touching[v] || !length) continue;
		// Half way at most: a corner never passes its neighbours.
		const k = Math.min(step, length / 2) / length;
		for (let c = 0; c < 3; c++) positions[3 * v + c] += to[c] * k;
		moved++;
	}
	return moved;
}

/** Per vertex: another one lies on the same spot. Null when none does. */
function onOneSpot(positions: Float32Array, tolerance: number): Uint8Array | null {
	const n = positions.length / 3;
	const grid = vertexGrid(n, tolerance);
	const spot = new Uint32Array(n);
	for (let v = 0; v < n; v++) spot[v] = grid.at(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
	if (grid.count() === n) return null;
	const copies = new Uint32Array(grid.count());
	for (let v = 0; v < n; v++) copies[spot[v]]++;
	return Uint8Array.from(spot, (s) => (copies[s] > 1 ? 1 : 0));
}

/** Per marked vertex: from it to the middle of the corners it shares faces with. */
function ownNeighbours(positions: Float32Array, indices: Uint32Array, marked: Uint8Array): Float64Array {
	const to = new Float64Array(positions.length);
	const count = new Uint32Array(marked.length);
	for (let t = 0; t + 3 <= indices.length; t += 3)
		for (let k = 0; k < 3; k++) {
			const v = indices[t + k];
			if (!marked[v]) continue;
			for (const o of [indices[t + (k + 1) % 3], indices[t + (k + 2) % 3]]) {
				for (let c = 0; c < 3; c++) to[3 * v + c] += positions[3 * o + c] - positions[3 * v + c];
				count[v]++;
			}
		}
	for (let v = 0; v < marked.length; v++)
		if (count[v]) for (let c = 0; c < 3; c++) to[3 * v + c] /= count[v];
	return to;
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
