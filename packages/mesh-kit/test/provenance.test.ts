import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { exportModel } from '../src/export-files.js';
import { parse3mfObjects } from '../src/mesh-import.js';
import { prepareForPrint } from '../src/print.js';
import { AI_SOURCE, markCoordinates, readMark, type Provenance } from '../src/provenance.js';
import { parseStl } from '../src/stl.js';
import { unzip } from '../src/zip-read.js';
import { icosphere, manifold } from './helpers.js';

const made: Provenance = { tool: 'Polyzon Maker 0.2.1', system: 'TRELLIS.2', created: '2026-11-08T12:00:00Z' };

/** A GLB's JSON and its first POSITION accessor as the floats the file holds. */
function glbParts(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const jsonLength = view.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
	const bin = 28 + jsonLength;
	const accessor = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
	const bufferView = json.bufferViews[accessor.bufferView];
	const start = bin + (bufferView.byteOffset ?? 0);
	return { json, positions: new Float32Array(bytes.slice(start, start + accessor.count * 12).buffer) };
}

describe('the invisible mark in the coordinates', () => {
	it('moves a coordinate by one step of its last digit at most, the same value always the same way', () => {
		const values = Float32Array.from([1, 1, -2.5, 0, 123.456, 123.456, 1e-30, -0]);
		const marked = markCoordinates(values);
		for (let i = 0; i < values.length; i++) expect(Math.abs(marked[i] - values[i])).toBeLessThanOrEqual(Math.abs(values[i]) * 2 ** -22);
		expect(marked[0]).toBe(marked[1]);
		expect(marked[4]).toBe(marked[5]);
		expect(Object.is(marked[3], 0)).toBe(true);
		expect(values[0]).toBe(1); // the input is left as it was
	});

	it('is found on a marked model and not on a model as it was', () => {
		const ball = icosphere(20, 3);
		expect(readMark(markCoordinates(ball)).marked).toBe(true);
		expect(readMark(markCoordinates(ball)).share).toBe(1);
		const plain = readMark(ball);
		expect(plain.marked).toBe(false);
		expect(plain.share).toBeGreaterThan(0.35);
		expect(plain.share).toBeLessThan(0.65);
	});
});

describe('files of an AI-generated model say so', () => {
	it('in the STL header, the 3MF metadata and the GLB XMP, and the mark rides in each', async () => {
		const ball = icosphere(20, 3);
		const files = await exportModel(ball, { formats: ['stl', '3mf', 'glb'], name: 'ball', provenance: made });
		const by = (f: string) => files.find((x) => x.format === f)!;
		for (const f of files) expect(f.problems).toEqual([]);

		const stl = by('stl').bytes!;
		const header = new TextDecoder().decode(stl.subarray(0, 80));
		expect(header).toContain('AI-generated');
		expect(header).toContain('TRELLIS.2');
		expect(readMark(parseStl(stl)).marked).toBe(true);

		const model = new TextDecoder().decode((await unzip(by('3mf').bytes!, (n) => n === '3D/3dmodel.model')).get('3D/3dmodel.model')!);
		expect(model).toContain('xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"');
		expect(model).toContain(`<metadata name="Iptc4xmpExt:DigitalSourceType">${AI_SOURCE}</metadata>`);
		expect(model).toContain('<metadata name="Iptc4xmpExt:AISystemUsed">TRELLIS.2</metadata>');
		expect(model).toContain('<metadata name="Application">Polyzon Maker 0.2.1</metadata>');
		expect(readMark((await parse3mfObjects(by('3mf').bytes!))[0]).marked).toBe(true);

		const { json, positions } = glbParts(by('glb').bytes!);
		expect(json.extensionsUsed).toContain('KHR_xmp_json_ld');
		const packet = json.extensions.KHR_xmp_json_ld.packets[json.asset.extensions.KHR_xmp_json_ld.packet];
		expect(packet['@context'].Iptc4xmpExt).toBe('http://iptc.org/std/Iptc4xmpExt/2008-02-29/');
		expect(packet['Iptc4xmpExt:DigitalSourceType']).toBe(AI_SOURCE);
		expect(packet['Iptc4xmpExt:AISystemUsed']).toBe('TRELLIS.2');
		expect(json.asset.generator).toContain('Polyzon Maker 0.2.1');
		expect(readMark(positions).marked).toBe(true);
	});

	it('the shape does not change, and a file the person made keeps no mark', async () => {
		const ball = icosphere(20, 3);
		const [marked] = await exportModel(ball, { formats: ['stl'], provenance: made });
		const [plain] = await exportModel(ball, { formats: ['stl'] });
		const a = parseStl(marked.bytes!);
		const b = parseStl(plain.bytes!);
		let worst = 0;
		for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
		expect(worst).toBeLessThan(1e-5);
		expect(readMark(b).marked).toBe(false);
		expect(new TextDecoder().decode(plain.bytes!.subarray(0, 80))).not.toContain('AI-generated');
	});

	it('prepared for print, a generated model comes out marked, and a model the person made does not', async () => {
		const wasm = await manifold();
		const ball = icosphere(20, 3);
		const generated = await prepareForPrint(ball, analyze(ball, { wasm }), { wasm, height: 40, provenance: made });
		const stl = generated.files.find((f) => f.format === 'stl')!.bytes!;
		expect(new TextDecoder().decode(stl.subarray(0, 80))).toContain('TRELLIS.2');
		expect(readMark(parseStl(stl)).marked).toBe(true);
		const own = await prepareForPrint(ball, analyze(ball, { wasm, finished: true }), { wasm, height: 40, finished: true });
		expect(readMark(parseStl(own.files.find((f) => f.format === 'stl')!.bytes!)).marked).toBe(false);
	});

	it('an STL header stays 80 bytes for a model named in another alphabet', async () => {
		const [stl] = await exportModel(icosphere(10, 2), { formats: ['stl'], provenance: { ...made, system: 'Модель с очень длинным названием на русском языке и ещё длиннее' } });
		expect(stl.ready).toBe(true);
		expect(parseStl(stl.bytes!).length).toBe(icosphere(10, 2).length);
	});
});
