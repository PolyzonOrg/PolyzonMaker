/**
 * Bolts, nuts, washers, spacers and threaded rods on the ISO metric thread.
 * Sizes from the open standards: ISO 261 (pitches), ISO 4017 / 4762 / 10642
 * (hex, socket cap and countersunk heads), ISO 4032 (nuts), ISO 7089
 * (washers). Everything stands as it prints: heads and nuts on the bed.
 */
import {
	cylinder,
	difference,
	extrude,
	intersection,
	part,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '../scad-literals';
import { clearanceHole, ring, threadedHole, threadedRod, type Thread } from '../shared/thread';
import { num as fmt } from '$lib/i18n/current';
import * as m from '$msg/tools/bolt-generator';
import { clamp as c } from '../shared/math';
import { ownKey } from '$lib/own';

export type BoltKind = 'bolt' | 'nut' | 'pair' | 'washer' | 'spacer' | 'rod';
export type HeadKind = 'hex' | 'socket' | 'countersunk';
export type SpacerShape = 'round' | 'hex';

export interface BoltParams {
	kind: BoltKind;
	/** «M8» etc., or «custom» for `diameter` × `pitch` */
	size: string;
	diameter: number;
	pitch: number;
	/** Fine pitch instead of the coarse one (M8 and up). */
	fine: boolean;
	head: HeadKind;
	/** Thread length of a bolt, length of a rod or a spacer, mm */
	length: number;
	/** Play between a printed nut and a printed bolt, mm; each takes half */
	clearance: number;
	spacerShape: SpacerShape;
	spacerOuter: number;
	washerThickness: number;
}

interface MetricSize {
	d: number;
	pitch: number;
	fine?: number;
	/** Across flats of a hex head and a nut */
	s: number;
	/** Hex head height */
	k: number;
	/** Socket cap: head diameter, socket key */
	dk: number;
	key: number;
	/** Countersunk head: socket key */
	ckey: number;
	/** Nut height */
	m: number;
	/** Washer: outer diameter, hole, thickness */
	w: [number, number, number];
}

export const METRIC: Readonly<Record<string, MetricSize>> = {
	M3: { d: 3, pitch: 0.5, s: 5.5, k: 2, dk: 5.5, key: 2.5, ckey: 2, m: 2.4, w: [7, 3.2, 0.5] },
	M4: { d: 4, pitch: 0.7, s: 7, k: 2.8, dk: 7, key: 3, ckey: 2.5, m: 3.2, w: [9, 4.3, 0.8] },
	M5: { d: 5, pitch: 0.8, s: 8, k: 3.5, dk: 8.5, key: 4, ckey: 3, m: 4.7, w: [10, 5.3, 1] },
	M6: { d: 6, pitch: 1, s: 10, k: 4, dk: 10, key: 5, ckey: 4, m: 5.2, w: [12, 6.4, 1.6] },
	M8: {
		d: 8,
		pitch: 1.25,
		fine: 1,
		s: 13,
		k: 5.3,
		dk: 13,
		key: 6,
		ckey: 5,
		m: 6.8,
		w: [16, 8.4, 1.6]
	},
	M10: {
		d: 10,
		pitch: 1.5,
		fine: 1.25,
		s: 16,
		k: 6.4,
		dk: 16,
		key: 8,
		ckey: 6,
		m: 8.4,
		w: [20, 10.5, 2]
	},
	M12: {
		d: 12,
		pitch: 1.75,
		fine: 1.5,
		s: 18,
		k: 7.5,
		dk: 18,
		key: 10,
		ckey: 8,
		m: 10.8,
		w: [24, 13, 2.5]
	},
	M14: {
		d: 14,
		pitch: 2,
		fine: 1.5,
		s: 21,
		k: 8.8,
		dk: 21,
		key: 12,
		ckey: 10,
		m: 12.8,
		w: [28, 15, 2.5]
	},
	M16: {
		d: 16,
		pitch: 2,
		fine: 1.5,
		s: 24,
		k: 10,
		dk: 24,
		key: 14,
		ckey: 10,
		m: 14.8,
		w: [30, 17, 3]
	},
	M20: {
		d: 20,
		pitch: 2.5,
		fine: 1.5,
		s: 30,
		k: 12.5,
		dk: 30,
		key: 17,
		ckey: 12,
		m: 18,
		w: [37, 21, 3]
	},
	M24: {
		d: 24,
		pitch: 3,
		fine: 2,
		s: 36,
		k: 15,
		dk: 36,
		key: 19,
		ckey: 14,
		m: 21.5,
		w: [44, 25, 4]
	},
	M30: {
		d: 30,
		pitch: 3.5,
		fine: 2,
		s: 46,
		k: 18.7,
		dk: 45,
		key: 22,
		ckey: 17,
		m: 25.6,
		w: [56, 31, 4]
	}
};
export const METRIC_SIZES = Object.keys(METRIC);

export const BOLT_DEFAULTS: BoltParams = {
	kind: 'bolt',
	size: 'M10',
	diameter: 40,
	pitch: 3,
	fine: false,
	head: 'hex',
	length: 30,
	clearance: 0.3,
	spacerShape: 'round',
	spacerOuter: 16,
	washerThickness: 2
};

export interface BoltPreset {
	id: string;
	label: string;
	params: Partial<BoltParams>;
}

export const BOLT_PRESETS: readonly BoltPreset[] = [
	{
		id: 'm8-bolt',
		get label() {
			return m.t_bolt_generator_preset_m8_bolt();
		},
		params: { kind: 'bolt', size: 'M8', head: 'hex', length: 30 }
	},
	{
		id: 'm10-pair',
		get label() {
			return m.t_bolt_generator_preset_m10_pair();
		},
		params: { kind: 'pair', size: 'M10', head: 'hex', length: 40 }
	},
	{
		id: 'm12-socket',
		get label() {
			return m.t_bolt_generator_preset_m12_socket();
		},
		params: { kind: 'bolt', size: 'M12', head: 'socket', length: 35 }
	},
	{
		id: 'm16-nut',
		get label() {
			return m.t_bolt_generator_preset_m16_nut();
		},
		params: { kind: 'nut', size: 'M16' }
	},
	{
		id: 'm6-rod',
		get label() {
			return m.t_bolt_generator_preset_m6_rod();
		},
		params: { kind: 'rod', size: 'M6', length: 60 }
	},
	{
		id: 'm8-washer',
		get label() {
			return m.t_bolt_generator_preset_m8_washer();
		},
		params: { kind: 'washer', size: 'M8', washerThickness: 2 }
	},
	{
		id: 'spacer',
		get label() {
			return m.t_bolt_generator_preset_spacer();
		},
		params: { kind: 'spacer', size: 'M5', length: 10, spacerOuter: 9, spacerShape: 'hex' }
	}
];

/** The sizes for a custom diameter, scaled the way the standard ones grow. */
function customSize(d: number, pitch: number): MetricSize {
	const r1 = (v: number) => Math.round(v * 10) / 10;
	return {
		d,
		pitch,
		s: r1(1.5 * d + 1),
		k: r1(0.62 * d),
		dk: r1(1.5 * d),
		key: r1(0.75 * d),
		ckey: r1(0.6 * d),
		m: r1(0.84 * d),
		w: [r1(2 * d + 1), r1(d * 1.06), r1(Math.max(1, 0.15 * d))]
	};
}

export function clampBolt(p: BoltParams): BoltParams {
	const kinds: BoltKind[] = ['bolt', 'nut', 'pair', 'washer', 'spacer', 'rod'];
	const heads: HeadKind[] = ['hex', 'socket', 'countersunk'];
	const size = p.size === 'custom' || ownKey(METRIC, p.size) ? p.size : 'M10';
	const diameter = c(p.diameter, 3, 120);
	return {
		kind: kinds.includes(p.kind) ? p.kind : 'bolt',
		size,
		diameter,
		pitch: c(p.pitch, 0.5, Math.max(0.5, diameter / 4)),
		fine: !!p.fine,
		head: heads.includes(p.head) ? p.head : 'hex',
		length: c(p.length, 2, 300),
		clearance: c(p.clearance, 0, 1),
		spacerShape: p.spacerShape === 'hex' ? 'hex' : 'round',
		spacerOuter: c(p.spacerOuter, 4, 150),
		washerThickness: c(p.washerThickness, 0.4, 20)
	};
}

/** The standard (or custom) sizes and the thread the parameters describe. */
export function boltSpec(input: BoltParams): { size: MetricSize; thread: Thread; name: string } {
	const p = clampBolt(input);
	const size = p.size === 'custom' ? customSize(p.diameter, p.pitch) : METRIC[p.size];
	const pitch = p.size !== 'custom' && p.fine && size.fine ? size.fine : size.pitch;
	const label = p.size === 'custom' ? `M${num(size.d, 0, 1e3)}` : p.size;
	return {
		size,
		thread: { major: size.d, pitch, profile: 'iso' },
		name: `${label} × ${dec(pitch)}`
	};
}

/** A size as text: the language's decimal mark, up to 4 decimals. */
const dec = (v: number) => fmt(v, 4);

const FN = 64;
const COS30 = Math.cos(Math.PI / 6);

/** A hex prism `s` across flats, its edges chamfered at 30° top and bottom. */
function hexPrism(s: number, h: number): Node {
	const e = s / COS30;
	const prism = cylinder(h, e / 2, e / 2, 6);
	// The classic chamfer: a cone through 0.95·s at the faces.
	const flare = (e / 2 - 0.475 * s) / Math.tan(Math.PI / 6);
	const t = Math.min(h / 2, flare);
	const cone = union(
		cylinder(t, 0.475 * s, 0.475 * s + t * Math.tan(Math.PI / 3), FN),
		translate([0, 0, t - 0.001], cylinder(Math.max(0.002, h - 2 * t + 0.002), e, e, FN)),
		translate([0, 0, h - t], cylinder(t, 0.475 * s + t * Math.tan(Math.PI / 3), 0.475 * s, FN))
	);
	return intersection(prism, cone);
}

/** A hex socket for a key, open at the bed (z = 0), `depth` deep. */
function hexSocket(key: number, depth: number, play: number): Node {
	const e = (key + play) / COS30;
	return translate([0, 0, -0.01], cylinder(depth + 0.01, e / 2, e / 2, 6));
}

/** The head of a bolt, its face on the bed; returns the node and its height. */
function head(p: BoltParams, size: MetricSize): { node: Node; height: number } {
	if (p.head === 'socket') {
		const node = difference(
			cylinder(size.d, size.dk / 2, size.dk / 2, FN),
			hexSocket(size.key, size.d * 0.6, 0.2)
		);
		return { node, height: size.d };
	}
	if (p.head === 'countersunk') {
		const dk = Math.min(2 * size.d, size.d + 18);
		const h = (dk - size.d) / 2;
		// 90° cone: wide face on the bed, narrowing into the shank.
		const node = difference(
			cylinder(h, dk / 2, size.d / 2, FN),
			hexSocket(size.ckey, Math.min(h * 0.9, size.d * 0.5), 0.2)
		);
		return { node, height: h };
	}
	return { node: hexPrism(size.s, size.k), height: size.k };
}

function bolt(p: BoltParams): Node {
	const { size, thread } = boltSpec(p);
	const h = head(p, size);
	return union(
		h.node,
		translate(
			[0, 0, h.height - 0.01],
			threadedRod(thread, p.length + 0.01, { chamferTop: true, grow: -p.clearance / 2 })
		)
	);
}

function nut(p: BoltParams): Node {
	const { size, thread } = boltSpec(p);
	// Half the clearance here, half off the bolt: either fits metal hardware too.
	return difference(hexPrism(size.s, size.m), threadedHole(thread, size.m, p.clearance / 2));
}

export function boltModel(input: BoltParams): Node {
	const p = clampBolt(input);
	const { size, thread } = boltSpec(p);
	switch (p.kind) {
		case 'nut':
			return part('nut', nut(p));
		case 'pair': {
			// Side by side on the bed, a gap between.
			const gap = size.s / 2 + Math.max(size.s, size.dk) / 2 + 6;
			return union(
				part('bolt', translate([-gap / 2, 0, 0], bolt(p))),
				part('nut', translate([gap / 2, 0, 0], nut(p)))
			);
		}
		case 'washer': {
			const [outer, hole] = size.w;
			return part('washer', extrude(p.washerThickness, ring(outer, hole + p.clearance)));
		}
		case 'spacer': {
			const outer = Math.max(p.spacerOuter, size.d + 2);
			const body =
				p.spacerShape === 'hex'
					? cylinder(p.length, outer / COS30 / 2, outer / COS30 / 2, 6)
					: cylinder(p.length, outer / 2, outer / 2, FN);
			return part('spacer', difference(body, clearanceHole(size.d, p.length, p.clearance)));
		}
		case 'rod':
			return part(
				'rod',
				threadedRod(thread, p.length, {
					chamferBottom: true,
					chamferTop: true,
					grow: -p.clearance / 2
				})
			);
		default:
			return part('bolt', bolt(p));
	}
}

const SCAD_TITLES: Record<BoltKind, (inputs: { name: string }) => string> = {
	bolt: m.t_bolt_generator_scad_title_bolt,
	nut: m.t_bolt_generator_scad_title_nut,
	pair: m.t_bolt_generator_scad_title_pair,
	washer: m.t_bolt_generator_scad_title_washer,
	spacer: m.t_bolt_generator_scad_title_spacer,
	rod: m.t_bolt_generator_scad_title_rod
};

export function boltHeader(input: BoltParams): string[] {
	const p = clampBolt(input);
	const { size, name } = boltSpec(p);
	const lines: string[] = [SCAD_TITLES[p.kind]({ name })];
	if (p.kind === 'bolt' || p.kind === 'pair' || p.kind === 'rod')
		lines.push(
			m.t_bolt_generator_scad_thread({
				length: num(p.length, 0, 1e4),
				clearance: num(p.clearance, 0, 10)
			})
		);
	// A wrench fits a hex head or a nut; socket and countersunk heads take a hex key.
	if (p.kind === 'nut' || p.kind === 'pair' || (p.kind === 'bolt' && p.head === 'hex')) {
		const key = num(size.s, 0, 1e3);
		lines.push(
			p.kind === 'bolt'
				? m.t_bolt_generator_scad_head_key({ key })
				: m.t_bolt_generator_scad_nut_key({ key })
		);
	}
	lines.push(m.t_bolt_generator_scad_print());
	return lines;
}

export function boltScad(p: BoltParams): string {
	return toScad(boltModel(p), boltHeader(p));
}

/** One line under the form: what comes out. */
export function boltSummary(input: BoltParams): string {
	const p = clampBolt(input);
	const { size, name } = boltSpec(p);
	const key = dec(size.s);
	const length = dec(p.length);
	switch (p.kind) {
		case 'nut':
			return m.t_bolt_generator_summary_nut({ name, height: dec(size.m), key });
		case 'pair':
			return m.t_bolt_generator_summary_pair({ name, length, key });
		case 'washer':
			return m.t_bolt_generator_summary_washer({
				size: name.split(' ')[0],
				outer: dec(size.w[0]),
				hole: dec(size.w[1] + p.clearance)
			});
		case 'spacer':
			return m.t_bolt_generator_summary_spacer({ size: name.split(' ')[0], length });
		case 'rod':
			return m.t_bolt_generator_summary_rod({ name, length });
		default:
			return p.head === 'hex'
				? m.t_bolt_generator_summary_bolt_hex({ name, length, key })
				: m.t_bolt_generator_summary_bolt({ name, length });
	}
}
