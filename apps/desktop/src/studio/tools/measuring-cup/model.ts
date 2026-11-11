/**
 * Measuring spoons and cups that hold exactly the volume asked: a round cup
 * whose inside is computed from the volume (height ≈ the diameter for a
 * spoon, a bit taller for a cup), a flat handle at the bottom with the
 * volume engraved — prints standing, no supports. A set makes the usual
 * kitchen measures in one go.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	hull,
	label,
	mirror,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { currentLocale, num as localNum } from '$lib/i18n/current';
import { decimalMark, listJoin } from '$lib/i18n/locale';
import { num } from '../scad-literals';
import * as m from '$msg/tools/measuring-cup';
import { clamp as c } from '../shared/math';

export interface MeasuringCupParams {
	/** Volumes in millilitres, comma-separated */
	volumes: string;
	/** Inside height to inside diameter */
	ratio: number;
	wall: number;
	handle: boolean;
	font: string;
}

export const MEASURING_CUP_DEFAULTS: MeasuringCupParams = {
	volumes: '5, 15',
	ratio: 0.8,
	wall: 1.8,
	handle: true,
	font: 'Noto Sans'
};

export interface MeasuringCupPreset {
	id: string;
	label: string;
	params: Partial<MeasuringCupParams>;
}

export const MEASURING_CUP_PRESETS: readonly MeasuringCupPreset[] = [
	{
		id: 'spoons',
		get label() {
			return m.t_measuring_cup_preset_spoons();
		},
		params: { volumes: '5, 15' }
	},
	{
		id: 'set',
		get label() {
			return m.t_measuring_cup_preset_set();
		},
		params: { volumes: '1.25, 2.5, 5, 15' }
	},
	{
		id: 'coffee',
		get label() {
			return m.t_measuring_cup_preset_coffee();
		},
		params: { volumes: '10', ratio: 0.9 }
	},
	{
		id: 'glass',
		get label() {
			return m.t_measuring_cup_preset_glass();
		},
		params: { volumes: '200', ratio: 1.3, wall: 2, handle: false }
	},
	{
		id: 'cups',
		get label() {
			return m.t_measuring_cup_preset_cups();
		},
		params: { volumes: '50, 100, 200', ratio: 1.1, wall: 2 }
	}
];

/** The volumes asked for, ml: positive, at most 8, 0.1–1000. */
export function volumesOf(p: Pick<MeasuringCupParams, 'volumes'>): number[] {
	// «1,25» is a decimal comma; a comma with a space after it separates the list.
	return String(p.volumes ?? '')
		.replace(/(\d),(\d)/g, '$1.$2')
		.split(/[;,\s，；、]+/)
		.map(Number)
		.filter((v) => Number.isFinite(v) && v > 0)
		.map((v) => Math.min(1000, Math.max(0.1, v)))
		.slice(0, 8);
}

export function clampMeasuringCup(p: MeasuringCupParams): MeasuringCupParams {
	return {
		volumes: String(p.volumes ?? '').slice(0, 80),
		ratio: c(p.ratio, 0.4, 2),
		wall: c(p.wall, 1.2, 4),
		handle: !!p.handle,
		font: p.font
	};
}

const FLOOR = 1.8;
const FN = 96;

/** Inside radius and height for a volume, mm: π r² h = V, h = ratio · 2r. */
export function insideOf(volumeMl: number, ratio: number): { r: number; h: number } {
	const v = volumeMl * 1000;
	const r = Math.cbrt(v / (2 * Math.PI * ratio));
	return { r, h: 2 * r * ratio };
}

/** «5 мл», «1,25 мл»; a spoon's kitchen name under it when it is one. */
export function nameOf(v: number): string {
	// No digit grouping: «1000» is engraved as is.
	return m.t_measuring_cup_volume({
		volume: num(v, 0, 1e4).replace('.', decimalMark(currentLocale()))
	});
}

/** The cavity of one measure (for the volume check). */
export function cavity(volumeMl: number, p: MeasuringCupParams): Node {
	const { r, h } = insideOf(volumeMl, p.ratio);
	return translate([0, 0, FLOOR], cylinder(h, r, r, FN));
}

function measure(v: number, p: MeasuringCupParams): Node {
	const { r, h } = insideOf(v, p.ratio);
	const R = r + p.wall;
	const cup = difference(cylinder(h + FLOOR, R, R, FN), cavity(v, p));
	if (!p.handle) {
		// A glass: the volume engraved under the floor, mirrored so it reads from below.
		const text = translate(
			[0, 0, -0.01],
			extrude(
				0.61,
				mirror(
					[1, 0],
					label(nameOf(v), Math.min(8, r * 0.35), { font: p.font, valign: 'center', fit: r * 1.4 })
				)
			)
		);
		return difference(cup, text);
	}
	// A flat handle along +X from the cup's foot, rounded at the end.
	const len = Math.max(50, R * 2.5);
	const w = Math.max(12, Math.min(18, R * 0.9));
	const t = 3;
	const handle = extrude(
		t,
		hull(
			translate([R * 0.5, 0], circle(w / 2, 32)),
			translate([R + len - w / 2, 0], circle(w / 2, 32))
		)
	);
	const text = translate(
		[R + 4, 0, t - 0.6],
		extrude(
			1,
			label(nameOf(v), Math.min(6, w * 0.4), {
				font: p.font,
				halign: 'left',
				valign: 'center',
				fit: len - 14
			})
		)
	);
	const hole = translate([R + len - w / 2, 0, -1], cylinder(t + 2, 2.5, 2.5, 32));
	return difference(union(cup, handle), cavity(v, p), text, hole);
}

export function measuringCupModel(input: MeasuringCupParams): Node {
	const p = clampMeasuringCup(input);
	const vs = volumesOf(p);
	const list = vs.length ? vs : [5];
	let y = 0;
	const parts: Node[] = [];
	for (const v of list) {
		const R = insideOf(v, p.ratio).r + p.wall;
		y += R;
		parts.push(translate([0, y, 0], measure(v, p)));
		y += R + 6;
	}
	return union(...parts);
}

export function measuringCupSummary(input: MeasuringCupParams): string {
	const p = clampMeasuringCup(input);
	const vs = volumesOf(p);
	const list = listJoin(vs.map(nameOf), currentLocale());
	const n = vs.length || 1;
	return m.t_measuring_cup_summary({ count: n, n: localNum(n), list: list || nameOf(5) });
}

export function measuringCupHeader(input: MeasuringCupParams): string[] {
	const p = clampMeasuringCup(input);
	return [m.t_measuring_cup_scad_title(), measuringCupSummary(p)];
}

export function measuringCupScad(p: MeasuringCupParams): string {
	return toScad(measuringCupModel(p), measuringCupHeader(p));
}
