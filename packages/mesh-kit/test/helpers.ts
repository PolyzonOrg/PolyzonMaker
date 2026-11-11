/** Fixtures and checks shared by the tests. */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { loadManifold } from '../src/manifold.js';
import { unweld, weld } from '../src/weld.js';

export const manifold = (): Promise<ManifoldToplevel> => loadManifold();

/** A solid straight from triangles, no repair: throws when they are not one. */
export function toM(wasm: ManifoldToplevel, tris: Float32Array): Manifold {
	const { positions, indices } = weld(tris);
	const mesh = new wasm.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
	mesh.merge();
	return new wasm.Manifold(mesh);
}

/** A solid's exact mesh as triangle soup (no export clean-up). */
export function fromM(m: Manifold): Float32Array {
	const mesh = m.getMesh();
	const stride = mesh.numProp;
	const positions = new Float32Array((mesh.vertProperties.length / stride) * 3);
	for (let v = 0, o = 0; v < mesh.vertProperties.length; v += stride, o += 3) {
		positions[o] = mesh.vertProperties[v];
		positions[o + 1] = mesh.vertProperties[v + 1];
		positions[o + 2] = mesh.vertProperties[v + 2];
	}
	return unweld({ positions, indices: mesh.triVerts });
}

/**
 * Edges not shared by exactly two faces once equal corners are joined, as a
 * slicer joins them reading the STL: Bambu Studio's «non-manifold edges».
 */
export function brokenEdges(tris: Float32Array): number {
	const { positions, indices } = weld(tris, 1e-9);
	const n = positions.length / 3;
	const faces = new Map<number, number>();
	for (let t = 0; t + 3 <= indices.length; t += 3)
		for (let e = 0; e < 3; e++) {
			const a = indices[t + e];
			const b = indices[t + (e === 2 ? 0 : e + 1)];
			const key = a < b ? a * n + b : b * n + a;
			faces.set(key, (faces.get(key) ?? 0) + 1);
		}
	let broken = 0;
	for (const count of faces.values()) if (count !== 2) broken++;
	return broken;
}

/** An axis-aligned box as an STL triangle soup, min corner at the origin. */
export function boxTris(sx: number, sy: number, sz: number): Float32Array {
	const v = [
		[0, 0, 0],
		[sx, 0, 0],
		[sx, sy, 0],
		[0, sy, 0],
		[0, 0, sz],
		[sx, 0, sz],
		[sx, sy, sz],
		[0, sy, sz]
	];
	const faces = [
		[0, 2, 1],
		[0, 3, 2],
		[4, 5, 6],
		[4, 6, 7],
		[0, 1, 5],
		[0, 5, 4],
		[1, 2, 6],
		[1, 6, 5],
		[2, 3, 7],
		[2, 7, 6],
		[3, 0, 4],
		[3, 4, 7]
	];
	return new Float32Array(faces.flatMap((f) => f.flatMap((i) => v[i])));
}

/**
 * An icosphere of radius `r` around `center`: 20 · 4^level triangles,
 * wound counter-clockwise from outside. Curved everywhere, like a generated
 * model, and closed.
 */
export function icosphere(r: number, level = 3, center = [0, 0, 0]): Float32Array {
	const t = (1 + Math.sqrt(5)) / 2;
	const verts: number[][] = [
		[-1, t, 0],
		[1, t, 0],
		[-1, -t, 0],
		[1, -t, 0],
		[0, -1, t],
		[0, 1, t],
		[0, -1, -t],
		[0, 1, -t],
		[t, 0, -1],
		[t, 0, 1],
		[-t, 0, -1],
		[-t, 0, 1]
	].map(unit);
	let faces = [
		[0, 11, 5],
		[0, 5, 1],
		[0, 1, 7],
		[0, 7, 10],
		[0, 10, 11],
		[1, 5, 9],
		[5, 11, 4],
		[11, 10, 2],
		[10, 7, 6],
		[7, 1, 8],
		[3, 9, 4],
		[3, 4, 2],
		[3, 2, 6],
		[3, 6, 8],
		[3, 8, 9],
		[4, 9, 5],
		[2, 4, 11],
		[6, 2, 10],
		[8, 6, 7],
		[9, 8, 1]
	];
	for (let l = 0; l < level; l++) {
		const mid = new Map<string, number>();
		const half = (a: number, b: number) => {
			const key = a < b ? `${a}_${b}` : `${b}_${a}`;
			let i = mid.get(key);
			if (i === undefined) {
				i = verts.length;
				verts.push(unit(verts[a].map((v, k) => (v + verts[b][k]) / 2)));
				mid.set(key, i);
			}
			return i;
		};
		faces = faces.flatMap(([a, b, c]) => {
			const ab = half(a, b);
			const bc = half(b, c);
			const ca = half(c, a);
			return [
				[a, ab, ca],
				[b, bc, ab],
				[c, ca, bc],
				[ab, bc, ca]
			];
		});
	}
	return new Float32Array(
		faces.flatMap((f) => f.flatMap((i) => verts[i].map((v, k) => v * r + center[k])))
	);
}

function unit(v: number[]): number[] {
	const l = Math.hypot(v[0], v[1], v[2]);
	return v.map((x) => x / l);
}

/** The triangles of a soup, minus the ones at `drop`, with the ones at `flip` turned over. */
export function damage(tris: Float32Array, drop: Iterable<number>, flip: Iterable<number>): Float32Array {
	const gone = new Set(drop);
	const turned = new Set(flip);
	const out: number[] = [];
	for (let t = 0; t < tris.length / 9; t++) {
		if (gone.has(t)) continue;
		const c = Array.from(tris.subarray(t * 9, t * 9 + 9));
		out.push(...(turned.has(t) ? [...c.slice(0, 3), ...c.slice(6, 9), ...c.slice(3, 6)] : c));
	}
	return new Float32Array(out);
}

/** The same faces turned the other way: a shell seen from inside, as a generator leaves under its skin. */
export const inward = (tris: Float32Array) => {
	const out = tris.slice();
	for (let t = 0; t < out.length; t += 9)
		for (let k = 0; k < 3; k++) [out[t + 3 + k], out[t + 6 + k]] = [out[t + 6 + k], out[t + 3 + k]];
	return out;
};

export const join = (...parts: Float32Array[]) => {
	const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) out.set(p, (at += p.length) - p.length);
	return out;
};

/** Faces whose centre lies within `r` of `at` taken out: a tear. */
export const tear = (tris: Float32Array, at: number[], r: number) => {
	const kept: number[] = [];
	for (let t = 0; t < tris.length; t += 9) {
		const c = [0, 1, 2].map((k) => (tris[t + k] + tris[t + 3 + k] + tris[t + 6 + k]) / 3);
		if (Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]) > r) for (let k = 0; k < 9; k++) kept.push(tris[t + k]);
	}
	return Float32Array.from(kept);
};
