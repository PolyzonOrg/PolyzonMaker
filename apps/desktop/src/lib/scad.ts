// OpenSCAD without a screen: the editor, agents and the coming assistant all go through here.
import type { Look } from '../studio/chat/scad-run';

export interface Built {
	stl: Uint8Array;
	log: string;
}

/** Text to a model. Bundled fonts the source names go along, so text looks as it does in the tools. */
export async function build(source: string, signal?: AbortSignal): Promise<Built> {
	const [{ compileScad }, { BUNDLED_FONTS, fontFiles }] = await Promise.all([import('../studio/openscad/runner'), import('../studio/tools/shared/fonts')]);
	let fonts: Record<string, Uint8Array> = {};
	for (const { family } of BUNDLED_FONTS) if (source.includes(family)) fonts = { ...fonts, ...(await fontFiles(family)) };
	let log = '';
	const stl = await compileScad(source, { signal, fonts, onLog: (text) => (log = text) });
	return { stl, log };
}

/** One picture of the model from up to four sides, with a scale. */
export async function pictures(stl: Uint8Array, look?: Look, cell?: number, parts?: { name: string; color?: string; triangles: number }[]): Promise<Blob> {
	const { renderViews } = await import('../studio/openscad/views');
	return renderViews(stl, { look, cell, parts });
}
