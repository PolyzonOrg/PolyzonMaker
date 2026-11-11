/**
 * Holders for cables, sized to the cable:
 * - saddle — a strap over one or several cables, two screws;
 * - tape — a snap ring on a pad for double-sided tape;
 * - comb — a row of snap slots, for a desk or a wall;
 * - desk — a clamp over the edge of a desk with a snap ring in front.
 * Each is a profile extruded across its width; it lies as it prints.
 */
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/cable-clip';
import {
	circle,
	cylinder,
	difference,
	extrude,
	offset,
	part,
	rotate,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { clamp as c } from '../shared/math';

export type ClipKind = 'saddle' | 'tape' | 'comb' | 'desk';

export interface CableClipParams {
	kind: ClipKind;
	/** Cable diameter, mm */
	cable: number;
	/** Cables side by side (saddle, comb) */
	count: number;
	/** Between neighbouring cables, mm */
	gap: number;
	/** Width across the cable, mm */
	width: number;
	thickness: number;
	/** Screw hole and head, mm */
	screw: number;
	head: number;
	/** Desk top thickness for the desk clamp, mm */
	desk: number;
	/** Play round the cable, mm */
	clearance: number;
}

export const CABLE_CLIP_DEFAULTS: CableClipParams = {
	kind: 'saddle',
	cable: 6,
	count: 1,
	gap: 2,
	width: 10,
	thickness: 2,
	screw: 3.5,
	head: 7,
	desk: 25,
	clearance: 0.3
};

export interface CableClipPreset {
	id: string;
	label: string;
	params: Partial<CableClipParams>;
}

export const CABLE_CLIP_PRESETS: readonly CableClipPreset[] = [
	{
		id: 'usb',
		get label() {
			return m.t_cable_clip_preset_usb();
		},
		params: { kind: 'tape', cable: 4, width: 12 }
	},
	{
		id: 'lan',
		get label() {
			return m.t_cable_clip_preset_lan();
		},
		params: { kind: 'saddle', cable: 6, count: 1 }
	},
	{
		id: 'pc',
		get label() {
			return m.t_cable_clip_preset_pc();
		},
		params: { kind: 'comb', cable: 5, count: 5, gap: 4, width: 8 }
	},
	{
		id: 'desk',
		get label() {
			return m.t_cable_clip_preset_desk();
		},
		params: { kind: 'desk', cable: 8, desk: 25, width: 15 }
	},
	{
		id: 'bundle',
		get label() {
			return m.t_cable_clip_preset_bundle();
		},
		params: { kind: 'saddle', cable: 5, count: 3, gap: 1 }
	}
];

export function clampCableClip(p: CableClipParams): CableClipParams {
	const kinds: ClipKind[] = ['saddle', 'tape', 'comb', 'desk'];
	const screw = c(p.screw, 2, 6);
	return {
		kind: kinds.includes(p.kind) ? p.kind : 'saddle',
		cable: c(p.cable, 2, 40),
		count: Math.round(c(p.count, 1, 12)),
		gap: c(p.gap, 0, 20),
		width: c(p.width, 4, 60),
		thickness: c(p.thickness, 1.2, 6),
		screw,
		head: c(p.head, screw + 1, 14),
		desk: c(p.desk, 5, 80),
		clearance: c(p.clearance, 0, 1.5)
	};
}

const FN = 64;

/** An open ring round a cable: the cable snaps in through a gap 0.75 of its size. */
function snapRing(p: CableClipParams, cx: number, cy: number): Node {
	const r = p.cable / 2 + p.clearance;
	const ring = difference(circle(r + p.thickness, FN), circle(r, FN));
	const mouth = 0.75 * p.cable;
	const gap = translate([0, r + p.thickness / 2], square(mouth, 2 * p.thickness + 1));
	// Rounded lips at the mouth: the edges a cable slides past.
	return translate([cx, cy], offset(0.4, 24, offset(-0.4, 24, difference(ring, gap))));
}

/** Bundle width: cables side by side with gaps between them. */
const bundle = (p: CableClipParams) =>
	p.count * (p.cable + 2 * p.clearance) + (p.count - 1) * p.gap;

function saddle(p: CableClipParams): Node {
	const t = p.thickness;
	const inner = bundle(p);
	const tall = p.cable + 2 * p.clearance;
	const tab = p.head + 4;
	// Profile in XZ, the bed at y = 0: two feet and an arch over the cables,
	// its top corners rounded, its feet square on the bed; extruded along Y.
	const outerW = inner + 2 * t;
	const outerH = tall + t;
	const arch = difference(
		union(
			translate([0, outerH / 2], rrect(outerW, outerH, Math.min(outerH / 2, 3), 32)),
			translate([0, outerH / 4], square(outerW, outerH / 2))
		),
		union(
			translate([0, tall / 2 - 0.5], rrect(inner, tall + 1, Math.min(tall / 2, 2), 32)),
			translate([0, tall / 4 - 0.5], square(inner, tall / 2 + 1))
		)
	);
	// Two feet beside the arch — nothing under the cable, it goes in from below.
	const feet = union(
		...[-1, 1].map((k) => translate([k * (outerW / 2 + tab / 2 - 0.5), t / 2], square(tab + 1, t)))
	);
	// The inside corners where the feet meet the arch rounded off.
	const profile = offset(-0.6, 16, offset(0.6, 16, union(arch, feet)));
	const holes = [-1, 1].map((s) =>
		translate([s * (inner / 2 + t + tab / 2), 0, -1], cylinder(t + 2, p.screw / 2, p.screw / 2, 32))
	);
	return difference(
		translate([0, p.width / 2, 0], rotate([90, 0, 0], extrude(p.width, profile))),
		...holes
	);
}

function tape(p: CableClipParams): Node {
	const r = p.cable / 2 + p.clearance;
	const pad = Math.max(p.cable + 2 * p.thickness + 6, 14);
	// The ring stands on a pad; the cable runs along X.
	// The ring's profile with the pad's top at y = 0: a neck, then the ring.
	const neck = 1.2;
	const ringProfile = union(
		snapRing(p, 0, neck + r + p.thickness),
		translate([0, (neck + p.thickness) / 2], square(r * 1.4, neck + p.thickness))
	);
	return union(
		extrude(1.6, rrect(p.width, pad, 2, 24)),
		translate([p.width / 2, 0, 1.59], rotate([90, 0, -90], extrude(p.width, ringProfile)))
	);
}

function comb(p: CableClipParams): Node {
	const t = p.thickness;
	const r = p.cable / 2 + p.clearance;
	const pitch = 2 * r + p.gap + 2 * t;
	const ends = p.head + 6;
	const length = p.count * pitch + 2 * ends;
	const depth = 2 * r + 2 * t + 4;
	// A plate seen from above: snap slots open towards +Y.
	const slots = Array.from({ length: p.count }, (_, i) => {
		const x = -length / 2 + ends + pitch * (i + 0.5);
		const y = depth / 2 - r - t;
		return union(
			translate([x, y], circle(r, FN)),
			translate([x, y + r], square(0.75 * p.cable, 2 * r + 2))
		);
	});
	// Screwed on by its back: the cables run along the wall or desk, not into it.
	const holes = [-1, 1].map((s) =>
		translate(
			[s * (length / 2 - ends / 2), -depth / 2 - 1, p.width / 2],
			rotate([-90, 0, 0], cylinder(depth + 2, p.screw / 2, p.screw / 2, 32))
		)
	);
	return difference(
		extrude(
			p.width,
			offset(0.5, 16, offset(-0.5, 16, difference(rrect(length, depth, 3, 24), ...slots)))
		),
		...holes
	);
}

function desk(p: CableClipParams): Node {
	const t = Math.max(p.thickness, 3);
	const H = p.desk + 0.3;
	const jaw = 18;
	// The clamp seen from the side (x into the desk, y up), printed on its side.
	const clamp = difference(
		translate([jaw / 2 - t, H / 2], square(jaw + t, H + 2 * t)),
		translate([jaw / 2 + 0.01, H / 2], square(jaw + 0.02, H))
	);
	// A little ridge under the top jaw grips the desk.
	const ridge = translate([jaw - 3, H - 0.6], circle(0.9, 16));
	const r = p.cable / 2 + p.clearance;
	// On the back wall's outside (it is 1.5 t thick), so the wall never fills the ring.
	const ring = snapRing(p, -1.5 * t - r - p.thickness + 0.5, H / 2);
	const profile = union(clamp, ridge, ring);
	return extrude(p.width, profile);
}

export function cableClipModel(input: CableClipParams): Node {
	const p = clampCableClip(input);
	switch (p.kind) {
		case 'tape':
			return part('clip', tape(p));
		case 'comb':
			return part('comb', comb(p));
		case 'desk':
			return part('clamp', desk(p));
		default:
			return part('saddle', saddle(p));
	}
}

const mm = (v: number) => num(v, 4);
function kindWord(kind: ClipKind): string {
	switch (kind) {
		case 'tape':
			return m.t_cable_clip_kind_tape();
		case 'comb':
			return m.t_cable_clip_kind_comb();
		case 'desk':
			return m.t_cable_clip_kind_desk();
		default:
			return m.t_cable_clip_kind_saddle();
	}
}

export function cableClipSummary(input: CableClipParams): string {
	const p = clampCableClip(input);
	const n = p.kind === 'saddle' || p.kind === 'comb' ? p.count : 1;
	const cable = mm(p.cable);
	// The desk clamp and the tape clip hold one cable.
	if (p.kind === 'desk') return m.t_cable_clip_summary_desk({ cable, desk: mm(p.desk) });
	if (p.kind === 'tape') return m.t_cable_clip_summary_tape({ cable });
	if (p.kind === 'comb')
		return n > 1
			? m.t_cable_clip_summary_comb_many({ count: n, n: num(n), cable })
			: m.t_cable_clip_summary_comb_one({ cable });
	const screw = mm(p.screw);
	return n > 1
		? m.t_cable_clip_summary_saddle_many({ count: n, n: num(n), cable, screw })
		: m.t_cable_clip_summary_saddle_one({ cable, screw });
}

export function cableClipHeader(input: CableClipParams): string[] {
	const p = clampCableClip(input);
	return [
		m.t_cable_clip_header_title({ kind: kindWord(p.kind) }),
		cableClipSummary(p),
		m.t_cable_clip_header_print()
	];
}

export function cableClipScad(p: CableClipParams): string {
	return toScad(cableClipModel(p), cableClipHeader(p));
}
