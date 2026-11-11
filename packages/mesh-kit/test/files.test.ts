import { assert, expect, test } from 'vitest';
import { glbMesh, writeGlb } from '../src/glb.js';
import { parse3mf, parseObj } from '../src/mesh-import.js';
import { guessUnit, toMillimetres, writeObj } from '../src/model-convert.js';
import { readGlb, readModel } from '../src/model-file.js';
import { unzip } from '../src/zip-read.js';
import { bounds, meshStats, parseStl, writeStl } from '../src/stl.js';
import { model3mf, write3mf } from '../src/threemf.js';
import { zipStore } from '../src/zip.js';
import { boxTris, icosphere } from './helpers.js';

const volume = (t: Float32Array) => meshStats(t).volume;

/** A closed cube, `s` on a side, its corner at `o`. */
function cube(s: number, o = [0, 0, 0]): Float32Array {
	const v = (x: number, y: number, z: number) => [o[0] + x * s, o[1] + y * s, o[2] + z * s];
	const q = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
	return new Float32Array([
		...q(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)),
		...q(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)),
		...q(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)),
		...q(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)),
		...q(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)),
		...q(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1))
	]);
}

test('3MF: a model of 200 000 faces, the size of a generated one, is written whole', async () => {
	const tris = new Float32Array(200_000 * 9);
	for (let i = 0; i < 200_000; i++) tris.set([i, 0, 0, i + 1, 0, 0, i, 1, 0], i * 9);
	const three = await parse3mf(write3mf([{ name: 'big', tris }], 'big', { plain: true }));
	assert.equal(three.length, tris.length);
});

test('3MF: every coordinate comes back exactly as written', async () => {
	const tris = icosphere(33.3, 3);
	const back = await parse3mf(write3mf([{ name: 'ball', tris }], 'ball', { plain: true }));
	assert.deepEqual(Array.from(back), Array.from(tris));
});

test('3MF: one model of parts, read back with the same triangles and volume', async () => {
	const base = boxTris(40, 20, 3);
	const text = boxTris(10, 5, 1).map((v, i) => (i % 3 === 2 ? v + 3 : v + 5));
	const file = write3mf(
		[
			{ name: 'Основа', tris: base },
			{ name: 'Надпись <1>', tris: text, colour: '#112233' }
		],
		'Табличка & «тест»'
	);
	const back = await parse3mf(file);
	assert.equal(back.length, base.length + text.length);
	assert.ok(Math.abs(volume(back) - (40 * 20 * 3 + 10 * 5 * 1)) < 1e-3, `${volume(back)}`);
	const xml = model3mf([{ name: 'A', tris: base }], 'X');
	assert.match(xml, /<components>\s*<component objectid="2"\/>/);
	assert.match(xml, /<base name="A" displaycolor="#F2F2F2"\/>/);
	assert.match(xml, /<metadata name="Application">Polyzon mesh-kit<\/metadata>/);
	assert.match(
		model3mf([{ name: 'A', tris: base }], 'X', { application: 'Polyzon Ark', lang: 'ru-RU' }),
		/xml:lang="ru-RU"[\s\S]*Polyzon Ark/
	);
	assert.notMatch(model3mf([{ name: 'a<b', tris: base }], 'x&y'), /a<b|x&y/, 'names are escaped');
});

test('model convert: units to millimetres and onto the bed', () => {
	const metres = cube(0.05, [1, 2, 3]);
	assert.equal(guessUnit(bounds(metres).size), 'm');
	assert.equal(guessUnit(bounds(cube(40)).size), 'mm');
	const b = bounds(toMillimetres(metres, 'm', true));
	b.size.forEach((v) => assert.ok(Math.abs(v - 50) < 1e-3));
	assert.ok(Math.abs(b.min[2]) < 1e-6, 'stands on the bed');
	assert.ok(Math.abs(volume(toMillimetres(cube(1), 'in', false)) - 25.4 ** 3) < 1);
	// The source is never changed in place.
	assert.equal(metres[0], 1);
});

