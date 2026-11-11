/**
 * Cookie cutter: a thin blade along the outer edge of a shape, a flat rim
 * at its base for stiffness and for the palm, an optional closed top, and an
 * optional stamp — a separate plate with raised lines that presses a
 * drawing into the cut-out dough.
 *
 * Print orientation: rim on the bed, cutting edge up, no supports. To cut,
 * the cutter is turned over, so the whole design is built mirrored (x → −x)
 * and comes out right on the cookie. The stamp is mirrored the same way.
 */
import type { CrossSection, Manifold } from 'manifold-3d';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/cookie-cutter';
import { ToolError } from '../build.svelte';
import type { Weight } from '../shared/glyphs';
import {
	closing,
	fillHoles,
	fitSection,
	glyphSection,
	offset,
	ringsOf,
	slab,
	toSection,
	union,
	unionSections,
	type Kit
} from '../shared/section';
import { TRACE_DEFAULTS, type Ring, type TraceOptions } from '../shared/trace';

export type CookieSource = 'shape' | 'text' | 'svg' | 'image';
/** straight: even wall; fine: the top thins out for a cleaner cut; sturdy: thick at the base. */
export type EdgeKind = 'straight' | 'fine' | 'sturdy';

export interface CookieParams {
	source: CookieSource;
	shape: string;
	text: string;
	weight: Weight;
	/** Larger side of the cookie, mm. */
	size: number;
	trace: TraceOptions;
	minDetail: number;
	bladeHeight: number;
	blade: number;
	edge: EdgeKind;
	rim: boolean;
	rimWidth: number;
	rimHeight: number;
	closedTop: boolean;
	topThickness: number;
	stamp: boolean;
	/** Distance from the cookie's edge to the stamp's outline line, mm. */
	stampInset: number;
	stampLine: number;
	stampRelief: number;
	/** Inner lines of the drawing (counters, holes) as stamp lines. */
	stampDetails: boolean;
	stampText: string;
	stampTextHeight: number;
}

export const COOKIE_LIMITS = {
	size: [25, 220, 1],
	bladeHeight: [8, 45, 0.5],
	blade: [0.6, 3, 0.1],
	rimWidth: [1, 10, 0.5],
	rimHeight: [0.8, 6, 0.2],
	topThickness: [1, 6, 0.2],
	stampInset: [2, 25, 0.5],
	stampLine: [0.6, 3, 0.1],
	stampRelief: [0.6, 5, 0.2],
	stampTextHeight: [4, 40, 1]
} as const;

/**
 * An 18 mm blade cuts dough rolled up to about 10 mm with room to push the
 * cookie out; 1 mm is two and a half 0.4 mm lines — sharp yet not floppy;
 * a 4 × 2.4 mm rim keeps a 75 mm cutter from bending in the hand.
 */
export const COOKIE_DEFAULTS: CookieParams = {
	source: 'shape',
	shape: 'star',
	get text() {
		return m.t_cookie_cutter_sample_text();
	},
	weight: 'black',
	size: 75,
	trace: { ...TRACE_DEFAULTS },
	minDetail: 1,
	bladeHeight: 18,
	blade: 1,
	edge: 'straight',
	rim: true,
	rimWidth: 4,
	rimHeight: 2.4,
	closedTop: false,
	topThickness: 2,
	stamp: false,
	stampInset: 5,
	stampLine: 1.2,
	stampRelief: 2,
	stampDetails: true,
	stampText: '',
	stampTextHeight: 10
};

/** Stamp plate: thick enough to press with a finger, small enough to fit in the cutter. */
const STAMP_BASE = 3;
const STAMP_CLEARANCE = 0.6;

export interface CookieJob {
	p: CookieParams;
	/** glyphs: text at GLYPH_SIZE; shape: built-in, union of rings; outline: mm, even-odd. */
	kind: 'glyphs' | 'shape' | 'outline';
	rings: Ring[];
	/** Stamp lettering at GLYPH_SIZE (empty when there is none). */
	stampGlyphs: Ring[];
}

export interface CookieResult {
	cutter: Manifold;
	stamp: Manifold | null;
	/** The cookie as it will look (not mirrored), for the SVG. */
	outline: Ring[];
	/** Separate cutters (a drawing in several pieces gives several). */
	pieces: number;
	warnings: string[];
}

/** The cookie's shape in mm, as seen on the table (not mirrored). */
export function cookieShape(kit: Kit, { p, kind, rings }: CookieJob): CrossSection {
	if (kind === 'glyphs') {
		// Letters must make one cookie: close the gaps between them.
		const nominal = 50;
		const text = glyphSection(kit, rings, nominal, p.weight);
		return fitSection(kit, closing(kit, text, nominal * 0.12), p.size);
	}
	if (kind === 'shape') return fitSection(kit, toSection(kit, rings, 'Positive'), p.size);
	return fitSection(kit, toSection(kit, rings), p.size);
}

