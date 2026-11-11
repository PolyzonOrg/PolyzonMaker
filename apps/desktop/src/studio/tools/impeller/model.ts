/**
 * «Крыльчатки»: a centrifugal impeller for a blower, a vacuum or a fan
 * housing — blades standing on a disc round a hub, straight (radial) or
 * curved back or forward, with a bore for the motor shaft (a flat for D
 * shafts). Printed on its disc, blades up: nothing overhangs.
 */
import {
	circle,
	cylinder,
	difference,
	intersection,
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
import * as m from '$msg/tools/impeller';
import { clamp } from '../shared/math';

export type BladeShape = 'radial' | 'backward' | 'forward';

export interface ImpellerParams {
	diameter: number;
	blades: number;
	shape: BladeShape;
	/** Blade height above the disc, thickness, mm */
	height: number;
	blade: number;
	disc: number;
	hub: number;
	hubHeight: number;
	bore: number;
	dFlat: boolean;
	/** Eye in the middle the blades start from, % of the diameter */
	eye: number;
}

export const IMPELLER_DEFAULTS: ImpellerParams = {
	diameter: 60,
	blades: 10,
	shape: 'backward',
	height: 12,
	blade: 1.2,
	disc: 1.6,
	hub: 10,
	hubHeight: 8,
	bore: 2.1,
	dFlat: false,
	eye: 35
};

export const IMPELLER_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<ImpellerParams>;
}[] = [
	{
		id: 'blower',
		get label() {
			return m.t_impeller_preset_blower();
		},
		params: {}
	},
	{
		id: 'radial',
		get label() {
			return m.t_impeller_preset_radial();
		},
		params: { shape: 'radial', blades: 8, diameter: 50, height: 10 }
	},
	{
		id: 'forward',
		get label() {
			return m.t_impeller_preset_forward();
		},
		params: { shape: 'forward', blades: 24, diameter: 80, height: 25, eye: 60, blade: 1 }
	},
	{
		id: 'motor',
		get label() {
			return m.t_impeller_preset_motor();
		},
		params: { bore: 5, dFlat: true, hub: 12, diameter: 70 }
	}
];

export function clampImpeller(p: ImpellerParams): ImpellerParams {
	const diameter = clamp(p.diameter, 20, 200);
	const hub = clamp(p.hub, 4, diameter * 0.5);
	return {
		diameter,
		blades: Math.round(clamp(p.blades, 3, 40)),
		shape: (['radial', 'backward', 'forward'] as const).includes(p.shape) ? p.shape : 'backward',
		height: clamp(p.height, 3, 80),
		blade: clamp(p.blade, 0.8, 4),
		disc: clamp(p.disc, 1, 5),
		hub,
		hubHeight: clamp(p.hubHeight, 2, 40),
		bore: clamp(p.bore, 1, hub - 2),
		dFlat: !!p.dFlat,
		eye: clamp(p.eye, Math.max(15, (hub / diameter) * 105), 80)
	};
}

/** A blade as a strip along a circular arc from the eye to the rim. */
function bladeShape(p: ImpellerParams): Node {
	const r0 = (p.diameter * p.eye) / 200;
	const r1 = p.diameter / 2;
	const t = p.blade;
	if (p.shape === 'radial') return translate([(r0 + r1) / 2, 0, 0], square(r1 - r0, t));
	// The arc's sweep: how far the blade turns between the eye and the rim.
	const sweep = ((p.shape === 'backward' ? -1 : 1) * Math.PI) / (p.shape === 'forward' ? 3 : 4);
	const n = 32;
	const centre: [number, number][] = [];
	for (let k = 0; k <= n; k++) {
		const s = k / n;
		const r = r0 + (r1 - r0) * s;
		const a = sweep * s * s;
		centre.push([r * Math.cos(a), r * Math.sin(a)]);
	}
	// Offset the centre line both ways, along its normal.
	const left: [number, number][] = [];
	const right: [number, number][] = [];
	for (let k = 0; k <= n; k++) {
		const a = centre[Math.max(0, k - 1)];
		const b = centre[Math.min(n, k + 1)];
		const dx = b[0] - a[0];
		const dy = b[1] - a[1];
		const len = Math.hypot(dx, dy) || 1;
		const nx = -dy / len;
		const ny = dx / len;
		left.push([centre[k][0] + (nx * t) / 2, centre[k][1] + (ny * t) / 2]);
		right.push([centre[k][0] - (nx * t) / 2, centre[k][1] - (ny * t) / 2]);
	}
	return polygon([...right, ...left.reverse()]);
}

export function impellerModel(input: ImpellerParams): Node {
	const p = clampImpeller(input);
	const R = p.diameter / 2;
	const one = bladeShape(p);
	const blades = Array.from({ length: p.blades }, (_, i) => {
		const a = (i * 360) / p.blades;
		return rotate([0, 0, a], one);
	});
	const top = p.disc + p.height;
	// The hub as tall as asked — lower than the blades too — never below the disc.
	const hubTop = Math.max(p.disc + 1, p.hubHeight);
	const body = union(
		cylinder(p.disc, R, R, 128),
		translate(
			[0, 0, p.disc - 0.01],
			extrude(p.height + 0.01, intersection(union(...blades), circle(R - 0.05, 128)))
		),
		cylinder(hubTop, p.hub / 2, p.hub / 2, 48)
	);
	const hole = circle(p.bore / 2 + 0.1, 32);
	const flatX = p.bore / 2 - p.bore * 0.1 + 0.1;
	const bore = p.dFlat
		? difference(hole, translate([flatX + p.bore / 2, 0, 0], square(p.bore, p.bore * 2)))
		: hole;
	return part(
		'impeller',
		difference(body, translate([0, 0, -1], extrude(Math.max(top, hubTop) + 2, bore)))
	);
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

/** «12 лопаток загнутых назад»: the count and the blade shape in one phrase. */
function blades(p: ImpellerParams): string {
	const n = { count: p.blades, n: num(p.blades) };
	if (p.shape === 'radial') return m.t_impeller_blades_radial(n);
	if (p.shape === 'forward') return m.t_impeller_blades_forward(n);
	return m.t_impeller_blades_backward(n);
}

export function impellerSummary(input: ImpellerParams): string {
	const p = clampImpeller(input);
	const values = {
		diameter: mm(p.diameter),
		blades: blades(p),
		height: mm(p.height),
		bore: mm(p.bore)
	};
	return p.dFlat ? m.t_impeller_summary_flat(values) : m.t_impeller_summary(values);
}

export function impellerHeader(input: ImpellerParams): string[] {
	return [m.t_impeller_header_title(), impellerSummary(input), m.t_impeller_header_print()];
}

export function impellerScad(p: ImpellerParams): string {
	return toScad(impellerModel(p), impellerHeader(p));
}