test('model convert: OBJ and 3MF read back the same solid', async () => {
	const tris = cube(20, [5, 5, 0]);
	const obj = writeObj(tris, 'my part');
	assert.match(obj, /^o my_part$/m);
	assert.equal(obj.split('\n').filter((l) => l.startsWith('v ')).length, 8, 'shared vertices');
	const back = parseObj(obj);
	assert.equal(back.length, tris.length);
	assert.ok(Math.abs(volume(back) - 8000) < 1e-3);
	const three = await parse3mf(write3mf([{ name: 'part', tris }], 'part'));
	assert.ok(Math.abs(volume(three) - 8000) < 1e-3);
});

test('a 3MF saved in inches comes in at its size in millimetres', async () => {
	const xml = (unit: string) =>
		`<?xml version="1.0"?><model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
	const file = (unit: string) =>
		zipStore([{ name: '3D/3dmodel.model', data: new TextEncoder().encode(xml(unit)) }]);
	assert.ok(Math.abs(bounds(await parse3mf(file('inch'))).size[0] - 25.4) < 1e-4);
	assert.ok(Math.abs(bounds(await parse3mf(file('millimeter'))).size[0] - 1) < 1e-6);
});

test('a sliver whose corners meet does not open a closed mesh (CAD tessellation)', () => {
	// OpenCascade leaves needle triangles along fillet seams: two corners within a micron.
	const sliver = new Float32Array([0, 0, 0, 0, 0, 0.0000004, 1, 0, 0]);
	const s = meshStats(new Float32Array([...cube(1), ...sliver]));
	assert.equal(s.nonManifoldEdges, 0);
	assert.ok(s.watertight);
	// A real hole still shows.
	assert.equal(meshStats(cube(1).slice(9)).watertight, false);
});

/** A GLB with one triangle (u16 indices) under `node`, as a generator would send it. */
function glb(
	node: Record<string, unknown>,
	extra: Record<string, unknown> = {},
	positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
): Uint8Array {
	const indices = new Uint16Array([0, 1, 2, 0]); // padded to 4 bytes; the accessor counts 3
	const bin = new Uint8Array(positions.byteLength + indices.byteLength);
	bin.set(new Uint8Array(positions.buffer), 0);
	bin.set(new Uint8Array(indices.buffer), positions.byteLength);
	const json = {
		asset: { version: '2.0' },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ children: [1] }, { mesh: 0, ...node }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
		buffers: [{ byteLength: bin.length }],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: 36 },
			{ buffer: 0, byteOffset: 36, byteLength: 8 }
		],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
			{ bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
		],
		...extra
	};
	let text = new TextEncoder().encode(JSON.stringify(json));
	const padded = new Uint8Array(text.length + ((4 - (text.length % 4)) % 4)).fill(0x20);
	padded.set(text);
	text = padded;
	const out = new Uint8Array(12 + 8 + text.length + 8 + bin.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, out.length, true);
	view.setUint32(12, text.length, true);
	view.setUint32(16, 0x4e4f534a, true);
	out.set(text, 20);
	view.setUint32(20 + text.length, bin.length, true);
	view.setUint32(24 + text.length, 0x004e4942, true);
	out.set(bin, 28 + text.length);
	return out;
}

const near = (actual: ArrayLike<number>, expected: number[]) =>
	assert.deepEqual(
		Array.from(actual, (v) => Math.round(v * 1e5) / 1e5 + 0),
		expected,
		Array.from(actual).join(' ')
	);

test('GLB: node transforms apply and Y-up becomes Z-up', () => {
	const mesh = glbMesh(glb({ translation: [10, 20, 30] }));
	// glTF (x, y, z) → (x, -z, y), after the node's translation.
	near(mesh.positions, [10, -30, 20, 11, -30, 20, 10, -30, 21]);
	assert.deepEqual(Array.from(mesh.indices), [0, 1, 2]);
	// A quarter turn about Y moves +X to -Z, which is +Y after the axis swap.
	const s = Math.SQRT1_2;
	near(glbMesh(glb({ rotation: [0, s, 0, s] })).positions, [0, 0, 0, 0, 1, 0, 0, 0, 1]);
	// A matrix is kept by columns, as Maker writes the turn Pixal3D's export needs (glb.rs `turned`):
	// a quarter turn about X takes +Y to +Z, which is -Y after the axis swap.
	near(glbMesh(glb({ matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1] })).positions, [0, 0, 0, 1, 0, 0, 0, -1, 0]);
});

test('GLB: a mirroring node keeps the faces pointing out', () => {
	assert.deepEqual(Array.from(glbMesh(glb({ scale: [-1, 1, 1] })).indices), [0, 2, 1]);
});

/** A GLB in which every corner is a vertex of its own, as a seam of a texture splits them. */
function splitGlb(tris: Float32Array): Uint8Array {
	const indices = Uint32Array.from({ length: tris.length / 3 }, (_, i) => i);
	const bin = new Uint8Array(tris.byteLength + indices.byteLength);
	bin.set(new Uint8Array(tris.buffer, tris.byteOffset, tris.byteLength), 0);
	bin.set(new Uint8Array(indices.buffer), tris.byteLength);
	const json = new TextEncoder().encode(
		JSON.stringify({
			asset: { version: '2.0' },
			scenes: [{ nodes: [0] }],
			nodes: [{ mesh: 0 }],
			meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
			buffers: [{ byteLength: bin.length }],
			bufferViews: [
				{ buffer: 0, byteOffset: 0, byteLength: tris.byteLength },
				{ buffer: 0, byteOffset: tris.byteLength, byteLength: indices.byteLength }
			],
			accessors: [
				{ bufferView: 0, componentType: 5126, count: indices.length, type: 'VEC3' },
				{ bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' }
			]
		})
	);
	const text = new Uint8Array(json.length + ((4 - (json.length % 4)) % 4)).fill(0x20);
	text.set(json);
	const out = new Uint8Array(28 + text.length + bin.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, out.length, true);
	view.setUint32(12, text.length, true);
	view.setUint32(16, 0x4e4f534a, true);
	out.set(text, 20);
	view.setUint32(20 + text.length, bin.length, true);
	view.setUint32(24 + text.length, 0x004e4942, true);
	out.set(bin, 28 + text.length);
	return out;
}

test('a model of more faces than a print needs is made lighter as it is read, whole and of the same shape', async () => {
	const ball = icosphere(20, 6); // 81 920 faces
	const files: [string, Uint8Array][] = [
		['shared.glb', writeGlb([ball], 'mm')],
		['split.glb', splitGlb(ball)],
		['ball.stl', writeStl(ball)]
	];
	for (const [name, bytes] of files) {
		let told = 0;
		const light = await readModel(name, bytes, { glbUnit: 'mm', maxFaces: 20_000, simplified: (n) => (told = n) });
		const faces = light.length / 9;
		assert.equal(told, 81_920, `${name}: the screen is told the file's own count`);
		assert.ok(faces <= 20_000 && faces > 15_000, `${name}: ${faces} faces`);
		assert.equal(meshStats(light).watertight, true, `${name}: no seam opened`);
		assert.ok(Math.abs(volume(light) / volume(ball) - 1) < 0.01, `${name}: volume ${volume(light)}`);
		bounds(light).size.forEach((s) => assert.ok(Math.abs(s - 40) < 0.4, `${name}: size ${s}`));
	}
	// at the limit nothing is touched, and nothing is said
	let told = 0;
	const same = await readModel('ball.glb', writeGlb([ball], 'mm'), { glbUnit: 'mm', maxFaces: 81_920, simplified: (n) => (told = n) });
	assert.equal(same.length, ball.length);
	assert.equal(told, 0);
});