const ring = (kit: Kit, cs: CrossSection, from: number, to: number) =>
	kit.keep(offset(kit, cs, to, 'Round').subtract(offset(kit, cs, from, 'Round')));

export function buildCookie(kit: Kit, job: CookieJob): CookieResult {
	const { p } = job;
	const shape = cookieShape(kit, job);
	if (shape.isEmpty()) throw new ToolError(m.t_cookie_cutter_shape_empty());
	const mirrored = kit.keep(shape.mirror([1, 0]));
	const outer = fillHoles(kit, mirrored);
	const pieces = outer.decompose().map((c) => kit.keep(c)).length;
	const t = p.blade;
	const H = p.bladeHeight;
	const parts: Manifold[] = [];

	if (p.edge === 'fine') {
		// The last few millimetres thin out in four steps to half the wall.
		const taper = Math.min(4, H / 3);
		parts.push(slab(kit, ring(kit, outer, 0, t), 0, H - taper));
		for (let k = 0; k < 4; k++) {
			const z = H - taper + (taper * k) / 4;
			parts.push(slab(kit, ring(kit, outer, 0, t * (1 - (0.5 * (k + 1)) / 4)), z, z + taper / 4));
		}
	} else {
		parts.push(slab(kit, ring(kit, outer, 0, t), 0, H));
		if (p.edge === 'sturdy') parts.push(slab(kit, ring(kit, outer, 0, t * 1.6), 0, H * 0.4));
	}
	if (p.rim) parts.push(slab(kit, ring(kit, outer, 0, t + p.rimWidth), 0, p.rimHeight));
	if (p.closedTop) parts.push(slab(kit, offset(kit, outer, t), 0, p.topThickness));
	const cutter = union(kit, parts);

	let stamp: Manifold | null = null;
	const warnings: string[] = [];
	if (p.stamp) {
		const plate = offset(kit, outer, -STAMP_CLEARANCE);
		const lines: CrossSection[] = [];
		const contour = ring(kit, outer, -p.stampInset - p.stampLine, -p.stampInset);
		if (!contour.isEmpty()) lines.push(contour);
		if (p.stampDetails) {
			// Edges inside the silhouette: counters, eyes, gaps between letters.
			const inner = kit.keep(outer.subtract(mirrored));
			if (!inner.isEmpty()) {
				const edge = ring(kit, inner, -p.stampLine / 2, p.stampLine / 2);
				lines.push(kit.keep(edge.intersect(offset(kit, outer, -1.5))));
			}
		}
		if (job.stampGlyphs.length) {
			const text = glyphSection(kit, job.stampGlyphs, p.stampTextHeight, 'bold');
			const tb = text.bounds();
			const ob = outer.bounds();
			const moved = kit.keep(
				kit
					.keep(text.mirror([1, 0]))
					.translate([
						(tb.min[0] + tb.max[0]) / 2 + (ob.min[0] + ob.max[0]) / 2,
						-(tb.min[1] + tb.max[1]) / 2 + (ob.min[1] + ob.max[1]) / 2
					])
			);
			lines.push(moved);
		}
		const relief = lines.length ? kit.keep(unionSections(kit, lines).intersect(plate)) : null;
		const stampParts = [slab(kit, plate, 0, STAMP_BASE)];
		if (relief && !relief.isEmpty())
			stampParts.push(slab(kit, relief, STAMP_BASE, STAMP_BASE + p.stampRelief));
		else warnings.push(m.t_cookie_cutter_warn_stamp_empty());
		stamp = union(kit, stampParts);
		if (p.stampLine < 0.8) warnings.push(m.t_cookie_cutter_warn_stamp_thin());
	}

	if (t < 0.8) warnings.push(m.t_cookie_cutter_warn_wall_thin());
	if (p.edge === 'fine' && t < 1.2) warnings.push(m.t_cookie_cutter_warn_fine_edge());
	if (p.size > 120 && !p.rim && !p.closedTop) warnings.push(m.t_cookie_cutter_warn_big_no_rim());
	if (pieces > 1)
		warnings.push(
			job.kind === 'glyphs'
				? m.t_cookie_cutter_warn_letters_apart()
				: m.t_cookie_cutter_warn_pieces({ count: pieces, n: num(pieces) })
		);
	return { cutter, stamp, outline: ringsOf(shape), pieces, warnings };
}
