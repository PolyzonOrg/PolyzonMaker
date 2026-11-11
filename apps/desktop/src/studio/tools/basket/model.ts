/**
 * «Корзины»: a round or a rectangular basket with patterned walls — honeycomb,
 * diamonds or tall slots — a solid band at the bottom and a solid rim at the
 * top, the floor solid or honeycombed. Printed upright without supports:
 * every hole in a wall ends in a point at the top (60° for the honeycomb,
 * 45° for diamonds and slots), never a flat bridge.
 */
import {
	cylinder,
	difference,
	extrude,
	part,
	polygon,
	rotate,
	rrect,
	toScad,
	translate,
	type Node
} from '../csg/csg';
import { currentLocale, num as fmt } from '$lib/i18n/current';
import { fullStop, listJoin } from '$lib/i18n/locale';
import * as m from '$msg/tools/basket';
import { clamp } from '../shared/math';

export type BasketShape = 'round' | 'rect';
export type BasketPattern = 'hex' | 'diamond' | 'slots' | 'none';

export interface BasketParams {
	shape: BasketShape;
	/** Outer size: width and depth of a rectangular one, the diameter of a round one, mm */
	width: number;
	depth: number;
	height: number;
	/** Corner radius of a rectangular basket, mm */
	radius: number;
	wall: number;
	floor: number;
	pattern: BasketPattern;
	/** Hole width, mm */
	hole: number;
	/** Plastic between holes, mm */
	bar: number;
	/** Solid band at the top and at the bottom, mm */
	rim: number;
	band: number;
	/** Honeycomb in the floor too */
	floorHoles: boolean;
}

export const BASKET_DEFAULTS: BasketParams = {
	shape: 'rect',
	width: 160,
	depth: 110,
	height: 70,
	radius: 12,
	wall: 2,
	floor: 1.6,
	pattern: 'hex',
	hole: 10,
	bar: 2.4,
	rim: 8,
	band: 6,
	floorHoles: false
};

export const BASKET_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<BasketParams>;
}[] = [
	{
		id: 'fruit',
		get label() {
			return m.t_basket_preset_fruit();
		},
		params: { shape: 'round', width: 200, height: 90, hole: 14, bar: 3, floorHoles: true }
	},
	{
		id: 'bath',
		get label() {
			return m.t_basket_preset_bath();
		},
		params: {
			shape: 'rect',
			width: 180,
			depth: 120,
			height: 80,
			pattern: 'diamond',
			floorHoles: true
		}
	},
	{
		id: 'desk',
		get label() {
			return m.t_basket_preset_desk();
		},
		params: { shape: 'rect', width: 120, depth: 90, height: 60, pattern: 'hex', hole: 8 }
	},
	{
		id: 'pens',
		get label() {
			return m.t_basket_preset_pens();
		},
		params: { shape: 'round', width: 80, height: 100, pattern: 'slots', hole: 6, bar: 3 }
	}
];

export function clampBasket(p: BasketParams): BasketParams {
	const width = clamp(p.width, 40, 300);
	const depth = clamp(p.depth, 40, 300);
	const height = clamp(p.height, 20, 300);
	return {
		shape: p.shape === 'round' ? 'round' : 'rect',
		width,
		depth,
		height,
		radius: clamp(p.radius, 1, Math.min(width, depth) / 2 - 1),
		wall: clamp(p.wall, 1.2, 4),
		floor: clamp(p.floor, 1, 5),
		pattern: (['hex', 'diamond', 'slots', 'none'] as const).includes(p.pattern) ? p.pattern : 'hex',
		hole: clamp(p.hole, 4, 30),
		bar: clamp(p.bar, 1.6, 10),
		rim: clamp(p.rim, 3, Math.max(3, height / 3)),
		band: clamp(p.band, 2, Math.max(2, height / 3)),
		floorHoles: !!p.floorHoles
	};
}

const FN = 96;
type Pt = [number, number];