test('GLB: what it cannot read, it refuses instead of misreading', () => {
	const code = (fn: () => unknown) => {
		try {
			fn();
		} catch (e) {
			return `${(e as { code?: string }).code}: ${(e as Error).message}`;
		}
		return 'no error';
	};
	assert.match(code(() => glbMesh(new Uint8Array(40))), /^glb-unreadable: .*not a GLB/);
	assert.match(
		code(() => glbMesh(glb({}, { extensionsUsed: ['KHR_draco_mesh_compression'] }))),
		/compressed/
	);
	const tooMany = {
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
			{ bufferView: 1, componentType: 5123, count: 300, type: 'SCALAR' }
		]
	};
	assert.match(code(() => glbMesh(glb({}, tooMany))), /out of bounds/);
});

test('GLB: a buffer outside the file is refused, not fetched', () => {
	assert.throws(() => glbMesh(glb({}, { buffers: [{ uri: 'https://example.com/a.bin', byteLength: 44 }] })), /outside the file/);
});

test('readModel: GLB units are said, never guessed; STL as it is', async () => {
	const metres = new Float32Array([0, 0, 0, 0.05, 0, 0, 0, 0.05, 0]);
	near(await readModel('figure.glb', glb({}, {}, metres)), [0, 0, 0, 50, 0, 0, 0, 0, 50]);
	const mm = new Float32Array([0, 0, 0, 30, 0, 0, 0, 30, 0]);
	near(await readModel('figure.glb', glb({}, {}, mm), { glbUnit: 'mm' }), [0, 0, 0, 30, 0, 0, 0, 0, 30]);
	const stl = writeStl(boxTris(10, 10, 10));
	assert.deepEqual(Array.from(await readModel('box.STL', stl)), Array.from(parseStl(stl)));
});

