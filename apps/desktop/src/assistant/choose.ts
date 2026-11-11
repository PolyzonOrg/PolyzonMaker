// What the assistant generates with: the best of what is installed that this computer can run.
import { fit, type Bench, type Fit, type Hardware, type Model } from '../lib/catalog';

export interface Choice {
	model: Model;
	/** The detail to ask for; empty for a model that has one */
	preset: string;
	fit: Fit;
}

/** Ready while the person waits in the chat: half an hour at most. */
const soon = (f: Fit) => f.band === 'fast' || f.band === 'wait';

/** Bigger first, column by column. */
const before = (a: number[], b: number[]) => {
	const at = a.findIndex((v, i) => v !== b[i]);
	return at < 0 ? 0 : b[at] - a[at];
};

/**
 * The 3D model and its detail for one picture: the best model at the most detail that is ready soon; when
 * nothing is, the best that runs at all, at its quickest. A model made for several photos is not for one picture.
 * Null only when no model for one picture is installed.
 */
export function bestGenerator(installed: Model[], hw: Hardware, bench: Bench | null): Choice | null {
	const ways = installed
		.filter((m) => m.kind === '3d' && !m.photos)
		.flatMap((model) => (model.presets.length ? model.presets : [undefined]).map((p) => ({ model, preset: p?.id ?? '', detail: p?.time_factor ?? 1, fit: fit(model, hw, bench, p) })));
	// hours either way: the least of them, more detail is the person's call. What the estimate says will not
	// run comes last but still comes: the person installed it, and the memory ladder may run it after all.
	// a plugin's model only when no model of the app's own is there: its quality and times are its author's word
	const rank = (w: (typeof ways)[number]) => [+!w.model.plugin, +soon(w.fit), +(w.fit.band !== 'no'), w.model.quality, soon(w.fit) ? w.detail : -w.detail, +(w.fit.target?.status === 'tested'), -(w.fit.seconds?.[0] ?? 0)];
	ways.sort((a, b) => before(rank(a), rank(b)));
	const best = ways[0];
	return best ? { model: best.model, preset: best.preset, fit: best.fit } : null;
}

/** The picture model: the best of the catalog's, else the first one taken from Hugging Face. */
export function bestPicture(catalog: Model[], custom: string[]): string | null {
	const best = catalog.filter((m) => m.kind === 'picture').sort((a, b) => b.quality - a.quality)[0];
	return best?.id ?? custom[0] ?? null;
}
