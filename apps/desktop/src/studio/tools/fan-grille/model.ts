/**
 * Grilles for case fans: a plate the size of the fan with its screw holes at
 * the standard spacing, the round opening filled with rings, hexagons, slots
 * or a grid. The plate lies flat, as it prints.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	intersection,
	part,
	rotate,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/fan-grille';
import { clamp as c } from '../shared/math';
import { ownKey } from '$lib/own';

export type GrillePattern = 'rings' | 'hex' | 'slots' | 'grid';

/** Fan size → distance between screw holes, mm (the sizes everyone builds to). */
export const FAN_HOLES: Readonly<Record<number, number>> = {
	40: 32,
	50: 40,
	60: 50,
	70: 60,
	80: 71.5,
	92: 82.5,
	120: 105,
	140: 124.5
};
export const FAN_SIZES = Object.keys(FAN_HOLES).map(Number);

export interface FanGrilleParams {
	fan: number;
	pattern: GrillePattern;
	thickness: number;
	/** Width of the bars between openings, mm */
	bar: number;
	/** Distance between neighbouring openings, mm */
	pitch: number;
	/** Countersunk holes, for screws flush with the grille. */
	countersink: boolean;
	corner: number;
}

export const FAN_GRILLE_DEFAULTS: FanGrilleParams = {
	fan: 120,
	pattern: 'hex',
	thickness: 2,
	bar: 1.6,
	pitch: 8,
	countersink: false,
	corner: 5
};

export interface FanGrillePreset {
	id: string;
	label: string;
	params: Partial<FanGrilleParams>;
}

export const FAN_GRILLE_PRESETS: readonly FanGrillePreset[] = [
	{
		id: 'pc',
		get label() {
			return m.t_fan_grille_preset_pc();
		},
		params: { fan: 120, pattern: 'hex', pitch: 9 }
	},
	{
		id: 'printer',
		get label() {
			return m.t_fan_grille_preset_printer();
		},
		params: { fan: 40, pattern: 'rings', pitch: 4, bar: 1.2, thickness: 1.6 }
	},
	{
		id: 'quiet',
		get label() {
			return m.t_fan_grille_preset_quiet();
		},
		params: { fan: 140, pattern: 'rings', pitch: 10, bar: 1.4 }
	},
	{
		id: 'grid80',
		get label() {
			return m.t_fan_grille_preset_grid();
		},
		params: { fan: 80, pattern: 'grid', pitch: 6 }
	}
];

export function clampFanGrille(p: FanGrilleParams): FanGrilleParams {
	const patterns: GrillePattern[] = ['rings', 'hex', 'slots', 'grid'];
	const bar = c(p.bar, 0.8, 6);
	return {
		fan: ownKey(FAN_HOLES, p.fan) ? p.fan : 120,
		pattern: patterns.includes(p.pattern) ? p.pattern : 'hex',
		thickness: c(p.thickness, 1, 6),
		bar,
		pitch: c(p.pitch, bar + 1.5, 30),
		countersink: !!p.countersink,
		corner: c(p.corner, 0, 20)
	};
}

export interface FanGrilleLayout {
	/** Diameter of the round opening, mm */
	opening: number;
	holes: number;
	screw: number;
	/** Share of the opening left open, 0…1 (estimate) */
	open: number;
}

export function fanGrilleLayout(input: FanGrilleParams): FanGrilleLayout {
	const p = clampFanGrille(input);
	const opening = p.fan - 2;
	const free = (p.pitch - p.bar) / p.pitch;
	let open: number;
	if (p.pattern === 'slots') open = free;
	else if (p.pattern === 'rings') {
		// Rings, then the spokes and the hub take their share.
		const R = opening / 2;
		const spokes = 6 * p.bar * (R - p.pitch);
		open = free - (spokes + Math.PI * p.pitch ** 2) / (Math.PI * R * R);
	} else open = free * free;
	return {
		opening,
		holes: FAN_HOLES[p.fan],
		screw: p.fan <= 70 ? 3.4 : 4.4,
		open: Math.max(0, open)
	};
}

const FN = 96;

