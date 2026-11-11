import { assert, expect, test } from 'vitest';
import { fromManifold } from '../src/manifold.js';
import { voxelRemesh } from '../src/remesh.js';
import { solidSdf } from '../src/sdf.js';
import { meshStats } from '../src/stl.js';
import { boxTris, brokenEdges, damage, manifold } from './helpers.js';

/** A 20 mm cube with its top missing and two side faces turned inside out. */
const broken = damage(boxTris(20, 20, 20), [2, 3], [4, 9]);

test('solidSdf: holes and flipped faces do not change inside and outside', () => {
	const sdf = solidSdf(broken, 4);
	assert.ok(Math.abs(sdf([10, 10, 3]) - 3) < 1e-6, 'inside, 3 mm above the floor');
	assert.equal(sdf([10, 10, 10]), 4);
	// Right under the missing top: still inside, by five of six rays.
	assert.equal(sdf([10, 10, 19]), 4);
	assert.equal(sdf([10, 10, 21]), -4, 'above the hole');
	// Outside, the distance is signed too: the surface lands where it was,
	// in front of a flipped face as well.
	assert.ok(Math.abs(sdf([22, 10, 10]) + 2) < 1e-6);
	assert.ok(Math.abs(sdf([10, -1, 10]) + 1) < 1e-6);
	assert.equal(sdf([40, 40, 40]), -4);
});

test('voxelRemesh: an open, partly flipped box comes back a closed solid of its size', async () => {
	const wasm = await manifold();
	const solid = voxelRemesh(wasm, broken, 0.5);
	assert.equal(solid.status(), 'NoError');
	assert.equal(solid.decompose().length, 1);
	const tris = fromManifold(solid);
	assert.equal(brokenEdges(tris), 0);
	const s = meshStats(tris);
	assert.ok(s.watertight);
	// Sharp corners are rounded off by the grid: a little under 8000 mm³.
	assert.ok(s.volume > 8000 * 0.93 && s.volume < 8000 * 1.02, `${s.volume}`);
	s.bounds.size.forEach((v) => assert.ok(Math.abs(v - 20) < 1, `${s.bounds.size}`));
	solid.delete();
});

test('voxelRemesh refuses a grid that would run for minutes', async () => {
	const wasm = await manifold();
	expect(() => voxelRemesh(wasm, broken, 0.01)).toThrow(expect.objectContaining({ code: 'remesh-too-fine' }));
});
