/**
 * The tools' link to the in-browser OpenSCAD (the same WASM worker as
 * /workspace/scad). OpenSCAD is too slow for live forms, so tools only ask
 * it to draw 2D shapes it is good at — text in Noto Sans, imported SVG —
 * and read the outline back; solids are built in manifold. Values go into
 * programs through scad-literals (never as code).
 */
import { compileScad, warmScad } from '$lib/openscad/runner';
import { ringsFromScadSvg } from './shared/outline';
import type { Ring } from './shared/trace';

export { bool, num, str, vec } from './scad-literals';

/**
 * Compile a program that draws a 2D shape and read its outline: rings in
 * OpenSCAD units, outer contours CCW, holes CW. Files are available to
 * import().
 */
export async function buildOutline(
	source: string,
	signal: AbortSignal,
	files?: Record<string, Uint8Array | string>,
	fonts?: Record<string, Uint8Array>
): Promise<Ring[]> {
	warmScad();
	const svg = await compileScad(source, { signal, files, fonts, format: 'svg' });
	return ringsFromScadSvg(new TextDecoder().decode(svg));
}
