import { assert, expect, test } from 'vitest';
import { allocatePins, CONNECTOR_DEFAULTS, cutPart, type ConnectorParams } from '../src/cut.js';
import { planeAt, planeNormal } from '../src/plane.js';
import { meshStats } from '../src/stl.js';
import { boxTris, fromM, manifold, toM } from './helpers.js';

const cube = boxTris(40, 40, 40);
const center: [number, number, number] = [20, 20, 20];

async function cut(axis: 'x' | 'y' | 'z', at: number, c: Partial<ConnectorParams> = {}, t1 = 0) {
	const wasm = await manifold();
	const part = toM(wasm, cube);
	// Pegs 4 mm × 3 mm, two of them, unless a test says otherwise.
	const pegs: ConnectorParams = {
		...CONNECTOR_DEFAULTS,
		mode: 'peg',
		diameter: 4,
		depth: 3,
		count: 2
	};
	return cutPart(wasm, part, planeAt(axis, at, center, t1), { ...pegs, ...c });
}

test('a plain cut gives two closed halves that add up to the whole', async () => {
	const r = await cut('z', 15, { enabled: false });
	const a = meshStats(fromM(r.plus));
	const b = meshStats(fromM(r.minus));
	assert.ok(a.watertight && b.watertight);
	assert.ok(Math.abs(a.volume + b.volume - 64000) < 1);
	assert.ok(Math.abs(b.bounds.max[2] - 15) < 1e-3);
	assert.equal(r.pins, 0);
});

test('pegs: the peg part gains what the socket part loses', async () => {
	const r = await cut('z', 20);
	assert.equal(r.pins, 2);
	const plus = meshStats(fromM(r.plus));
	const minus = meshStats(fromM(r.minus));
	assert.ok(plus.watertight && minus.watertight);
	// Pegs stick out of the lower part above the plane.
	assert.ok(minus.bounds.max[2] > 20 + 2.5);
	assert.ok(plus.volume < 32000 && minus.volume > 32000);
	// The socket is wider than the peg: the socket part lost more than the pegs add.
	assert.ok(32000 - plus.volume > minus.volume - 32000);
});

test('defaults: loose dowels, as many as fit the face', async () => {
	const wasm = await manifold();
	const r = cutPart(wasm, toM(wasm, cube), planeAt('z', 20, center), CONNECTOR_DEFAULTS);
	assert.ok(r.pins >= 1 && r.dowels && r.dowelsFlat);
	assert.ok(meshStats(fromM(r.plus)).watertight && meshStats(fromM(r.minus)).watertight);
	assert.ok(meshStats(fromM(r.dowelsFlat!)).watertight);
});

test('square pegs are frustums: half as wide at the tip', async () => {
	const r = await cut('z', 20, { shape: 'square' });
	const minus = meshStats(fromM(r.minus));
	assert.ok(minus.watertight && meshStats(fromM(r.plus)).watertight);
	// Two frustums 4 → 2 mm, 3 mm high: 28 mm³ each above the plane.
	assert.ok(Math.abs(minus.volume - 32000 - 56) < 1, `pegs ${minus.volume - 32000}`);
});

test('dowels: sockets in both halves and loose pins of the right size', async () => {
	const r = await cut('x', 20, { mode: 'dowel', count: 3, shape: 'square', diameter: 5, depth: 4 });
	assert.equal(r.pins, 3);
	assert.ok(r.dowels && r.dowelsFlat);
	const flat = meshStats(fromM(r.dowelsFlat!));
	assert.ok(flat.watertight);
	assert.ok(Math.abs(flat.volume - 3 * 5 * 5 * 8) < 1);
	assert.ok(Math.abs(flat.bounds.min[2]) < 1e-3 && Math.abs(flat.bounds.max[2] - 8) < 1e-3);
	assert.ok(meshStats(fromM(r.plus)).volume < 32000 - 3 * 5 * 5 * 4);
});

test('a tilted plane cuts at an angle', async () => {
	const r = await cut('z', 20, { enabled: false }, 30);
	const b = meshStats(fromM(r.minus));
	assert.ok(b.watertight);
	assert.ok(b.bounds.max[2] > 30 && b.bounds.min[2] < 1e-3);
	const n = planeNormal('z', 30);
	assert.ok(Math.abs(n[0] - Math.sin(Math.PI / 6)) < 1e-9);
});

test('a plane outside the part is a coded error', async () => {
	await expect(cut('z', 60)).rejects.toMatchObject({ code: 'plane-misses-model' });
});

test('a too-narrow face is cut without pins and says so', async () => {
	const wasm = await manifold();
	const thin = toM(wasm, boxTris(3, 40, 40));
	const r = cutPart(wasm, thin, planeAt('z', 20, [1.5, 20, 20]), CONNECTOR_DEFAULTS);
	assert.equal(r.pins, 0);
	assert.deepEqual(r.note, { code: 'face-too-narrow' });
});

test('pin counts: one per island first, the rest by area; auto by size', () => {
	assert.deepEqual(allocatePins([100, 100], 3, 4), [2, 1]);
	assert.deepEqual(allocatePins([400, 10, 5], 2, 4), [1, 1, 0]);
	assert.deepEqual(allocatePins([1600], 0, 4), [2]);
	assert.equal(
		allocatePins([1e6, 1e6, 1e6, 1e6], 0, 4).reduce((s, n) => s + n, 0),
		12
	);
});
