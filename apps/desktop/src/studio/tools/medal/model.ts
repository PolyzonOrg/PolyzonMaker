/**
 * Medals and tokens: a disc (or a star) with a rim, a big centre (a place
 * number or a word), a line curved along the top and one along the bottom,
 * an optional laurel branch on each side; a slot for a ribbon, a loop or
 * nothing (a token, with a ribbed edge). Raised parts stand 1 mm proud for
 * a second colour. Letters on the arcs are placed one by one, upright to
 * the circle, each as wide as it is drawn (the page measures them first), so
 * «Ш» and «М» do not run into their neighbours.
 */
import {
	circle,
	difference,
	extrude,
	intersection,
	label,
	mirror,
	offset,
	polygon,
	rotate,
	rrect,
	scale,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { quote, sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/medal';
import { clamp as c } from '../shared/math';

export type MedalShape = 'round' | 'star';
export type MedalMount = 'ribbon' | 'loop' | 'none';

export interface MedalParams {
	shape: MedalShape;
	diameter: number;
	/** The big centre: «1», «2», «★», a word */
	centre: string;
	/** Under the centre, e.g. «место» */
	under: string;
	/** Along the top arc */
	top: string;
	/** Along the bottom arc */
	bottom: string;
	laurel: boolean;
	mount: MedalMount;
	font: string;
	bold: boolean;
	thickness: number;
	relief: number;
	count: number;
}

export const MEDAL_DEFAULTS: MedalParams = {
	shape: 'round',
	diameter: 60,
	centre: '1',
	get under() {
		return m.t_medal_sample_place();
	},
	get top() {
		return m.t_medal_sample_tournament();
	},
	bottom: '2026',
	laurel: true,
	mount: 'ribbon',
	font: 'Russo One',
	bold: false,
	thickness: 3,
	relief: 1,
	count: 1
};

export interface MedalPreset {
	id: string;
	label: string;
	params: Partial<MedalParams>;
}

export const MEDAL_PRESETS: readonly MedalPreset[] = [
	{
		id: 'first',
		get label() {
			return m.t_medal_preset_first();
		},
		params: {}
	},
	{
		id: 'set',
		get label() {
			return m.t_medal_preset_set();
		},
		params: { count: 3 }
	},
	{
		id: 'kids',
		get label() {
			return m.t_medal_preset_kids();
		},
		params: {
			centre: '★',
			get under() {
				return m.t_medal_sample_well_done();
			},
			get top() {
				return m.t_medal_sample_graduation();
			},
			get bottom() {
				return m.t_medal_sample_kindergarten();
			},
			font: 'Comfortaa',
			bold: true
		}
	},
	{
		id: 'star',
		get label() {
			return m.t_medal_preset_star();
		},
		params: {
			shape: 'star',
			diameter: 70,
			top: '',
			bottom: '',
			laurel: false,
			get under() {
				return m.t_medal_sample_best();
			}
		}
	},
	{
		id: 'token',
		get label() {
			return m.t_medal_preset_token();
		},
		params: {
			mount: 'none',
			diameter: 39,
			centre: '100',
			under: '',
			top: '',
			bottom: '',
			laurel: false,
			thickness: 3.3,
			relief: 0.6
		}
	}
];

export function clampMedal(p: MedalParams): MedalParams {
	return {
		shape: p.shape === 'star' ? 'star' : 'round',
		diameter: c(p.diameter, 25, 120),
		centre: String(p.centre ?? '').slice(0, 12),
		under: String(p.under ?? '').slice(0, 20),
		top: String(p.top ?? '').slice(0, 40),
		bottom: String(p.bottom ?? '').slice(0, 40),
		laurel: !!p.laurel,
		mount: p.mount === 'loop' || p.mount === 'none' ? p.mount : 'ribbon',
		font: p.font,
		bold: !!p.bold,
		thickness: c(p.thickness, 1.6, 6),
		relief: c(p.relief, 0.4, 3),
		count: Math.round(c(p.count, 1, 10))
	};
}

const RIM = 1.6;

/** The ribbon slot's width, mm: 26 (a 25 mm ribbon) where the medal is wide enough for its tab. */
export const ribbonSlot = (diameter: number) => Math.min(26, Math.max(10, diameter * 0.6 - 6));

/** A set counts up from the centre's number: 1 → 1, 2, 3. */
export function centreOf(p: MedalParams, i: number): string {
	const n = Number(p.centre);
	return Number.isInteger(n) && p.count > 1 ? String(n + i) : p.centre;
}

function starShape(R: number): Node {
	return polygon(
		Array.from({ length: 10 }, (_, i): Vec2 => {
			const r = i % 2 ? R * 0.62 : R;
			const a = Math.PI / 2 + (i * Math.PI) / 5;
			return [r * Math.cos(a), r * Math.sin(a)];
		})
	);
}

/** A token's edge: fine ribs all round, like a coin. */
function ribbed(R: number): Node {
	const n = Math.max(48, Math.round((2 * Math.PI * R) / 1.6));
	return polygon(
		Array.from({ length: 2 * n }, (_, i): Vec2 => {
			const r = i % 2 ? R - 0.5 : R;
			const a = (i * Math.PI) / n;
			return [r * Math.cos(a), r * Math.sin(a)];
		})
	);
}

/** Ink width ÷ capital height of each letter on the arcs, as the page measured it. */
export type ArcWidths = Record<string, number>;
/** The capital the page measures the arc letters at (arcLetters). */
export const ARC_REF_CAP = 10;

type TextStyle = { font: string; bold: boolean };
const arcGlyph = (ch: string, cap: number, o: TextStyle) =>
	label(ch, cap, { ...o, valign: 'center', fit: cap * 1.2 });

/** Every distinct letter of the arcs at ARC_REF_CAP, to measure before the build. */
export function arcLetters(input: MedalParams): { ch: string; node: Node }[] {
	const p = clampMedal(input);
	if (p.shape !== 'round') return [];
	const chars = new Set([...p.top.trim(), ...p.bottom.trim()].filter((ch) => ch.trim()));
	return [...chars].map((ch) => ({
		ch,
		node: arcGlyph(ch, ARC_REF_CAP, { font: p.font, bold: p.bold })
	}));
}

/** Unmeasured (the assistant's generator, tests): a guess by the letter's shape. */
function guessWidth(ch: string): number {
	// i18n-ok-begin: glyph shapes to guess a width by, never shown
	if (/[ЖШЩМЮЫФЪWMжшщмюыфъwm@%]/.test(ch)) return 1.05;
	if (/[1IіїlijtfrГг.,:;!'|()-]/.test(ch)) return 0.4;
	// i18n-ok-end
	return 0.75;
}

/** Between two letters' ink, where they come closest (their inner corners), × cap. */
const ARC_GAP = 0.16;
/** A word space, × cap, on top of the two gaps beside it. */
const ARC_SPACE = 0.2;

/**
 * Text along an arc of radius r: letters one by one, `cap` high, centred on
 * the top (or the bottom, read left to right, tops inwards). Each step is
 * the two letters' half-widths plus a gap at the arc's inner edge; a line
 * longer than the arc may take gets smaller letters, never overlapping ones.
 */
export function arcText(
	text: string,
	r: number,
	cap: number,
	o: TextStyle,
	bottom: boolean,
	widths: ArcWidths = {}
): Node | null {
	const chars = [...text.trim()];
	if (!chars.length) return null;
	const w = (ch: string) => (ch.trim() ? (widths[ch] ?? guessWidth(ch)) : ARC_SPACE);
	const steps = (size: number) =>
		chars.slice(1).map((ch, i) => (((w(chars[i]) + w(ch)) / 2 + ARC_GAP) * size) / (r - size / 2));
	const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
	const MAX = Math.PI * 0.8;
	let size = cap;
	// Shrinking also widens the inner radius a little: settle in a few rounds.
	for (let i = 0; i < 4 && sum(steps(size)) > MAX; i++) size *= MAX / sum(steps(size));
	const step = steps(size);
	let t = -sum(step) / 2;
	return union(
		...chars.map((ch, i) => {
			if (i > 0) t += step[i - 1];
			if (!ch.trim()) return null;
			const a = bottom ? -Math.PI / 2 + t : Math.PI / 2 - t;
			const deg = (a * 180) / Math.PI + (bottom ? 90 : -90);
			return translate(
				[r * Math.cos(a), r * Math.sin(a)],
				rotate([0, 0, deg], arcGlyph(ch, size, o))
			);
		})
	);
}

/** A wedge from the centre between two angles (degrees), radius r. */
function wedge(a0: number, a1: number, r: number): Node {
	const pts: Vec2[] = [[0, 0]];
	for (let i = 0; i <= 16; i++) {
		const a = ((a0 + ((a1 - a0) * i) / 16) * Math.PI) / 180;
		pts.push([r * Math.cos(a), r * Math.sin(a)]);
	}
	return polygon(a1 > a0 ? pts : [pts[0], ...pts.slice(1).reverse()]);
}

/** A laurel branch up each side: a thin stem on radius R and pairs of leaves. */
function laurel(R: number): Node {
	const leaves: Node[] = [];
	const n = 7;
	const from = 262;
	const to = 145;
	for (let i = 0; i < n; i++) {
		const deg = from - (i * (from - to)) / (n - 1);
		const a = (deg * Math.PI) / 180;
		// Leaves shrink towards the tip and point along the branch (upwards).
		const len = R * (0.27 - 0.09 * (i / (n - 1)));
		for (const side of [-1, 1]) {
			const rr = R + side * len * 0.22;
			leaves.push(
				translate(
					[rr * Math.cos(a), rr * Math.sin(a)],
					rotate([0, 0, deg + 180 + side * 30], scale([0.42, 1, 1], circle(len / 2, 24)))
				)
			);
		}
	}
	const stem = intersection(
		difference(circle(R + 0.5, 96), circle(R - 0.5, 96)),
		wedge(to - 6, from + 2, 2 * R)
	);
	const left = union(...leaves, stem);
	return union(left, mirror([1, 0], left));
}

function medal(p: MedalParams, centre: string, widths?: ArcWidths): { base: Node; raised: Node } {
	const R = p.diameter / 2;
	const disc = p.shape === 'star' ? starShape(R) : p.mount === 'none' ? ribbed(R) : circle(R, 128);
	const o = { font: p.font, bold: p.bold };
	const hasArcs = p.shape === 'round' && (p.top.trim() || p.bottom.trim());
	const inner = hasArcs ? R * 0.62 : p.shape === 'star' ? R * 0.5 : R * 0.8;
	const big = label(centre.trim(), inner * (p.under.trim() ? 0.75 : 0.95), {
		...o,
		valign: 'center',
		fit: inner * (p.laurel && p.shape === 'round' ? 1.1 : 1.5)
	});
	const centreY = p.under.trim() ? inner * 0.14 : 0;
	const underText =
		!!p.under.trim() &&
		translate(
			[0, -inner * 0.55],
			label(p.under.trim(), inner * 0.2, { ...o, valign: 'center', fit: inner * 1.3 })
		);
	const arcCap = R * 0.12;
	const arcR = R - RIM - 1.2 - arcCap / 2;
	const top = p.shape === 'round' && arcText(p.top, arcR, arcCap, o, false, widths);
	const bottom = p.shape === 'round' && arcText(p.bottom, arcR, arcCap, o, true, widths);
	// The leaves reach out to about 1.14 × the branch radius: on a small medal they stay inside the arcs.
	const branch = hasArcs ? Math.min(R * 0.66, (R * 0.88 - 3.4) * 0.875) : R * 0.66;
	const wreath = p.laurel && p.shape === 'round' && laurel(branch);
	const rim = difference(disc, offset(-RIM, 24, disc));
	const inside = offset(-RIM - 0.6, 24, disc);
	const raised = union(
		rim,
		intersection(union(translate([0, centreY], big), underText, top, bottom, wreath), inside)
	);
	let plate = disc;
	let hole: Node | null = null;
	if (p.mount === 'ribbon') {
		// A tab above with a slot for the ribbon (ribbonSlot), 3 mm of tab each side.
		const slot = ribbonSlot(p.diameter);
		plate = union(disc, translate([0, R + 3], rrect(slot + 6, 12, 4)));
		hole = translate([0, R + 3.5], rrect(slot, 3.2, 1.2));
	} else if (p.mount === 'loop') {
		plate = union(disc, translate([0, R + 2.5], circle(5, 48)));
		hole = translate([0, R + 2.5], circle(2.6, 48));
	}
	const cut = (n: Node) =>
		hole ? difference(n, translate([0, 0, -1], extrude(p.thickness + p.relief + 2, hole))) : n;
	return {
		base: cut(extrude(p.thickness, plate)),
		raised: cut(translate([0, 0, p.thickness - 0.01], extrude(p.relief + 0.01, raised)))
	};
}

/** The set laid out: the plates, and the raised parts. */
function laidOut(p: MedalParams, widths?: ArcWidths): { base: Node; raised: Node } {
	const pitch = p.diameter + 8;
	const all = Array.from({ length: p.count }, (_, i) => {
		const at = [(i % 4) * pitch, -Math.floor(i / 4) * (pitch + 14), 0];
		const one = medal(p, centreOf(p, i), widths);
		return { base: translate(at, one.base), raised: translate(at, one.raised) };
	});
	return { base: union(...all.map((x) => x.base)), raised: union(...all.map((x) => x.raised)) };
}

export function medalModel(input: MedalParams, widths?: ArcWidths): Node {
	const { base, raised } = laidOut(clampMedal(input), widths);
	return union(base, raised);
}

/** The two colours, for a 3MF of parts. */
export function medalColours(
	input: MedalParams,
	widths?: ArcWidths
): { name: string; node: Node }[] {
	const { base, raised } = laidOut(clampMedal(input), widths);
	return [
		{ name: m.t_medal_part_medal(), node: base },
		{ name: m.t_medal_part_raised(), node: raised }
	];
}

const mm = (v: number) => num(v, 4);

export function medalSummary(input: MedalParams): string {
	const p = clampMedal(input);
	const diameter = mm(p.diameter);
	const what =
		p.mount === 'ribbon'
			? m.t_medal_summary_ribbon({
					diameter,
					slot: mm(Math.floor(ribbonSlot(p.diameter) - 1))
				})
			: p.mount === 'loop'
				? m.t_medal_summary_loop({ diameter })
				: m.t_medal_summary_token({ diameter });
	return [what, m.t_medal_summary_colour({ height: mm(p.thickness) })].join(
		sentenceGap(currentLocale())
	);
}

export function medalHeader(input: MedalParams): string[] {
	const p = clampMedal(input);
	const locale = currentLocale();
	return [
		m.t_medal_scad_title(),
		`${quote(p.top, locale)} ${p.centre} ${p.under} ${quote(p.bottom, locale)}`,
		medalSummary(p)
	];
}

export function medalScad(p: MedalParams): string {
	return toScad(medalModel(p), medalHeader(p));
}
