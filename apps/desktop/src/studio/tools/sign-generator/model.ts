/**
 * Light letters: every letter (or outline) becomes a box with an open top —
 * floor plus walls along all its edges, counters included — for an LED
 * strip, and a lid of translucent plastic. Lid kinds:
 *
 * - insert: a plate that drops into the top of the walls, flush, resting on
 *   a narrow ledge along the inside of the walls;
 * - cap: a sleeve that goes over the walls from outside; it prints ceiling
 *   down, so it is built mirrored and reads right once turned over;
 * - channel: a second wall inside the letter keeps the light in a channel
 *   along the edge (a neon-like outline); the insert lid rests on it.
 *
 * Letters that touch or overlap merge into one box. Everything is 2D in
 * manifold, extruded in layers and unioned.
 */
import type { CrossSection, Manifold } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import * as m from '$msg/tools/sign-generator';
import type { Weight } from '../shared/glyphs';
import { DEFAULT_FONT } from '../shared/fonts';
import {
	closing,
	fitSection,
	glyphSection,
	interiorPoint,
	offset,
	ringsOf,
	slab,
	toSection,
	union,
	unionSections,
	type Kit
} from '../shared/section';
import { TRACE_DEFAULTS, type Ring, type TraceOptions } from '../shared/trace';

export type SignSource = 'text' | 'svg' | 'image';
export type LidKind = 'insert' | 'cap' | 'channel' | 'none';

export interface SignParams {
	source: SignSource;
	text: string;
	weight: Weight;
	/** Font family (shared/fonts.ts); one not opened this visit falls back to Noto Sans. */
	font: string;
	/** Capital letter height, mm. */
	letterHeight: number;
	/** Gap between letters, mm; zero or less makes them touch and merge. */
	spacing: number;
	/** Height of an SVG or picture outline, mm. */
	size: number;
	trace: TraceOptions;
	minDetail: number;
	/** Total height of the box, floor included, mm. */
	depth: number;
	wall: number;
	floor: number;
	lid: LidKind;
	lidThickness: number;
	/** Gap around an insert lid, mm per side. */
	lidGap: number;
	/** Width of the ledge an insert lid rests on, mm (0 — none). */
	ledge: number;
	/** Width of the LED channel between the walls, mm. */
	channel: number;
	innerWall: number;
	capWall: number;
	capTop: number;
	capGap: number;
	/** How far the cap slides down over the walls, mm. */
	capDepth: number;
	wireHole: boolean;
	wireDiameter: number;
}

export const SIGN_LIMITS = {
	letterHeight: [30, 400, 1],
	spacing: [-20, 60, 0.5],
	size: [30, 400, 1],
	depth: [10, 100, 0.5],
	wall: [1, 6, 0.1],
	floor: [0.8, 6, 0.1],
	lidThickness: [0.8, 6, 0.1],
	lidGap: [0, 1, 0.05],
	ledge: [0, 4, 0.1],
	channel: [2, 25, 0.5],
	innerWall: [0.8, 5, 0.1],
	capWall: [0.8, 5, 0.1],
	capTop: [0.8, 6, 0.1],
	capGap: [0, 1, 0.05],
	capDepth: [3, 30, 0.5],
	wireDiameter: [2, 12, 0.5]
} as const;

/**
 * 25 mm of depth lets a 10 mm strip sit low enough for the lid to spread
 * the dots into an even glow; 2 mm walls take four 0.4 mm lines and stop
 * light leaking through the sides; a 2 mm lid diffuses without dimming much.
 */
export const SIGN_DEFAULTS: SignParams = {
	source: 'text',
	get text() {
		return m.t_sign_generator_text_default();
	},
	weight: 'bold',
	font: DEFAULT_FONT,
	letterHeight: 80,
	spacing: 6,
	size: 120,
	trace: { ...TRACE_DEFAULTS },
	minDetail: 1,
	depth: 25,
	wall: 2,
	floor: 1.6,
	lid: 'insert',
	lidThickness: 2,
	lidGap: 0.25,
	ledge: 1.2,
	channel: 10,
	innerWall: 1.6,
	capWall: 1.6,
	capTop: 2,
	capGap: 0.2,
	capDepth: 8,
	wireHole: true,
	wireDiameter: 5
};

/** Letters side by side with `spacing` between their outlines' bounds. */
export function layoutLetters(
	kit: Kit,
	chars: readonly string[],
	glyphs: readonly Ring[][],
	p: SignParams
): CrossSection {
	const placed: CrossSection[] = [];
	let x = 0;
	chars.forEach((ch, i) => {
		const rings = glyphs[i] ?? [];
		if (!ch.trim() || !rings.length) {
			x += p.letterHeight * 0.35;
			return;
		}
		const glyph = glyphSection(kit, rings, p.letterHeight, p.weight);
		if (glyph.isEmpty()) return;
		const { min, max } = glyph.bounds();
		placed.push(kit.keep(glyph.translate([x - min[0], 0])));
		x += max[0] - min[0] + p.spacing;
	});
	if (!placed.length) throw new ToolError(m.t_sign_generator_no_letters());
	// A hair of closing fuses letters that only just touch into one box.
	return closing(kit, unionSections(kit, placed), 0.5);
}

