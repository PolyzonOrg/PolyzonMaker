/**
 * Brackets and corner plates. A shelf bracket is an L with a gusset and
 * screw holes in both arms; it prints on its side, so the bend is inside
 * every layer and the bracket does not break along it (the holes then run
 * along the bed: teardrops, pan-head screws). Flat furniture plates —
 * a corner, a T, a straight mender — print lying, with countersunk holes.
 */
import {
	circle,
	difference,
	extrude,
	hull,
	polygon,
	rotate,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/shelf-bracket';
import { clamp as c } from '../shared/math';
import { countersunk } from '../shared/thread';

export type BracketKind = 'shelf' | 'corner' | 'tee' | 'straight';

export interface ShelfBracketParams {
	kind: BracketKind;
	/** Along the wall (the first arm), mm */
	armA: number;
	/** Under the shelf (the second arm), mm */
	armB: number;
	width: number;
	thickness: number;
	gusset: boolean;
	/** Screw diameter, mm */
	screw: number;
	holes: number;
	count: number;
}

export const SHELF_BRACKET_DEFAULTS: ShelfBracketParams = {
	kind: 'shelf',
	armA: 100,
	armB: 120,
	width: 20,
	thickness: 5,
	gusset: true,
	screw: 4,
	holes: 2,
	count: 2
};

export interface ShelfBracketPreset {
	id: string;
	label: string;
	params: Partial<ShelfBracketParams>;
}

export const SHELF_BRACKET_PRESETS: readonly ShelfBracketPreset[] = [
	{
		id: 'shelf',
		get label() {
			return m.t_shelf_bracket_preset_shelf();
		},
		params: {}
	},
	{
		id: 'small',
		get label() {
			return m.t_shelf_bracket_preset_small();
		},
		params: { armA: 60, armB: 70, width: 16, thickness: 4 }
	},
	{
		id: 'corner',
		get label() {
			return m.t_shelf_bracket_preset_corner();
		},
		params: { kind: 'corner', armA: 60, armB: 60, width: 16, thickness: 3, holes: 2, count: 4 }
	},
	{
		id: 'tee',
		get label() {
			return m.t_shelf_bracket_preset_tee();
		},
		params: { kind: 'tee', armA: 90, armB: 60, width: 16, thickness: 3, count: 2 }
	},
	{
		id: 'straight',
		get label() {
			return m.t_shelf_bracket_preset_straight();
		},
		params: { kind: 'straight', armA: 100, width: 18, thickness: 3, holes: 2, count: 2 }
	}
];

const KINDS: readonly BracketKind[] = ['shelf', 'corner', 'tee', 'straight'];

export function clampShelfBracket(p: ShelfBracketParams): ShelfBracketParams {
	const width = c(p.width, 10, 60);
	return {
		kind: KINDS.includes(p.kind) ? p.kind : 'shelf',
		armA: c(p.armA, 30, 300),
		armB: c(p.armB, 30, 300),
		width,
		thickness: c(p.thickness, 2, 12),
		gusset: !!p.gusset,
		screw: c(p.screw, 2.5, Math.min(8, width / 2.5)),
		holes: Math.round(c(p.holes, 1, 6)),
		count: Math.round(c(p.count, 1, 8))
	};
}

/** Hole centres along an arm from `from` to `to` (mm from the corner), at least `gap` apart. */
function holeSpots(from: number, to: number, want: number, gap = 12): number[] {
	const n = Math.max(1, Math.min(want, Math.floor((to - from) / gap) + 1));
	if (n === 1 || to <= from) return [(from + Math.max(from, to)) / 2];
	return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

/** A teardrop hole along an axis lying on the bed, its point up (+Z). */
function teardrop(d: number, length: number): Node {
	const r = d / 2 + 0.15;
	return extrude(length, hull(circle(r, 32), translate([0, r * Math.SQRT2], square(0.01, 0.01))));
}

/** The shelf L in XY: wall arm up Y (x from 0 to T), shelf arm along X (y from 0 to T). */
function shelf(p: ShelfBracketParams): Node {
	const T = p.thickness;
	const g = Math.min(p.armA, p.armB) * 0.62;
	const outline = union(
		polygon([
			[0, 0],
			[T, 0],
			[T, p.armA],
			[0, p.armA]
		]),
		polygon([
			[0, 0],
			[p.armB, 0],
			[p.armB, T],
			[0, T]
		]),
		p.gusset &&
			polygon([
				[T - 0.01, T - 0.01],
				[T + g, T - 0.01],
				[T - 0.01, T + g]
			]),
		// A fillet in the inside corner even without the gusset.
		polygon([
			[T - 0.01, T - 0.01],
			[T + T * 1.5, T - 0.01],
			[T - 0.01, T + T * 1.5]
		])
	);
	// A window in a big gusset saves plastic; its diagonal brace stays 1.5 × T wide.
	const brace = Math.max(4, 1.5 * T * Math.SQRT2);
	const leg = g - 8 - brace - 8;
	const window =
		p.gusset &&
		g > 40 &&
		leg > 6 &&
		translate(
			[0, 0, -1],
			extrude(
				p.width + 2,
				polygon([
					[T + 8, T + 8],
					[T + 8 + leg, T + 8],
					[T + 8, T + 8 + leg]
				])
			)
		);
	const body = difference(extrude(p.width, outline), window);
	// Holes through the wall arm (along X) and the shelf arm (along Y), the width along Z.
	const z = p.width / 2;
	const reach = Math.max(T + (p.gusset ? g : 0) + p.screw * 1.5, T + 12);
	const holes: Node[] = [];
	for (const y of holeSpots(Math.min(p.armA - 8, reach), p.armA - 8, p.holes))
		holes.push(
			translate([-1, y, z], rotate([0, 90, 0], rotate([0, 0, 90], teardrop(p.screw, T + 2))))
		);
	for (const x of holeSpots(Math.min(p.armB - 8, reach), p.armB - 8, p.holes))
		holes.push(translate([x, T + 1, z], rotate([90, 0, 0], teardrop(p.screw, T + 2))));
	return difference(body, ...holes);
}

function plate(p: ShelfBracketParams): Node {
	const w = p.width;
	const T = p.thickness;
	const r = Math.min(3, w * 0.2);
	let shape: Node;
	const spots: [number, number][] = [];
	if (p.kind === 'straight') {
		shape = translate([p.armA / 2, 0], rrect(p.armA, w, r, 24));
		for (const x of holeSpots(w / 2, p.armA / 2 - 6, p.holes)) spots.push([x, 0], [p.armA - x, 0]);
	} else if (p.kind === 'tee') {
		// The bar along X, the stem down −Y from its middle.
		shape = union(
			translate([0, 0], rrect(p.armA, w, r, 24)),
			translate([0, -p.armB / 2 + w / 4], rrect(w, p.armB - w / 2, r, 24))
		);
		for (const x of holeSpots(w * 0.9, p.armA / 2 - w / 2, p.holes)) spots.push([x, 0], [-x, 0]);
		for (const y of holeSpots(w * 0.9, p.armB - w, p.holes)) spots.push([0, -y]);
	} else {
		// Both arms from the corner's outer edge: its corner square is solid.
		shape = union(
			translate([(p.armA - w / 2) / 2, 0], rrect(p.armA + w / 2, w, r, 24)),
			translate([0, (p.armB - w / 2) / 2], rrect(w, p.armB + w / 2, r, 24))
		);
		for (const x of holeSpots(w * 0.9, p.armA - w / 2, p.holes)) spots.push([x, 0]);
		for (const y of holeSpots(w * 0.9, p.armB - w / 2, p.holes)) spots.push([0, y]);
	}
	return difference(extrude(T, shape), ...spots.map(([x, y]) => countersunk(x, y, p.screw, T)));
}

export function shelfBracketModel(input: ShelfBracketParams): Node {
	const p = clampShelfBracket(input);
	const one = p.kind === 'shelf' ? shelf(p) : plate(p);
	const step: Record<BracketKind, [number, number]> = {
		shelf: [p.armB + 8, 0],
		corner: [p.armA + p.width + 6, 0],
		tee: [p.armA + 6, 0],
		straight: [0, p.width + 6]
	};
	const [sx, sy] = step[p.kind];
	return union(...Array.from({ length: p.count }, (_, i) => translate([i * sx, i * sy, 0], one)));
}

const mm = (v: number) => num(Math.round(v), 0);

export function shelfBracketSummary(input: ShelfBracketParams): string {
	const p = clampShelfBracket(input);
	const what =
		p.kind === 'shelf'
			? m.t_shelf_bracket_summary_shelf({ a: mm(p.armA), b: mm(p.armB) })
			: m.t_shelf_bracket_summary_plate({ screw: num(p.screw, 4) });
	return (
		m.t_shelf_bracket_summary_count({ count: p.count, n: num(p.count) }) +
		sentenceGap(currentLocale()) +
		what
	);
}

export function shelfBracketHeader(input: ShelfBracketParams): string[] {
	const p = clampShelfBracket(input);
	return [m.t_shelf_bracket_scad_title(), shelfBracketSummary(p)];
}

export function shelfBracketScad(p: ShelfBracketParams): string {
	return toScad(shelfBracketModel(p), shelfBracketHeader(p));
}
