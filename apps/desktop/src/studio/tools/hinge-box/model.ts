/**
 * A box with a lid on a hinge that prints in place: box and lid lie side by
 * side, open 180°, their knuckles already on one axis. After printing, the
 * lid folds over and sits on the box.
 *
 * The axis runs behind the back walls at half the sum of the heights,
 * h = (box + lid) / 2: a half turn round it takes the lid's rim exactly onto
 * the box's rim. Knuckles alternate box / lid / box…; where the lid's
 * knuckles are, its back wall rises to the axis and the box's back wall is
 * cut down to it, so closed they fill each other. Neighbouring knuckles hold
 * together by 45° cone pins with play — they print without supports.
 *
 * Coordinates as printed: x along the hinge, the box at y < 0, the lid at
 * y > gap, the bed at z = 0.
 */
import {
	cube,
	cylinder,
	difference,
	extrude,
	part,
	polygon,
	rotate,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num as fmt } from '$lib/i18n/current';
import * as m from '$msg/tools/hinge-box';
import { clamp as c } from '../shared/math';

export interface HingeBoxParams {
	/** Inside of the box, mm */
	width: number;
	depth: number;
	height: number;
	/** Inside height of the lid, mm */
	lidHeight: number;
	wall: number;
	corner: number;
	/** Play in the hinge, mm */
	clearance: number;
	/** Knuckles along the hinge (odd: the box has both ends) */
	knuckles: 3 | 5 | 7;
}

export const HINGE_DEFAULTS: HingeBoxParams = {
	width: 70,
	depth: 50,
	height: 30,
	lidHeight: 8,
	wall: 2,
	corner: 4,
	clearance: 0.4,
	knuckles: 5
};

export interface HingePreset {
	id: string;
	label: string;
	params: Partial<HingeBoxParams>;
}

export const HINGE_PRESETS: readonly HingePreset[] = [
	{
		id: 'rings',
		get label() {
			return m.t_hinge_box_preset_rings();
		},
		params: { width: 50, depth: 40, height: 22, lidHeight: 8, knuckles: 3 }
	},
	{
		id: 'bits',
		get label() {
			return m.t_hinge_box_preset_bits();
		},
		params: { width: 90, depth: 45, height: 25, lidHeight: 6 }
	},
	{
		id: 'sd',
		get label() {
			return m.t_hinge_box_preset_sd();
		},
		params: { width: 70, depth: 50, height: 18, lidHeight: 6 }
	},
	{
		id: 'big',
		get label() {
			return m.t_hinge_box_preset_big();
		},
		params: { width: 140, depth: 90, height: 50, lidHeight: 15, wall: 2.4, knuckles: 7 }
	}
];

export function clampHinge(p: HingeBoxParams): HingeBoxParams {
	const wall = c(p.wall, 1.2, 5);
	const lidHeight = c(p.lidHeight, 3, 80);
	const knuckles = p.knuckles === 3 || p.knuckles === 7 ? p.knuckles : 5;
	const R = knuckleRadius(wall);
	const clearance = c(p.clearance, 0.2, 1);
	// Turning, the lid's back wall passes the box's knuckle webs: half the difference of
	// the heights must exceed the web's reach from the axis (wall + axis offset + knuckle).
	const minHeight = lidHeight + 2 * (wall + (R + clearance + 0.1) + R + 1);
	return {
		width: c(p.width, knuckles * 8 + 10, 300),
		depth: c(p.depth, 15, 300),
		height: c(p.height, minHeight, 200),
		lidHeight,
		wall,
		corner: c(p.corner, 0.5, 20),
		clearance,
		knuckles
	};
}

function knuckleRadius(wall: number): number {
	return Math.max(3, wall + 1.5);
}

export interface HingeLayout {
	/** Outside of the box and of the lid (floors included), mm */
	outer: [number, number];
	boxHeight: number;
	lidHeight: number;
	/** The axis: y and z */
	axis: [number, number];
	gap: number;
	radius: number;
	/** Knuckle segments along x: [from, to, belongs to the box] */
	segments: [number, number, boolean][];
}

export function hingeLayout(input: HingeBoxParams): HingeLayout {
	const p = clampHinge(input);
	const W = p.width + 2 * p.wall;
	const D = p.depth + 2 * p.wall;
	const Hb = p.height + p.wall;
	const Hl = p.lidHeight + p.wall;
	const R = knuckleRadius(p.wall);
	// Each knuckle clears the other part's back wall by the play.
	const gap = 2 * (R + p.clearance) + 0.2;
	const span = W - 2 * Math.max(p.corner, p.wall) - 2;
	const n = p.knuckles;
	const seg = (span - (n - 1) * p.clearance) / n;
	const segments: [number, number, boolean][] = Array.from({ length: n }, (_, i) => {
		const x0 = -span / 2 + i * (seg + p.clearance);
		return [x0, x0 + seg, i % 2 === 0];
	});
	return {
		outer: [W, D],
		boxHeight: Hb,
		lidHeight: Hl,
		axis: [gap / 2, (Hb + Hl) / 2],
		gap,
		radius: R,
		segments
	};
}

const FN = 48;

function tray(W: number, D: number, H: number, p: HingeBoxParams): Node {
	return difference(
		extrude(H, rrect(W, D, p.corner, 32)),
		translate(
			[0, 0, p.wall],
			extrude(H, rrect(W - 2 * p.wall, D - 2 * p.wall, Math.max(0.5, p.corner - p.wall), 32))
		)
	);
}

