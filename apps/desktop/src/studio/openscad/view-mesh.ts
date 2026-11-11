/**
 * What the STL viewer draws for a model. The triangles are welded into an
 * indexed mesh: shared corners leave a sixth of the vertices to transform and
 * a quarter of the GPU memory. A generator result, a scan or an AI model past
 * VIEW_TRIANGLES is also simplified until a weak phone turns it smoothly; the
 * picture only — downloads and exports keep every triangle.
 */
import { bounds } from '$lib/tools/stl';
import { weld, type IndexedMesh } from '$lib/tools/weld';

/** Triangles a weak phone still turns smoothly with flat shading. */
export const VIEW_TRIANGLES = 300_000;
/** How far the drawn surface may stray, as a share of the model's size: under a pixel when it fills the scene. */
const VIEW_ERROR = 1e-3;
/** Edges sharper than this get a line; smooth curved surfaces stay clean. */
const EDGE_ANGLE = 30;

export interface ViewMesh extends IndexedMesh {
	/** Size of the model itself (not of the simplified copy), in its own axes. */
	size: [number, number, number];
	simplified: boolean;
	/** Sharp edges and borders as line segments; null on a simplified (dense) model, where they are noise. */
	edges: Float32Array | null;
}

/**
 * The edges where two faces meet at more than EDGE_ANGLE, and the borders of
 * the surface, as line segments (six floats each). What three.js's
 * EdgesGeometry draws, with numeric keys instead of strings: its string keys
 * froze the page for a second on a 200k-triangle generator result.
 */
export function sharpEdges({ positions, indices }: IndexedMesh): Float32Array {
	const n = positions.length / 3;
	const faces = indices.length / 3;
	const normals = new Float32Array(indices.length);
	for (let f = 0; f < faces; f++) {
		const a = indices[3 * f] * 3;
		const b = indices[3 * f + 1] * 3;
		const c = indices[3 * f + 2] * 3;
		const ux = positions[b] - positions[a];
		const uy = positions[b + 1] - positions[a + 1];
		const uz = positions[b + 2] - positions[a + 2];
		const vx = positions[c] - positions[a];
		const vy = positions[c + 1] - positions[a + 1];
		const vz = positions[c + 2] - positions[a + 2];
		const x = uy * vz - uz * vy;
		const y = uz * vx - ux * vz;
		const z = ux * vy - uy * vx;
		const length = Math.hypot(x, y, z) || 1;
		normals[3 * f] = x / length;
		normals[3 * f + 1] = y / length;
		normals[3 * f + 2] = z / length;
	}
	const cos = Math.cos((EDGE_ANGLE * Math.PI) / 180);
	const lines: number[] = [];
	const line = (a: number, b: number) =>
		lines.push(
			positions[3 * a],
			positions[3 * a + 1],
			positions[3 * a + 2],
			positions[3 * b],
			positions[3 * b + 1],
			positions[3 * b + 2]
		);
	// Edge (lower vertex · n + higher vertex) → its first face; -1 once a second one was seen.
	const first = new Map<number, number>();
	for (let f = 0; f < faces; f++) {
		for (let e = 0; e < 3; e++) {
			const a = indices[3 * f + e];
			const b = indices[3 * f + (e === 2 ? 0 : e + 1)];
			const key = a < b ? a * n + b : b * n + a;
			const other = first.get(key);
			if (other === undefined) {
				first.set(key, f);
				continue;
			}
			if (other >= 0) {
				const dot =
					normals[3 * f] * normals[3 * other] +
					normals[3 * f + 1] * normals[3 * other + 1] +
					normals[3 * f + 2] * normals[3 * other + 2];
				if (dot <= cos) line(a, b);
			}
			first.set(key, -1);
		}
	}
	for (const [key, face] of first) if (face >= 0) line(Math.floor(key / n), key % n);
	return new Float32Array(lines);
}

export async function viewMesh(tris: Float32Array, budget = VIEW_TRIANGLES): Promise<ViewMesh> {
	const mesh = weld(tris);
	const size = bounds(mesh.positions).size;
	if (mesh.indices.length / 3 <= budget)
		return { ...mesh, size, simplified: false, edges: sharpEdges(mesh) };
	// Loaded only for a dense model: most results never need it.
	const { MeshoptSimplifier } = await import('meshoptimizer/simplifier');
	await MeshoptSimplifier.ready;
	const [indices] = MeshoptSimplifier.simplify(
		mesh.indices,
		mesh.positions,
		3,
		budget * 3,
		VIEW_ERROR
	);
	// Keep only the vertices the simplified triangles still use.
	const [remap, count] = MeshoptSimplifier.compactMesh(indices);
	const positions = new Float32Array(count * 3);
	for (let v = 0; v < remap.length; v++) {
		const to = remap[v];
		if (to === 0xffffffff) continue;
		positions[to * 3] = mesh.positions[v * 3];
		positions[to * 3 + 1] = mesh.positions[v * 3 + 1];
		positions[to * 3 + 2] = mesh.positions[v * 3 + 2];
	}
	return {
		positions,
		indices,
		size,
		simplified: indices.length < mesh.indices.length,
		edges: null
	};
}
