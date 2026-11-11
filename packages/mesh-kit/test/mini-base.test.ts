import type { Manifold } from 'manifold-3d';
import { assert, test } from 'vitest';
import { fromManifold } from '../src/manifold.js';
import {
	MINI_BASE_DEFAULTS,
	MINI_BASE_PRESETS,
	clampMiniBase,
	miniBase,
	miniBaseLayout,
	type BaseShape,
	type MiniBaseParams
} from '../src/mini-base.js';
import { bounds } from '../src/stl.js';
import { brokenEdges, manifold } from './helpers.js';

const base = (p: Partial<MiniBaseParams>): MiniBaseParams => ({ ...MINI_BASE_DEFAULTS, ...p });

async function solid(p: MiniBaseParams) {
	const wasm = await manifold();
	const m = miniBase(wasm, p);
	const tris = fromManifold(m);
	const out = {
		ok: m.status() === 'NoError' && !m.isEmpty(),
		broken: brokenEdges(tris),
		pieces: m.decompose().length,
		size: bounds(tris).size
	};
	m.delete();
	return out;
}

/** Area of the base's cross-section `z` mm above the bed. */
async function slice(p: MiniBaseParams, z: number) {
	const wasm = await manifold();
	const m: Manifold = miniBase(wasm, p);
	const s = m.slice(z);
	const area = s.area();
	s.delete();
	m.delete();
	return area;
}

test('values are clamped: the floor over the magnet stays printable', () => {
	const p = clampMiniBase(base({ height: 2, magnetDepth: 5, count: 99 }));
	assert.equal(p.magnetDepth, 1.2);
	assert.equal(p.count, 30);
});

test('every shape, solid or hollow, is one closed base of the asked size', async () => {
	for (const shape of ['round', 'oval', 'square', 'hex'] as BaseShape[])
		for (const hollow of [false, true]) {
			const p = base({ shape, size: 50, width: 30, hollow, twoMagnets: true });
			const s = await solid(p);
			const id = `${shape}/${hollow}`;
			assert.ok(s.ok && s.broken === 0, id);
			assert.equal(s.pieces, 1, id);
			const [x, y, z] = s.size;
			assert.ok(Math.abs(x - 50) < 0.6, `${id}: ${x}`);
			if (shape === 'oval') assert.ok(Math.abs(y - 30) < 0.6, `${id}: ${y}`);
			assert.ok(Math.abs(z - 4) < 1e-4, `${id}: ${z}`);
		}
});

test('the magnet pocket is the magnet plus the play', async () => {
	const p = base({ size: 32, magnetDiameter: 8, clearance: 0.2, bevel: 0 });
	const area = await slice(p, 1);
	const full = 48 * 16 ** 2 * Math.sin((2 * Math.PI) / 96);
	const pocket = 24 * 4.2 ** 2 * Math.sin((2 * Math.PI) / 48);
	assert.ok(Math.abs(full - area - pocket) < 0.3, `${full - area} vs ${pocket}`);
});

test('a set lies in a grid with gaps', async () => {
	const L = miniBaseLayout(base({ count: 10, size: 25 }));
	assert.equal(L.spots.length, 10);
	assert.equal((await solid(base({ count: 4, size: 25 }))).pieces, 4);
});

test('every preset builds', async () => {
	for (const preset of MINI_BASE_PRESETS) {
		const s = await solid(base(preset.params));
		assert.ok(s.ok && s.broken === 0, preset.id);
	}
});

test('a hollow base is a rim, a top and a boss: little plastic near the bed', async () => {
	const p = base({ shape: 'oval', size: 90, width: 52, hollow: true, twoMagnets: true });
	const hollow = await slice(p, 1);
	const full = await slice({ ...p, hollow: false }, 1);
	assert.ok(hollow < full * 0.3, `${hollow} of ${full}`);
	// The top is closed: a cut just under it is full again.
	assert.ok((await slice(p, 3.5)) > full * 0.8);
});
