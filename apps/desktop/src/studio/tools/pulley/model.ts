/**
 * «Зубчатые шкивы»: a pulley for a timing belt — GT2 (3D printers), HTD 3M
 * and 5M (round teeth), MXL, T2.5 and T5 (trapezoidal) — with the number of
 * teeth, the belt width, flanges and a hub with a set screw and a nut trap.
 *
 * The pulley's outside is the pitch circle less the belt's pitch line
 * differential; each groove is cut to the belt tooth: a round groove (GT2,
 * HTD) or a trapezoid with 40° flanks (MXL, T). The sizes are the usual
 * ones for printed pulleys; `play` widens every groove for a looser belt.
 * The top flange rests on a 45° cone and the nut trap opens upward, so the
 * pulley prints standing on its hub's side without supports.
 */
import {
	circle,
	cube,
	cylinder,
	difference,
	extrude,
	part,
	polygon,
	rotate,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/pulley';
import { clamp } from '../shared/math';
import { ownKey } from '$lib/own';

export type BeltProfile = 'gt2' | 'htd3' | 'htd5' | 'mxl' | 't25' | 't5';

export interface BeltSpec {
	label: string;
	pitch: number;
	/** Pitch line differential: how far inside the pitch circle the pulley's outside is, mm */
	pld: number;
	/** Groove depth and width at the outside, mm */
	depth: number;
	width: number;
	shape: 'round' | 'trapezoid';
	/** Usual belt widths, mm */
	belts: number[];
}

export const BELTS: Record<BeltProfile, BeltSpec> = {
	gt2: {
		label: 'GT2',
		pitch: 2,
		pld: 0.254,
		depth: 0.764,
		width: 1.494,
		shape: 'round',
		belts: [6, 9, 10]
	},
	htd3: {
		label: 'HTD 3M',
		pitch: 3,
		pld: 0.381,
		depth: 1.289,
		width: 2.27,
		shape: 'round',
		belts: [9, 15]
	},
	htd5: {
		label: 'HTD 5M',
		pitch: 5,
		pld: 0.5715,
		depth: 2.199,
		width: 3.781,
		shape: 'round',
		belts: [15, 25]
	},
	mxl: {
		label: 'MXL',
		pitch: 2.032,
		pld: 0.254,
		depth: 0.6,
		width: 1.24,
		shape: 'trapezoid',
		belts: [3.2, 4.8, 6.4]
	},
	t25: {
		label: 'T2.5',
		pitch: 2.5,
		pld: 0.3,
		depth: 0.75,
		width: 1.8,
		shape: 'trapezoid',
		belts: [6, 10]
	},
	t5: {
		label: 'T5',
		pitch: 5,
		pld: 0.5,
		depth: 1.25,
		width: 3.2,
		shape: 'trapezoid',
		belts: [10, 16, 25]
	}
};

export interface PulleyParams {
	profile: BeltProfile;
	teeth: number;
	beltWidth: number;
	/** Widens every groove, mm */
	play: number;
	flanges: boolean;
	bore: number;
	/** A flat on the bore, for motor shafts with a D cut */
	dFlat: boolean;
	hub: boolean;
	hubDiameter: number;
	hubHeight: number;
	setScrew: boolean;
}

export const PULLEY_DEFAULTS: PulleyParams = {
	profile: 'gt2',
	teeth: 20,
	beltWidth: 6,
	play: 0.05,
	flanges: true,
	bore: 5,
	dFlat: false,
	hub: true,
	hubDiameter: 16,
	hubHeight: 7,
	setScrew: true
};

export const PULLEY_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<PulleyParams>;
}[] = [
	{
		id: 'gt2-20',
		get label() {
			return m.t_pulley_preset_gt2_20();
		},
		params: { profile: 'gt2', teeth: 20, beltWidth: 6, bore: 5 }
	},
	{
		id: 'gt2-40',
		get label() {
			return m.t_pulley_preset_gt2_40();
		},
		params: { profile: 'gt2', teeth: 40, beltWidth: 6, bore: 8, hubDiameter: 20 }
	},
	{
		id: 'gt2-idler',
		get label() {
			return m.t_pulley_preset_idler();
		},
		params: { profile: 'gt2', teeth: 20, beltWidth: 6, bore: 3, hub: false, setScrew: false }
	},
	{
		id: 'htd5',
		get label() {
			return m.t_pulley_preset_htd5_30();
		},
		params: { profile: 'htd5', teeth: 30, beltWidth: 15, bore: 8, hubDiameter: 24, hubHeight: 10 }
	},
	{
		id: 't5',
		get label() {
			return m.t_pulley_preset_t5_20();
		},
		params: { profile: 't5', teeth: 20, beltWidth: 10, bore: 8, hubDiameter: 22 }
	}
];

