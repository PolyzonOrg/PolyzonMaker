/**
 * Where the flat shapes of the «text and outline» tools come from, in the
 * browser: text and SVG through the OpenSCAD worker (glyphs.ts programs),
 * pictures through the trace worker. Results are cached, so only a change of
 * the text or the file waits for a compile; sizes and walls rebuild at once.
 * Units: text at GLYPH_SIZE, SVG in mm as OpenSCAD reads it, images in px.
 */
import { ToolError } from '../build.svelte';
import { buildOutline } from '../scad';
import {
	CAP_HEIGHT,
	LINE_SLOT,
	letterSlotsScad,
	SLOT,
	svgScad,
	textLinesScad,
	type Weight
} from './glyphs';
import { DEFAULT_FONT, fontFiles } from './fonts';
import { workerName } from '$lib/i18n/worker';
import * as tc from '$msg/tools/common';
import { splitBySlot } from './outline';
import type { Point, Ring, TraceOptions } from './trace';

const lineCache = new Map<string, Ring[]>();
const charCache = new Map<string, Ring[]>();

/**
 * Pieces of text (lines or letters) at GLYPH_SIZE, each centred on x = 0
 * with its baseline at y = 0. Only pieces not seen before are compiled,
 * all in one program, one slot each; the rest come from the cache.
 * Another font than Noto Sans is scaled so its capitals stand as tall as
 * Noto's: every size in the tools means the height of a capital letter.
 */
async function textPieces(
	pieces: readonly string[],
	cache: Map<string, Ring[]>,
	program: (missing: string[], font: string, weight: Weight) => string | null,
	pitch: number,
	signal: AbortSignal,
	font: string,
	weight: Weight = 'regular'
): Promise<Ring[][]> {
	const key = (t: string) => `${font}\u0000${weight}\u0000${t}`;
	const missing = [...new Set(pieces.filter((t) => t.trim() && !cache.has(key(t))))];
	const other = font !== DEFAULT_FONT;
	// A capital to measure the font by, in the slot after the pieces.
	const asked = other && missing.length ? [...missing, 'Н'] : missing; // i18n-ok: never shown
	const source = asked.length ? program(asked, font, weight) : null;
	if (source) {
		const groups = splitBySlot(
			await buildOutline(source, signal, undefined, await fontFiles(font)),
			pitch,
			asked.length
		);
		let scale = 1;
		if (other) {
			const cap = groups[asked.length - 1].flat().reduce((top, [, y]) => Math.max(top, y), 0);
			if (cap > 0) scale = CAP_HEIGHT / cap;
		}
		missing.forEach((t, k) =>
			cache.set(
				key(t),
				groups[k].map((r) => r.map(([x, y]) => [(x - k * pitch) * scale, y * scale] as Point))
			)
		);
	}
	const result = pieces.map((t) => cache.get(key(t)) ?? []);
	// Recent pieces are enough to go back and forth.
	while (cache.size > 64) cache.delete(cache.keys().next().value!);
	return result;
}

/** One group of rings per line of text, set as wide as `weight` needs (textLinesScad). */
export function textLines(
	lines: readonly string[],
	signal: AbortSignal,
	font = DEFAULT_FONT,
	weight: Weight = 'regular'
): Promise<Ring[][]> {
	return textPieces(lines, lineCache, textLinesScad, LINE_SLOT, signal, font, weight);
}

/** One group of rings per character (spaces give empty groups). */
export function letterGlyphs(
	chars: readonly string[],
	signal: AbortSignal,
	font = DEFAULT_FONT
): Promise<Ring[][]> {
	return textPieces(chars, charCache, letterSlotsScad, SLOT, signal, font);
}

const svgCache = new WeakMap<File, Ring[]>();

/** Filled contours of an uploaded SVG, in mm. */
export async function svgShape(file: File, signal: AbortSignal): Promise<Ring[]> {
	const hit = svgCache.get(file);
	if (hit) return hit;
	const bytes = new Uint8Array(await file.arrayBuffer());
	let rings: Ring[];
	try {
		rings = await buildOutline(svgScad('shape.svg'), signal, { 'shape.svg': bytes });
	} catch (e) {
		if (signal.aborted) throw e;
		throw new ToolError(tc.tc_svg_unreadable());
	}
	if (!rings.length) throw new ToolError(tc.tc_svg_no_contours());
	svgCache.set(file, rings);
	return rings;
}

const traceCache = new WeakMap<File, Map<string, Ring[]>>();

/** Contours of an uploaded picture (px, y up), traced in a worker. */
export async function imageShape(
	file: File,
	opts: TraceOptions,
	signal: AbortSignal
): Promise<Ring[]> {
	const key = JSON.stringify(opts);
	const byFile = traceCache.get(file) ?? new Map<string, Ring[]>();
	traceCache.set(file, byFile);
	const hit = byFile.get(key);
	if (hit) return hit;
	const rings = await new Promise<Ring[]>((resolve, reject) => {
		const worker = new Worker(new URL('./trace.worker.ts', import.meta.url), {
			type: 'module',
			name: workerName('trace')
		});
		const done = () => {
			worker.terminate();
			signal.removeEventListener('abort', onAbort);
		};
		const onAbort = () => {
			done();
			reject(new DOMException('trace aborted', 'AbortError'));
		};
		signal.addEventListener('abort', onAbort, { once: true });
		worker.onmessage = (e: MessageEvent<{ rings?: Ring[]; error?: string }>) => {
			done();
			if (e.data.rings) resolve(e.data.rings);
			else reject(new ToolError(tc.tc_picture_unreadable()));
		};
		worker.onerror = () => {
			done();
			reject(new ToolError(tc.tc_picture_failed()));
		};
		worker.postMessage({ file, opts });
	});
	byFile.set(key, rings);
	if (byFile.size > 8) byFile.delete(byFile.keys().next().value!);
	return rings;
}
