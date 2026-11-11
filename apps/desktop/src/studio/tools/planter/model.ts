/**
 * A flower pot and its saucer: the pot widens upwards (prints without
 * supports), drain holes in its floor, short feet under it so water runs
 * off; the saucer has ribs the pot stands on, so its roots never sit in
 * water. Round or square; both print open side up.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	loft,
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
import * as m from '$msg/tools/planter';
import { clamp as c } from '../shared/math';

export type PlanterShape = 'round' | 'square';

export interface PlanterParams {
	shape: PlanterShape;
	/** Outside at the top and at the bottom, mm */
	top: number;
	bottom: number;
	height: number;
	wall: number;
	floor: number;
	/** Drain holes and their diameter */
	holes: number;
	holeDiameter: number;
	saucer: boolean;
	saucerHeight: number;
}

export const PLANTER_DEFAULTS: PlanterParams = {
	shape: 'round',
	top: 120,
	bottom: 90,
	height: 105,
	wall: 2,
	floor: 3,
	holes: 5,
	holeDiameter: 6,
	saucer: true,
	saucerHeight: 16
};

export interface PlanterPreset {
	id: string;
	label: string;
	params: Partial<PlanterParams>;
}

export const PLANTER_PRESETS: readonly PlanterPreset[] = [
	{
		id: 'succulent',
		get label() {
			return m.t_planter_preset_succulent();
		},
		params: { top: 70, bottom: 55, height: 60, holes: 3, holeDiameter: 5, saucerHeight: 10 }
	},
	{
		id: 'mid',
		get label() {
			return m.t_planter_preset_mid();
		},
		params: { top: 120, bottom: 90, height: 105 }
	},
	{
		id: 'square',
		get label() {
			return m.t_planter_preset_square();
		},
		params: { shape: 'square', top: 110, bottom: 85, height: 100 }
	},
	{
		id: 'herbs',
		get label() {
			return m.t_planter_preset_herbs();
		},
		params: { shape: 'square', top: 160, bottom: 140, height: 90, holes: 7 }
	}
];

export function clampPlanter(p: PlanterParams): PlanterParams {
	const top = c(p.top, 40, 300);
	const height = c(p.height, 30, 300);
	// The wall leans out no more than 40° from upright: it prints without supports.
	const lean = Math.tan((40 * Math.PI) / 180) * height * 2;
	return {
		shape: p.shape === 'square' ? 'square' : 'round',
		top,
		bottom: c(p.bottom, Math.max(30, top - lean), top),
		height,
		wall: c(p.wall, 1.2, 5),
		floor: c(p.floor, 1.5, 8),
		holes: Math.round(c(p.holes, 0, 13)),
		holeDiameter: c(p.holeDiameter, 2, 15),
		saucer: !!p.saucer,
		saucerHeight: c(p.saucerHeight, 6, 40)
	};
}

const FN = 128;
const FEET = 3;

function shape(p: PlanterParams, size: number): Node {
	return p.shape === 'square'
		? rrect(size, size, Math.min(12, size / 6), 32)
		: circle(size / 2, FN);
}

/** Where the drain holes go: one in the middle, the rest on a ring. */
function holeSpots(p: PlanterParams): [number, number][] {
	if (p.holes === 0) return [];
	const spots: [number, number][] = [[0, 0]];
	const ring = Math.max(p.holeDiameter * 1.5, p.bottom * 0.28);
	for (let i = 0; i < p.holes - 1; i++) {
		const a = (2 * Math.PI * i) / (p.holes - 1);
		spots.push([ring * Math.cos(a), ring * Math.sin(a)]);
	}
	return spots;
}

function pot(p: PlanterParams): Node {
	const z0 = FEET;
	const H = p.height;
	// The wall's outside and inside; the inside follows the same lean.
	const outer = loft([
		{ z: z0, shape: shape(p, p.bottom) },
		{ z: H, shape: shape(p, p.top) }
	]);
	const t = (p.floor / (H - z0)) * (p.top - p.bottom);
	const inner = loft([
		{ z: z0 + p.floor, shape: shape(p, p.bottom + t - 2 * p.wall) },
		{ z: H + 0.01, shape: shape(p, p.top - 2 * p.wall) }
	]);
	// Feet: short arcs under the floor, gaps between them let the water out.
	const ring = difference(shape(p, p.bottom - 4), shape(p, p.bottom - 14));
	const gaps = [0, 45, 90, 135].map((a) => rotate([0, 0, a], square(p.bottom + 2, 8)));
	const feet = extrude(z0 + 0.01, difference(ring, ...gaps));
	const holes = holeSpots(p).map(([x, y]) =>
		translate([x, y, -1], cylinder(z0 + p.floor + 2, p.holeDiameter / 2, p.holeDiameter / 2, 24))
	);
	return difference(union(difference(outer, inner), feet), ...holes);
}

function saucer(p: PlanterParams): Node {
	const inside = p.bottom + 12;
	const R = inside + 2 * p.wall;
	const h = p.saucerHeight;
	const flare = Math.min(8, h * 0.5);
	const outer = loft([
		{ z: 0, shape: shape(p, R) },
		{ z: h, shape: shape(p, R + flare) }
	]);
	const inner = loft([
		{ z: 2, shape: shape(p, inside) },
		{ z: h + 0.01, shape: shape(p, inside + flare) }
	]);
	// Ribs the pot stands on: radial, low, gaps between them for water.
	const ribs = [0, 60, 120].map((a) =>
		translate([0, 0, 1.99], rotate([0, 0, a], extrude(4, square(p.bottom * 0.9, 2.4))))
	);
	return union(difference(outer, inner), ...ribs);
}

export function planterModel(input: PlanterParams): Node {
	const p = clampPlanter(input);
	if (!p.saucer) return part('pot', pot(p));
	const saucerTop = p.bottom + 12 + 2 * p.wall + Math.min(8, p.saucerHeight * 0.5);
	const gap = p.top / 2 + saucerTop / 2 + 8;
	return union(part('pot', pot(p)), part('saucer', translate([gap, 0, 0], saucer(p))));
}

const mm = (v: number) => num(Math.round(v), 0);

export function planterSummary(input: PlanterParams): string {
	const p = clampPlanter(input);
	// Volume of a frustum (round) or of a square one, inside the wall.
	const a = p.bottom - 2 * p.wall;
	const b = p.top - 2 * p.wall;
	const h = p.height - FEET - p.floor;
	const litres =
		p.shape === 'round'
			? (((Math.PI * h) / 12) * (a * a + a * b + b * b)) / 1e6
			: ((h / 3) * (a * a + a * b + b * b)) / 1e6;
	const values = { litres: num(Math.round(litres * 10) / 10, 1), height: mm(p.height) };
	if (!p.holes) {
		return p.saucer
			? m.t_planter_summary_no_holes_saucer(values)
			: m.t_planter_summary_no_holes(values);
	}
	const holes = m.t_planter_drain_holes({ count: p.holes, n: num(p.holes) });
	return p.saucer
		? m.t_planter_summary_holes_saucer({ ...values, holes })
		: m.t_planter_summary_holes({ ...values, holes });
}

export function planterHeader(input: PlanterParams): string[] {
	const p = clampPlanter(input);
	return [m.t_planter_header_title(), planterSummary(p), m.t_planter_header_print()];
}

export function planterScad(p: PlanterParams): string {
	return toScad(planterModel(p), planterHeader(p));
}
