/**
 * A name that sits on a pencil or a straw: the word lies flat on the bed,
 * a sleeve runs from the middle of it downwards (along −Y), and the pencil
 * goes into the sleeve from below. A bar under the letters joins them into
 * one piece; with the outline on, the letters stand on a
 * rounded backing, so a colour change at its top makes them a second colour.
 *
 * The sleeve lies on the bed too: a flat underneath, the hole horizontal —
 * a hexagon with a corner up or a teardrop, both print without supports.
 * Several names (comma-separated) come out as a set on one plate.
 */
import {
	circle,
	difference,
	extrude,
	hull,
	intersection,
	label,
	offset,
	polygon,
	rotate,
	square,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/pencil-topper';
import { clamp as c } from '../shared/math';

export type HoleShape = 'hex' | 'round';

export interface PencilTopperParams {
	/** One or more names, comma-separated */
	names: string;
	font: string;
	bold: boolean;
	/** Capital height, mm */
	cap: number;
	/** Widest a name may be, mm (a longer one shrinks) */
	maxWidth: number;
	thickness: number;
	/** Letters on a rounded backing, a second colour above it */
	outline: boolean;
	hole: HoleShape;
	/** Across flats (hexagon) or diameter (round), mm */
	size: number;
	/** Added to the size, mm */
	clearance: number;
	/** How deep the pencil goes in, mm */
	depth: number;
}

export const PENCIL_TOPPER_DEFAULTS: PencilTopperParams = {
	// A sample name printed into the model: each language gets its own.
	get names() {
		return m.t_pencil_topper_default_names();
	},
	font: 'Comfortaa',
	bold: true,
	cap: 14,
	maxWidth: 70,
	thickness: 6,
	outline: true,
	hole: 'hex',
	size: 7,
	clearance: 0.3,
	depth: 14
};

export interface PencilTopperPreset {
	id: string;
	label: string;
	params: Partial<PencilTopperParams>;
}

export const PENCIL_TOPPER_PRESETS: readonly PencilTopperPreset[] = [
	{
		id: 'hex',
		get label() {
			return m.t_pencil_topper_preset_hex();
		},
		params: { hole: 'hex', size: 7 }
	},
	{
		id: 'round',
		get label() {
			return m.t_pencil_topper_preset_round();
		},
		params: { hole: 'round', size: 7.5 }
	},
	{
		id: 'jumbo',
		get label() {
			return m.t_pencil_topper_preset_jumbo();
		},
		params: { hole: 'round', size: 10, cap: 16 }
	},
	{
		id: 'straw',
		get label() {
			return m.t_pencil_topper_preset_straw();
		},
		params: { hole: 'round', size: 6, cap: 12, depth: 10 }
	},
	{
		id: 'class',
		get label() {
			return m.t_pencil_topper_preset_class();
		},
		params: {
			get names() {
				return m.t_pencil_topper_preset_class_names();
			},
			cap: 12,
			maxWidth: 60
		}
	}
];

/** The names of a set: trimmed, empty ones dropped, at most 24. */
export function namesOf(p: Pick<PencilTopperParams, 'names'>): string[] {
	return p.names
		.split(/[,;\n，；、]/)
		.map((s) => s.trim().slice(0, 20))
		.filter(Boolean)
		.slice(0, 24);
}

export function clampPencilTopper(p: PencilTopperParams): PencilTopperParams {
	const hole: HoleShape = p.hole === 'round' ? 'round' : 'hex';
	return {
		names: String(p.names ?? '').slice(0, 400),
		font: p.font,
		bold: !!p.bold,
		cap: c(p.cap, 8, 30),
		maxWidth: c(p.maxWidth, 30, 160),
		thickness: c(p.thickness, 2.4, 10),
		outline: !!p.outline,
		hole,
		size: c(p.size, 4, 14),
		clearance: c(p.clearance, 0, 1),
		depth: c(p.depth, 6, 30)
	};
}

/** Backing round the letters, mm. */
const PAD = 1.6;
/** Wall round the hole, mm. */
const WALL = 2;
/** Flat under the sleeve, mm cut off its round. */
const FLAT = 0.6;

/**
 * Height of the backing, mm: well under half, so the letters stand clear of it
 * and read in one colour too.
 */
const backingHeight = (p: PencilTopperParams) => Math.max(1.2, p.thickness * 0.35);

/** The hole's radius to its corners (hexagon) or its radius (round), mm. */
export function holeRadius(p: PencilTopperParams): number {
	const s = p.size + p.clearance;
	return p.hole === 'hex' ? s / Math.sqrt(3) : s / 2;
}

/** The bore: its axis height and where it runs along Y (from the stop to past the open end). */
export function boreOf(input: PencilTopperParams): { z: number; from: number; to: number } {
	const p = clampPencilTopper(input);
	return { z: sleeveRadius(p) - FLAT, from: -PAD - 2, to: -PAD - 2 - p.depth };
}

/** Outer radius of the sleeve, mm. */
export const sleeveRadius = (p: PencilTopperParams) => holeRadius(p) + WALL;

/**
 * The hole's section in the sleeve's plane (x across, y up from the bed):
 * a hexagon with a corner up, or a circle with a 45° point on top.
 */
function holeSection(p: PencilTopperParams, cz: number): Node {
	const r = holeRadius(p);
	if (p.hole === 'hex')
		return polygon(
			Array.from(
				{ length: 6 },
				(_, i): Vec2 => [r * Math.sin((i * Math.PI) / 3), cz + r * Math.cos((i * Math.PI) / 3)]
			)
		);
	// A teardrop, its point cut off so the wall above stays printable.
	const drop = hull(
		translate([0, cz], circle(r, 48)),
		translate([0, cz + r * Math.SQRT2], square(0.01, 0.01))
	);
	return intersection(drop, translate([0, cz], square(2 * r + 2, 2 * r * 1.15)));
}

/**
 * The sleeve along −Y from y = top, solid for `solidLen`, and its bore (cut
 * from the whole topper, so no letter reaches into it).
 */
function sleeve(p: PencilTopperParams, top: number, solidLen: number): { tube: Node; bore: Node } {
	const ro = sleeveRadius(p);
	const cz = ro - FLAT;
	const outer = intersection(
		translate([0, cz], circle(ro, 64)),
		translate([0, ro], square(2 * ro + 2, 2 * ro))
	);
	const along = (n: Node) => translate([0, top, 0], rotate([90, 0, 0], n));
	return {
		tube: along(extrude(solidLen + p.depth, outer)),
		bore: along(translate([0, 0, solidLen], extrude(p.depth + 1, holeSection(p, cz))))
	};
}

/** One topper, the name's baseline at y = 0, centred on x = 0. */
function topper(p: PencilTopperParams, name: string): { base: Node; raised: Node | null } {
	const glyph = label(name, p.cap, { font: p.font, bold: p.bold, fit: p.maxWidth });
	const back = offset(PAD, 24, glyph);
	// The letters' feet, hulled and pulled down: a bar under the name that joins
	// all the letters. It only touches them — across them it hid the stem of «а»
	// (read as «о») and the bottom of «ш».
	const touch = p.cap * 0.04;
	const feet = intersection(
		p.outline ? back : glyph,
		translate([0, (touch - PAD - 1) / 2], square(2 * p.maxWidth + 40, touch + PAD + 1))
	);
	// The bar is full height: the sleeve hangs from it, so it takes the bending.
	const bar = hull(feet, translate([0, -p.cap * 0.2], feet));
	const low = p.outline ? backingHeight(p) : p.thickness;
	// The sleeve hangs below the name (the letters stay in view), its end in the bar.
	const top = 0;
	const { tube, bore } = sleeve(p, top, top + PAD + 2);
	const barSolid = extrude(p.thickness, bar);
	const base = difference(union(extrude(low, p.outline ? back : glyph), barSolid, tube), bore);
	// The letters above the backing, a colour of their own (the bar keeps the base colour).
	const raised = p.outline
		? difference(
				translate([0, 0, low - 0.01], extrude(p.thickness - low + 0.01, glyph)),
				barSolid,
				bore
			)
		: null;
	return { base, raised };
}

/** Grid of a set: rows down the plate, a new column after `rows`. */
export function layoutOf(p: PencilTopperParams, n: number) {
	const pitchY = p.cap * 1.5 + PAD * 2 + p.cap * 0.25 + PAD + 2 + p.depth + 6;
	const pitchX = p.maxWidth + 2 * PAD + 8;
	const rows = Math.max(1, Math.min(n, Math.floor(200 / pitchY)));
	return { pitchX, pitchY, rows, cols: Math.ceil(n / rows) };
}

function laidOut(p: PencilTopperParams): { base: Node; raised: Node | null } {
	const names = namesOf(p);
	const list = names.length ? names : [''];
	const g = layoutOf(p, list.length);
	const all = list.map((name, i) => {
		const at = [Math.floor(i / g.rows) * g.pitchX, -(i % g.rows) * g.pitchY, 0];
		const t = topper(p, name);
		return { base: translate(at, t.base), raised: t.raised && translate(at, t.raised) };
	});
	return {
		base: union(...all.map((t) => t.base)),
		raised: p.outline ? union(...all.map((t) => t.raised)) : null
	};
}

export function pencilTopperModel(input: PencilTopperParams): Node {
	const { base, raised } = laidOut(clampPencilTopper(input));
	return union(base, raised);
}

/** The colours, for a 3MF of parts: two with the backing on, one without. */
export function pencilTopperColours(input: PencilTopperParams): { name: string; node: Node }[] {
	const { base, raised } = laidOut(clampPencilTopper(input));
	return raised
		? [
				{ name: m.t_pencil_topper_part_base(), node: base },
				{ name: m.t_pencil_topper_part_letters(), node: raised }
			]
		: [{ name: m.t_pencil_topper_part_single(), node: base }];
}

const mm = (v: number) => num(v, 4);

export function pencilTopperSummary(input: PencilTopperParams): string {
	const p = clampPencilTopper(input);
	const n = Math.max(1, namesOf(p).length);
	const what =
		n > 1
			? m.t_pencil_topper_summary_set({ count: n, n: num(n) })
			: m.t_pencil_topper_summary_single();
	const hole =
		p.hole === 'hex'
			? m.t_pencil_topper_summary_hex({ size: mm(p.size + p.clearance) })
			: m.t_pencil_topper_summary_round({ size: mm(p.size + p.clearance) });
	const summary = m.t_pencil_topper_summary({ what, hole, depth: mm(p.depth) });
	return p.outline
		? summary +
				sentenceGap(currentLocale()) +
				m.t_pencil_topper_summary_colour({ height: mm(backingHeight(p)) })
		: summary;
}

export function pencilTopperHeader(input: PencilTopperParams): string[] {
	const p = clampPencilTopper(input);
	return [
		m.t_pencil_topper_scad_title(),
		m.t_pencil_topper_scad_names({ names: namesOf(p).join(', ') || '—' }),
		pencilTopperSummary(p)
	];
}

export function pencilTopperScad(p: PencilTopperParams): string {
	return toScad(pencilTopperModel(p), pencilTopperHeader(p));
}