export function clampPulley(p: PulleyParams): PulleyParams {
	const profile = ownKey(BELTS, p.profile) ? p.profile : 'gt2';
	const teeth = Math.round(clamp(p.teeth, 10, 150));
	const od = pulleyOuter(profile, teeth);
	const bore = clamp(p.bore, 1, Math.max(1, od - 2 * BELTS[profile].depth - 3));
	return {
		profile,
		teeth,
		beltWidth: clamp(p.beltWidth, 3, 50),
		play: clamp(p.play, 0, 0.3),
		flanges: !!p.flanges,
		bore,
		dFlat: !!p.dFlat,
		hub: !!p.hub,
		// With a set screw the nut's slot needs about 2 mm of wall on each side.
		hubDiameter: clamp(p.hubDiameter, bore + (p.setScrew && p.hub ? 10 : 6), 80),
		hubHeight: clamp(p.hubHeight, 3, 30),
		setScrew: !!p.setScrew && !!p.hub
	};
}

/** Pitch diameter and the pulley's outside for this many teeth, mm. */
export function pulleyPitch(profile: BeltProfile, teeth: number): number {
	return (teeth * BELTS[profile].pitch) / Math.PI;
}
export function pulleyOuter(profile: BeltProfile, teeth: number): number {
	return pulleyPitch(profile, teeth) - 2 * BELTS[profile].pld;
}

/** Flange over the teeth: this much wider than the outside, and this thick, mm. */
const FLANGE = 1.6;
const FLANGE_T = 1;
/** M3 set screw, its square nut (5,5 × 2,4), mm. */
const M3 = { hole: 3.3, nut: 5.7, nutT: 2.6 };

/** One groove in the plane, its mouth on the outside at angle 0. */
function groove(spec: BeltSpec, R: number, play: number): Node {
	const d = spec.depth + play;
	const w = spec.width + 2 * play;
	if (spec.shape === 'round') {
		// A circle as wide as the groove, sunk to its depth (centre just inside the outside).
		const r = w / 2;
		return translate([R - d + r, 0, 0], circle(r, 24));
	}
	// 40° between the flanks: each 20° off the radius.
	const t = Math.tan((20 * Math.PI) / 180);
	const bottom = Math.max(0.2, w - 2 * d * t);
	return polygon([
		[R - d, -bottom / 2],
		[R + 0.5, -w / 2 - 0.5 * t],
		[R + 0.5, w / 2 + 0.5 * t],
		[R - d, bottom / 2]
	]);
}

export interface PulleyLayout {
	/** The hub stands on the bed (wider than the flanges) or on top. */
	hubDown: boolean;
	/** Bottom of the teeth and the whole height, mm */
	teethZ: number;
	height: number;
}

export function pulleyLayout(input: PulleyParams): PulleyLayout {
	const p = clampPulley(input);
	const R = pulleyOuter(p.profile, p.teeth) / 2;
	const widest = p.flanges ? R + FLANGE : R;
	const hubDown = p.hub && p.hubDiameter / 2 >= widest;
	const fl = p.flanges ? FLANGE_T : 0;
	const top = p.flanges ? FLANGE + BELTS[p.profile].depth + FLANGE_T : 0;
	const hubH = p.hub ? p.hubHeight : 0;
	const teethZ = (hubDown ? hubH : 0) + fl;
	return { hubDown, teethZ, height: teethZ + p.beltWidth + 1 + top + (hubDown ? 0 : hubH) };
}