/** The openings across the whole plate, before the round opening clips them. */
function pattern(p: FanGrilleParams, R: number): Node {
	const gap = p.pitch - p.bar;
	const n = Math.ceil(R / p.pitch) + 1;
	switch (p.pattern) {
		case 'slots':
			return union(
				...Array.from({ length: 2 * n + 1 }, (_, i) =>
					translate([(i - n) * p.pitch, 0], square(gap, 2 * R + 2))
				)
			);
		case 'grid': {
			const cells: Node[] = [];
			for (let i = -n; i <= n; i++)
				for (let j = -n; j <= n; j++)
					cells.push(translate([i * p.pitch, j * p.pitch], square(gap, gap)));
			return union(...cells);
		}
		case 'rings': {
			const rings: Node[] = [];
			for (let r = p.pitch; r + p.bar < R; r += p.pitch)
				rings.push(difference(circle(Math.min(R, r + gap), FN), circle(r, FN)));
			const spokes = Array.from({ length: 3 }, (_, i) =>
				rotate([0, 0, i * 60], square(2 * R + 2, p.bar))
			);
			return difference(union(...rings), ...spokes);
		}
		default: {
			// Hexagons in rows half a cell apart: bars of the same width everywhere.
			const cells: Node[] = [];
			const dy = (p.pitch * Math.sqrt(3)) / 2;
			const rows = Math.ceil(R / dy) + 1;
			const hex = rotate([0, 0, 30], circle(gap / Math.sqrt(3), 6));
			for (let j = -rows; j <= rows; j++)
				for (let i = -n; i <= n; i++)
					cells.push(translate([i * p.pitch + (Math.abs(j) % 2 ? p.pitch / 2 : 0), j * dy], hex));
			return union(...cells);
		}
	}
}

export function fanGrilleModel(input: FanGrilleParams): Node {
	const p = clampFanGrille(input);
	const L = fanGrilleLayout(p);
	const R = L.opening / 2;
	const t = p.thickness;
	// A bar's width of rim round the opening, so no cell is cut into a sliver.
	const openings = intersection(pattern(p, R), circle(R - p.bar / 2, FN));
	const h = L.holes / 2;
	const screws = [
		[-h, -h],
		[h, -h],
		[-h, h],
		[h, h]
	].map(([x, y]) => {
		const r = L.screw / 2;
		const head = L.screw * 1.9;
		return translate(
			[x, y, 0],
			union(
				translate([0, 0, -1], cylinder(t + 2, r, r, 32)),
				p.countersink &&
					translate([0, 0, t - (head / 2 - r)], cylinder(head / 2 - r + 0.01, r, head / 2, 32))
			)
		);
	});
	return part(
		'grille',
		difference(
			extrude(t, rrect(p.fan, p.fan, p.corner, 32)),
			translate([0, 0, -1], extrude(t + 2, openings)),
			...screws
		)
	);
}

function patternWord(pattern: GrillePattern): string {
	switch (pattern) {
		case 'rings':
			return m.t_fan_grille_word_rings();
		case 'hex':
			return m.t_fan_grille_word_hex();
		case 'slots':
			return m.t_fan_grille_word_slots();
		case 'grid':
			return m.t_fan_grille_word_grid();
	}
}
const mm = (v: number) => num(v, 4);

export function fanGrilleSummary(input: FanGrilleParams): string {
	const p = clampFanGrille(input);
	const L = fanGrilleLayout(p);
	return m.t_fan_grille_summary({
		spacing: mm(L.holes),
		screw: mm(L.screw),
		open: Math.round(L.open * 20) * 5
	});
}

export function fanGrilleHeader(input: FanGrilleParams): string[] {
	const p = clampFanGrille(input);
	return [
		m.t_fan_grille_scad_title({
			fan: num(p.fan),
			pattern: patternWord(p.pattern),
			thickness: mm(p.thickness)
		}),
		fanGrilleSummary(p),
		m.t_fan_grille_scad_print()
	];
}

export function fanGrilleScad(p: FanGrilleParams): string {
	return toScad(fanGrilleModel(p), fanGrilleHeader(p));
}
