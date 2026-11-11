/**
 * «Именной пазл»: a child's name as a puzzle — every letter a thick piece
 * of its own, a tray with a pocket for each letter, a little roomier. The
 * letters stand beside the tray on the bed, the tray prints face up. Each
 * letter can be its own colour (3MF by colour).
 *
 * Letters are laid out by their measured widths (the page measures them
 * first, as the cake topper does); without measurements — in tests — by an
 * estimate.
 */
import {
	difference,
	extrude,
	label,
	offset,
	part,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import type { TextBox } from '../csg/evaluate';
import type { ColourNode } from '../csg/run';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/name-puzzle';
import { clamp } from '../shared/math';

export interface NamePuzzleParams {
	name: string;
	/** Capital height of the letters, mm */
	cap: number;
	/** Letter pieces' thickness, mm */
	thickness: number;
	/** Pocket depth in the tray and its floor, mm */
	depth: number;
	floor: number;
	/** Play round each letter in its pocket, mm */
	gap: number;
	/** Between the letters, mm */
	spacing: number;
	font: string;
	bold: boolean;
}

export const NAME_PUZZLE_DEFAULTS: NamePuzzleParams = {
	// A sample name printed into the model: each language gets its own.
	get name() {
		return m.t_name_puzzle_default_name();
	},
	cap: 40,
	thickness: 10,
	depth: 5,
	floor: 3,
	gap: 0.5,
	spacing: 5,
	font: 'Russo One',
	bold: true
};

export const NAME_PUZZLE_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<NamePuzzleParams>;
}[] = [
	{
		id: 'kids',
		get label() {
			return m.t_name_puzzle_preset_kids();
		},
		params: { cap: 45, thickness: 12, gap: 0.6 }
	},
	{
		id: 'long',
		get label() {
			return m.t_name_puzzle_preset_long();
		},
		params: {
			get name() {
				return m.t_name_puzzle_preset_long_name();
			},
			cap: 30,
			thickness: 8
		}
	},
	{
		id: 'round',
		get label() {
			return m.t_name_puzzle_preset_round();
		},
		params: { font: 'Comfortaa', bold: true }
	}
];

export function clampNamePuzzle(p: NamePuzzleParams): NamePuzzleParams {
	const name = (p.name ?? '').toUpperCase().replace(/\s+/g, '').slice(0, 16);
	const thickness = clamp(p.thickness, 4, 20);
	const gap = clamp(p.gap, 0.2, 1.2);
	return {
		name,
		cap: clamp(p.cap, 15, 80),
		thickness,
		// A letter stands at least 1 mm proud of its pocket, or it cannot be taken out.
		depth: clamp(p.depth, 2, Math.min(15, thickness - 1)),
		floor: clamp(p.floor, 1.6, 6),
		gap,
		// Neighbouring pockets keep a wall of at least 1.2 mm between them.
		spacing: clamp(p.spacing, Math.max(2, 2 * gap + 1.2), 20),
		font: p.font || 'Noto Sans',
		bold: !!p.bold
	};
}

const letters = (p: NamePuzzleParams) => [...p.name];

/** The letters the layout depends on, one text each, in order. */
export function namePuzzleTexts(input: NamePuzzleParams): Node[] {
	const p = clampNamePuzzle(input);
	return letters(p).map((ch) =>
		label(ch, p.cap, { font: p.font, bold: p.bold, halign: 'left', valign: 'baseline' })
	);
}

/** About 0.75 × cap wide when not measured. */
function estimate(cap: number): TextBox {
	return { x0: 0, x1: cap * 0.75, y0: 0, y1: cap, cap };
}

export interface NamePuzzleLayout {
	/** Where each letter's origin goes (its left edge at x0) */
	at: number[];
	boxes: TextBox[];
	/** The tray's size and its centre, mm */
	width: number;
	height: number;
	bottom: number;
}

const MARGIN = 8;

