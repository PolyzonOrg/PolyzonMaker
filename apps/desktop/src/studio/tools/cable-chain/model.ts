/**
 * A cable chain (drag chain) for a printer or a CNC: links that snap on to
 * each other, or a whole chain printed already assembled.
 *
 * A link (x along the chain, y across, z up; the bottom on the bed): two side
 * plates with round ends round the pivots, at x = 0 and x = pitch. At the
 * front the plates sit inside (with pins pointing out), at the back outside
 * (with holes); a joggle in the middle steps between the two. The next
 * link's back fits over this one's front. With pitch = height + 4 the
 * neighbour's round ends never reach the joggle or the cross bars, however
 * the chain bends.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	hull,
	part,
	rotate,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/cable-chain';
import { clamp as c } from '../shared/math';

export interface CableChainParams {
	/** Room inside for the cables, mm */
	innerWidth: number;
	innerHeight: number;
	plate: number;
	links: number;
	/** Print the chain assembled (pins already in the holes), not as loose links. */
	assembled: boolean;
	/** Play round the pins, mm */
	clearance: number;
}

export const CABLE_CHAIN_DEFAULTS: CableChainParams = {
	innerWidth: 15,
	innerHeight: 10,
	plate: 2,
	links: 10,
	assembled: false,
	clearance: 0.2
};

export interface CableChainPreset {
	id: string;
	label: string;
	params: Partial<CableChainParams>;
}

export const CABLE_CHAIN_PRESETS: readonly CableChainPreset[] = [
	{
		id: 'x',
		get label() {
			return m.t_cable_chain_preset_x();
		},
		params: { innerWidth: 15, innerHeight: 10, links: 20 }
	},
	{
		id: 'bed',
		get label() {
			return m.t_cable_chain_preset_bed();
		},
		params: { innerWidth: 25, innerHeight: 10, links: 14 }
	},
	{
		id: 'cnc',
		get label() {
			return m.t_cable_chain_preset_cnc();
		},
		params: { innerWidth: 30, innerHeight: 15, plate: 2.4, links: 16 }
	},
	{
		id: 'pip',
		get label() {
			return m.t_cable_chain_preset_assembled();
		},
		params: { innerWidth: 15, innerHeight: 10, links: 8, assembled: true, clearance: 0.35 }
	}
];

export function clampCableChain(p: CableChainParams): CableChainParams {
	return {
		innerWidth: c(p.innerWidth, 5, 80),
		innerHeight: c(p.innerHeight, 5, 40),
		plate: c(p.plate, 1.6, 4),
		links: Math.round(c(p.links, 1, 60)),
		assembled: !!p.assembled,
		// Printed together, the pins need more room not to fuse.
		clearance: c(p.clearance, p.assembled ? 0.3 : 0.1, 0.6)
	};
}

const BAR = 2;
/** Between neighbouring links' plates, mm: more when printed together, so they do not fuse. */
const SIDE = 0.3;
const SIDE_ASSEMBLED = 0.5;

export interface CableChainLayout {
	height: number;
	pitch: number;
	/** Across the outer plates, mm */
	width: number;
	pin: number;
	/** How far apart loose links are laid on the bed */
	spacing: number;
	/** Gap between neighbouring links' plates */
	side: number;
}

export function cableChainLayout(input: CableChainParams): CableChainLayout {
	const p = clampCableChain(input);
	const height = p.innerHeight + 2 * BAR;
	const side = p.assembled ? SIDE_ASSEMBLED : SIDE;
	return {
		height,
		pitch: height + 4,
		width: p.innerWidth + 2 * (2 * p.plate + side),
		pin: Math.min(height / 4, 3),
		spacing: p.innerWidth + 2 * (2 * p.plate + side) + 4,
		side
	};
}

