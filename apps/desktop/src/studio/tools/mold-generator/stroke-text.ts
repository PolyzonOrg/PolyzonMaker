/**
 * A few characters drawn as strokes, for the silicone amount pressed into a
 * mold's base («~34 мл»): the number is known only at the end of a build, in
 * the worker, where OpenSCAD and its fonts are not. Digits, «~», «м», «л», «m», «l»,
 * «г» and a space; anything else is skipped. Pure geometry on manifold.
 */
import type { CrossSection, ManifoldToplevel } from 'manifold-3d';
import type { Bin } from '../booleans/kit';

type Strokes = [number, number][][];

/** On a 4 × 6 grid (lower case 4 tall); each list is one pen stroke. */
const GLYPHS: Record<string, Strokes> = {
	'0': [
		[
			[0, 0],
			[4, 0],
			[4, 6],
			[0, 6],
			[0, 0]
		]
	],
	'1': [
		[
			[1, 5],
			[2, 6],
			[2, 0]
		],
		[
			[1, 0],
			[3, 0]
		]
	],
	'2': [
		[
			[0, 6],
			[4, 6],
			[4, 3],
			[0, 3],
			[0, 0],
			[4, 0]
		]
	],
	'3': [
		[
			[0, 6],
			[4, 6],
			[4, 0],
			[0, 0]
		],
		[
			[1, 3],
			[4, 3]
		]
	],
	'4': [
		[
			[0, 6],
			[0, 3],
			[4, 3]
		],
		[
			[3, 6],
			[3, 0]
		]
	],
	'5': [
		[
			[4, 6],
			[0, 6],
			[0, 3],
			[4, 3],
			[4, 0],
			[0, 0]
		]
	],
	'6': [
		[
			[4, 6],
			[0, 6],
			[0, 0],
			[4, 0],
			[4, 3],
			[0, 3]
		]
	],
	'7': [
		[
			[0, 6],
			[4, 6],
			[1.5, 0]
		]
	],
	'8': [
		[
			[0, 0],
			[4, 0],
			[4, 6],
			[0, 6],
			[0, 0]
		],
		[
			[0, 3],
			[4, 3]
		]
	],
	'9': [
		[
			[0, 0],
			[4, 0],
			[4, 6],
			[0, 6],
			[0, 3],
			[4, 3]
		]
	],
	'~': [
		[
			[0, 2.6],
			[1.3, 3.4],
			[2.7, 2.6],
			[4, 3.4]
		]
	],
	// i18n-ok-begin: glyph shapes of the letters «мл»/«г», keyed by the letter; not text
	м: [
		[
			[0, 0],
			[0, 4],
			[2, 2],
			[4, 4],
			[4, 0]
		]
	],
	л: [
		[
			[0, 0],
			[1, 0.4],
			[1.5, 4],
			[4, 4],
			[4, 0]
		]
	],
	г: [
		[
			[0, 0],
			[0, 4],
			[3.5, 4]
		]
	],
	// i18n-ok-end
	// «ml» of the other languages.
	m: [
		[
			[0, 0],
			[0, 4],
			[4, 4],
			[4, 0]
		],
		[
			[2, 4],
			[2, 0]
		]
	],
	l: [
		[
			[2, 6],
			[2, 0]
		]
	]
};
const ADVANCE = 5.6;
const SPACE = 3;

/** Every kind of space is a space: French puts a no-break one before «ml». */
const SPACES = new Set([' ', '\u00A0', '\u202F']);

/** The characters strokeText() draws. */
export const STROKE_CHARS = new Set([...Object.keys(GLYPHS), ...SPACES]);

/**
 * `text` as a flat outline, capitals `height` mm tall, strokes `stroke` mm
 * wide with round ends, centred on the origin.
 */
export function strokeText(
	wasm: ManifoldToplevel,
	bin: Bin,
	text: string,
	height = 6,
	stroke = 1
): CrossSection {
	const k = height / 6;
	const thin: [number, number][][] = [];
	let x = 0;
	for (const ch of text) {
		if (SPACES.has(ch)) {
			x += SPACE;
			continue;
		}
		const glyph = GLYPHS[ch];
		if (!glyph) continue;
		for (const line of glyph) {
			for (let i = 0; i + 1 < line.length; i++) {
				const [x0, y0] = [(x + line[i][0]) * k, line[i][1] * k];
				const [x1, y1] = [(x + line[i + 1][0]) * k, line[i + 1][1] * k];
				// A hair-thin quad along the segment; the offset below gives it width and round ends.
				const len = Math.hypot(x1 - x0, y1 - y0) || 1;
				const nx = (-(y1 - y0) / len) * 0.01;
				const ny = ((x1 - x0) / len) * 0.01;
				thin.push([
					[x0 - nx, y0 - ny],
					[x1 - nx, y1 - ny],
					[x1 + nx, y1 + ny],
					[x0 + nx, y0 + ny]
				]);
			}
		}
		x += ADVANCE;
	}
	const { CrossSection } = wasm;
	if (!thin.length) return bin.add(new CrossSection([]));
	const lines = bin.add(
		CrossSection.union(thin.map((q) => bin.add(new CrossSection([q], 'NonZero'))))
	);
	const drawn = bin.add(lines.offset(stroke / 2 - 0.01, 'Round'));
	const b = drawn.bounds();
	return bin.add(drawn.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2]));
}
