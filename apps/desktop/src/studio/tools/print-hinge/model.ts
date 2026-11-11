/**
 * A butt hinge printed already assembled: two leaves lying open on the bed,
 * knuckles taking turns along the axis, and 45° cone pins from each knuckle
 * of one leaf into its neighbours of the other (a socket √2 × play wider in
 * radius leaves the full play across the cone) — nothing to put together,
 * no supports. Countersunk holes in both leaves.
 */
import {
	cube,
	cylinder,
	difference,
	rotate,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/print-hinge';
import { clamp as c } from '../shared/math';
import { countersunk } from '../shared/thread';

export interface PrintHingeParams {
	/** Along the axis, mm */
	length: number;
	/** Each leaf from the axis, mm */
	leaf: number;
	thickness: number;
	knuckles: number;
	clearance: number;
	/** Screw diameter, mm */
	screw: number;
	holes: number;
	count: number;
}

export const PRINT_HINGE_DEFAULTS: PrintHingeParams = {
	length: 50,
	leaf: 20,
	thickness: 3,
	knuckles: 5,
	clearance: 0.35,
	screw: 3.5,
	holes: 2,
	count: 2
};

export interface PrintHingePreset {
	id: string;
	label: string;
	params: Partial<PrintHingeParams>;
}

export const PRINT_HINGE_PRESETS: readonly PrintHingePreset[] = [
	{
		id: 'box',
		get label() {
			return m.t_print_hinge_preset_box();
		},
		params: { length: 30, leaf: 12, thickness: 2.4, knuckles: 3, screw: 2.5, holes: 1 }
	},
	{
		id: 'door',
		get label() {
			return m.t_print_hinge_preset_door();
		},
		params: {}
	},
	{
		id: 'big',
		get label() {
			return m.t_print_hinge_preset_big();
		},
		params: { length: 80, leaf: 30, thickness: 4, knuckles: 7, screw: 4, holes: 3 }
	}
];

export function clampPrintHinge(p: PrintHingeParams): PrintHingeParams {
	const thickness = c(p.thickness, 1.6, 8);
	const length = c(p.length, 15, 200);
	const leaf = c(p.leaf, 8, 80);
	// A countersink is twice the screw: it stays inside the leaf, and holes keep apart.
	const screw = c(p.screw, 2, Math.min(6, leaf / 2.5));
	const most = Math.max(1, Math.floor((length - 4 * screw) / (2.2 * screw)) + 1);
	return {
		length,
		leaf,
		thickness,
		// Odd: the outer knuckles belong to the same leaf.
		knuckles: Math.round(c(p.knuckles, 3, 11)) | 1,
		clearance: c(p.clearance, 0.15, 0.8),
		screw,
		holes: Math.round(c(p.holes, 1, Math.min(5, most))),
		count: Math.round(c(p.count, 1, 8))
	};
}

export interface PrintHingeLayout {
	/** Knuckle radius, axis height (= radius: knuckles sit on the bed) */
	radius: number;
	/** Each leaf's inner edge from the axis */
	gap: number;
	/** Knuckle segments along x: [from, to, of leaf A] */
	segments: [number, number, boolean][];
	pin: number;
}

export function printHingeLayout(input: PrintHingeParams): PrintHingeLayout {
	const p = clampPrintHinge(input);
	const radius = Math.max(p.thickness, 2.6);
	const n = p.knuckles;
	const seg = (p.length - (n - 1) * p.clearance) / n;
	const segments: [number, number, boolean][] = Array.from({ length: n }, (_, i) => {
		const x0 = -p.length / 2 + i * (seg + p.clearance);
		return [x0, x0 + seg, i % 2 === 0];
	});
	return { radius, gap: radius + p.clearance, segments, pin: Math.min(radius * 0.55, seg * 0.4) };
}

const FN = 48;

/** A cylinder along x from x0 to x1 round the axis (y = 0, z = R). */
function along(x0: number, x1: number, r: number, R: number): Node {
	return translate([x0, 0, R], rotate([0, 90, 0], cylinder(x1 - x0, r, r, FN)));
}

/** A 45° cone along x with its base at `x`, pointing towards `dir`. */
function cone(x: number, dir: 1 | -1, base: number, R: number): Node {
	return translate([x, 0, R], rotate([0, dir * 90, 0], cylinder(base, base, 0.01, FN)));
}

/** The two leaves as printed (open, on the bed): A with the pins, B with the sockets. */
export function printHingeParts(input: PrintHingeParams): { a: Node; b: Node } {
	const p = clampPrintHinge(input);
	const L = printHingeLayout(p);
	const R = L.radius;
	const T = p.thickness;
	const parts: { a: Node[]; b: Node[]; cutA: Node[]; cutB: Node[] } = {
		a: [],
		b: [],
		cutA: [],
		cutB: []
	};
	// Leaves: A on −Y, B on +Y, each from the gap outwards.
	parts.a.push(translate([-p.length / 2, -L.gap - p.leaf, 0], cube([p.length, p.leaf, T])));
	parts.b.push(translate([-p.length / 2, L.gap, 0], cube([p.length, p.leaf, T])));
	for (const [x0, x1, ofA] of L.segments) {
		// The knuckle and a web from it to its own leaf.
		(ofA ? parts.a : parts.b).push(
			along(x0, x1, R, R),
			translate([x0, ofA ? -L.gap - 0.01 : 0, 0], cube([x1 - x0, L.gap + 0.01, T]))
		);
	}
	const wider = L.pin + p.clearance * Math.SQRT2;
	for (let i = 0; i < L.segments.length - 1; i++) {
		const [, x1, ofA] = L.segments[i];
		const [x0n] = L.segments[i + 1];
		// The pin grows out of an A knuckle into the B knuckle next to it.
		if (ofA) {
			parts.a.push(cone(x1 - 0.01, 1, L.pin, R));
			parts.cutB.push(cone(x1 - 0.01, 1, wider, R));
		} else {
			parts.a.push(cone(x0n + 0.01, -1, L.pin, R));
			parts.cutB.push(cone(x0n + 0.01, -1, wider, R));
		}
	}
	const spots = Array.from({ length: p.holes }, (_, i) =>
		p.holes === 1 ? 0 : -p.length / 2 + p.screw * 2 + ((p.length - p.screw * 4) * i) / (p.holes - 1)
	);
	const mid = L.gap + p.leaf / 2;
	for (const x of spots) {
		parts.cutA.push(countersunk(x, -mid, p.screw, T));
		parts.cutB.push(countersunk(x, mid, p.screw, T));
	}
	return {
		a: difference(union(...parts.a), ...parts.cutA),
		b: difference(union(...parts.b), ...parts.cutB)
	};
}

export function printHingeModel(input: PrintHingeParams): Node {
	const p = clampPrintHinge(input);
	const { a, b } = printHingeParts(p);
	const one = union(a, b);
	const L = printHingeLayout(p);
	const pitch = 2 * (L.gap + p.leaf) + 6;
	return union(...Array.from({ length: p.count }, (_, i) => translate([0, i * pitch, 0], one)));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function printHingeSummary(input: PrintHingeParams): string {
	const p = clampPrintHinge(input);
	const L = printHingeLayout(p);
	return m.t_print_hinge_summary({
		count: p.knuckles,
		n: num(p.knuckles),
		length: mm(p.length),
		width: mm(2 * (L.gap + p.leaf)),
		gap: mm(p.clearance)
	});
}

export function printHingeHeader(input: PrintHingeParams): string[] {
	const p = clampPrintHinge(input);
	return [m.t_print_hinge_header_title(), printHingeSummary(p)];
}

export function printHingeScad(p: PrintHingeParams): string {
	return toScad(printHingeModel(p), printHingeHeader(p));
}