/** A hole in the plane of a wall (x across, y up), centred on the origin. */
function holeShape(pattern: BasketPattern, w: number): { pts: Pt[]; h: number } {
	if (pattern === 'hex') {
		// Pointy top: 60° up to the point, 30° from upright.
		const R = w / Math.sqrt(3);
		return {
			pts: Array.from({ length: 6 }, (_, k) => {
				const a = Math.PI / 2 + (k * Math.PI) / 3;
				return [R * Math.cos(a), R * Math.sin(a)] as Pt;
			}),
			h: 2 * R
		};
	}
	if (pattern === 'diamond')
		return {
			pts: [
				[0, -w / 2],
				[w / 2, 0],
				[0, w / 2],
				[-w / 2, 0]
			],
			h: w
		};
	// A tall slot, its ends pointed at 45°.
	const h = w * 3;
	return {
		pts: [
			[0, -h / 2],
			[w / 2, -h / 2 + w / 2],
			[w / 2, h / 2 - w / 2],
			[0, h / 2],
			[-w / 2, h / 2 - w / 2],
			[-w / 2, -h / 2 + w / 2]
		],
		h
	};
}

export interface BasketLayout {
	/** Rows of holes and their heights (centres), mm */
	rows: number[];
	/** Holes across one wall (rect: per side) or round the basket */
	perRow: number[];
	holes: number;
}

/** Positions along a wall run of `length`: as many holes as fit, centred. */
function across(length: number, pitch: number): number[] {
	const n = Math.max(0, Math.floor((length + 1e-6) / pitch));
	return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
}

interface Spot {
	/** Along the wall (rect) or the angle, degrees (round) */
	at: number;
	z: number;
	/** Rect: which side, 0…3 */
	side: number;
}

function spots(p: BasketParams): { spots: Spot[]; rows: number[]; perRow: number[] } {
	if (p.pattern === 'none') return { spots: [], rows: [], perRow: [] };
	const { h } = holeShape(p.pattern, p.hole);
	const pitchX = p.hole + p.bar;
	// Honeycomb and diamonds nest: rows closer, every other one shifted half a hole.
	const nest = p.pattern !== 'slots';
	const pitchZ = nest
		? (p.pattern === 'hex' ? h * 0.75 : h / 2) + p.bar * (p.pattern === 'hex' ? 0.87 : 0.71)
		: h + p.bar;
	const z0 = p.floor + p.band + h / 2;
	const z1 = p.height - p.rim - h / 2;
	const rows: number[] = [];
	for (let z = z0; z <= z1 + 1e-6; z += pitchZ) rows.push(z);
	// Centre the rows in the patterned band.
	const shift = rows.length ? (z1 - rows[rows.length - 1]) / 2 : 0;
	for (let i = 0; i < rows.length; i++) rows[i] += shift;
	const out: Spot[] = [];
	const perRow: number[] = [];
	rows.forEach((z, r) => {
		const offset = nest && r % 2 ? pitchX / 2 : 0;
		let n = 0;
		if (p.shape === 'round') {
			const circumference = Math.PI * (p.width - p.wall);
			const k = Math.max(3, Math.floor(circumference / pitchX));
			const step = 360 / k;
			for (let i = 0; i < k; i++) out.push({ at: i * step + (offset ? step / 2 : 0), z, side: 0 });
			n = k;
		} else {
			// Each side, clear of the rounded corners.
			[p.width, p.depth, p.width, p.depth].forEach((len, side) => {
				const run = len - 2 * p.radius - p.bar;
				const xs = across(run - (offset ? pitchX : 0), pitchX);
				for (const x of xs) out.push({ at: x, z, side });
				n += xs.length;
			});
		}
		perRow.push(n);
	});
	return { spots: out, rows, perRow };
}

export function basketLayout(input: BasketParams): BasketLayout {
	const p = clampBasket(input);
	const s = spots(p);
	return { rows: s.rows, perRow: s.perRow, holes: s.spots.length };
}

