/**
 * Glyph outlines for the relief tools (plates, tags, QR signs), in the
 * browser: the OpenSCAD worker draws the lines once at TEXT_SIZE (2D, no
 * CGAL, exported as SVG), the relief worker turns each line into a region.
 * Every line is cached on its own, so sliders and shapes rebuild at once
 * and an edit of one line compiles only that line.
 */
import { buildOutline } from '../scad';
import { fontFiles } from './fonts';
import { TEXT_FONT, textOutlineScad, type Region, type TextShapes } from './relief';

const lineCache = new Map<string, Region>();
/** Capital height per font, measured on the reference «Н» of each compile. */
const caps = new Map<string, number>();

export type GlyphReader = (
	rings: [number, number][][],
	texts: string[],
	signal: AbortSignal
) => Promise<TextShapes>;

export async function textShapes(
	texts: readonly string[],
	signal: AbortSignal,
	read: GlyphReader,
	font = TEXT_FONT,
	/** text() `spacing`: wider for a bold face (boldSpacing). */
	spacing = 1
): Promise<TextShapes | null> {
	const wanted = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
	if (!wanted.length) return null;
	const key = (t: string) => `${font}\u0000${spacing}\u0000${t}`;
	const missing = wanted.filter((t) => !lineCache.has(key(t)));
	if (missing.length || !caps.has(font)) {
		const rings = await buildOutline(
			textOutlineScad(missing, font, spacing),
			signal,
			undefined,
			await fontFiles(font)
		);
		const shapes = await read(rings, missing, signal);
		caps.set(font, shapes.cap);
		for (const t of missing) lineCache.set(key(t), shapes.lines[t] ?? []);
		// Recent lines are enough to go back and forth.
		while (lineCache.size > 48) lineCache.delete(lineCache.keys().next().value as string);
	}
	const lines: Record<string, Region> = {};
	for (const t of wanted) lines[t] = lineCache.get(key(t)) ?? [];
	return { cap: caps.get(font) ?? 0, lines };
}
