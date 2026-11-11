import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { assert, expect, test } from 'vitest';
import {
	BIG_PRINT_DEFAULTS,
	bigPrint,
	bigPrintModel,
	planCloud,
	type BigPrintParams
} from '../src/big-print.js';
import { fits, partsFor } from '../src/big-print-plan.js';
import { meshStats } from '../src/stl.js';
import { manifold } from './helpers.js';

const NO_PINS: BigPrintParams = { ...BIG_PRINT_DEFAULTS, pins: false };

async function cutUp(make: (wasm: ManifoldToplevel) => Manifold, p: BigPrintParams) {
	const wasm = await manifold();
	const model = make(wasm);
	const r = bigPrint(wasm, model, model, planCloud(model), p);
	return { r, volume: model.volume() };
}

/** Every part fits the usable volume as it lies on the bed and is a closed solid. */
function checkParts(r: Awaited<ReturnType<typeof cutUp>>['r']) {
	for (const [i, part] of r.parts.entries()) {
		assert.ok(part.fits, `part ${i + 1} fits`);
		const size = meshStats(part.printTris).bounds;
		const s = [0, 1, 2].map((k) => size.max[k] - size.min[k]);
		for (let k = 0; k < 3; k++)
			assert.ok(s[k] <= r.bed[k] + 1e-3, `part ${i + 1}: ${s.join('×')} on ${r.bed.join('×')}`);
		assert.ok(meshStats(part.tris).watertight, `part ${i + 1} is closed`);
	}
}

test('grid estimate: quarter turns on the bed count', () => {
	assert.equal(partsFor([500, 500, 500], [251, 251, 251]), 8);
	assert.equal(partsFor([300, 100, 100], [100, 310, 100]), 1);
	assert.ok(fits([200, 100, 50], [60, 210, 110]));
	assert.ok(!fits([200, 100, 50], [60, 190, 110]));
});

test('a 500 mm cube on a 256 mm printer: 8 parts that add up to the cube', async () => {
	const { r, volume } = await cutUp((w) => w.Manifold.cube([500, 500, 500]), NO_PINS);
	assert.equal(r.parts.length, 8);
	checkParts(r);
	const sum = r.parts.reduce((s, p) => s + p.volume, 0);
	assert.ok(Math.abs(sum - volume) < 1, `${sum} vs ${volume}`);
	// Seven joints glue eight parts, the small blocks first.
	assert.equal(r.joints.length, 7);
	assert.deepEqual(r.joints.at(-1)!.a[0], 1);
	assert.deepEqual(r.joints.at(-1)!.b[1], 8);
	assert.equal(r.dowels, null);
});

test('a bar a little too long: one cut, two parts', async () => {
	const { r } = await cutUp((w) => w.Manifold.cube([300, 120, 120]), NO_PINS);
	assert.equal(r.parts.length, 2);
	checkParts(r);
	assert.equal(r.joints.length, 1);
	assert.ok(r.joints[0].area > 120 * 120 - 1);
});

test('the shape counts, not its box: a column on a wide base needs 5 parts, not 8', async () => {
	const { r } = await cutUp((w) => {
		const base = w.Manifold.cube([400, 400, 100]);
		const column = w.Manifold.cube([100, 100, 300]).translate([150, 150, 100]);
		return w.Manifold.union(base, column);
	}, NO_PINS);
	assert.equal(r.parts.length, 5);
	checkParts(r);
});

test('a rod too long for the bed is turned to lie diagonally: one part', async () => {
	const { r } = await cutUp((w) => w.Manifold.cube([260, 20, 20]), {
		...NO_PINS,
		bed: [200, 200, 200],
		margin: 0
	});
	assert.equal(r.parts.length, 1);
	assert.equal(r.orientation.yaw, 45);
	checkParts(r);
});

test('dowels: closed parts with sockets, loose dowels printed standing', async () => {
	const { r, volume } = await cutUp((w) => w.Manifold.cube([300, 200, 120]), BIG_PRINT_DEFAULTS);
	assert.equal(r.parts.length, 2);
	checkParts(r);
	const dowels = r.dowels;
	assert.ok(dowels && dowels.count >= 2, `dowels: ${dowels?.count}`);
	assert.equal(r.joints[0].pins, dowels!.count);
	assert.ok(meshStats(dowels!.printTris).watertight);
	// The sockets take more than the dowels fill (the clearance and the floor).
	const sum = r.parts.reduce((s, p) => s + p.volume, 0);
	assert.ok(sum < volume - dowels!.volume, `${sum} + ${dowels!.volume} vs ${volume}`);
	// Standing on end: as tall as a dowel, 1.5 diameters into each part.
	const tall = meshStats(dowels!.printTris).bounds;
	assert.ok(Math.abs(tall.max[2] - tall.min[2] - 18) < 1e-3);
});

test('a model that fits stays whole', async () => {
	const { r } = await cutUp((w) => w.Manifold.sphere(60, 48), BIG_PRINT_DEFAULTS);
	assert.equal(r.parts.length, 1);
	assert.equal(r.joints.length, 0);
	checkParts(r);
});

test('bigPrintModel: scaled up first, refused when it would be a heap of parts', async () => {
	const wasm = await manifold();
	const bar = wasm.Manifold.cube([150, 60, 60]);
	const r = bigPrintModel(wasm, bar, NO_PINS, { scale: 2 });
	assert.equal(r.parts.length, 2);
	checkParts(r);
	assert.ok(Math.abs(bar.volume() - 150 * 60 * 60) < 1e-6, 'the input is left as it was');
	expect(() => bigPrintModel(wasm, bar, NO_PINS, { scale: 20 })).toThrow(
		expect.objectContaining({ code: 'too-many-parts' })
	);
});