function floorHoles(p: BasketParams): Node[] {
	if (!p.floorHoles) return [];
	// Honeycomb with flat sides across, inside the floor less a margin.
	const w = p.hole;
	const R = w / Math.sqrt(3);
	const hex: Pt[] = Array.from({ length: 6 }, (_, k) => {
		const a = (k * Math.PI) / 3;
		return [R * Math.cos(a), R * Math.sin(a)] as Pt;
	});
	const dx = 1.5 * R + p.bar * 0.87;
	const dy = w + p.bar;
	const margin = p.wall + p.bar + 2;
	const iw = p.width - 2 * margin;
	const id = (p.shape === 'round' ? p.width : p.depth) - 2 * margin;
	// The inside's rounded corners, which a hole must keep clear of too.
	const rc = p.shape === 'round' ? 0 : Math.max(0, p.radius - margin);
	const inCorner = (x: number, y: number) => {
		const cx = Math.abs(x) - (iw / 2 - rc);
		const cy = Math.abs(y) - (id / 2 - rc);
		return cx <= 0 || cy <= 0 || Math.hypot(cx, cy) + R <= rc;
	};
	const out: Node[] = [];
	const nx = Math.floor(iw / 2 / dx);
	const ny = Math.floor(id / 2 / dy) + 1;
	for (let i = -nx; i <= nx; i++)
		for (let j = -ny; j <= ny; j++) {
			const x = i * dx;
			const y = j * dy + (i % 2 ? dy / 2 : 0);
			const inside =
				p.shape === 'round'
					? Math.hypot(x, y) + R <= iw / 2
					: Math.abs(x) + R <= iw / 2 && Math.abs(y) + w / 2 <= id / 2 && inCorner(x, y);
			if (inside) out.push(translate([x, y, -1], extrude(p.floor + 2, polygon(hex))));
		}
	return out;
}

/** The wall's holes, as cutters (also for the lampshades' drums). */
export function basketWallHoles(input: BasketParams): Node[] {
	const p = clampBasket(input);
	const { pts } = holeShape(p.pattern, p.hole);
	// A hole runs through the wall: drawn in the wall's plane, pushed through along y.
	// A round wall curves away from a flat cutter, so there it reaches deeper.
	const depth = p.wall * 4 + (p.shape === 'round' ? p.hole : 0);
	const cutter = rotate([90, 0, 0], translate([0, 0, -depth / 2], extrude(depth, polygon(pts))));
	return spots(p).spots.map(({ at, z, side }) => {
		if (p.shape === 'round')
			return rotate([0, 0, at], translate([0, p.width / 2 - p.wall / 2, z], cutter));
		const half = side % 2 ? p.width / 2 : p.depth / 2;
		const angle = [0, 90, 180, 270][side];
		return rotate([0, 0, angle], translate([at, -half + p.wall / 2, z], cutter));
	});
}

export function basketModel(input: BasketParams): Node {
	const p = clampBasket(input);
	const outer =
		p.shape === 'round'
			? cylinder(p.height, p.width / 2, p.width / 2, FN)
			: extrude(p.height, rrect(p.width, p.depth, p.radius, FN));
	const inner =
		p.shape === 'round'
			? translate(
					[0, 0, p.floor],
					cylinder(p.height, p.width / 2 - p.wall, p.width / 2 - p.wall, FN)
				)
			: translate(
					[0, 0, p.floor],
					extrude(
						p.height,
						rrect(p.width - 2 * p.wall, p.depth - 2 * p.wall, p.radius - p.wall, FN)
					)
				);
	return part('basket', difference(outer, inner, ...basketWallHoles(p), ...floorHoles(p)));
}

const mm = (v: number) => fmt(Math.round(v * 10) / 10, 1);

const PATTERN_WORDS: Record<BasketPattern, () => string> = {
	hex: m.t_basket_summary_hex,
	diamond: m.t_basket_summary_diamond,
	slots: m.t_basket_summary_slots,
	none: m.t_basket_summary_none
};

/** A list of facts, not a sentence: each fact is a whole message. */
export function basketSummary(input: BasketParams): string {
	const p = clampBasket(input);
	const L = basketLayout(p);
	const facts = [
		p.shape === 'round'
			? m.t_basket_summary_size_round({ d: mm(p.width), h: mm(p.height) })
			: m.t_basket_summary_size_rect({ w: mm(p.width), d: mm(p.depth), h: mm(p.height) }),
		PATTERN_WORDS[p.pattern]()
	];
	if (p.pattern !== 'none')
		facts.push(m.t_basket_summary_holes({ count: L.holes, n: fmt(L.holes) }));
	if (p.floorHoles) facts.push(m.t_basket_summary_floor_holes());
	const locale = currentLocale();
	return listJoin(facts, locale) + fullStop(locale);
}

export function basketHeader(input: BasketParams): string[] {
	const p = clampBasket(input);
	return [
		m.t_basket_scad_title(),
		basketSummary(p),
		m.t_basket_scad_dims({
			wall: mm(p.wall),
			floor: mm(p.floor),
			hole: mm(p.hole),
			bar: mm(p.bar)
		}),
		m.t_basket_scad_print()
	];
}

export function basketScad(p: BasketParams): string {
	return toScad(basketModel(p), basketHeader(p));
}