test('GLB written in metres, Y up, reads back as the same millimetres, Z up', () => {
	const box = boxTris(10, 20, 30).map((v, i) => v + [5, -3, 1][i % 3]);
	const back = readGlb(writeGlb([box]));
	near(bounds(back).min, [5, -3, 1]);
	near(bounds(back).max, [15, 17, 31]);
	assert.ok(Math.abs(volume(back) - 6000) < 1e-2, 'faces still point out');
	near(bounds(readGlb(writeGlb([box], 'mm'), 'mm')).max, [15, 17, 31]);
	assert.equal(glbMesh(writeGlb([box, box])).parts, 2);
	const painted = glbMesh(writeGlb([box, box], 'm', ['#ff0000']));
	assert.deepEqual(painted.paints[0].color, [1, 0, 0]);
	assert.equal(painted.paints[1].color, null);
	assert.equal(painted.paints[0].triangles, box.length / 9);
});

test('a deflate-compressed 3MF (as slicers save them) reads', async () => {
	const { deflateRawSync } = await import('node:zlib');
	const raw = new TextEncoder().encode(model3mf([{ name: 'box', tris: boxTris(10, 20, 30) }], 'box', { plain: true }));
	const packed = new Uint8Array(deflateRawSync(raw));
	const zip = zipStore([{ name: '3D/3dmodel.model', data: packed }]);
	const view = new DataView(zip.buffer);
	const central = 30 + '3D/3dmodel.model'.length + packed.length;
	for (const [method, size] of [
		[8, 22],
		[central + 10, central + 24]
	]) {
		view.setUint16(method, 8, true); // deflate
		view.setUint32(size, raw.length, true); // unpacked size
	}
	assert.ok(Math.abs(volume(await parse3mf(zip)) - 6000) < 1e-3);
});

test('a 3MF that unpacks to more than allowed is refused', async () => {
	const big = zipStore([{ name: '3D/3dmodel.model', data: new Uint8Array(4096) }]);
	await expect(unzip(big, () => true, 1000)).rejects.toMatchObject({ code: 'zip-too-large' });
});
