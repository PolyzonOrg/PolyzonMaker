/**
 * Bases for miniatures and figurines: round, oval, square or hex, the edge
 * bevelled the way tabletop bases are, a pocket for a magnet underneath.
 * A hollow base keeps a rim and a boss round the magnet — less plastic.
 * The base lies as it prints: the bottom on the bed.
 */
import {
	circle,
	cube,
	cylinder,
	difference,
	intersection,
	loft,
	part,
	rotate,
	scale,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/mini-base';
import { clamp as c } from '../shared/math';

export type BaseShape = 'round' | 'oval' | 'square' | 'hex';

export interface MiniBaseParams {
	shape: BaseShape;
	/** Diameter or side; the length of an oval, mm */
	size: number;
	/** The width of an oval, mm */
	width: number;
	height: number;
	/** How much narrower the top is than the bottom, on each side, mm */
	bevel: number;
	magnet: boolean;
	magnetDiameter: number;
	magnetDepth: number;
	/** Extra width of the magnet pocket, mm */
	clearance: number;
	/** Two magnets along an oval instead of one. */
	twoMagnets: boolean;
	hollow: boolean;
	/** How many bases side by side on the bed. */
	count: number;
}

export const MINI_BASE_DEFAULTS: MiniBaseParams = {
	shape: 'round',
	size: 32,
	width: 35,
	height: 4,
	bevel: 1.2,
	magnet: true,
	magnetDiameter: 8,
	magnetDepth: 2,
	clearance: 0.2,
	twoMagnets: false,
	hollow: false,
	count: 1
};

export interface MiniBasePreset {
	id: string;
	label: string;
	params: Partial<MiniBaseParams>;
}

/** Sizes in common use on tabletop bases (by the millimetre, not by a brand). */
export const MINI_BASE_PRESETS: readonly MiniBasePreset[] = [
	{
		id: 'r25',
		get label() {
			return m.t_mini_base_preset_r25();
		},
		params: { shape: 'round', size: 25, magnetDiameter: 6 }
	},
	{
		id: 'r32',
		get label() {
			return m.t_mini_base_preset_r32();
		},
		params: { shape: 'round', size: 32 }
	},
	{
		id: 'r40',
		get label() {
			return m.t_mini_base_preset_r40();
		},
		params: { shape: 'round', size: 40, magnetDiameter: 10 }
	},
	{
		id: 'r60',
		get label() {
			return m.t_mini_base_preset_r60();
		},
		params: { shape: 'round', size: 60, hollow: true, magnetDiameter: 10 }
	},
	{
		id: 'o60',
		get label() {
			return m.t_mini_base_preset_o60();
		},
		params: { shape: 'oval', size: 60, width: 35, twoMagnets: true }
	},
	{
		id: 'o90',
		get label() {
			return m.t_mini_base_preset_o90();
		},
		params: { shape: 'oval', size: 90, width: 52, hollow: true, twoMagnets: true }
	},
	{
		id: 's25',
		get label() {
			return m.t_mini_base_preset_s25();
		},
		params: { shape: 'square', size: 25, height: 3, bevel: 0.6 }
	},
	{
		id: 'set',
		get label() {
			return m.t_mini_base_preset_set();
		},
		params: { shape: 'round', size: 25, count: 10, magnetDiameter: 6 }
	}
];

export function clampMiniBase(p: MiniBaseParams): MiniBaseParams {
	const shapes: BaseShape[] = ['round', 'oval', 'square', 'hex'];
	const size = c(p.size, 10, 200);
	const height = c(p.height, 1.5, 15);
	const magnetDiameter = c(p.magnetDiameter, 2, Math.max(2, size * 0.6));
	return {
		shape: shapes.includes(p.shape) ? p.shape : 'round',
		size,
		width: c(p.width, 10, size),
		height,
		bevel: c(p.bevel, 0, Math.min(height, size / 6)),
		magnet: !!p.magnet,
		magnetDiameter,
		// The floor above the magnet stays at least 0.8 mm.
		magnetDepth: c(p.magnetDepth, 0.5, height - 0.8),
		clearance: c(p.clearance, 0, 0.8),
		twoMagnets: !!p.twoMagnets,
		hollow: !!p.hollow,
		count: Math.round(c(p.count, 1, 30))
	};
}

const FN = 96;

/** The footprint shrunk by `inset` on every side. */
function outline(p: MiniBaseParams, inset: number): Node {
	const s = p.size - 2 * inset;
	switch (p.shape) {
		case 'oval':
			// A circle stretched to the oval: the inset is exact at the ends and the sides.
			return scale([1, (p.width - 2 * inset) / s, 1], circle(s / 2, FN));
		case 'square':
			return square(s, s);
		case 'hex':
			// Flats left and right: the size is across them.
			return rotate([0, 0, 30], circle(s / Math.cos(Math.PI / 6) / 2, 6));
		default:
			return circle(s / 2, FN);
	}
}

/** Where the magnets go: one in the middle, or two along an oval. */
function magnetSpots(p: MiniBaseParams): [number, number][] {
	if (p.shape === 'oval' && p.twoMagnets) {
		// Towards the ends, where the oval has room; never touching each other.
		const x = Math.max(p.magnetDiameter / 2 + 1, ((p.size - p.width) / 2) * 0.8);
		return [
			[-x, 0],
			[x, 0]
		];
	}
	return [[0, 0]];
}

function base(p: MiniBaseParams): Node {
	const body = loft([
		{ z: 0, shape: outline(p, 0) },
		{ z: p.height, shape: outline(p, p.bevel) }
	]);
	const spots = magnetSpots(p);
	const pocketR = p.magnetDiameter / 2 + p.clearance;
	const pockets = p.magnet
		? spots.map(([x, y]) =>
				translate([x, y, -0.01], cylinder(p.magnetDepth + 0.01, pocketR, pocketR, 48))
			)
		: [];
	if (!p.hollow) return difference(body, ...pockets);
	// Hollow: a rim 1.6 mm, the top 1.2 mm, a boss round each magnet.
	const top = 1.2;
	const rim = 1.6;
	const cavity = loft([
		{ z: -0.01, shape: outline(p, rim) },
		{ z: p.height - top, shape: outline(p, rim + p.bevel * ((p.height - top) / p.height)) }
	]);
	const bosses = p.magnet
		? spots.map(([x, y]) =>
				translate([x, y, 0], cylinder(p.height, pocketR + 1.6, pocketR + 1.6, 48))
			)
		: [];
	// Two ribs across a wide base halve the top's bridge over the cavity.
	const span = Math.max(p.size, p.shape === 'oval' ? p.width : 0);
	const ribs =
		span > 30
			? [
					intersection(
						body,
						union(
							translate([-span, -0.6, 0], cube([2 * span, 1.2, p.height])),
							translate([-0.6, -span, 0], cube([1.2, 2 * span, p.height]))
						)
					)
				]
			: [];
	return difference(union(difference(body, cavity), ...bosses, ...ribs), ...pockets);
}

export interface MiniBaseLayout {
	/** Footprint of one base, mm */
	footprint: [number, number];
	/** Centres of the bases on the bed */
	spots: [number, number][];
}

export function miniBaseLayout(input: MiniBaseParams): MiniBaseLayout {
	const p = clampMiniBase(input);
	const w = p.size;
	const d = p.shape === 'oval' ? p.width : p.size;
	const cols = Math.ceil(Math.sqrt(p.count));
	const gap = 4;
	const spots: [number, number][] = [];
	for (let i = 0; i < p.count; i++) {
		const col = i % cols;
		const row = Math.floor(i / cols);
		spots.push([col * (w + gap), row * (d + gap)]);
	}
	return { footprint: [w, d], spots };
}

export function miniBaseModel(input: MiniBaseParams): Node {
	const p = clampMiniBase(input);
	const one = base(p);
	const L = miniBaseLayout(p);
	if (L.spots.length === 1) return part('base', one);
	return part('bases', union(...L.spots.map(([x, y]) => translate([x, y, 0], one))));
}

const mm = (v: number) => num(v, 4);

export function miniBaseSummary(input: MiniBaseParams): string {
	const p = clampMiniBase(input);
	const v = {
		size: mm(p.size),
		length: mm(p.size),
		width: mm(p.width),
		height: mm(p.height),
		magnet: mm(p.magnetDiameter),
		depth: mm(p.magnetDepth)
	};
	switch (p.shape) {
		case 'oval':
			if (!p.magnet) return m.t_mini_base_summary_oval(v);
			return p.twoMagnets
				? m.t_mini_base_summary_oval_magnets(v)
				: m.t_mini_base_summary_oval_magnet(v);
		case 'square':
			return p.magnet ? m.t_mini_base_summary_square_magnet(v) : m.t_mini_base_summary_square(v);
		case 'hex':
			return p.magnet ? m.t_mini_base_summary_hex_magnet(v) : m.t_mini_base_summary_hex(v);
		default:
			return p.magnet ? m.t_mini_base_summary_round_magnet(v) : m.t_mini_base_summary_round(v);
	}
}

export function miniBaseHeader(input: MiniBaseParams): string[] {
	const p = clampMiniBase(input);
	return [
		m.t_mini_base_header_title({ summary: miniBaseSummary(p) }),
		p.count > 1
			? m.t_mini_base_header_count({ count: p.count, n: num(p.count) })
			: m.t_mini_base_header_one(),
		m.t_mini_base_header_print()
	];
}

export function miniBaseScad(p: MiniBaseParams): string {
	return toScad(miniBaseModel(p), miniBaseHeader(p));
}
