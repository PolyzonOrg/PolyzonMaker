/**
 * Glyph outlines for the CSG tools. Manifold has no fonts, OpenSCAD has
 * Noto Sans: all texts of a build are drawn in one 2D OpenSCAD program —
 * each in its own slot along Y, no CGAL — exported as SVG and read back as
 * rings per text. Pure; run.ts compiles and caches.
 */
import { str } from '../scad-literals';
import type { Ring } from '../shared/trace';
import { GLYPH_SIZE, type TextRequest } from './csg';
import type { Glyphs } from './evaluate';

/** Distance between the text slots (a line of text at size 10 is ~14 mm tall). */
const SLOT = 30;

/** Fine curves: at size 10 a segment is ≤ 0.05 mm, still ≤ 0.2 mm at size 40. */
const HEAD = '$fn = 0; $fa = 4; $fs = 0.05;';

export function glyphScad(requests: readonly TextRequest[]): string {
	const body = requests
		.map(
			(r, i) =>
				`\ttranslate([0, ${i * SLOT}]) text(${str(r.text, 80)}, size = ${GLYPH_SIZE}, font = ${str(r.font ?? 'Noto Sans', 80)}, halign = "${r.halign}", valign = "${r.valign}"${r.spacing ? `, spacing = ${r.spacing}` : ''});`
		)
		.join('\n');
	return `${HEAD}\n${body}\n`;
}

/** Outline of glyphScad(requests) → each text's rings, moved back to y = 0. */
export function glyphsFromRings(rings: readonly Ring[], requests: readonly TextRequest[]): Glyphs {
	const parts: Ring[][] = requests.map(() => []);
	for (const ring of rings) {
		let sum = 0;
		for (const [, y] of ring) sum += y;
		const slot = Math.round(sum / ring.length / SLOT);
		const dy = slot * SLOT;
		parts[slot]?.push(ring.map(([x, y]) => [x, y - dy]));
	}
	const glyphs: Glyphs = {};
	requests.forEach((r, i) => (glyphs[r.key] = parts[i]));
	return glyphs;
}
