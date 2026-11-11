/**
 * End caps for profile and round tubes (ГОСТ 8639 / 8645 square and
 * rectangular, round furniture tubes) and furniture feet: a cap flush with
 * the tube's outside and a hollow plug that goes in, with barbed ribs that
 * flex and hold. A foot is a cap with a thicker sole (a pocket for felt is
 * optional). Printed cap down, plug up — no supports.
 */
import {
	circle,
	difference,
	extrude,
	loft,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/tube-cap';
import { clamp as c } from '../shared/math';

export type TubeProfile = 'square' | 'rect' | 'round';

export interface TubeCapParams {
	profile: TubeProfile;
	/** Outside of the tube: width (diameter of a round one) and height, mm */
	width: number;
	height: number;
	/** The tube's wall, mm */
	wall: number;
	/** How far the plug goes in, mm */
	depth: number;
	/** Thickness of the cap (the sole of a foot), mm */
	cap: number;
	/** A pocket under the sole for a felt pad */
	felt: boolean;
	/** Play between plug and tube, mm (the ribs hold anyway) */
	clearance: number;
	count: number;
}

export const TUBE_CAP_DEFAULTS: TubeCapParams = {
	profile: 'square',
	width: 20,
	height: 20,
	wall: 1.5,
	depth: 12,
	cap: 3,
	felt: false,
	clearance: 0.2,
	count: 4
};

export interface TubeCapPreset {
	id: string;
	label: string;
	params: Partial<TubeCapParams>;
}

export const TUBE_CAP_PRESETS: readonly TubeCapPreset[] = [
	{ id: 's20', label: '20 × 20', params: { profile: 'square', width: 20, height: 20 } },
	{ id: 's25', label: '25 × 25', params: { profile: 'square', width: 25, height: 25 } },
	{ id: 's40', label: '40 × 40', params: { profile: 'square', width: 40, height: 40, wall: 2 } },
	{ id: 'r4020', label: '40 × 20', params: { profile: 'rect', width: 40, height: 20 } },
	{ id: 'r6040', label: '60 × 40', params: { profile: 'rect', width: 60, height: 40, wall: 2 } },
	{
		id: 'round25',
		get label() {
			return m.t_tube_cap_preset_round();
		},
		params: { profile: 'round', width: 25, height: 25 }
	},
	{
		id: 'foot',
		get label() {
			return m.t_tube_cap_preset_foot();
		},
		params: { profile: 'square', width: 25, height: 25, cap: 6, felt: true }
	}
];

export function clampTubeCap(p: TubeCapParams): TubeCapParams {
	const profile: TubeProfile = p.profile === 'rect' || p.profile === 'round' ? p.profile : 'square';
	const width = c(p.width, 8, 120);
	const height = profile === 'rect' ? c(p.height, 8, 120) : width;
	return {
		profile,
		width,
		height,
		wall: c(p.wall, 0.8, Math.min(width, height) / 4),
		depth: c(p.depth, 4, 40),
		cap: c(p.cap, 1.6, 15),
		felt: !!p.felt,
		clearance: c(p.clearance, 0, 1),
		count: Math.round(c(p.count, 1, 16))
	};
}

/** How far a rib stands out of the plug, mm. */
const RIB = 0.5;
const PLUG_WALL = 1.6;

/** The tube's inside, mm. */
export function insideOf(p: TubeCapParams): [number, number] {
	return [p.width - 2 * p.wall, p.height - 2 * p.wall];
}

function section(p: TubeCapParams, w: number, h: number): Node {
	if (p.profile === 'round') return circle(w / 2, 64);
	// Profile tubes have rounded corners: about the wall's thickness inside.
	return rrect(w, h, Math.max(0.3, p.wall * 0.8), 24);
}

function cap(p: TubeCapParams): Node {
	const [iw, ih] = insideOf(p);
	const pw = iw - 2 * p.clearance;
	const ph = ih - 2 * p.clearance;
	// The cap: the tube's outside, its top edge rounded by a little chamfer.
	const ch = Math.min(1, p.cap / 3);
	const head = loft([
		{ z: 0, shape: section(p, p.width - 2 * ch, p.height - 2 * ch) },
		{ z: ch, shape: section(p, p.width, p.height) },
		{ z: p.cap, shape: section(p, p.width, p.height) }
	]);
	// Barbed ribs: rings that lean back, so the plug goes in and does not pull out.
	const ribs: Node[] = [];
	const step = 3;
	for (let z = p.cap + 2; z + step <= p.cap + p.depth - 0.5; z += step)
		ribs.push(
			loft([
				{ z, shape: section(p, pw + 2 * RIB, ph + 2 * RIB) },
				{ z: z + step * 0.8, shape: section(p, pw, ph) }
			])
		);
	// The plug's tip is narrower, to find the tube.
	const plug = loft([
		{ z: p.cap - 0.01, shape: section(p, pw, ph) },
		{ z: p.cap + p.depth - 1, shape: section(p, pw, ph) },
		{ z: p.cap + p.depth, shape: section(p, pw - 1.6, ph - 1.6) }
	]);
	const hollow = translate(
		[0, 0, p.cap + 0.8],
		extrude(
			p.depth + 1,
			section(p, Math.max(1, pw - 2 * PLUG_WALL), Math.max(1, ph - 2 * PLUG_WALL))
		)
	);
	const body = difference(union(head, plug, ...ribs), hollow);
	if (!p.felt) return body;
	// A 1 mm pocket for a felt pad, 2 mm in from the edge.
	const felt = translate([0, 0, -0.01], extrude(1.01, section(p, p.width - 4, p.height - 4)));
	return difference(body, felt);
}

export function tubeCapModel(input: TubeCapParams): Node {
	const p = clampTubeCap(input);
	const one = cap(p);
	const cols = Math.min(4, p.count);
	const gx = p.width + 6;
	const gy = p.height + 6;
	return union(
		...Array.from({ length: p.count }, (_, i) =>
			translate([(i % cols) * gx, -Math.floor(i / cols) * gy, 0], one)
		)
	);
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function tubeCapSummary(input: TubeCapParams): string {
	const p = clampTubeCap(input);
	const [iw, ih] = insideOf(p);
	const size = p.profile === 'round' ? `⌀ ${mm(p.width)}` : `${mm(p.width)} × ${mm(p.height)}`;
	const inside = p.profile === 'round' ? `⌀ ${mm(iw)}` : `${mm(iw)} × ${mm(ih)}`;
	return m.t_tube_cap_summary({
		count: p.count,
		n: num(p.count),
		size,
		inside,
		depth: mm(p.depth)
	});
}

export function tubeCapHeader(input: TubeCapParams): string[] {
	const p = clampTubeCap(input);
	return [m.t_tube_cap_scad_title(), tubeCapSummary(p)];
}

export function tubeCapScad(p: TubeCapParams): string {
	return toScad(tubeCapModel(p), tubeCapHeader(p));
}