export function namePuzzleLayout(
	input: NamePuzzleParams,
	measured?: readonly (TextBox | null)[]
): NamePuzzleLayout {
	const p = clampNamePuzzle(input);
	const boxes = letters(p).map((_, i) => measured?.[i] ?? estimate(p.cap));
	const at: number[] = [];
	let x = 0;
	for (const b of boxes) {
		at.push(x - b.x0);
		x += b.x1 - b.x0 + p.spacing;
	}
	const total = Math.max(0, x - p.spacing);
	for (let i = 0; i < at.length; i++) at[i] -= total / 2;
	const top = Math.max(p.cap, ...boxes.map((b) => b.y1));
	const bottom = Math.min(0, ...boxes.map((b) => b.y0));
	return {
		at,
		boxes,
		width: total + 2 * MARGIN,
		height: top - bottom + 2 * MARGIN,
		bottom
	};
}

function letterNode(p: NamePuzzleParams, ch: string): Node {
	return label(ch, p.cap, { font: p.font, bold: p.bold, halign: 'left', valign: 'baseline' });
}

export function namePuzzleParts(
	input: NamePuzzleParams,
	measured?: readonly (TextBox | null)[]
): { tray: Node; letters: Node[] } {
	const p = clampNamePuzzle(input);
	const L = namePuzzleLayout(p, measured);
	const chars = letters(p);
	// Tray: centred on the letters' band, pockets as deep as asked.
	const cy = L.bottom - MARGIN + L.height / 2;
	const pockets = chars.map((ch, i) =>
		translate([L.at[i], 0, p.floor], extrude(p.depth + 1, offset(p.gap, 16, letterNode(p, ch))))
	);
	const tray = difference(
		translate([0, cy, 0], extrude(p.floor + p.depth, rrect(L.width, L.height, 6, 48))),
		...pockets
	);
	// The pieces below the tray, in the same order.
	const shift = -(L.height + 10);
	const pieces = chars.map((ch, i) =>
		translate([L.at[i], shift, 0], extrude(p.thickness, letterNode(p, ch)))
	);
	return { tray, letters: pieces };
}

export function namePuzzleModel(
	input: NamePuzzleParams,
	measured?: readonly (TextBox | null)[]
): Node {
	const p = clampNamePuzzle(input);
	if (!p.name) return part('tray', extrude(p.floor, rrect(60, 40, 6, 48)));
	const parts = namePuzzleParts(p, measured);
	return union(part('tray', parts.tray), part('letters', union(...parts.letters)));
}

/** The tray and every letter in a colour of its own, for a 3MF. */
export function namePuzzleColours(
	input: NamePuzzleParams,
	measured?: readonly (TextBox | null)[]
): ColourNode[] {
	const p = clampNamePuzzle(input);
	if (!p.name) return [];
	const parts = namePuzzleParts(p, measured);
	return [
		{ name: m.t_name_puzzle_part_tray(), node: parts.tray },
		...parts.letters.map((node, i) => ({
			name: m.t_name_puzzle_part_letter({ letter: letters(p)[i] }),
			node
		}))
	];
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function namePuzzleSummary(
	input: NamePuzzleParams,
	measured?: readonly (TextBox | null)[]
): string {
	const p = clampNamePuzzle(input);
	if (!p.name) return m.t_name_puzzle_summary_empty();
	const L = namePuzzleLayout(p, measured);
	const n = letters(p).length;
	return m.t_name_puzzle_summary({
		count: n,
		n: num(n),
		cap: mm(p.cap),
		width: mm(L.width),
		height: mm(L.height)
	});
}

export function namePuzzleHeader(input: NamePuzzleParams): string[] {
	const p = clampNamePuzzle(input);
	return [
		m.t_name_puzzle_scad_title(),
		m.t_name_puzzle_scad_name({ name: p.name, summary: namePuzzleSummary(p) }),
		m.t_name_puzzle_scad_gap({ gap: mm(p.gap), thickness: mm(p.thickness) })
	];
}

export function namePuzzleScad(p: NamePuzzleParams): string {
	return toScad(namePuzzleModel(p), namePuzzleHeader(p));
}
