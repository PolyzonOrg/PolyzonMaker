/**
 * Keycaps for MX-style switches: a uniform low profile (the same height on
 * every row) with a spherical dish, a stem with the cross socket — 4.1 mm
 * long, the bar across the key 1.3 mm and the other 1.17 mm, as the MX stem's
 * arms differ, plus a play for printing — and stems for
 * the stabilisers of the long keys (23.876 mm apart, 100 mm on a space bar).
 * A legend can be engraved into the dish. Printed upright, as they sit.
 */
import {
	cylinder,
	difference,
	extrude,
	loft,
	part,
	rrect,
	scale,
	sphere,
	square,
	text,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/keycap';
import { clamp as c } from '../shared/math';

export const KEY_SIZES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.75, 6.25] as const;
export type KeySize = (typeof KEY_SIZES)[number];

export interface KeycapParams {
	size: KeySize;
	height: number;
	/** Depth of the dish in the middle, mm */
	dish: number;
	wall: number;
	/** Extra width of the cross socket, mm: 0.1 fits most printers */
	fit: number;
	legend: string;
	legendSize: number;
	count: number;
}

export const KEYCAP_DEFAULTS: KeycapParams = {
	size: 1,
	height: 7.6,
	dish: 1,
	wall: 1.4,
	fit: 0.1,
	legend: '',
	legendSize: 4.5,
	count: 1
};

export interface KeycapPreset {
	id: string;
	label: string;
	params: Partial<KeycapParams>;
}

export const KEYCAP_PRESETS: readonly KeycapPreset[] = [
	{ id: 'esc', label: 'Esc', params: { size: 1, legend: 'Esc', legendSize: 3.5 } },
	{
		id: 'set',
		get label() {
			return m.t_keycap_preset_six();
		},
		params: { size: 1, count: 6 }
	},
	{
		id: 'enter',
		get label() {
			return m.t_keycap_preset_enter();
		},
		params: { size: 2.25, legend: 'Enter', legendSize: 3.5 }
	},
	{
		id: 'space',
		get label() {
			return m.t_keycap_preset_space();
		},
		params: { size: 6.25 }
	}
];

export function clampKeycap(p: KeycapParams): KeycapParams {
	return {
		size: (KEY_SIZES as readonly number[]).includes(p.size) ? p.size : 1,
		height: c(p.height, 5, 14),
		dish: c(p.dish, 0, 2.5),
		wall: c(p.wall, 0.8, 2.5),
		fit: c(p.fit, -0.1, 0.4),
		legend: (p.legend ?? '').trim().slice(0, 8),
		legendSize: c(p.legendSize, 2, 10),
		count: Math.round(c(p.count, 1, 20))
	};
}

/** Cherry's keycap socket, mm. */
/** The socket: `across` is the bar along the key's width (x), `along` the one across it. */
export const CROSS = { length: 4.1, across: 1.3, along: 1.17, depth: 4 } as const;
const UNIT = 19.05;
const STEM = 5.5;

export interface KeycapLayout {
	base: [number, number];
	top: [number, number];
	/** Stems along x: the switch, then the stabilisers */
	stems: number[];
}

export function keycapLayout(input: KeycapParams): KeycapLayout {
	const p = clampKeycap(input);
	const bw = p.size * UNIT - 0.95;
	const bd = UNIT - 0.95;
	const stab = p.size >= 6 ? 50 : p.size >= 2 ? 11.938 : 0;
	return {
		base: [bw, bd],
		top: [bw - 5.6, bd - 5.6],
		stems: stab ? [0, -stab, stab] : [0]
	};
}

function keycap(p: KeycapParams, L: KeycapLayout): Node {
	const [bw, bd] = L.base;
	const [tw, td] = L.top;
	const h = p.height;
	const outer = loft([
		{ z: 0, shape: rrect(bw, bd, 1, 24) },
		{ z: h, shape: rrect(tw, td, 2, 24) }
	]);
	// The dish: a sphere across the short side, stretched along a long key.
	const dish =
		p.dish > 0.05
			? (() => {
					const R = (td / 2) ** 2 / (2 * p.dish) + p.dish / 2;
					return translate([0, 0, h - p.dish + R], scale([tw / td, 1, 1], sphere(R, 96)));
				})()
			: null;
	const ceiling = h - p.dish - 1.4;
	const cavity = loft([
		{ z: -0.01, shape: rrect(bw - 2 * p.wall, bd - 2 * p.wall, 0.5, 16) },
		{ z: ceiling, shape: rrect(tw - 2 * p.wall, td - 2 * p.wall, 1, 16) }
	]);
	const stems = L.stems.map((x) =>
		translate([x, 0, 0], cylinder(ceiling + 0.2, STEM / 2, STEM / 2, 40))
	);
	const cross = (x: number) =>
		translate(
			[x, 0, -0.01],
			extrude(
				CROSS.depth,
				union(
					square(CROSS.length + p.fit, CROSS.across + p.fit),
					square(CROSS.along + p.fit, CROSS.length + p.fit)
				)
			)
		);
	const legend = p.legend
		? translate([0, 0, h - p.dish - 0.5], extrude(p.dish + 2, text(p.legend, p.legendSize)))
		: null;
	return difference(
		union(difference(outer, cavity), ...stems),
		dish,
		legend,
		...L.stems.map(cross)
	);
}

export function keycapModel(input: KeycapParams): Node {
	const p = clampKeycap(input);
	const L = keycapLayout(p);
	const one = keycap(p, L);
	if (p.count === 1) return part('keycap', one);
	const cols = Math.ceil(Math.sqrt(p.count));
	return part(
		'keycaps',
		union(
			...Array.from({ length: p.count }, (_, i) =>
				translate([(i % cols) * (L.base[0] + 3), Math.floor(i / cols) * (L.base[1] + 3), 0], one)
			)
		)
	);
}

const mm = (v: number) => num(Math.round(v * 100) / 100, 2);

export function keycapSummary(input: KeycapParams): string {
	const p = clampKeycap(input);
	const L = keycapLayout(p);
	const values = {
		size: mm(p.size),
		width: mm(L.base[0]),
		depth: mm(L.base[1]),
		height: mm(p.height)
	};
	return L.stems.length > 1
		? m.t_keycap_summary_stabilisers({ ...values, spacing: mm(L.stems[2] * 2) })
		: m.t_keycap_summary(values);
}

export function keycapHeader(input: KeycapParams): string[] {
	const p = clampKeycap(input);
	return [m.t_keycap_scad_title(), keycapSummary(p), m.t_keycap_scad_print()];
}

export function keycapScad(p: KeycapParams): string {
	return toScad(keycapModel(p), keycapHeader(p));
}
