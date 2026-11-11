/**
 * Rulers and radius gauges. A ruler: millimetre, half-centimetre and
 * centimetre marks engraved from its measuring edge, the numbers above them,
 * a hole to hang it. Radius gauges: a plate per radius, a convex corner on
 * one end and a concave one on the other, the radius engraved, a hole to put
 * the set on a ring. The engraving is 0.6 mm deep — a filament change at
 * that height colours it.
 */
import {
	circle,
	cube,
	difference,
	extrude,
	label,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num as fmt } from '$lib/i18n/current';
import * as m from '$msg/tools/ruler';
import { clamp as c } from '../shared/math';

export type RulerKind = 'ruler' | 'radius';

export interface RulerParams {
	kind: RulerKind;
	length: number;
	width: number;
	thickness: number;
	/** Millimetre marks (the finest ones) */
	millimetres: boolean;
	/** Radii of a gauge set, mm, comma-separated */
	radii: string;
	font: string;
}

export const RULER_DEFAULTS: RulerParams = {
	kind: 'ruler',
	length: 150,
	width: 25,
	thickness: 2.4,
	millimetres: true,
	radii: '1, 2, 3, 4, 5, 6, 8, 10',
	font: 'Noto Sans'
};

export interface RulerPreset {
	id: string;
	label: string;
	params: Partial<RulerParams>;
}

export const RULER_PRESETS: readonly RulerPreset[] = [
	{
		id: '150',
		get label() {
			return m.t_ruler_preset_150();
		},
		params: {}
	},
	{
		id: '200',
		get label() {
			return m.t_ruler_preset_200();
		},
		params: { length: 200 }
	},
	{
		id: 'small',
		get label() {
			return m.t_ruler_preset_small();
		},
		params: { length: 100, width: 20 }
	},
	{
		id: 'radius',
		get label() {
			return m.t_ruler_preset_radius();
		},
		params: { kind: 'radius' }
	},
	{
		id: 'radius-big',
		get label() {
			return m.t_ruler_preset_radius_big();
		},
		params: { kind: 'radius', radii: '10, 12, 15, 20, 25' }
	}
];

export function clampRuler(p: RulerParams): RulerParams {
	return {
		kind: p.kind === 'radius' ? 'radius' : 'ruler',
		length: Math.round(c(p.length, 30, 300)),
		width: c(p.width, 12, 50),
		thickness: c(p.thickness, 1.6, 5),
		millimetres: !!p.millimetres,
		radii: String(p.radii ?? '').slice(0, 80),
		font: p.font
	};
}

/** The radii asked for, mm: 0.5–50, at most 16, no repeats, in order. */
export function radiiOf(p: Pick<RulerParams, 'radii'>): number[] {
	// «0,5» is a decimal comma; a comma with a space after it separates the list.
	const list = String(p.radii ?? '')
		.replace(/(\d),(\d)/g, '$1.$2')
		.split(/[;,\s，；、]+/)
		.map(Number)
		.filter((v) => Number.isFinite(v) && v >= 0.5 && v <= 50);
	return [...new Set(list)].sort((a, b) => a - b).slice(0, 16);
}

const DEPTH = 0.6;
const MARGIN = 6;

/** The marks of a ruler: x and length, mm from the measuring edge (y = 0). */
export function marksOf(p: RulerParams): { x: number; len: number; w: number }[] {
	const out: { x: number; len: number; w: number }[] = [];
	for (let mmv = 0; mmv <= p.length; mmv++) {
		const cm = mmv % 10 === 0;
		const half = mmv % 5 === 0;
		if (!cm && !half && !p.millimetres) continue;
		out.push({
			x: MARGIN + mmv,
			len: cm ? p.width * 0.36 : half ? p.width * 0.26 : p.width * 0.17,
			w: cm || half ? 0.6 : 0.5
		});
	}
	return out;
}

function ruler(p: RulerParams): Node {
	const L = p.length + 2 * MARGIN + 8;
	const body = extrude(p.thickness, translate([L / 2, p.width / 2], rrect(L, p.width, 2, 24)));
	const cut = (n: Node) => translate([0, 0, p.thickness - DEPTH], extrude(DEPTH + 1, n));
	const marks = marksOf(p).map((m) =>
		translate([m.x - m.w / 2, -1, p.thickness - DEPTH], cube([m.w, m.len + 1, DEPTH + 1]))
	);
	const cap = Math.min(4, p.width * 0.16);
	const numbers = Array.from({ length: Math.floor(p.length / 10) + 1 }, (_, i) =>
		translate(
			[MARGIN + i * 10, p.width * 0.36 + 1.2],
			label(String(i), cap, { font: p.font, valign: 'bottom' })
		)
	);
	const unit = translate(
		[L - 9, p.width - 4],
		label(m.t_ruler_engraved_cm(), cap * 0.8, { font: p.font, halign: 'right', valign: 'top' })
	);
	const hole = translate([L - 5, p.width / 2, -1], extrude(p.thickness + 2, circle(2.5, 32)));
	return difference(body, ...marks, cut(union(...numbers, unit)), hole);
}

function gauge(r: number, p: RulerParams): Node {
	const w = Math.max(16, 2 * r + 8);
	const len = Math.max(40, 4 * r + 24);
	const T = p.thickness;
	// The plate along X; the right end has a convex corner r, the left a concave one.
	const plate = translate([len / 2, 0], rrect(len, w, 1.5, 16));
	const convex = difference(
		translate([len - r / 2 - 0.01, w / 2 - r / 2], square(r + 0.02, r + 0.02)),
		translate([len - r, w / 2 - r], circle(r, 96))
	);
	const concave = translate([0, w / 2], circle(r, 96));
	const shape = difference(plate, convex, concave);
	const text = translate(
		[len / 2, -w / 2 + 3],
		label(`R${fmt(r, 4)}`, Math.min(5, w * 0.3), {
			font: p.font,
			valign: 'bottom'
		})
	);
	const hole = translate(
		[len / 2 + Math.max(10, r), w / 2 - Math.max(4.5, w * 0.3), -1],
		extrude(T + 2, circle(2, 24))
	);
	return difference(
		extrude(T, shape),
		translate([0, 0, T - DEPTH], extrude(DEPTH + 1, text)),
		hole
	);
}

export function rulerModel(input: RulerParams): Node {
	const p = clampRuler(input);
	if (p.kind === 'ruler') return ruler(p);
	const radii = radiiOf(p);
	const list = radii.length ? radii : [5];
	let y = 0;
	return union(
		...list.map((r) => {
			const w = Math.max(16, 2 * r + 8);
			y += w / 2;
			const g = translate([0, y, 0], gauge(r, p));
			y += w / 2 + 4;
			return g;
		})
	);
}

export function rulerSummary(input: RulerParams): string {
	const p = clampRuler(input);
	if (p.kind === 'radius') {
		const r = radiiOf(p);
		const n = r.length || 1;
		return m.t_ruler_summary_gauges({ count: n, n: fmt(n) });
	}
	return m.t_ruler_summary_ruler({ cm: fmt(p.length / 10, 4) });
}

export function rulerHeader(input: RulerParams): string[] {
	const p = clampRuler(input);
	return [m.t_ruler_scad_title(), rulerSummary(p)];
}

export function rulerScad(p: RulerParams): string {
	return toScad(rulerModel(p), rulerHeader(p));
}