export function pulleyModel(input: PulleyParams): Node {
	const p = clampPulley(input);
	const spec = BELTS[p.profile];
	const L = pulleyLayout(p);
	const R = pulleyOuter(p.profile, p.teeth) / 2;
	const Rf = R + FLANGE;
	const toothH = p.beltWidth + 1;
	const grooves = Array.from({ length: p.teeth }, (_, i) =>
		rotate([0, 0, (i * 360) / p.teeth], groove(spec, R, p.play))
	);
	const teeth2d = difference(circle(R, Math.max(64, p.teeth * 6)), ...grooves);
	const body: Node[] = [translate([0, 0, L.teethZ - 0.01], extrude(toothH + 0.02, teeth2d))];
	const toothTop = L.teethZ + toothH;
	if (p.flanges) {
		// Below the teeth a flat flange; above, a 45° cone (from the tooth roots out
		// to the flange's edge, as tall as it is wide) up to a flat one.
		const cone = FLANGE + spec.depth;
		body.push(
			translate([0, 0, L.teethZ - FLANGE_T], cylinder(FLANGE_T + 0.01, Rf, Rf, 96)),
			translate([0, 0, toothTop - 0.01], cylinder(cone + 0.01, R - spec.depth, Rf, 96)),
			translate([0, 0, toothTop + cone - 0.01], cylinder(FLANGE_T + 0.01, Rf, Rf, 96))
		);
	}
	// The hub: on the bed when it is the widest part, else on top.
	const hubZ = L.hubDown ? 0 : L.height - p.hubHeight;
	if (p.hub)
		body.push(
			translate(
				[0, 0, hubZ - (L.hubDown ? 0 : 0.01)],
				cylinder(p.hubHeight + 0.01, p.hubDiameter / 2, p.hubDiameter / 2, 64)
			)
		);
	// A D-shaped bore cuts the shaft's flat (0,1 of its diameter) in.
	const hole = circle(p.bore / 2 + 0.1, 48);
	const flatX = p.bore / 2 - p.bore * 0.1 + 0.1;
	const boreShape = p.dFlat
		? difference(hole, translate([flatX + p.bore / 2, 0, 0], square(p.bore, p.bore * 2)))
		: hole;
	const cuts: Node[] = [translate([0, 0, -1], extrude(L.height + 2, boreShape))];
	if (p.setScrew) {
		// Across the hub at its middle; the square nut slides in from the hub's free end.
		const zc = hubZ + p.hubHeight / 2;
		const nutX = p.bore / 2 + (p.hubDiameter / 2 - p.bore / 2) / 2 - M3.nutT / 2;
		const fromZ = L.hubDown ? -1 : zc - M3.nut / 2;
		const toZ = L.hubDown ? zc + M3.nut / 2 : L.height + 1;
		cuts.push(
			translate(
				[0, 0, zc],
				rotate([0, 90, 0], cylinder(p.hubDiameter, M3.hole / 2, M3.hole / 2, 24))
			),
			translate([nutX, -M3.nut / 2, fromZ], cube([M3.nutT, M3.nut, toZ - fromZ]))
		);
	}
	return part('pulley', difference(union(...body), ...cuts));
}

const mm = (v: number) => num(Math.round(v * 100) / 100, 2);

export function pulleySummary(input: PulleyParams): string {
	const p = clampPulley(input);
	const spec = BELTS[p.profile];
	return m.t_pulley_summary({
		count: p.teeth,
		n: num(p.teeth),
		belt: spec.label,
		pitch: mm(pulleyPitch(p.profile, p.teeth)),
		outer: mm(pulleyOuter(p.profile, p.teeth)),
		width: mm(p.beltWidth),
		bore: mm(p.bore)
	});
}

export function pulleyHeader(input: PulleyParams): string[] {
	const p = clampPulley(input);
	const hubDown = pulleyLayout(p).hubDown;
	return [
		m.t_pulley_scad_title(),
		pulleySummary(p),
		p.setScrew
			? m.t_pulley_scad_play_set_screw({ play: mm(p.play) })
			: m.t_pulley_scad_play({ play: mm(p.play) }),
		hubDown
			? p.flanges
				? m.t_pulley_scad_print_hub_flange()
				: m.t_pulley_scad_print_hub()
			: p.flanges
				? m.t_pulley_scad_print_bed_flange()
				: m.t_pulley_scad_print_bed()
	];
}

export function pulleyScad(p: PulleyParams): string {
	return toScad(pulleyModel(p), pulleyHeader(p));
}