/** A knuckle round the axis from x0 to x1 (a cylinder along x). */
function knuckle(L: HingeLayout, x0: number, x1: number, r = L.radius): Node {
	return translate([x0, L.axis[0], L.axis[1]], rotate([0, 90, 0], cylinder(x1 - x0, r, r, FN)));
}

/** A 45° cone along x with its base at `x`, pointing towards `dir`. */
function cone(L: HingeLayout, x: number, dir: 1 | -1, base: number): Node {
	const c = cylinder(base, base, 0.01, FN);
	return translate([x, L.axis[0], L.axis[1]], rotate([0, dir * 90, 0], c));
}

/**
 * A 45° buttress under a knuckle, from the back wall's face at y = `wall`
 * up to the knuckle's 45° point: the knuckle and its web print on it instead
 * of hanging in the air (a prism along x from x0 to x1).
 */
function buttress(L: HingeLayout, x0: number, x1: number, wall: number): Node {
	const [ay, h] = L.axis;
	const R = L.radius;
	const dir = wall < ay ? 1 : -1;
	const k = R / Math.SQRT2;
	const z0 = Math.max(0, h - Math.abs(ay - wall) - Math.SQRT2 * R);
	const w = wall - dir * 0.01;
	const pts: [number, number][] = [
		[w, z0],
		[ay + dir * k, h - k],
		[ay, h],
		[w, h]
	];
	// (y, z) drawn flat, then turned so the extrusion runs along x.
	return translate(
		[x0, 0, 0],
		rotate([90, 0, 90], extrude(x1 - x0, polygon(dir > 0 ? pts : [...pts].reverse())))
	);
}

/** The box and the lid as printed, apart. */
export function hingeParts(input: HingeBoxParams): { box: Node; lid: Node } {
	const p = clampHinge(input);
	const L = hingeLayout(p);
	const [W, D] = L.outer;
	const [ay, h] = L.axis;
	const R = L.radius;
	const t = p.wall;
	const pin = R * 0.55;

	// The box: y from −D to 0.
	const box = translate([0, -D / 2, 0], tray(W, D, L.boxHeight, p));
	// The lid: y from gap to gap + D, open side up.
	const lid = translate([0, L.gap + D / 2, 0], tray(W, D, L.lidHeight, p));

	const boxParts: Node[] = [];
	const lidParts: Node[] = [];
	const boxCuts: Node[] = [];
	const lidCuts: Node[] = [];
	for (const [x0, x1, ofBox] of L.segments) {
		if (ofBox) {
			// The knuckle and a web into the box's back wall.
			boxParts.push(
				knuckle(L, x0, x1),
				translate([x0, -t, h - R], cube([x1 - x0, ay + t, 2 * R])),
				buttress(L, x0, x1, 0)
			);
		} else {
			// The lid's back wall rises to the axis here; the box's back wall is cut down to meet it.
			lidParts.push(
				knuckle(L, x0, x1),
				translate([x0, ay, h - R], cube([x1 - x0, L.gap + t - ay, R])),
				translate([x0, L.gap, 0], cube([x1 - x0, t, h])),
				buttress(L, x0, x1, L.gap)
			);
			boxCuts.push(
				translate(
					[x0 - p.clearance, -t - 1, h - p.clearance],
					cube([x1 - x0 + 2 * p.clearance, t + 2, L.boxHeight])
				)
			);
		}
	}
	// Cone pins: from each box knuckle into its lid neighbours. A socket √2 × play wider
	// in radius leaves the full play across the 45° cone.
	const wider = pin + p.clearance * Math.SQRT2;
	for (let i = 0; i < L.segments.length - 1; i++) {
		const [, x1, ofBox] = L.segments[i];
		const [x0n] = L.segments[i + 1];
		if (ofBox) {
			boxParts.push(cone(L, x1 - 0.01, 1, pin));
			lidCuts.push(cone(L, x1 - 0.01, 1, wider));
		} else {
			boxParts.push(cone(L, x0n + 0.01, -1, pin));
			lidCuts.push(cone(L, x0n + 0.01, -1, wider));
		}
	}
	return {
		box: difference(union(box, ...boxParts), ...boxCuts),
		lid: difference(union(lid, ...lidParts), ...lidCuts)
	};
}

export function hingeModel(input: HingeBoxParams): Node {
	const { box, lid } = hingeParts(input);
	return union(part('box', box), part('lid', lid));
}

/** The lid folded shut: half a turn round the axis (for checks and pictures). */
export function closedLid(input: HingeBoxParams, lid: Node, angle = 180): Node {
	const L = hingeLayout(input);
	const [ay, h] = L.axis;
	return translate([0, ay, h], rotate([angle, 0, 0], translate([0, -ay, -h], lid)));
}

const mm = (v: number) => fmt(Math.round(v * 10) / 10, 1);

export function hingeSummary(input: HingeBoxParams): string {
	const p = clampHinge(input);
	const L = hingeLayout(p);
	return m.t_hinge_box_summary({
		w: mm(L.outer[0]),
		d: mm(L.outer[1] + L.gap / 2 + L.radius),
		h: mm(L.boxHeight + L.lidHeight)
	});
}

export function hingeHeader(input: HingeBoxParams): string[] {
	const p = clampHinge(input);
	return [m.t_hinge_box_scad_title(), hingeSummary(p), m.t_hinge_box_scad_print()];
}

export function hingeScad(p: HingeBoxParams): string {
	return toScad(hingeModel(p), hingeHeader(p));
}
