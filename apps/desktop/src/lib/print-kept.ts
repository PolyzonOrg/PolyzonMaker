// A model is prepared for print once. The files lie in its folder (print.stl, print.3mf); print.json
// beside them says how they were made and what the check found, so the next visit shows them at once
// instead of repairing and simplifying again. Another version of the app or another model.glb makes
// them anew: preparation may have changed, and the files would be of something else.
import type { Prepared } from './geometry';

export const KEPT_FILE = 'print.json';

/** What a preparation found, without its files and its picture for the screen */
export type Summary = Omit<Prepared, 'stl' | 'threemf' | 'preview'>;

export interface Kept {
	height: number;
	mend: boolean;
	summary: Summary;
}

interface Made {
	/** The app's version */
	version: string;
	/** model.glb's size in bytes: a new one is another model */
	source: number;
}

export function keep(r: Prepared, made: Made & { height: number; mend: boolean }): Uint8Array {
	const { stl: _stl, threemf: _threemf, preview: _preview, ...summary } = r;
	return new TextEncoder().encode(JSON.stringify({ v: 1, ...made, summary }));
}

/** What was kept, when it is of this model, made by this version, and whole; otherwise null. */
export function kept(text: string, made: Made): Kept | null {
	let k: { v?: unknown; version?: unknown; source?: unknown; height?: unknown; mend?: unknown; summary?: Partial<Summary> } | null;
	try {
		k = JSON.parse(text);
	} catch {
		return null;
	}
	if (!k || typeof k !== 'object' || k.v !== 1 || k.version !== made.version || k.source !== made.source) return null;
	const { height, mend, summary } = k;
	if (typeof height !== 'number' || !(height > 0) || typeof mend !== 'boolean' || !summary?.report || !summary.faces) return null;
	return { height, mend, summary: summary as Summary };
}
