/**
 * «Надпись на модели» worker. It keeps the uploaded model, so moving the
 * text or retyping it does not load and repair the file again.
 */
import type { Manifold } from 'manifold-3d';
import type { Glyphs } from '../csg/evaluate';
import { fromManifold, loadManifold, toManifold } from '../manifold';
import { serve } from '../booleans/worker';
import { applyText, type ModelTextParams } from './model';

export interface ModelTextJob {
	/** Identifies the uploaded file: the cache is kept while it is the same. */
	key: string;
	tris: Float32Array;
	params: ModelTextParams;
	glyphs: Glyphs;
}

export interface ModelTextReply {
	/** The model with the text */
	whole: Float32Array;
	/** The model as loaded and the raised letters alone (for two colours) */
	model: Float32Array | null;
	letters: Float32Array | null;
	volume: number;
	note: string | null;
}

let held: { key: string; solid: Manifold; tris: Float32Array; note: string | null } | null = null;

serve<ModelTextJob>(async (job) => {
	const wasm = await loadManifold();
	if (held?.key !== job.key) {
		held?.solid.delete();
		const { solid, note } = toManifold(wasm, job.tris);
		held = { key: job.key, solid, tris: fromManifold(solid), note };
	}
	const { whole, letters } = applyText(wasm, held.solid, job.params, job.glyphs);
	const reply: ModelTextReply = {
		whole: fromManifold(whole),
		model: letters ? held.tris.slice() : null,
		letters: letters ? fromManifold(letters) : null,
		volume: whole.volume(),
		note: held.note
	};
	whole.delete();
	letters?.delete();
	const buffers = [reply.whole, reply.model, reply.letters]
		.filter((t): t is Float32Array => !!t)
		.map((t) => t.buffer);
	return [reply, buffers];
});