/** One link, its back pivot at x = 0. */
function link(p: CableChainParams, L: CableChainLayout): Node {
	const H = L.height;
	const t = p.plate;
	const half = p.innerWidth / 2;
	const r = H / 2;
	const mid = L.pitch / 2;
	// The plate in XZ: round ends round both pivots.
	const back = hull(translate([0, r], circle(r, 48)), translate([mid, r], square(0.01, H)));
	const front = hull(translate([mid, r], square(0.01, H)), translate([L.pitch, r], circle(r, 48)));
	const plateAt = (y0: number, thick: number, profile: Node) =>
		translate([0, y0 + thick, 0], rotate([90, 0, 0], extrude(thick, profile)));
	// The joggle: a short stretch as thick as both plates.
	const jog = (L.pitch - H) / 2 - 0.3;
	const joggle = translate([mid, r], square(2 * jog, H));
	const pieces: Node[] = [];
	for (const s of [-1, 1]) {
		const inner = s > 0 ? half : -half - t;
		const outer = s > 0 ? half + t + L.side : -half - 2 * t - L.side;
		pieces.push(
			plateAt(outer, t, back),
			plateAt(inner, t, front),
			plateAt(Math.min(inner, outer), 2 * t + L.side, joggle)
		);
		// The pin: out of the front plate into the next link's back plate, its tip chamfered.
		const pin = translate(
			[L.pitch, s > 0 ? half + t - 0.01 : -half - t + 0.01, r],
			rotate(
				[s > 0 ? -90 : 90, 0, 0],
				union(
					cylinder(L.side + t * 0.6, L.pin, L.pin, 32),
					translate([0, 0, L.side + t * 0.6 - 0.01], cylinder(t * 0.4, L.pin, L.pin * 0.6, 32))
				)
			)
		);
		pieces.push(pin);
	}
	// Cross bars, top and bottom, in the middle where no neighbour reaches.
	const barLen = 2 * jog;
	const bars = [0, H - BAR].map((z) =>
		translate(
			[mid - barLen / 2, -half - t, z],
			extrude(BAR, translate([barLen / 2, half + t], square(barLen, p.innerWidth + 2 * t)))
		)
	);
	const holes = [-1, 1].map((s) =>
		translate(
			[0, s > 0 ? half + t + L.side - 1 : -half - 2 * t - L.side - 1, r],
			rotate([-90, 0, 0], cylinder(t + 2, L.pin + p.clearance, L.pin + p.clearance, 32))
		)
	);
	return difference(union(...pieces, ...bars), ...holes);
}

export function cableChainModel(input: CableChainParams): Node {
	const p = clampCableChain(input);
	const L = cableChainLayout(p);
	const one = link(p, L);
	if (p.assembled)
		return part(
			'chain',
			union(...Array.from({ length: p.links }, (_, i) => translate([i * L.pitch, 0, 0], one)))
		);
	// Loose links in rows, a little apart.
	const perRow = Math.ceil(Math.sqrt(p.links));
	const step = L.pitch + L.height + 4;
	return part(
		'links',
		union(
			...Array.from({ length: p.links }, (_, i) =>
				translate([(i % perRow) * step, Math.floor(i / perRow) * L.spacing, 0], one)
			)
		)
	);
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);
const links = (n: number) => m.t_cable_chain_links_count({ count: n, n: num(n) });

export function cableChainSummary(input: CableChainParams): string {
	const p = clampCableChain(input);
	const L = cableChainLayout(p);
	const values = {
		links: links(p.links),
		pitch: mm(L.pitch),
		length: mm(p.links * L.pitch),
		width: mm(p.innerWidth),
		height: mm(p.innerHeight)
	};
	const text = p.assembled
		? m.t_cable_chain_summary_assembled(values)
		: m.t_cable_chain_summary_loose(values);
	// Printed together, the chain lies in one straight row: say when a usual bed is too short.
	const long = p.links * L.pitch + L.height;
	if (!(p.assembled && long > 220)) return text;
	const bed = m.t_cable_chain_summary_bed({
		length: mm(long),
		links: links(Math.floor((220 - L.height) / L.pitch))
	});
	return text + sentenceGap(currentLocale()) + bed;
}

export function cableChainHeader(input: CableChainParams): string[] {
	const p = clampCableChain(input);
	return [m.t_cable_chain_scad_title(), cableChainSummary(p), m.t_cable_chain_scad_print()];
}

export function cableChainScad(p: CableChainParams): string {
	return toScad(cableChainModel(p), cableChainHeader(p));
}
