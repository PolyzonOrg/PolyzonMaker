/**
 * A box for a deck of cards: a base sized to the cards (sleeved or not) and
 * a cap that slides over it like a shoebox lid. A thumb notch in front lets
 * the deck out. Both print open side up, no supports.
 */
import {
	cylinder,
	difference,
	extrude,
	part,
	rotate,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/deck-box';
import { clamp as c } from '../shared/math';

export interface DeckBoxParams {
	/** Card (with its sleeve) width and height, mm */
	cardWidth: number;
	cardHeight: number;
	count: number;
	/** One card's thickness, mm: 0.3 bare, 0.6 sleeved, 0.8 double-sleeved */
	cardThickness: number;
	/** Room round the deck, mm */
	clearance: number;
	wall: number;
	/** How much of the height the cap covers, % */
	capPercent: number;
	notch: boolean;
}

export const DECK_DEFAULTS: DeckBoxParams = {
	cardWidth: 66,
	cardHeight: 91,
	count: 60,
	cardThickness: 0.62,
	clearance: 1,
	wall: 1.6,
	capPercent: 35,
	notch: true
};

export interface DeckPreset {
	id: string;
	label: string;
	params: Partial<DeckBoxParams>;
}

export const DECK_PRESETS: readonly DeckPreset[] = [
	{
		id: 'tcg',
		get label() {
			return m.t_deck_box_preset_tcg();
		},
		params: { cardWidth: 66, cardHeight: 91, count: 60, cardThickness: 0.62 }
	},
	{
		id: 'bare',
		get label() {
			return m.t_deck_box_preset_bare();
		},
		params: { cardWidth: 63.5, cardHeight: 88.5, count: 60, cardThickness: 0.32 }
	},
	{
		id: 'small',
		get label() {
			return m.t_deck_box_preset_small();
		},
		params: { cardWidth: 62, cardHeight: 89, count: 50, cardThickness: 0.6 }
	},
	{
		id: 'poker',
		get label() {
			return m.t_deck_box_preset_poker();
		},
		params: { cardWidth: 63.5, cardHeight: 89, count: 54, cardThickness: 0.32 }
	}
];

export function clampDeck(p: DeckBoxParams): DeckBoxParams {
	return {
		cardWidth: c(p.cardWidth, 20, 200),
		cardHeight: c(p.cardHeight, 20, 250),
		count: Math.round(c(p.count, 1, 500)),
		cardThickness: c(p.cardThickness, 0.1, 2),
		clearance: c(p.clearance, 0, 4),
		wall: c(p.wall, 1, 4),
		capPercent: c(p.capPercent, 15, 60),
		notch: !!p.notch
	};
}

export interface DeckLayout {
	/** Inside of the base, mm */
	inner: [number, number, number];
	/** Outside of the base and of the cap, mm */
	base: [number, number, number];
	cap: [number, number, number];
}

const PLAY = 0.3;

export function deckLayout(input: DeckBoxParams): DeckLayout {
	const p = clampDeck(input);
	const w = p.cardWidth + p.clearance;
	const d = p.count * p.cardThickness + p.clearance;
	const h = p.cardHeight + p.clearance / 2;
	const base: [number, number, number] = [w + 2 * p.wall, d + 2 * p.wall, h + p.wall];
	const capH = Math.max(15, (h * p.capPercent) / 100) + p.wall;
	return {
		inner: [w, d, h],
		base,
		cap: [base[0] + 2 * (PLAY + p.wall), base[1] + 2 * (PLAY + p.wall), capH]
	};
}

const R = 2;

function tray(outer: [number, number, number], wall: number, r: number): Node {
	return difference(
		extrude(outer[2], rrect(outer[0], outer[1], r, 24)),
		translate(
			[0, 0, wall],
			extrude(
				outer[2],
				rrect(outer[0] - 2 * wall, outer[1] - 2 * wall, Math.max(0.5, r - wall), 24)
			)
		)
	);
}

export function deckModel(input: DeckBoxParams): Node {
	const p = clampDeck(input);
	const L = deckLayout(p);
	const [bw, bd, bh] = L.base;
	// The thumb notch: a half circle out of the front wall at the top.
	const notchR = Math.min(12, bw / 4);
	const notch = p.notch
		? translate([0, -bd / 2 - 1, bh], rotate([-90, 0, 0], cylinder(p.wall + 2, notchR, notchR, 48)))
		: null;
	const base = difference(tray(L.base, p.wall, R), notch);
	const cap = tray(L.cap, p.wall, R + PLAY + p.wall);
	const gap = bw / 2 + L.cap[0] / 2 + 8;
	return union(
		part('base', translate([-gap / 2, 0, 0], base)),
		part('cap', translate([gap / 2, 0, 0], cap))
	);
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function deckSummary(input: DeckBoxParams): string {
	const p = clampDeck(input);
	const L = deckLayout(p);
	return m.t_deck_box_summary({
		count: p.count,
		n: num(p.count),
		width: mm(L.inner[0]),
		depth: mm(L.inner[1]),
		height: mm(L.inner[2]),
		outerWidth: mm(L.cap[0]),
		outerDepth: mm(L.cap[1]),
		outerHeight: mm(L.base[2] + p.wall)
	});
}

export function deckHeader(input: DeckBoxParams): string[] {
	const p = clampDeck(input);
	return [m.t_deck_box_header_title(), deckSummary(p), m.t_deck_box_header_print()];
}

export function deckScad(p: DeckBoxParams): string {
	return toScad(deckModel(p), deckHeader(p));
}
