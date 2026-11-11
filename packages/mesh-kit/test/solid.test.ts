import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { solidify } from '../src/solid.js';
import { boxTris, brokenEdges, fromM, icosphere, inward, join, manifold, tear } from './helpers.js';

const ball = (r: number) => (4 / 3) * Math.PI * r ** 3;

describe('a generated skin made one solid body for printing', () => {
	it('a hollow, torn skin with a loose flap comes out filled and whole', async () => {
		const wasm = await manifold();
		// an outer skin torn in three places, a skin under it turned inward, and a flap lying over it
		let outer = icosphere(20, 4);
		for (const at of [[20, 0, 0], [0, -20, 0], [0, 0, 20]]) outer = tear(outer, at, 2);
		const cap = icosphere(20.6, 4);
		const piece = Float32Array.from(
			Array.from({ length: cap.length / 9 }, (_, t) => t)
				.filter((t) => [1, 4, 7].every((k) => cap[t * 9 + k] > 19))
				.flatMap((t) => Array.from(cap.subarray(t * 9, t * 9 + 9)))
		);
		const skin = join(outer, inward(icosphere(19.6, 4)), piece);
		const { solid } = await solidify(wasm, skin, 2e6);
		try {
			expect(solid.volume() / ball(20)).toBeGreaterThan(0.96);
			expect(solid.volume() / ball(20)).toBeLessThan(1.04);
			const parts = solid.decompose();
			expect(parts.length).toBe(1);
			parts.forEach((p) => p.delete());
			const tris = fromM(solid);
			expect(brokenEdges(tris)).toBe(0);
			const report = analyze(tris, { wasm });
			expect(report.components.filter((c) => c.volume < 0)).toHaveLength(0);
		} finally {
			solid.delete();
		}
	});

	it('a skin torn through to its inside is sealed: the closing grows until the body is whole', async () => {
		const wasm = await manifold();
		let skin = icosphere(20, 4);
		for (const at of [[20, 0, 0], [0, -20, 0], [0, 0, 20]]) skin = tear(skin, at, 2);
		const { solid, voxel, close } = await solidify(wasm, skin, 2e6);
		try {
			expect(close).toBeGreaterThan(2.5 * voxel);
			expect(solid.volume() / ball(20)).toBeGreaterThan(0.96);
			expect(solid.volume() / ball(20)).toBeLessThan(1.04);
			const parts = solid.decompose();
			expect(parts.length).toBe(1);
			parts.forEach((p) => p.delete());
		} finally {
			solid.delete();
		}
	});

	it('a sound body keeps its shape and size', async () => {
		const wasm = await manifold();
		const { solid, voxel } = await solidify(wasm, icosphere(20, 5), 2e6);
		try {
			expect(Math.abs(solid.volume() / ball(20) - 1)).toBeLessThan(0.02);
			const tris = fromM(solid);
			let worst = 0;
			for (let i = 0; i < tris.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(tris[i], tris[i + 1], tris[i + 2]) - 20));
			expect(worst).toBeLessThan(voxel);
		} finally {
			solid.delete();
		}
	});

	it('parts with a gap between them are not glued when nothing needs sealing', async () => {
		const wasm = await manifold();
		const a = boxTris(10, 10, 10);
		const b = boxTris(10, 10, 10).map((v, i) => (i % 3 === 0 ? v + 12 : v));
		const { solid, close } = await solidify(wasm, join(a, b), 1e6);
		try {
			expect(close).toBeLessThan(1);
			const parts = solid.decompose();
			expect(parts.length).toBe(2);
			parts.forEach((p) => p.delete());
		} finally {
			solid.delete();
		}
	});
});
