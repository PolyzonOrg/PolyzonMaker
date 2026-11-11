/**
 * A gauge for the box of mixed screws: a plate with a hole for every metric
 * size (a bolt goes through its own and not the one before), a pocket for
 * every nut (ISO 4032 across flats, and DIN 934 / ГОСТ 5915 where they
 * differ) and a ruler with a stop — the head rests against the wall, the
 * tip shows the length. Sizes from ISO 261 and ISO 4032. Printed as it lies:
 * labels and marks engraved 0.6 mm deep.
 */
import {
	circle,
	cube,
	difference,
	extrude,
	label,
	polygon,
	rotate,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { listJoin, sentenceGap } from '$lib/i18n/locale';
import * as tc from '$msg/tools/common';
import * as m from '$msg/tools/bolt-gauge';
import { clamp as c } from '../shared/math';

export interface BoltGaugeParams {
	/** Smallest and largest size, «M2» … «M16» */
	from: string;
	to: string;
	holes: boolean;
	nuts: boolean;
	/** Length the ruler measures, mm; 0 — no ruler */
	ruler: number;
	/** Added to every hole and pocket, mm: printed holes come out smaller */
	play: number;
	thickness: number;
}

/** Thread diameter, nut across flats (ISO 4032, then DIN 934 when it differs), nut height. */
export const GAUGE_SIZES: readonly { name: string; d: number; s: readonly number[]; m: number }[] =
	[
		{ name: 'M2', d: 2, s: [4], m: 1.6 },
		{ name: 'M2,5', d: 2.5, s: [5], m: 2 },
		{ name: 'M3', d: 3, s: [5.5], m: 2.4 },
		{ name: 'M4', d: 4, s: [7], m: 3.2 },
		{ name: 'M5', d: 5, s: [8], m: 4.7 },
		{ name: 'M6', d: 6, s: [10], m: 5.2 },
		{ name: 'M8', d: 8, s: [13], m: 6.8 },
		{ name: 'M10', d: 10, s: [16, 17], m: 8.4 },
		{ name: 'M12', d: 12, s: [18, 19], m: 10.8 },
		{ name: 'M14', d: 14, s: [21, 22], m: 12.8 },
		{ name: 'M16', d: 16, s: [24], m: 14.8 }
	];

export const BOLT_GAUGE_DEFAULTS: BoltGaugeParams = {
	from: 'M2',
	to: 'M12',
	holes: true,
	nuts: true,
	ruler: 100,
	play: 0.3,
	thickness: 4
};

export interface BoltGaugePreset {
	id: string;
	label: string;
	params: Partial<BoltGaugeParams>;
}

export const BOLT_GAUGE_PRESETS: readonly BoltGaugePreset[] = [
	{ id: 'all', label: 'M2–M12', params: {} },
	{
		id: 'small',
		get label() {
			return m.t_bolt_gauge_preset_electronics();
		},
		params: { from: 'M2', to: 'M5', ruler: 50 }
	},
	{
		id: 'big',
		get label() {
			return m.t_bolt_gauge_preset_furniture();
		},
		params: { from: 'M6', to: 'M16', ruler: 120 }
	},
	{
		id: 'ruler',
		get label() {
			return m.t_bolt_gauge_preset_length_only();
		},
		params: { holes: false, nuts: false, ruler: 120 }
	}
];

export const RULER_LENGTHS = [0, 50, 80, 100, 120] as const;

const indexOf = (name: string, fallback: number) => {
	const i = GAUGE_SIZES.findIndex((s) => s.name === name);
	return i < 0 ? fallback : i;
};

export function clampBoltGauge(p: BoltGaugeParams): BoltGaugeParams {
	let a = indexOf(p.from, 0);
	let b = indexOf(p.to, GAUGE_SIZES.length - 1);
	if (a > b) [a, b] = [b, a];
	const ruler = RULER_LENGTHS.reduce((best, v) =>
		Math.abs(v - c(p.ruler, 0, 120)) < Math.abs(best - c(p.ruler, 0, 120)) ? v : best
	);
	const holes = !!p.holes;
	const nuts = !!p.nuts;
	return {
		from: GAUGE_SIZES[a].name,
		to: GAUGE_SIZES[b].name,
		// Something must be on the plate.
		holes: holes || (!nuts && ruler === 0),
		nuts,
		ruler,
		play: c(p.play, 0, 0.8),
		thickness: c(p.thickness, 3, 8)
	};
}

export const sizesOf = (p: BoltGaugeParams) =>
	GAUGE_SIZES.slice(indexOf(p.from, 0), indexOf(p.to, GAUGE_SIZES.length - 1) + 1);

const MARGIN = 5;
const GAP = 4;
const CAP = 3;
const DEPTH = 0.6;
/** Band under an item for its label. */
const LABEL = CAP + 2.5;
/** Widest line of holes or pockets, mm — the plate fits a 220 mm bed. */
const LINE = 170;
/** Depth of the ruler's V groove and the wall's thickness, mm. */
const GROOVE = 3;
const WALL = 3;
/** Half the V's opening: a screw's head is always wider than the V where its shank sits. */
const TAN = Math.tan(Math.PI / 6);
const COS30 = Math.cos(Math.PI / 6);

interface Item {
	name: string;
	/** Width of the column and height of the hole or pocket, mm */
	w: number;
	h: number;
	cut: (x: number, y: number, t: number) => Node;
}

function holeItems(p: BoltGaugeParams): Item[] {
	return sizesOf(p).map((s) => {
		const d = s.d + p.play;
		return {
			name: s.name,
			w: Math.max(d, 8),
			h: d,
			cut: (x, y, t) => translate([x, y, -1], extrude(t + 2, circle(d / 2, 48)))
		};
	});
}

function nutItems(p: BoltGaugeParams): Item[] {
	return sizesOf(p).flatMap((s) =>
		s.s.map((across) => {
			const w = across + p.play;
			return {
				name: s.name,
				w: Math.max(w, 8),
				h: w / COS30,
				// Flats facing ±X, so the column is exactly as wide as the key.
				cut: (x, y, t) => {
					const depth = Math.min(s.m, t - 1);
					return translate(
						[x, y, t - depth],
						extrude(depth + 1, rotate([0, 0, 30], circle(w / COS30 / 2, 6)))
					);
				}
			};
		})
	);
}

const lineWidth = (line: Item[]) => line.reduce((s, i) => s + i.w, 0) + GAP * (line.length - 1);

/** Items in as few lines no wider than LINE as fit, about equally long. */
function flow(items: Item[]): Item[][] {
	const lines: Item[][] = [];
	const count = Math.ceil(lineWidth(items) / LINE);
	const target = lineWidth(items) / count;
	let width = Infinity;
	for (const item of items) {
		const next = width + GAP + item.w;
		if (next > LINE || (lines.length < count && next > target + item.w / 2)) {
			lines.push([]);
			width = -GAP;
		}
		lines[lines.length - 1].push(item);
		width += GAP + item.w;
	}
	return lines;
}

/** The ruler: the stop wall's height above the plate and the band's size. */
function rulerFrame(p: BoltGaugeParams) {
	const biggest = Math.max(...sizesOf(p).map((s) => s.d), 8);
	// A shank in a 60° V lies with its axis d above the bottom of the V; the
	// wall stands above it so a big head still bears on it.
	const rise = Math.max(6, biggest - GROOVE + 3);
	const notch = 2 * (GROOVE + rise) * TAN;
	const wallDepth = notch + 8;
	const groove = 2 * GROOVE * TAN;
	const band = Math.max(wallDepth, wallDepth / 2 + groove / 2 + 0.6 + 5.5 + 1 + CAP + 1);
	return { rise, wallDepth, groove, band, length: p.ruler + WALL + 8 };
}

export interface GaugeLayout {
	width: number;
	depth: number;
}

function layout(p: BoltGaugeParams) {
	const sections = [p.holes ? flow(holeItems(p)) : [], p.nuts ? flow(nutItems(p)) : []].flat();
	const ruler = p.ruler > 0 ? rulerFrame(p) : null;
	const width =
		Math.max(0, ...sections.map(lineWidth), ruler ? ruler.length - MARGIN : 0) + 2 * MARGIN;
	let y = MARGIN;
	const placed = sections.map((line) => {
		const h = Math.max(...line.map((i) => i.h));
		const at = { line, y, h };
		y += LABEL + h + GAP;
		return at;
	});
	const rulerY = y;
	if (ruler) y += ruler.band + GAP;
	return { placed, ruler, rulerY, width, depth: y - GAP + MARGIN };
}

export function boltGaugeSize(input: BoltGaugeParams): GaugeLayout {
	const l = layout(clampBoltGauge(input));
	return { width: l.width, depth: l.depth };
}

export function boltGaugeModel(input: BoltGaugeParams): Node {
	const p = clampBoltGauge(input);
	const t = p.thickness;
	const l = layout(p);
	const plate = extrude(t, translate([l.width / 2, l.depth / 2], rrect(l.width, l.depth, 3, 24)));
	const cuts: Node[] = [];
	const engraved: Node[] = [];
	for (const { line, y } of l.placed) {
		let x = MARGIN;
		for (const item of line) {
			const cx = x + item.w / 2;
			cuts.push(item.cut(cx, y + LABEL + item.h / 2, t));
			engraved.push(
				translate(
					[cx, y + 1],
					label(item.name, CAP, { fit: item.w + GAP - 1, bold: true, valign: 'baseline' })
				)
			);
			x += item.w + GAP;
		}
	}
	const parts: Node[] = [plate];
	if (l.ruler) {
		const r = l.ruler;
		const yg = l.rulerY + r.wallDepth / 2;
		const zero = WALL;
		// The stop: a wall on the plate's left edge with a 60° V the shank goes through.
		parts.push(translate([0, yg - r.wallDepth / 2, 0], cube([WALL, r.wallDepth, t + r.rise])));
		// One V prism along X is the groove in the plate and the notch in the wall.
		// On the thinnest plate it stops short of the bed: down to it, the V
		// split the plate along a line.
		const bottom = Math.max(t - GROOVE, 0.6);
		const top = t + r.rise + 1;
		const half = (top - bottom) * TAN;
		cuts.push(
			translate(
				[-1, yg, 0],
				rotate(
					[0, 90, 0],
					extrude(
						r.length + 2,
						polygon([
							[-bottom, 0],
							[-top, half],
							[-top, -half]
						])
					)
				)
			)
		);
		const y0 = yg + r.groove / 2 + 0.6;
		// The wall's face is the zero.
		for (let mm = 1; mm <= p.ruler; mm++) {
			const len = mm % 10 === 0 ? 5.5 : mm % 5 === 0 ? 4 : 2.5;
			const w = mm % 5 === 0 ? 0.6 : 0.5;
			cuts.push(translate([zero + mm - w / 2, y0, t - DEPTH], cube([w, len, DEPTH + 1])));
		}
		for (let mm = 10; mm <= p.ruler; mm += 10)
			engraved.push(translate([zero + mm, y0 + 6.5], label(String(mm), CAP * 0.9, { bold: true })));
		engraved.push(
			// The unit after the last number, where the plate runs on past the scale.
			translate(
				[zero + p.ruler + 4.5, y0 + 6.5],
				label(tc.tc_unit_mm(), CAP * 0.9, { bold: true, halign: 'left' })
			)
		);
	}
	cuts.push(translate([0, 0, t - DEPTH], extrude(DEPTH + 1, union(...engraved))));
	return difference(union(...parts), ...cuts);
}

const mm = (v: number) => num(Math.round(v), 0);

export function boltGaugeSummary(input: BoltGaugeParams): string {
	const p = clampBoltGauge(input);
	const size = boltGaugeSize(p);
	const sizes = sizesOf(p);
	const what: string[] = [];
	if (p.holes)
		what.push(m.t_bolt_gauge_summary_holes({ count: sizes.length, n: num(sizes.length) }));
	if (p.nuts) {
		const nuts = nutItems(p).length;
		what.push(m.t_bolt_gauge_summary_nuts({ count: nuts, n: num(nuts) }));
	}
	if (p.ruler) what.push(m.t_bolt_gauge_summary_ruler({ length: num(p.ruler) }));
	const din = p.nuts && sizes.some((s) => s.s.length > 1);
	return [
		m.t_bolt_gauge_summary({
			from: p.from,
			to: p.to,
			contents: listJoin(what, currentLocale()),
			width: mm(size.width),
			depth: mm(size.depth)
		}),
		p.holes && m.t_bolt_gauge_hole_rule(),
		din && m.t_bolt_gauge_summary_din(),
		p.ruler && m.t_bolt_gauge_summary_ruler_use()
	]
		.filter(Boolean)
		.join(sentenceGap(currentLocale()));
}

export function boltGaugeHeader(input: BoltGaugeParams): string[] {
	return [m.t_bolt_gauge_scad_title(), boltGaugeSummary(input)];
}

export function boltGaugeScad(p: BoltGaugeParams): string {
	return toScad(boltGaugeModel(p), boltGaugeHeader(p));
}
