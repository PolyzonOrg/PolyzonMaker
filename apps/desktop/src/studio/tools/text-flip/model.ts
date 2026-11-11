/**
 * Two-word sculpture: one word reads from the front, the other from the
 * right. Each pair of letters is the intersection of two extruded glyphs —
 * the front letter pushed back along Y, the side letter pushed along X —
 * so from the front only the first letter's silhouette shows and from the
 * right only the second's. Blocks step diagonally (X for the front word,
 * Y for the side word), so neighbours never hide each other.
 *
 * Words of different length: the shorter word's letters are shared — a
 * letter stands in several blocks that line up behind each other in its
 * view, so it still reads once.
 */
import type { CrossSection, Manifold } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import type { Weight } from '../shared/glyphs';
import { DEFAULT_FONT } from '../shared/fonts';
import { glyphSection, offset, rect, slab, trianglesOf, union, type Kit } from '../shared/section';
import type { Ring } from '../shared/trace';
import type { Triangles } from '../stl';
import * as m from '$msg/tools/text-flip';

export interface FlipParams {
	front: string;
	side: string;
	uppercase: boolean;
	weight: Weight;
	/** Font family (shared/fonts.ts); one not opened this visit falls back to Noto Sans. */
	font: string;
	/** Capital letter height, mm. */
	height: number;
	/** Gap between neighbouring letter blocks, mm. */
	spacing: number;
	base: boolean;
	baseThickness: number;
}

export const FLIP_LIMITS = {
	height: [10, 80, 1],
	spacing: [0, 12, 0.5],
	baseThickness: [1, 8, 0.5]
} as const;

/** Heavy strokes: thin ones leave thread-like bits after the intersection. */
export const FLIP_DEFAULTS: FlipParams = {
	get front() {
		return m.t_text_flip_sample_front();
	},
	get side() {
		return m.t_text_flip_sample_side();
	},
	uppercase: true,
	weight: 'black',
	font: DEFAULT_FONT,
	height: 30,
	spacing: 2,
	base: true,
	baseThickness: 3
};

export interface FlipResult {
	tris: Triangles;
	/** Letter pairs as blocks, e.g. [«Л», «З»]. */
	pairs: [string, string][];
	/** Pairs that did not overlap at all (nothing printed there). */
	empty: [string, string][];
}

/** Characters that make letters: no spaces, uppercased if asked. */
export function flipLetters(word: string, uppercase: boolean, max = 10): string[] {
	const chars = Array.from(uppercase ? word.toUpperCase() : word).filter((c) => c.trim());
	return chars.slice(0, max);
}

/** Which letter of each word stands in block i (the shorter word repeats). */
export function pairIndices(nFront: number, nSide: number): [number, number][] {
	const n = Math.max(nFront, nSide);
	return Array.from({ length: n }, (_, i) => [
		Math.min(nFront - 1, Math.floor((i * nFront) / n)),
		Math.min(nSide - 1, Math.floor((i * nSide) / n))
	]);
}

interface Letter {
	char: string;
	cs: CrossSection;
	width: number;
}

/** Glyph in mm, standing on y = 0 (descenders cut), left edge at x = 0. */
function letter(kit: Kit, char: string, rings: Ring[], p: FlipParams): Letter | null {
	if (!rings.length) return null;
	const glyph = glyphSection(kit, rings, p.height, p.weight);
	const above = kit.keep(glyph.intersect(rect(kit, -1e4, 0, 1e4, 1e4)));
	if (above.isEmpty()) return null;
	const { min, max } = above.bounds();
	return { char, cs: kit.keep(above.translate([-min[0], 0])), width: max[0] - min[0] };
}

/**
 * The sculpture from the glyph outlines of both words (one group of rings
 * per character, at GLYPH_SIZE, as letterGlyphs() gives them).
 */
export function buildTextFlip(
	kit: Kit,
	frontChars: readonly string[],
	frontGlyphs: readonly Ring[][],
	sideChars: readonly string[],
	sideGlyphs: readonly Ring[][],
	p: FlipParams
): FlipResult {
	const front = frontChars
		.map((c, i) => letter(kit, c, frontGlyphs[i] ?? [], p))
		.filter((l) => l !== null);
	const side = sideChars
		.map((c, i) => letter(kit, c, sideGlyphs[i] ?? [], p))
		.filter((l) => l !== null);
	if (!front.length || !side.length) throw new ToolError(m.t_text_flip_both_words());

	// Block corners: the front word steps along X, the side word along Y.
	const xs: number[] = [];
	front.reduce((x, l, i) => ((xs[i] = x), x + l.width + p.spacing), 0);
	const ys: number[] = [];
	side.reduce((y, l, i) => ((ys[i] = y), y + l.width + p.spacing), 0);

	const z0 = p.base ? p.baseThickness : 0;
	const pieces: Manifold[] = [];
	const footprint: CrossSection[] = [];
	const pairs: [string, string][] = [];
	const empty: [string, string][] = [];
	for (const [a, b] of pairIndices(front.length, side.length)) {
		const f = front[a];
		const s = side[b];
		pairs.push([f.char, s.char]);
		// Front letter in the XZ plane, as deep as the side letter is wide.
		const frontSolid = kit.keep(
			kit
				.keep(kit.keep(f.cs.extrude(s.width)).rotate([90, 0, 0]))
				.translate([xs[a], ys[b] + s.width, z0])
		);
		// Side letter in the YZ plane, as deep as the front letter is wide.
		const sideSolid = kit.keep(
			kit.keep(kit.keep(s.cs.extrude(f.width)).rotate([90, 0, 90])).translate([xs[a], ys[b], z0])
		);
		const piece = kit.keep(frontSolid.intersect(sideSolid));
		if (piece.isEmpty() || piece.volume() < 1e-3) {
			empty.push([f.char, s.char]);
			continue;
		}
		pieces.push(piece);
		footprint.push(rect(kit, xs[a], ys[b], xs[a] + f.width, ys[b] + s.width));
	}
	if (!pieces.length) throw new ToolError(m.t_text_flip_no_overlap());

	if (p.base) {
		const hull = kit.keep(kit.wasm.CrossSection.hull(footprint));
		const margin = Math.max(2, p.height * 0.08);
		pieces.push(slab(kit, offset(kit, hull, margin), 0, p.baseThickness));
	}
	return { tris: trianglesOf(union(kit, pieces)), pairs, empty };
}
