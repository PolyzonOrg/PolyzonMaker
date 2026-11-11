/**
 * Calibration test prints as STL, for any slicer and any printer:
 *  - «Зазоры»: pins printed inside holes, each with its own play, a knob on
 *    top — the smallest play whose pin still turns is your printer's;
 *  - «Нависания»: tongues out of a wall at 30–80° from the vertical;
 *  - «Мосты»: spans from 10 to 60 mm between pillars;
 *  - «Отверстия»: holes and pegs of known diameters, to measure the
 *    printer's hole compensation;
 *  - «Куб XYZ»: a 20 mm cube with its axes engraved;
 *  - «Перекос осей»: a 100 mm square with its corners marked, and the
 *    calculation of SET_SKEW / M852 from three measurements;
 *  - «Первый слой»: one-layer squares in the corners and the middle of the bed.
 * Every label is engraved 0.6 mm deep.
 */
import {
	cube,
	cylinder,
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
import { num } from '../scad-literals';
import { num as localNum } from '$lib/i18n/current';
import * as m from '$msg/tools/test-prints';
import { clamp as c } from '../shared/math';

export type TestPrintKind =
	| 'fit'
	| 'overhang'
	| 'bridge'
	| 'holes'
	| 'cube'
	| 'skew'
	| 'first-layer';

export interface TestPrintParams {
	kind: TestPrintKind;
	/** Plays to try, mm (fit) */
	plays: string;
	/** Angles from the vertical, degrees (overhang) */
	angles: string;
	/** Spans, mm (bridge) */
	spans: string;
	/** Diameters, mm (holes) */
	diameters: string;
	/** Cube side, mm */
	cubeSize: number;
	/** Square side, mm (skew) */
	skewSize: number;
	/** Bed size, mm (first layer) */
	bedX: number;
	bedY: number;
	/** First layer height, mm */
	layer: number;
	font: string;
}

export const TEST_PRINT_DEFAULTS: TestPrintParams = {
	kind: 'fit',
	plays: '0.1, 0.2, 0.3, 0.4, 0.5, 0.6',
	angles: '30, 40, 50, 60, 70, 80',
	spans: '10, 20, 30, 40, 50, 60',
	diameters: '3, 4, 5, 6, 8, 10',
	cubeSize: 20,
	skewSize: 100,
	bedX: 220,
	bedY: 220,
	layer: 0.2,
	font: 'Noto Sans'
};

export interface TestPrintPreset {
	id: string;
	label: string;
	params: Partial<TestPrintParams>;
}

export const TEST_PRINT_PRESETS: readonly TestPrintPreset[] = [
	{
		id: 'fit',
		get label() {
			return m.t_test_prints_preset_fit();
		},
		params: { kind: 'fit' }
	},
	{
		id: 'overhang',
		get label() {
			return m.t_test_prints_preset_overhang();
		},
		params: { kind: 'overhang' }
	},
	{
		id: 'bridge',
		get label() {
			return m.t_test_prints_preset_bridge();
		},
		params: { kind: 'bridge' }
	},
	{
		id: 'holes',
		get label() {
			return m.t_test_prints_preset_holes();
		},
		params: { kind: 'holes' }
	},
	{
		id: 'cube',
		get label() {
			return m.t_test_prints_preset_cube();
		},
		params: { kind: 'cube' }
	},
	{
		id: 'skew',
		get label() {
			return m.t_test_prints_preset_skew();
		},
		params: { kind: 'skew' }
	},
	{
		id: 'first',
		get label() {
			return m.t_test_prints_preset_first_layer();
		},
		params: { kind: 'first-layer' }
	}
];

const KINDS: readonly TestPrintKind[] = [
	'fit',
	'overhang',
	'bridge',
	'holes',
	'cube',
	'skew',
	'first-layer'
];

export function clampTestPrint(p: TestPrintParams): TestPrintParams {
	return {
		kind: KINDS.includes(p.kind) ? p.kind : 'fit',
		plays: String(p.plays ?? '').slice(0, 80),
		angles: String(p.angles ?? '').slice(0, 80),
		spans: String(p.spans ?? '').slice(0, 80),
		diameters: String(p.diameters ?? '').slice(0, 80),
		cubeSize: c(p.cubeSize, 10, 60),
		skewSize: c(p.skewSize, 50, 200),
		bedX: c(p.bedX, 80, 600),
		bedY: c(p.bedY, 80, 600),
		layer: c(p.layer, 0.08, 0.6),
		font: p.font
	};
}

/**
 * Numbers of a list field, sorted and unique. A comma is a separator in a
 * list of whole numbers («30,45,60») and wherever dots mark the decimals
 * («0.2,0.3»); otherwise «0,2» is a decimal comma («0,2; 0,3» a list).
 */
export function listOf(text: string, lo: number, hi: number, max = 10, decimals = true): number[] {
	const raw = String(text ?? '');
	const commaDecimal = decimals && !raw.includes('.');
	const values = (commaDecimal ? raw.replace(/(\d),(\d)/g, '$1.$2') : raw)
		.split(/[;,\s，；、]+/)
		.map(Number)
		.filter((v) => Number.isFinite(v) && v >= lo && v <= hi);
	return [...new Set(values)].sort((a, b) => a - b).slice(0, max);
}

const DEPTH = 0.6;
/** Air between a knob and the plate under it, mm: two thin layers. */
const LIFT = 0.4;
/** A number engraved or shown, written the language's way. */
const fmt = (v: number) => localNum(v, 4);

/** Text engraved into a top face at height `top`. */
function engrave(text: string, cap: number, x: number, y: number, top: number, font: string): Node {
	return translate(
		[x, y, top - DEPTH],
		extrude(DEPTH + 1, label(text, cap, { font, valign: 'center' }))
	);
}

function fit(p: TestPrintParams): Node {
	const plays = listOf(p.plays, 0.05, 1.5);
	const list = plays.length ? plays : [0.3];
	const pin = 6;
	const pitch = 14;
	const T = 4;
	const W = list.length * pitch + 6;
	const plate = extrude(T, translate([W / 2, 0], rrect(W, 24, 3, 24)));
	const holes: Node[] = [];
	const pins: Node[] = [];
	const labels: Node[] = [];
	list.forEach((play, i) => {
		const x = 3 + pitch / 2 + i * pitch;
		const y = 3;
		holes.push(translate([x, y, -1], cylinder(T + 2, pin / 2 + play, pin / 2 + play, 48)));
		// The pin stands in its hole on the bed; a knob to turn it by, clear of the plate.
		const knobZ = T + LIFT;
		pins.push(
			translate([x, y, 0], cylinder(knobZ + 0.01, pin / 2, pin / 2, 48)),
			translate([x, y, knobZ], cylinder(3, pin / 2 + play + 1.5, pin / 2 + play + 1.5, 48)),
			translate(
				[x - 0.6, y - pin / 2 - play - 1.4, knobZ + 3 - 0.01],
				cube([1.2, 2 * (pin / 2 + play + 1.4), 1])
			)
		);
		labels.push(engrave(fmt(play), 3.2, x, -7, T, p.font));
	});
	return union(difference(plate, ...holes, ...labels), ...pins);
}

function overhang(p: TestPrintParams): Node {
	const angles = listOf(p.angles, 20, 85, 10, false);
	const list = angles.length ? angles : [45];
	const seg = 12;
	const reach = 12;
	const tongue = 2;
	const wallT = 3;
	const z0 = 3;
	const rise = (a: number) => reach / Math.tan((a * Math.PI) / 180);
	const H = z0 + Math.max(...list.map(rise)) + tongue + 2;
	const L = list.length * seg + 4;
	// The base runs behind the wall (labels) and under the tongues.
	const base = translate([0, -12, 0], cube([L, 12 + wallT + reach + 2, 2]));
	const wall = cube([L, wallT, H]);
	const tongues = list.map((a, i) => {
		const r = rise(a);
		const prof = polygon([
			[wallT - 0.01, z0],
			[wallT + reach, z0 + r],
			[wallT + reach, z0 + r + tongue],
			[wallT - 0.01, z0 + tongue]
		]);
		// The profile is drawn in Y (out of the wall) by Z (up); extruded along X.
		return translate([2 + i * seg + 1, 0, 0], rotate([90, 0, 90], extrude(seg - 2, prof)));
	});
	const labels = list.map((a, i) =>
		engrave(`${fmt(a)}°`, 3.4, 2 + i * seg + seg / 2, -6, 2, p.font)
	);
	return difference(union(base, wall, ...tongues), ...labels);
}

function bridge(p: TestPrintParams): Node {
	const spans = listOf(p.spans, 5, 150, 10, false);
	const list = spans.length ? spans : [20];
	const post = 5;
	const H = 8;
	const deck = 1.2;
	const row = 12;
	const longest = Math.max(...list);
	const L = longest + 2 * post + 24;
	const base = cube([L, list.length * row + 2, 1.6]);
	const parts: Node[] = [base];
	const labels: Node[] = [];
	list.forEach((s, i) => {
		const y = 1 + i * row + (row - post) / 2;
		const x0 = 18;
		parts.push(
			translate([x0, y, 0], cube([post, post, H])),
			translate([x0 + post + s, y, 0], cube([post, post, H])),
			translate([x0, y, H - 0.01], cube([2 * post + s, post, deck]))
		);
		labels.push(engrave(fmt(s), 3.4, 9, y + post / 2, 1.6, p.font));
	});
	return difference(union(...parts), ...labels);
}

function holes(p: TestPrintParams): Node {
	const ds = listOf(p.diameters, 1, 30);
	const list = ds.length ? ds : [5];
	const pitch = Math.max(...list) + 8;
	const W = list.length * pitch + 4;
	const T = 4;
	const plate = extrude(T, translate([W / 2, 0], rrect(W, Math.max(...list) + 20, 3, 24)));
	const cuts: Node[] = [];
	const pegs: Node[] = [];
	list.forEach((d, i) => {
		const x = 2 + pitch / 2 + i * pitch;
		cuts.push(
			translate([x, 3, -1], cylinder(T + 2, d / 2, d / 2, 64)),
			engrave(fmt(d), 3.2, x, -Math.max(...list) / 2 - 4, T, p.font)
		);
		// A peg of the same nominal size, printed beside the plate: 4 mm off its edge, however big.
		pegs.push(translate([x, Math.max(...list) + 14, 0], cylinder(8, d / 2, d / 2, 64)));
	});
	return union(difference(plate, ...cuts), ...pegs);
}

function xyzCube(p: TestPrintParams): Node {
	const s = p.cubeSize;
	const cap = s * 0.45;
	const body = cube([s, s, s]);
	const o = { font: p.font, valign: 'center' as const };
	// X on the face looking along −Y (front), Y on the side looking along +X, Z on top.
	const x = translate(
		[s / 2, DEPTH, s / 2],
		rotate([90, 0, 0], extrude(DEPTH + 1, label('X', cap, o)))
	);
	const y = translate(
		[s - DEPTH, s / 2, s / 2],
		rotate([90, 0, 90], extrude(DEPTH + 1, label('Y', cap, o)))
	);
	const z = translate([s / 2, s / 2, s - DEPTH], extrude(DEPTH + 1, label('Z', cap, o)));
	return difference(body, x, y, z);
}

function skewSquare(p: TestPrintParams): Node {
	const s = p.skewSize;
	const w = 6;
	const T = 1.6;
	const frame = difference(
		cube([s, s, T]),
		translate([w, w, -1], cube([s - 2 * w, s - 2 * w, T + 2]))
	);
	const letters = (
		[
			['A', w / 2, w / 2],
			['B', w / 2, s - w / 2],
			['C', s - w / 2, s - w / 2],
			['D', s - w / 2, w / 2]
		] as const
	).map(([t, x, y]) => engrave(t, 3.4, x, y, T, p.font));
	return difference(frame, ...letters);
}

function firstLayer(p: TestPrintParams): Node {
	const size = 30;
	const m = 20;
	const spots: [number, number][] = [
		[m, m],
		[p.bedX - m - size, m],
		[m, p.bedY - m - size],
		[p.bedX - m - size, p.bedY - m - size],
		[(p.bedX - size) / 2, (p.bedY - size) / 2]
	];
	return union(...spots.map(([x, y]) => translate([x, y, 0], cube([size, size, p.layer]))));
}

export function testPrintModel(input: TestPrintParams): Node {
	const p = clampTestPrint(input);
	switch (p.kind) {
		case 'overhang':
			return overhang(p);
		case 'bridge':
			return bridge(p);
		case 'holes':
			return holes(p);
		case 'cube':
			return xyzCube(p);
		case 'skew':
			return skewSquare(p);
		case 'first-layer':
			return firstLayer(p);
		default:
			return fit(p);
	}
}

/** Skew from the square's diagonals AC, BD and its side AD (mm). */
export function skewOf(
	ac: number,
	bd: number,
	ad: number
): { degrees: number; factor: number } | null {
	if (![ac, bd, ad].every((v) => Number.isFinite(v) && v > 0)) return null;
	// The other side from the parallelogram law, then the angle between the sides.
	const ab2 = (ac * ac + bd * bd) / 2 - ad * ad;
	if (ab2 <= 0) return null;
	const ab = Math.sqrt(ab2);
	const cos = (ac * ac - bd * bd) / (4 * ab * ad);
	if (Math.abs(cos) >= 1) return null;
	const angle = Math.acos(cos);
	const error = Math.PI / 2 - angle;
	return { degrees: (error * 180) / Math.PI, factor: Math.tan(error) };
}

export function skewCommands(
	ac: number,
	bd: number,
	ad: number
): { klipper: string; marlin: string } | null {
	const s = skewOf(ac, bd, ad);
	if (!s) return null;
	const n = (v: number) => num(v, 0, 1e4);
	return {
		klipper: `SET_SKEW XY=${n(ac)},${n(bd)},${n(ad)}\nSKEW_PROFILE SAVE=my_skew_profile\nSAVE_CONFIG`,
		marlin: `M852 I${s.factor.toFixed(5)}\nM500`
	};
}

export function testPrintSummary(input: TestPrintParams): string {
	const p = clampTestPrint(input);
	switch (p.kind) {
		case 'overhang':
			return m.t_test_prints_summary_overhang();
		case 'bridge':
			return m.t_test_prints_summary_bridge();
		case 'holes':
			return m.t_test_prints_summary_holes();
		case 'cube':
			return m.t_test_prints_summary_cube({ size: fmt(p.cubeSize) });
		case 'skew':
			return m.t_test_prints_summary_skew();
		case 'first-layer':
			return m.t_test_prints_summary_first_layer({
				x: fmt(p.bedX),
				y: fmt(p.bedY),
				layer: fmt(p.layer)
			});
		default:
			return m.t_test_prints_summary_fit();
	}
}

export function testPrintHeader(input: TestPrintParams): string[] {
	const p = clampTestPrint(input);
	return [m.t_test_prints_scad_title(), testPrintSummary(p)];
}

export function testPrintScad(p: TestPrintParams): string {
	return toScad(testPrintModel(p), testPrintHeader(p));
}
