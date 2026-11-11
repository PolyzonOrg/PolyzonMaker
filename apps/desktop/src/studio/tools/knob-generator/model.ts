/**
 * Knobs for a bolt, a nut or a shaft: a star knob for a clamp, a wing for a
 * thumbscrew, a knurled one for a dial. What holds the knob on: a hex pocket
 * for a nut or a bolt head pressed in from below, a printed thread, or a
 * D-shaft (6 mm, as on potentiometers and encoders).
 * The knob stands on its bottom, as it prints; the pocket opens at the bed.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	hull,
	offset,
	part,
	polygon,
	rotate,
	square,
	taperExtrude,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/knob-generator';
import { METRIC, METRIC_SIZES } from '../bolt-generator/model';
import { threadedHole } from '../shared/thread';
import { clamp as c } from '../shared/math';

export type KnobShape = 'star' | 'wing' | 'knurled' | 'round';
export type KnobInsert = 'nut' | 'head' | 'thread' | 'dshaft' | 'none';

export interface KnobParams {
	shape: KnobShape;
	diameter: number;
	height: number;
	/** Lobes of a star knob */
	lobes: number;
	insert: KnobInsert;
	/** M3…M12 for a nut, a bolt head or a thread */
	size: string;
	/** D-shaft: diameter and the flat's distance from the far side */
	shaft: number;
	flat: number;
	/** Play in the pocket or the thread, mm */
	clearance: number;
	/** A groove on top that shows the position. */
	pointer: boolean;
}

export const KNOB_DEFAULTS: KnobParams = {
	shape: 'star',
	diameter: 40,
	height: 16,
	lobes: 5,
	insert: 'nut',
	size: 'M8',
	shaft: 6,
	flat: 4.5,
	clearance: 0.25,
	pointer: false
};

export const KNOB_SIZES = METRIC_SIZES.filter((s) => METRIC[s].d <= 12);

export interface KnobPreset {
	id: string;
	label: string;
	params: Partial<KnobParams>;
}

export const KNOB_PRESETS: readonly KnobPreset[] = [
	{
		id: 'clamp',
		get label() {
			return m.t_knob_generator_preset_clamp();
		},
		params: { shape: 'star', diameter: 45, lobes: 5, insert: 'nut', size: 'M8' }
	},
	{
		id: 'thumb',
		get label() {
			return m.t_knob_generator_preset_thumb();
		},
		params: { shape: 'wing', diameter: 42, height: 20, insert: 'head', size: 'M6' }
	},
	{
		id: 'pot',
		get label() {
			return m.t_knob_generator_preset_pot();
		},
		params: { shape: 'knurled', diameter: 22, height: 14, insert: 'dshaft', pointer: true }
	},
	{
		id: 'print',
		get label() {
			return m.t_knob_generator_preset_print();
		},
		params: { shape: 'star', diameter: 50, lobes: 6, height: 18, insert: 'thread', size: 'M10' }
	}
];

export function clampKnob(p: KnobParams): KnobParams {
	const shapes: KnobShape[] = ['star', 'wing', 'knurled', 'round'];
	const inserts: KnobInsert[] = ['nut', 'head', 'thread', 'dshaft', 'none'];
	const shaft = c(p.shaft, 2, 12);
	const q: KnobParams = {
		shape: shapes.includes(p.shape) ? p.shape : 'star',
		diameter: c(p.diameter, 12, 120),
		height: c(p.height, 6, 60),
		lobes: Math.round(c(p.lobes, 3, 10)),
		insert: inserts.includes(p.insert) ? p.insert : 'nut',
		size: KNOB_SIZES.includes(p.size) ? p.size : 'M8',
		shaft,
		flat: c(p.flat, shaft * 0.5, shaft),
		clearance: c(p.clearance, 0, 1),
		pointer: !!p.pointer
	};
	// Never so small that the nut pocket breaks through the rim.
	return { ...q, diameter: Math.max(q.diameter, knobMinDiameter(q)) };
}

/** The smallest knob round its pocket: 3 mm of wall past the deepest ridge. */
export function knobMinDiameter(p: KnobParams): number {
	return Math.ceil(2 * (pocketRadius(p) + 3.1));
}

const FN = 64;
const COS30 = Math.cos(Math.PI / 6);

/** How far the pocket, the thread or the shaft reaches from the axis, mm. */
function pocketRadius(p: KnobParams): number {
	const m = METRIC[p.size];
	if (p.insert === 'nut' || p.insert === 'head') return (m.s + 2 * p.clearance) / COS30 / 2;
	if (p.insert === 'thread') return m.d / 2 + p.clearance;
	if (p.insert === 'dshaft') return p.shaft / 2 + p.clearance;
	return 0;
}

/** The outline seen from above (star, knurled, round); the wing is built apart. */
function outline(p: KnobParams): Node {
	const R = p.diameter / 2;
	if (p.shape === 'star') {
		// Lobes on a ring, the hollows between them rounded off.
		const n = p.lobes;
		const lobe = Math.min(R * 0.32, R * Math.sin(Math.PI / n) * 0.8);
		const lobes = Array.from({ length: n }, (_, i) => {
			const a = (2 * Math.PI * i) / n;
			return translate([(R - lobe) * Math.cos(a), (R - lobe) * Math.sin(a)], circle(lobe, 40));
		});
		return offset(
			-lobe * 0.35,
			32,
			offset(
				lobe * 0.35,
				32,
				union(circle(Math.max(R * 0.45, pocketRadius(p) + 2.5), FN), ...lobes)
			)
		);
	}
	if (p.shape === 'knurled') {
		// Fine V-ridges every ~2 mm of the rim, 0.6 mm deep.
		const ridges = Math.max(18, Math.round((Math.PI * p.diameter) / 2));
		const pts: [number, number][] = [];
		for (let i = 0; i < ridges * 2; i++) {
			const a = (Math.PI * i) / ridges;
			const r = i % 2 === 0 ? R : R - 0.6;
			pts.push([r * Math.cos(a), r * Math.sin(a)]);
		}
		return polygon(pts);
	}
	return circle(R, FN);
}

