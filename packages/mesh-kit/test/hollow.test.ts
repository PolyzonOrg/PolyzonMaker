import { assert, expect, test } from 'vitest';
import {
	cavityEdge,
	drainHole,
	hollow,
	HOLLOW_DEFAULTS,
	makeBox,
	makeCavity
} from '../src/hollow.js';
import { planeAt } from '../src/plane.js';
import { meshSdf } from '../src/sdf.js';
import { bounds, meshStats } from '../src/stl.js';
import { boxTris, fromM, manifold, toM } from './helpers.js';

const cube = boxTris(30, 30, 30);

test('the mesh SDF: sign by ray parity, distance clamped to the band', () => {
	const sdf = meshSdf(cube, 5);
	assert.ok(Math.abs(sdf([15, 15, 2]) - 2) < 1e-6);
	assert.ok(Math.abs(sdf([1, 15, 15]) - 1) < 1e-6);
	assert.equal(sdf([15, 15, 15]), 5);
	assert.equal(sdf([40, 15, 15]), -5);
	assert.equal(sdf([15, 15, -1]), -5);
	// On the diagonal edge of the top and bottom faces the jitter keeps the parity right.
	assert.equal(sdf([10, 10, 20]), 5);
	assert.equal(sdf([10, 10, 31]), -5);
});

async function cavityOf(tris: Float32Array, wall = 2) {
	const wasm = await manifold();
	const b = bounds(tris);
	const solid = toM(wasm, tris);
	const cavity = makeCavity(wasm, tris, b, wall, cavityEdge(b, wall, 'standard'));
	return { wasm, solid, cavity };
}

test('hollow cube: a closed shell about `wall` thick', async () => {
	const { solid, cavity } = await cavityOf(cube, 2);
	const cv = cavity.volume();
	// The cavity is the 26 mm cube inside, give or take the grid.
	assert.ok(Math.abs(cv - 26 ** 3) / 26 ** 3 < 0.03, `cavity ${cv}`);
	const shell = meshStats(fromM(solid.subtract(cavity)));
	assert.ok(shell.watertight);
	assert.ok(Math.abs(shell.volume - (30 ** 3 - cv)) < 1);
});

test('drain hole goes from the bottom into the cavity', async () => {
	const { wasm, solid, cavity } = await cavityOf(cube, 2);
	const hole = drainHole(wasm, solid, cavity, 3)!;
	const shell = solid.subtract(cavity);
	const drilled = shell.subtract(hole);
	assert.ok(meshStats(fromM(drilled)).watertight);
	// It removed a 3 mm × 2 mm plug from the floor (plus facets).
	const plug = shell.volume() - drilled.volume();
	assert.ok(plug > 10 && plug < 20, `plug ${plug}`);
});

test('box with a plate: closed lid with a plate, base with a recess', async () => {
	const { wasm, solid, cavity } = await cavityOf(boxTris(40, 40, 30), 2.5);
	const plane = planeAt('z', 20, [20, 20, 15]);
	const r = makeBox(wasm, solid, cavity, plane, {
		...HOLLOW_DEFAULTS,
		mode: 'box',
		wall: 2.5,
		plate: 1.8,
		weld: 1.5,
		clearance: 0.2
	});
	const lid = meshStats(fromM(r.lid));
	const base = meshStats(fromM(r.base));
	assert.ok(lid.watertight && base.watertight);
	// The plate stands below the plane by its thickness.
	assert.ok(Math.abs(lid.bounds.min[2] - (20 - 1.8)) < 0.05, `lid min ${lid.bounds.min[2]}`);
	assert.ok(Math.abs(base.bounds.max[2] - 20) < 1e-3);
	// One body: the plate is welded to the wall, the lid's cavity is sealed inside it.
	const bodies = r.lid.decompose().map((m) => m.volume());
	assert.equal(bodies.filter((v) => v > 0).length, 1);
	assert.equal(bodies.filter((v) => v < 0).length, 1);
	// They do not overlap when assembled.
	assert.ok(r.lid.intersect(r.base).volume() < 1e-3);
});

test('box with a lip: the lip rises from the base into the lid', async () => {
	const { wasm, solid, cavity } = await cavityOf(boxTris(40, 40, 30), 2.4);
	const plane = planeAt('z', 12, [20, 20, 15]);
	const r = makeBox(wasm, solid, cavity, plane, {
		...HOLLOW_DEFAULTS,
		mode: 'box',
		wall: 2.4,
		fit: 'lip',
		lip: 1.5,
		lid: 'plus'
	});
	const base = meshStats(fromM(r.base));
	assert.ok(base.watertight && meshStats(fromM(r.lid)).watertight);
	assert.ok(Math.abs(base.bounds.max[2] - 13.5) < 1e-3);
	assert.ok(r.lid.intersect(r.base).volume() < 1e-3);
});

test('a plane missing the cavity is a coded error', async () => {
	const { wasm, solid, cavity } = await cavityOf(cube, 2);
	expect(() => makeBox(wasm, solid, cavity, planeAt('z', 1, [15, 15, 15]), HOLLOW_DEFAULTS)).toThrow(
		expect.objectContaining({ code: 'plane-misses-cavity' })
	);
});

test('hollow(): a drained shell in one call, the input solid left alone', async () => {
	const wasm = await manifold();
	const solid = toM(wasm, cube);
	const r = hollow(wasm, solid, { wall: 2, drain: true, drainDiameter: 3 });
	assert.equal(r.pieces.length, 1);
	assert.equal(r.pieces[0].role, 'shell');
	assert.deepEqual(r.notes, []);
	const shell = meshStats(r.pieces[0].tris);
	assert.ok(shell.watertight);
	assert.ok(r.pieces[0].volume > 30 ** 3 - 27 ** 3 && r.pieces[0].volume < 30 ** 3 - 25 ** 3);
	assert.ok(Math.abs(solid.volume() - 30 ** 3) < 1e-6);
	const box = hollow(wasm, solid, { mode: 'box', wall: 2 }, planeAt('z', 20, [15, 15, 15]));
	assert.deepEqual(
		box.pieces.map((p) => p.role),
		['base', 'lid']
	);
	expect(() => hollow(wasm, solid, { mode: 'box' })).toThrow(
		expect.objectContaining({ code: 'no-plane' })
	);
});
