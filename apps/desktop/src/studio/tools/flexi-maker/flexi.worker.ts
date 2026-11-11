/** The flexi tool's worker: keeps the uploaded model, builds the jointed links. */
import type { Manifold } from 'manifold-3d';
import { fromManifold, loadManifold, toManifold } from '../manifold';
import { serve } from '../booleans/worker';
import { flexi, type FlexiParams } from './model';

export interface FlexiJob {
	key: string;
	tris: Float32Array;
	params: FlexiParams;
}

export interface FlexiReply {
	links: { tris: Float32Array; volume: number }[];
	/** What was done to the uploaded mesh (repaired, simplified), if anything. */
	note: string | null;
}

let model: { key: string; solid: Manifold; note: string | null } | null = null;

serve<FlexiJob>(async (job) => {
	const wasm = await loadManifold();
	if (model?.key !== job.key) {
		model?.solid.delete();
		model = null;
		const loaded = toManifold(wasm, job.tris);
		model = { key: job.key, solid: loaded.solid, note: loaded.note };
	}
	const r = flexi(wasm, model.solid, job.params);
	const links = r.links.map((m) => {
		const out = { tris: fromManifold(m), volume: m.volume() };
		if (m !== model?.solid) m.delete();
		return out;
	});
	return [{ links, note: model.note } satisfies FlexiReply, links.map((l) => l.tris.buffer)];
});