/** The outline extruded, its top edge eased: the last ~1.5 mm shrink towards the centre. */
function body(p: KnobParams): Node {
	const ch = Math.min(1.5, p.height / 6);
	const shape = outline(p);
	return union(
		extrude(p.height - ch, shape),
		translate(
			[0, 0, p.height - ch - 0.001],
			taperExtrude(ch + 0.001, 1 - (2 * ch) / p.diameter, shape)
		)
	);
}

/** A wing knob: a hub with a rounded wing across it, standing up. */
function wing(p: KnobParams): Node {
	const hub = Math.max(p.diameter * 0.34, METRIC[p.size].s + 5);
	const t = Math.max(4, p.diameter * 0.14);
	const R = p.diameter / 2;
	const top = p.height;
	// The wing in the XZ plane: wide at the top, narrowing into the hub.
	// Two wings rising from the hub, a dip between them for the thumb.
	const tip = top * 0.35;
	const base = translate([0, 1], square(hub, 2));
	const profile = union(
		hull(base, translate([R - tip, top - tip], circle(tip, 40))),
		hull(base, translate([-(R - tip), top - tip], circle(tip, 40)))
	);
	return union(
		cylinder(Math.min(top, hub * 0.9), hub / 2, hub / 2, FN),
		translate([0, t / 2, 0], rotate([90, 0, 0], extrude(t, profile)))
	);
}

/** What is cut from below: the pocket and the hole, or the thread, or the D. */
function insert(p: KnobParams): Node | null {
	const m = METRIC[p.size];
	const through = translate([0, 0, -1], cylinder(p.height + 2, m.d / 2 + 0.3, m.d / 2 + 0.3, 40));
	switch (p.insert) {
		case 'nut':
		case 'head': {
			const depth = Math.min(p.height - 2, p.insert === 'nut' ? m.m + 0.4 : m.k + 0.4);
			const e = (m.s + 2 * p.clearance) / COS30;
			const pocket = translate([0, 0, -0.01], cylinder(depth, e / 2, e / 2, 6));
			// A captive bolt head: the shank leaves at the bottom, nothing passes above.
			return p.insert === 'nut' ? union(pocket, through) : pocket;
		}
		case 'thread':
			return threadedHole({ major: m.d, pitch: m.pitch, profile: 'iso' }, p.height, p.clearance);
		case 'dshaft': {
			const d = p.shaft + 2 * p.clearance;
			const depth = p.height - 2;
			const D = difference(
				circle(d / 2, 40),
				translate([p.flat + 2 * p.clearance - d / 2, -d], square(d, 2 * d, false))
			);
			return translate([0, 0, -0.01], extrude(depth, D));
		}
		default:
			return null;
	}
}

export function knobModel(input: KnobParams): Node {
	const p = clampKnob(input);
	const solid = p.shape === 'wing' ? wing(p) : body(p);
	const groove =
		p.pointer && p.shape !== 'wing'
			? translate([p.diameter / 4, 0, p.height - 0.8], cube3(p.diameter / 2 + 1, 1.6, 2))
			: null;
	return part('knob', difference(solid, insert(p), groove));
}

/** A box centred across Y, starting at x = −len/2 (a groove from the middle out). */
function cube3(len: number, w: number, h: number): Node {
	return translate([-len / 2, -w / 2, 0], extrude(h, square(len, w, false)));
}

const SHAPE_WORDS: Record<KnobShape, () => string> = {
	star: m.t_knob_generator_scad_shape_star,
	wing: m.t_knob_generator_scad_shape_wing,
	knurled: m.t_knob_generator_scad_shape_knurled,
	round: m.t_knob_generator_scad_shape_round
};
const mm = (v: number) => num(v, 4);

export function knobHeader(input: KnobParams): string[] {
	const p = clampKnob(input);
	return [
		m.t_knob_generator_scad_title({
			shape: SHAPE_WORDS[p.shape](),
			diameter: mm(p.diameter),
			height: mm(p.height)
		}),
		knobSummary(p),
		m.t_knob_generator_scad_print()
	];
}

export function knobScad(p: KnobParams): string {
	return toScad(knobModel(p), knobHeader(p));
}

export function knobSummary(input: KnobParams): string {
	const p = clampKnob(input);
	const metric = METRIC[p.size];
	switch (p.insert) {
		case 'nut':
			return m.t_knob_generator_summary_nut({ size: p.size, wrench: mm(metric.s) });
		case 'head':
			return m.t_knob_generator_summary_head({ size: p.size });
		case 'thread':
			return m.t_knob_generator_summary_thread({ size: p.size, pitch: mm(metric.pitch) });
		case 'dshaft':
			return m.t_knob_generator_summary_dshaft({ shaft: mm(p.shaft), flat: mm(p.flat) });
		default:
			return m.t_knob_generator_summary_none();
	}
}