/** An SVG or traced outline (mm, even-odd) scaled to its height. */
export function outlineShape(kit: Kit, rings: readonly Ring[], p: SignParams): CrossSection {
	const cs = toSection(kit, rings);
	if (cs.isEmpty()) throw new ToolError(m.t_sign_generator_no_contours());
	return fitSection(kit, cs, p.size, 'height');
}

/** Small round holes in the floor: one per separate region, where it fits. */
function wireHoles(kit: Kit, room: CrossSection, d: number): CrossSection | null {
	const inside = offset(kit, room, -(d / 2 + 0.6));
	const holes: CrossSection[] = [];
	for (const part of inside.decompose()) {
		kit.keep(part);
		const at = interiorPoint(ringsOf(part));
		if (at) holes.push(kit.keep(kit.keep(kit.wasm.CrossSection.circle(d / 2, 32)).translate(at)));
	}
	return holes.length ? unionSections(kit, holes) : null;
}

export interface SignResult {
	corpus: Manifold;
	lid: Manifold | null;
	/** Separate boxes in the corpus. */
	bodies: number;
}

export function buildSign(kit: Kit, shape: CrossSection, p: SignParams): SignResult {
	if (shape.isEmpty()) throw new ToolError(m.t_sign_generator_no_shape());
	const count = shape.decompose().map((c) => kit.keep(c)).length;
	const opening = offset(kit, shape, -p.wall, 'Miter');
	if (opening.isEmpty()) throw new ToolError(m.t_sign_generator_too_thin());
	const walls = kit.keep(shape.subtract(opening));
	const lidT = p.lid === 'insert' || p.lid === 'channel' ? p.lidThickness : 0;
	const top = p.depth;
	const parts: Manifold[] = [slab(kit, walls, 0, top)];

	// Floor, with a hole for the wires where the light lives.
	let floor: CrossSection = shape;
	let lightRoom: CrossSection = opening;
	if (p.lid === 'channel') {
		const innerOuter = offset(kit, shape, -(p.wall + p.channel), 'Miter');
		const innerInner = offset(kit, innerOuter, -p.innerWall, 'Miter');
		const innerWall = kit.keep(innerOuter.subtract(innerInner));
		if (!innerWall.isEmpty()) parts.push(slab(kit, innerWall, 0, top - lidT));
		lightRoom = kit.keep(opening.subtract(innerOuter));
	}
	if (p.wireHole) {
		const holes = wireHoles(kit, lightRoom, p.wireDiameter);
		if (holes) floor = kit.keep(floor.subtract(holes));
	}
	parts.push(slab(kit, floor, 0, p.floor));

	// The ledge under an insert lid, as tall as it is wide and stepped out by
	// half a millimetre a step — a 45° slope that prints without support.
	if (p.lid === 'insert' && p.ledge > 0) {
		const z1 = top - lidT;
		const z0 = Math.max(p.floor, z1 - Math.max(1, p.ledge));
		const steps = Math.max(1, Math.ceil(p.ledge / 0.5));
		for (let i = 1; i <= steps && z1 > z0; i++) {
			const band = kit.keep(
				opening.subtract(offset(kit, opening, -(p.ledge * i) / steps, 'Miter'))
			);
			const a = z0 + ((z1 - z0) * (i - 1)) / steps;
			if (!band.isEmpty()) parts.push(slab(kit, band, a, z1));
		}
	}
	const corpus = union(kit, parts);

	let lid: Manifold | null = null;
	if (p.lid === 'insert' || p.lid === 'channel') {
		const plate = offset(kit, opening, -p.lidGap, 'Miter');
		if (!plate.isEmpty()) lid = slab(kit, plate, 0, p.lidThickness);
	} else if (p.lid === 'cap') {
		// Printed ceiling down: mirror, so it reads right when turned over.
		const mirrored = kit.keep(shape.mirror([1, 0]));
		const inner = offset(kit, mirrored, p.capGap, 'Miter');
		const outer = offset(kit, inner, p.capWall, 'Miter');
		lid = union(kit, [
			slab(kit, outer, 0, p.capTop),
			slab(kit, kit.keep(outer.subtract(inner)), 0, p.capTop + p.capDepth)
		]);
	}
	return { corpus, lid, bodies: count };
}
