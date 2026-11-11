/**
 * OpenSCAD programs that turn text and SVG files into flat outlines. They
 * only draw a 2D shape (no CGAL booleans) and export it as SVG, so they
 * compile in a fraction of a second; ringsFromScadSvg() reads it back. Glyphs are compiled once at
 * a fixed size and scaled in JS, so moving a slider does not recompile.
 *
 * Fonts: Noto Sans Regular (Cyrillic and Latin) is always there, a font the
 * user opened comes with the compile (fonts.ts); heavier weights are made by
 * offsetting the outline (WEIGHTS).
 */
import { str } from '../scad-literals';
import { boldSpacing, DEFAULT_FONT } from './fonts';
import type { Point, Ring } from './trace';
import * as tc from '$msg/tools/common';

/** text() size the glyphs are compiled at. */
export const GLYPH_SIZE = 100;
/** Height of a capital letter at GLYPH_SIZE (Noto Sans «Н», measured). */
export const CAP_HEIGHT = 99.17;
/** Distance between letter slots in letterSlotsScad(). */
export const SLOT = 400;
/** Distance between line slots in textLinesScad() (a line of 24 letters fits). */
export const LINE_SLOT = 4000;
/** Baseline to baseline, in capital heights. */
export const LINE_SPACING = 1.4;

/** Fine curves at any later scale: the angle decides, not the length. */
const HEAD = '$fn = 0; $fa = 6; $fs = 0.5;';

/** Stroke offset per side, as a share of the capital height. */
export const WEIGHTS = { regular: 0, bold: 0.028, black: 0.055 } as const;
export type Weight = keyof typeof WEIGHTS;
export const WEIGHT_OPTIONS: readonly { value: Weight; label: string }[] = [
	{
		value: 'regular',
		get label() {
			return tc.tc_weight_regular();
		}
	},
	{
		value: 'bold',
		get label() {
			return tc.tc_weight_bold();
		}
	},
	{
		value: 'black',
		get label() {
			return tc.tc_weight_black();
		}
	}
];

/** Visible characters (no line breaks or other control characters). */
export function cleanText(text: string, maxLength: number): string {
	// eslint-disable-next-line no-control-regex
	return Array.from(text.replace(/[\u0000-\u001f\u007f]/g, ' '))
		.slice(0, maxLength)
		.join('');
}

// i18n-ok-begin: a transliteration table for file names, never shown
const LATIN: Record<string, string> = {
	а: 'a',
	б: 'b',
	в: 'v',
	г: 'g',
	д: 'd',
	е: 'e',
	ё: 'e',
	ж: 'zh',
	з: 'z',
	и: 'i',
	й: 'y',
	к: 'k',
	л: 'l',
	м: 'm',
	н: 'n',
	о: 'o',
	п: 'p',
	р: 'r',
	с: 's',
	т: 't',
	у: 'u',
	ф: 'f',
	х: 'h',
	ц: 'ts',
	ч: 'ch',
	ш: 'sh',
	щ: 'sch',
	ъ: '',
	ы: 'y',
	ь: '',
	э: 'e',
	ю: 'yu',
	я: 'ya'
}; // i18n-ok-end

/** A short latin file-name part: «Привет 12» → «privet-12». */
export function fileSlug(text: string, fallback: string): string {
	const slug = Array.from(text.toLowerCase())
		.map((ch) => LATIN[ch] ?? ch)
		.join('')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 24)
		.replace(/-+$/, '');
	return slug || fallback;
}

/**
 * Lines of text, each centred in its own slot (x = k · LINE_SLOT), baseline
 * y = 0; set wider for a heavier weight (boldSpacing), so its letters stay apart.
 */
export function textLinesScad(
	lines: readonly string[],
	font = DEFAULT_FONT,
	weight: Weight = 'regular'
): string | null {
	const spacing = boldSpacing(WEIGHTS[weight], font);
	const step = spacing !== 1 ? `, spacing = ${spacing}` : '';
	const body = lines
		.map((line, k) =>
			line.trim()
				? `\ttranslate([${k * LINE_SLOT}, 0]) text(${str(line, 80)}, size = ${GLYPH_SIZE}, font = ${str(font, 120)}, halign = "center"${step});`
				: ''
		)
		.filter(Boolean);
	return body.length ? `${HEAD}\n${body.join('\n')}\n` : null;
}

/** Lines one under another, centred, baselines 1.4 capitals apart (GLYPH_SIZE units). */
export function stackLines(lines: readonly (readonly Ring[])[]): Ring[] {
	return lines.flatMap((rings, k) =>
		rings.map((r) => r.map(([x, y]) => [x, y - k * LINE_SPACING * CAP_HEIGHT] as Point))
	);
}

/** One glyph per slot (centred at x = k · SLOT), to lay letters out in JS. */
export function letterSlotsScad(chars: readonly string[], font = DEFAULT_FONT): string | null {
	const body = chars
		.map((ch, k) =>
			ch.trim()
				? `\ttranslate([${k * SLOT}, 0]) text(${str(ch, 4)}, size = ${GLYPH_SIZE}, font = ${str(font, 120)}, halign = "center");`
				: ''
		)
		.filter(Boolean);
	return body.length ? `${HEAD}\n${body.join('\n')}\n` : null;
}

/** An uploaded SVG (passed to the worker as `name`), fills only. */
export function svgScad(name: string): string {
	return `$fn = 0; $fa = 4; $fs = 0.05;\nimport(${str(name, 40)});\n`;
}
