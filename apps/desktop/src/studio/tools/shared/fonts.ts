/**
 * Fonts for the text tools. The browser OpenSCAD carries Noto Sans. Six
 * more come with Studio (static/tool-fonts, licences beside them) and are
 * fetched the first time one is chosen; a font the user opens (TTF or OTF)
 * is kept for this visit. Either is written next to Noto, into OpenSCAD's
 * /fonts, with every compile that asks for it, and text() finds it by its
 * family name — the one in the font's own name table.
 */

import { ToolError } from '../build.svelte';
import * as tc from '$msg/tools/common';

export const DEFAULT_FONT = 'Noto Sans';

/** The fonts that come with Studio: all with Cyrillic, ё and №. */
export const BUNDLED_FONTS: readonly { family: string; file: string }[] = [
	{ family: 'Roboto Slab', file: 'RobotoSlab-Regular.ttf' },
	{ family: 'Oswald', file: 'Oswald-Regular.ttf' },
	{ family: 'Comfortaa', file: 'Comfortaa-Regular.ttf' },
	{ family: 'Lobster', file: 'Lobster-Regular.ttf' },
	{ family: 'Russo One', file: 'RussoOne-Regular.ttf' },
	{ family: 'PT Serif', file: 'PTSerif-Regular.ttf' }
];
const bundled = (family: string) => BUNDLED_FONTS.find((f) => f.family === family);

/** «Жирное» of the text tools: the outline grown by this share of the capital height, per side. */
export const BOLD_GROW = 0.03;
/** Joined scripts: their letters are drawn to touch, a wider step would break the joins. */
const SCRIPTS = new Set(['Lobster']);

/**
 * OpenSCAD text() `spacing` for letters grown by `grow` (share of the
 * capital height per side). Growing eats the gap between neighbours from
 * both sides, so pairs the font kerns close («ГА», «LT», «ух») run
 * together; a bold face is wider, and this step keeps them apart (checked
 * on the bundled fonts up to 5.5 %).
 */
export function boldSpacing(grow: number, font = DEFAULT_FONT): number {
	return grow > 0 && !SCRIPTS.has(font) ? Math.round((1 + 3.2 * grow) * 1000) / 1000 : 1;
}
const fetched = new Map<string, Promise<Uint8Array>>();
/** Bigger than any text font; a family of a few MB is the most there is. */
export const FONT_MAX_BYTES = 20 * 1024 * 1024;

interface FontFile {
	file: string;
	bytes: Uint8Array;
}

const files = new Map<string, FontFile>();

const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32 = (b: Uint8Array, at: number) =>
	((b[at] << 24) >>> 0) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);

/**
 * The family name of a TrueType or OpenType font (the first face of a
 * collection), as fontconfig reads it: name 1, Windows Unicode preferred.
 * Null when the bytes are not such a font.
 */
export function fontFamily(bytes: Uint8Array): string | null {
	if (bytes.length < 12) return null;
	let base = 0;
	const tag = String.fromCharCode(...bytes.subarray(0, 4));
	if (tag === 'ttcf') base = u32(bytes, 12);
	const version = u32(bytes, base);
	const kind = String.fromCharCode(...bytes.subarray(base, base + 4));
	if (version !== 0x00010000 && kind !== 'OTTO' && kind !== 'true') return null;
	const tables = u16(bytes, base + 4);
	let name = -1;
	for (let i = 0; i < tables; i++) {
		const rec = base + 12 + i * 16;
		if (rec + 16 > bytes.length) return null;
		if (String.fromCharCode(...bytes.subarray(rec, rec + 4)) === 'name') name = u32(bytes, rec + 8);
	}
	if (name < 0 || name + 6 > bytes.length) return null;
	const count = u16(bytes, name + 2);
	const strings = name + u16(bytes, name + 4);
	let best: { score: number; text: string } | null = null;
	for (let i = 0; i < count; i++) {
		const rec = name + 6 + i * 12;
		if (rec + 12 > bytes.length) break;
		const platform = u16(bytes, rec);
		const nameId = u16(bytes, rec + 6);
		if (nameId !== 1) continue;
		const length = u16(bytes, rec + 8);
		const at = strings + u16(bytes, rec + 10);
		if (at + length > bytes.length) continue;
		const raw = bytes.subarray(at, at + length);
		let text = '';
		if (platform === 3 || platform === 0) {
			for (let k = 0; k + 1 < raw.length; k += 2) text += String.fromCharCode(u16(raw, k));
		} else if (platform === 1) {
			text = String.fromCharCode(...raw);
		} else continue;
		const score = platform === 3 ? 3 : platform === 0 ? 2 : 1;
		text = text.trim();
		if (text && (!best || score > best.score)) best = { score, text };
	}
	return best?.text ?? null;
}

/** Open a font file: its family, ready to choose. Errors are for the page, in its language. */
export async function addFont(file: File): Promise<string> {
	if (file.size > FONT_MAX_BYTES) throw new ToolError(tc.tc_font_too_big({ mb: 20 }));
	const bytes = new Uint8Array(await file.arrayBuffer());
	const family = fontFamily(bytes);
	if (!family) {
		throw new ToolError(tc.tc_font_not_ttf());
	}
	// Noto Sans and the bundled fonts are there already.
	if (family === DEFAULT_FONT || bundled(family)) return family;
	// The name OpenSCAD reads from the program: only safe characters in the file name.
	const index = files.has(family) ? [...files.keys()].indexOf(family) : files.size;
	files.set(family, { file: `user-${index}.${/otf$/i.test(file.name) ? 'otf' : 'ttf'}`, bytes });
	return family;
}

/** The families to choose from: Noto Sans, the bundled ones, then the opened ones. */
export function fontFamilies(): string[] {
	return [DEFAULT_FONT, ...BUNDLED_FONTS.map((f) => f.family), ...files.keys()];
}

/**
 * The files a compile needs for `family`: an opened font's bytes, a bundled
 * one fetched once per page (none for Noto Sans or an unknown family).
 */
export async function fontFiles(family: string): Promise<Record<string, Uint8Array> | undefined> {
	const own = files.get(family);
	if (own) return { [own.file]: own.bytes };
	const shipped = bundled(family);
	if (!shipped) return undefined;
	let bytes = fetched.get(family);
	if (!bytes) {
		bytes = fetch(`/tool-fonts/${shipped.file}`).then(async (res) => {
			if (!res.ok) throw new ToolError(tc.tc_font_not_loaded());
			return new Uint8Array(await res.arrayBuffer());
		});
		// A failed fetch is tried again next time.
		bytes.catch(() => fetched.delete(family));
		fetched.set(family, bytes);
	}
	return { [shipped.file]: await bytes };
}

/** A family the page can draw: an unknown one (not opened this visit) falls back. */
export function usableFont(family: string | undefined): string {
	return family && (family === DEFAULT_FONT || bundled(family) || files.has(family))
		? family
		: DEFAULT_FONT;
}
