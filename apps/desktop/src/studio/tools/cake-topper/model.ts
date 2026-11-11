/**
 * A cake topper: a big line (a name, an age) that fills the chosen width,
 * an optional smaller line above it, all on one smooth backing that hugs
 * the letters (a morphological closing: small gaps between letters and the
 * lines fill in), a bar under the big line and stakes from the bar into the
 * cake. Printed flat; with «Буквы выше подложки» the letters stand 1 mm
 * proud, so a filament change makes them a second colour.
 *
 * The layout needs the real size of the lettering, so the page measures the
 * texts first (run.ts measureTexts) and passes their boxes in; without them
 * (tests) the boxes are estimated.
 */
import { currentLocale, num } from '$lib/i18n/current';
import { quote, sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/cake-topper';
import {
	extrude,
	hull,
	intersection,
	label,
	offset,
	polygon,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import type { TextBox } from '../csg/evaluate';
import { clamp as c } from '../shared/math';

export interface CakeTopperParams {
	/** The big line */
	title: string;
	/** A smaller line above it, may be empty */
	top: string;
	font: string;
	bold: boolean;
	/** Width of the big line, mm */
	width: number;
	/** Capital height of the line above, mm */
	topCap: number;
	thickness: number;
	/** Letters 1 mm above the backing, for a second colour */
	relief: boolean;
	stakes: number;
	stakeLength: number;
}

export const CAKE_TOPPER_DEFAULTS: CakeTopperParams = {
	get title() {
		return m.t_cake_topper_sample_name();
	},
	get top() {
		return m.t_cake_topper_sample_greeting();
	},
	font: 'Lobster',
	bold: true,
	width: 130,
	topCap: 12,
	thickness: 2.4,
	relief: true,
	stakes: 2,
	stakeLength: 60
};

export interface CakeTopperPreset {
	id: string;
	label: string;
	params: Partial<CakeTopperParams>;
}

export const CAKE_TOPPER_PRESETS: readonly CakeTopperPreset[] = [
	{
		id: 'birthday',
		get label() {
			return m.t_cake_topper_preset_birthday();
		},
		params: {}
	},
	{
		id: 'age',
		get label() {
			return m.t_cake_topper_preset_age();
		},
		params: { title: '18', top: '', font: 'Russo One', width: 90, stakes: 2 }
	},
	{
		id: 'wedding',
		get label() {
			return m.t_cake_topper_preset_wedding();
		},
		params: {
			title: 'Love',
			get top() {
				return m.t_cake_topper_sample_couple();
			},
			width: 140
		}
	},
	{
		id: 'mini',
		get label() {
			return m.t_cake_topper_preset_cupcake();
		},
		params: {
			get title() {
				return m.t_cake_topper_sample_cupcake_name();
			},
			top: '',
			width: 60,
			stakes: 1,
			stakeLength: 35,
			thickness: 2
		}
	}
];

export function clampCakeTopper(p: CakeTopperParams): CakeTopperParams {
	let title = String(p.title ?? '').slice(0, 30);
	let top = String(p.top ?? '').slice(0, 40);
	// The stakes hang from the big line: a lone line is the big one.
	if (!title.trim() && top.trim()) [title, top] = [top, ''];
	return {
		title,
		top,
		font: p.font,
		bold: !!p.bold,
		width: c(p.width, 40, 220),
		topCap: c(p.topCap, 6, 30),
		thickness: c(p.thickness, 1.6, 6),
		relief: !!p.relief,
		stakes: Math.round(c(p.stakes, 1, 3)),
		stakeLength: c(p.stakeLength, 20, 120)
	};
}

/** Backing round the letters, mm, in proportion to them; gaps up to twice CLOSE fill in. */
const padOf = (cap: number) => Math.min(2, Math.max(0.8, cap * 0.06));
const CLOSE = 2.5;
const STAKE = 6;
/** The line above sinks this far onto the big one, mm: its bar rests on it. */
const SINK = 1;

/** The texts the layout depends on, in the order the boxes come back. */
export function cakeTopperTexts(input: CakeTopperParams): Node[] {
	const p = clampCakeTopper(input);
	const o = { font: p.font, bold: p.bold };
	return [
		label(p.title.trim(), p.width * 0.75, { ...o, fit: p.width, fill: true }),
		label(p.top.trim(), p.topCap, { ...o, fit: p.width * 1.1 })
	];
}

/** A box when the page has not measured (tests): about 0.6 × cap per letter. */
function estimate(text: string, cap: number, fit: number): TextBox | null {
	if (!text.trim()) return null;
	const natural = text.trim().length * cap * 0.6;
	const k = Math.min(1, fit / natural);
	const w = natural * k;
	return { x0: -w / 2, x1: w / 2, y0: 0, y1: cap * k, cap: cap * k };
}

export interface CakeTopperLayout {
	main: TextBox | null;
	top: TextBox | null;
	/** Shift of the line above, mm */
	topY: number;
	stakeX: number[];
}

export function cakeTopperLayout(
	input: CakeTopperParams,
	boxes?: readonly (TextBox | null)[]
): CakeTopperLayout {
	const p = clampCakeTopper(input);
	const main = boxes ? (boxes[0] ?? null) : estimate(p.title, p.width * 0.75, p.width);
	const top = boxes ? (boxes[1] ?? null) : estimate(p.top, p.topCap, p.width * 1.1);
	const mainTop = main ? main.y1 : 0;
	const topY = top ? mainTop - SINK - top.y0 : 0;
	const x0 = main ? main.x0 : -p.width / 4;
	const x1 = main ? main.x1 : p.width / 4;
	const w = x1 - x0;
	const n = w < 2.5 * STAKE * p.stakes ? 1 : p.stakes;
	const stakeX =
		n === 1
			? [(x0 + x1) / 2]
			: Array.from({ length: n }, (_, i) => x0 + w * (0.2 + (0.6 * i) / (n - 1)));
	return { main, top, topY, stakeX };
}

function stake(x: number, y: number, length: number): Node {
	const h = STAKE / 2;
	return polygon([
		[x - h, y],
		[x + h, y],
		[x + h, y - length + STAKE * 1.5],
		[x, y - length],
		[x - h, y - length + STAKE * 1.5]
	]);
}

function topperParts(
	input: CakeTopperParams,
	boxes?: readonly (TextBox | null)[]
): { base: Node; letters: Node | null } {
	const p = clampCakeTopper(input);
	const [mainText, topText] = cakeTopperTexts(p);
	const L = cakeTopperLayout(p, boxes);
	const top = L.top && translate([0, L.topY], topText);
	const letters = union(mainText, top);
	// Each line on a smooth backing in proportion to its letters: grow, shrink
	// back (fills the gaps between letters), then the margin.
	const backed = (text: Node, cap: number) => {
		const pad = padOf(cap);
		const r = Math.min(CLOSE, cap * 0.12);
		return offset(pad, 24, union(text, offset(-r, 24, offset(r, 24, text))));
	};
	const mainCap = L.main?.cap ?? 10;
	const topCap = L.top?.cap ?? p.topCap;
	const backing = union(backed(mainText, mainCap), top && backed(top, topCap));
	// A bar along the bottom of the big line joins its letters and holds the stakes.
	const PAD = padOf(mainCap);
	const barH = Math.max(3, mainCap * 0.12);
	const band = translate([0, (barH - PAD) / 2], square(p.width * 2 + 40, barH + PAD));
	const bar = hull(intersection(offset(PAD, 24, mainText), band));
	// The line above has its own bar under it, lying on top of the big line.
	const topBar =
		L.top &&
		translate(
			[0, L.topY],
			hull(
				intersection(
					offset(padOf(topCap), 24, topText),
					translate([0, L.top.y0 + 1], square(p.width * 2 + 40, 2 * (padOf(topCap) + 1)))
				)
			)
		);
	const stakes = L.stakeX.map((x) => stake(x, 1, p.stakeLength + 1));
	const base = union(backing, bar, topBar, ...stakes);
	return {
		base: extrude(p.thickness, base),
		letters: p.relief ? translate([0, 0, p.thickness - 0.01], extrude(1.01, letters)) : null
	};
}

export function cakeTopperModel(
	input: CakeTopperParams,
	boxes?: readonly (TextBox | null)[]
): Node {
	const { base, letters } = topperParts(input, boxes);
	return union(base, letters);
}

/** The colours, for a 3MF of parts: the backing with the stakes, and the raised letters. */
export function cakeTopperColours(
	input: CakeTopperParams,
	boxes?: readonly (TextBox | null)[]
): { name: string; node: Node }[] {
	const { base, letters } = topperParts(input, boxes);
	return letters
		? [
				{ name: m.t_cake_topper_part_base(), node: base },
				{ name: m.t_cake_topper_part_letters(), node: letters }
			]
		: [{ name: m.t_cake_topper_part_topper(), node: base }];
}

const mm = (v: number) => num(v, 4);

export function cakeTopperSummary(
	input: CakeTopperParams,
	boxes?: readonly (TextBox | null)[]
): string {
	const p = clampCakeTopper(input);
	const L = cakeTopperLayout(p, boxes);
	const height = (L.top ? L.topY + L.top.y1 : (L.main?.y1 ?? 0)) + 2;
	const stakes = L.stakeX.length;
	return [
		m.t_cake_topper_summary_size({
			height: mm(Math.round(height)),
			count: stakes,
			n: num(stakes),
			length: mm(p.stakeLength)
		}),
		m.t_cake_topper_summary_food(),
		p.relief && m.t_cake_topper_summary_colour({ height: mm(p.thickness) })
	]
		.filter(Boolean)
		.join(sentenceGap(currentLocale()));
}

export function cakeTopperHeader(
	input: CakeTopperParams,
	boxes?: readonly (TextBox | null)[]
): string[] {
	const p = clampCakeTopper(input);
	const words = [p.top, p.title].filter((t) => t.trim()).map((t) => quote(t, currentLocale()));
	return [m.t_cake_topper_scad_title(), words.join(' / '), cakeTopperSummary(p, boxes)];
}

export function cakeTopperScad(p: CakeTopperParams): string {
	return toScad(cakeTopperModel(p), cakeTopperHeader(p));
}
