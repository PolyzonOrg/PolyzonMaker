/**
 * One CSG build off the main thread: main → { root, glyphs }, worker →
 * { stl } (binary STL, transferred) | { error }; or main → { parts, title,
 * glyphs }, worker → { file } (a 3MF of one model, a part per colour). Each worker serves one
 * build (run.ts keeps a warm spare), so nothing has to be freed in between.
 */
import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { writeStl } from '../stl';
import { write3mf } from '../shared/threemf';
import type { Node } from './csg';
import { evaluate, trianglesOf, type Glyphs } from './evaluate';

// Start loading the WASM as soon as the spare worker exists.
const ready = Module({ locateFile: () => wasmUrl }).then((wasm) => {
	wasm.setup();
	return wasm;
});

self.onmessage = async (
	e: MessageEvent<{
		root: Node;
		glyphs: Glyphs;
		parts?: { name: string; root: Node }[];
		title?: string;
	}>
) => {
	try {
		const wasm = await ready;
		if (e.data.parts) {
			const parts = e.data.parts
				.map((p) => {
					const solid = evaluate(wasm, p.root, e.data.glyphs);
					return { name: p.name, tris: solid ? trianglesOf(solid) : new Float32Array() };
				})
				.filter((p) => p.tris.length > 0);
			if (!parts.length) throw new Error('empty');
			const file = write3mf(parts, e.data.title ?? 'Polyzon Studio');
			self.postMessage({ file: file.buffer }, { transfer: [file.buffer] });
			return;
		}
		const solid = evaluate(wasm, e.data.root, e.data.glyphs);
		const tris = solid ? trianglesOf(solid) : new Float32Array();
		if (tris.length === 0) throw new Error('empty');
		const stl = writeStl(tris);
		self.postMessage({ stl: stl.buffer }, { transfer: [stl.buffer] });
	} catch (err) {
		self.postMessage({ error: err instanceof Error ? err.message : String(err) });
	}
};
