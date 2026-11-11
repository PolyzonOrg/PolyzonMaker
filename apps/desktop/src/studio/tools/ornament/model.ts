/**
 * Flat Christmas-tree ornaments with a name: a ball with its cap, a star,
 * a tree, a bell or a heart; the name and an optional line under it (a year,
 * a wish) stand 1 mm proud together with a rim, so a filament change at the
 * top of the plate makes them a second colour. A loop for the thread on top.
 * The name shrinks to fit the shape; every piece lies flat on the bed.
 */
import {
	circle,
	difference,
	extrude,
	intersection,
	label,
	offset,
	polygon,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/ornament';
import { clamp as c } from '../shared/math';

export type OrnamentShape = 'ball' | 'star' | 'tree' | 'bell' | 'heart';

export interface OrnamentParams {
	shape: OrnamentShape;
	/** Height of the shape (without the loop), mm */
	size: number;
	name: string;
	/** A line under the name, may be empty */
	line: string;
	font: string;
	bold: boolean;
	thickness: number;
	/** Name, line and rim this much above the plate, mm */
	relief: number;
	rim: boolean;
	count: number;
}

export const ORNAMENT_DEFAULTS: OrnamentParams = {
	shape: 'ball',
	size: 80,
	get name() {
		return m.t_ornament_default_name();
	},
	line: '2027',
	font: 'Lobster',
	bold: true,
	thickness: 3,
	relief: 1,
	rim: true,
	count: 1
};

export interface OrnamentPreset {
	id: string;
	label: string;
	params: Partial<OrnamentParams>;
}

export const ORNAMENT_PRESETS: readonly OrnamentPreset[] = [
	{
		id: 'ball',
		get label() {
			return m.t_ornament_preset_ball();
		},
		params: { shape: 'ball' }
	},
	{
		id: 'star',
		get label() {
			return m.t_ornament_preset_star();
		},
		params: { shape: 'star', size: 90, line: '' }
	},
	{
		id: 'tree',
		get label() {
			return m.t_ornament_preset_tree();
		},
		get params() {
			return {
				shape: 'tree',
				size: 90,
				name: m.t_ornament_preset_tree_name(),
				line: '2027'
			} as const;
		}
	},
	{
		id: 'bell',
		get label() {
			return m.t_ornament_preset_bell();
		},
		get params() {
			return { shape: 'bell', size: 80, name: m.t_ornament_preset_bell_name(), line: '' } as const;
		}
	},
	{
		id: 'heart',
		get label() {
			return m.t_ornament_preset_heart();
		},
		get params() {
			return {
				shape: 'heart',
				size: 70,
				name: m.t_ornament_preset_heart_name(),
				line: m.t_ornament_preset_heart_line()
			} as const;
		}
	}
];

const SHAPES: readonly OrnamentShape[] = ['ball', 'star', 'tree', 'bell', 'heart'];

export function clampOrnament(p: OrnamentParams): OrnamentParams {
	return {
		shape: SHAPES.includes(p.shape) ? p.shape : 'ball',
		size: c(p.size, 40, 160),
		name: String(p.name ?? '').slice(0, 24),
		line: String(p.line ?? '').slice(0, 30),
		font: p.font,
		bold: !!p.bold,
		thickness: c(p.thickness, 1.6, 6),
		relief: c(p.relief, 0.4, 3),
		rim: !!p.rim,
		count: Math.round(c(p.count, 1, 6))
	};
}

const RIM = 1.6;
const FN = 96;

/** Where the texts go, in parts of the size: name centre, width, capital; the line's. */
const AREA: Record<
	OrnamentShape,
	{ y: number; w: number; cap: number; ly: number; lw: number; lcap: number }
> = {
	ball: { y: 0.04, w: 0.74, cap: 0.2, ly: -0.24, lw: 0.5, lcap: 0.09 },
	star: { y: 0.02, w: 0.46, cap: 0.13, ly: -0.15, lw: 0.3, lcap: 0.07 },
	tree: { y: -0.3, w: 0.4, cap: 0.1, ly: 0.06, lw: 0.2, lcap: 0.06 },
	bell: { y: -0.14, w: 0.56, cap: 0.15, ly: -0.33, lw: 0.4, lcap: 0.075 },
	heart: { y: 0.06, w: 0.6, cap: 0.17, ly: -0.16, lw: 0.4, lcap: 0.08 }
};

function star(R: number, inner: number): Node {
	return polygon(
		Array.from({ length: 10 }, (_, i): Vec2 => {
			const r = i % 2 ? R * inner : R;
			const a = Math.PI / 2 + (i * Math.PI) / 5;
			return [r * Math.cos(a), r * Math.sin(a)];
		})
	);
}

function heart(s: number): Node {
	// The classic parametric heart, scaled to height s and centred.
	const pts: Vec2[] = [];
	for (let i = 0; i < 120; i++) {
		const t = (i / 120) * 2 * Math.PI;
		pts.push([
			16 * Math.sin(t) ** 3,
			13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
		]);
	}
	const k = s / 29;
	return polygon(pts.map(([x, y]): Vec2 => [x * k, (y + 2.5) * k]));
}

function bell(s: number): Node {
	// Half outline from the top down; the rim flares at the bottom.
	const half: Vec2[] = [];
	for (let i = 0; i <= 24; i++) {
		const t = i / 24;
		const w = 0.13 + 0.2 * t ** 1.6 + 0.07 * Math.max(0, (t - 0.85) / 0.15) ** 2;
		half.push([w * s, s * (0.42 - 0.84 * t)]);
	}
	const body = polygon([...half, ...[...half].reverse().map(([x, y]): Vec2 => [-x, y])]);
	const top = translate([0, 0.42 * s], circle(0.13 * s, FN));
	const clapper = translate([0, -0.44 * s], circle(0.07 * s, 48));
	return union(body, top, clapper);
}

function tree(s: number): Node {
	const tiers = [
		{ y: 0.5, w: 0.3, h: 0.32 },
		{ y: 0.26, w: 0.46, h: 0.36 },
		{ y: 0.0, w: 0.64, h: 0.4 }
	];
	const parts = tiers.map((t) =>
		polygon([
			[0, s * t.y],
			[(s * t.w) / 2, s * (t.y - t.h)],
			[(-s * t.w) / 2, s * (t.y - t.h)]
		])
	);
	const trunk = translate([0, -0.45 * s], square(0.14 * s, 0.12 * s));
	return offset(0.6, 16, offset(-0.6, 16, union(...parts, trunk)));
}

/** The plate's outline, centred, `size` tall; and the y of its top for the loop. */
function outline(p: OrnamentParams): { shape: Node; top: number } {
	const s = p.size;
	switch (p.shape) {
		case 'star':
			return { shape: offset(1, 16, offset(-1, 16, star(s * 0.52, 0.5))), top: s * 0.52 - 1.4 };
		case 'tree':
			return { shape: tree(s), top: s * 0.5 - 0.8 };
		case 'bell':
			return { shape: bell(s), top: s * 0.55 };
		case 'heart':
			// The loop sits in the notch between the two halves.
			return { shape: heart(s), top: (7.5 / 29) * s + 1.8 };
		default: {
			// The ball and its cap, which overlaps the ball's top.
			const r = s * 0.44;
			const ballTop = r - s * 0.06;
			const cap = translate([0, ballTop + s * 0.03], rrect(s * 0.26, s * 0.12, 1.5));
			return {
				shape: union(translate([0, -s * 0.06], circle(r, FN)), cap),
				top: ballTop + s * 0.09
			};
		}
	}
}

function ornament(p: OrnamentParams): { base: Node; raised: Node } {
	const { shape, top } = outline(p);
	const a = AREA[p.shape];
	const s = p.size;
	const o = { font: p.font, bold: p.bold, valign: 'center' as const };
	const name = translate([0, a.y * s], label(p.name.trim(), a.cap * s, { ...o, fit: a.w * s }));
	const line =
		!!p.line.trim() &&
		translate([0, a.ly * s], label(p.line.trim(), a.lcap * s, { ...o, fit: a.lw * s }));
	const ro = Math.max(3.5, s * 0.06);
	const ri = ro - 2;
	const at = (n: Node) => translate([0, top + ri - 0.5], n);
	const plate = extrude(p.thickness, union(shape, at(circle(ro, 48))));
	// Raised parts stay inside the plate (a long name never overhangs the edge).
	const inside = offset(-RIM - 0.6, 24, shape);
	const raised = union(
		intersection(union(name, line), inside),
		p.rim && difference(shape, offset(-RIM, 24, shape))
	);
	// The thread hole goes through whatever is there (the heart's halves round it).
	const hole = translate([0, 0, -1], extrude(p.thickness + p.relief + 2, at(circle(ri, 48))));
	return {
		base: difference(plate, hole),
		raised: difference(
			translate([0, 0, p.thickness - 0.01], extrude(p.relief + 0.01, raised)),
			hole
		)
	};
}

/** Each shape's width, and its height with the loop, in parts of the size. */
const EXTENT: Record<OrnamentShape, [number, number]> = {
	ball: [0.88, 1.12],
	star: [1, 1.15],
	tree: [0.64, 1.1],
	bell: [0.8, 1.25],
	heart: [1.11, 1.15]
};

/** The set laid out: every ornament's plate, and every one's raised parts. */
function laidOut(p: OrnamentParams): { base: Node; raised: Node } {
	const one = ornament(p);
	// Spaced by the shape's own size: a heart is wider than it is tall.
	const [w, h] = EXTENT[p.shape];
	const pitch = p.size * w + 8;
	const row = p.size * h + 10;
	const place = (n: Node) =>
		union(
			...Array.from({ length: p.count }, (_, i) =>
				translate([(i % 3) * pitch, -Math.floor(i / 3) * row, 0], n)
			)
		);
	return { base: place(one.base), raised: place(one.raised) };
}

export function ornamentModel(input: OrnamentParams): Node {
	const { base, raised } = laidOut(clampOrnament(input));
	return union(base, raised);
}

/** The two colours, for a 3MF of parts: the plate, and the name with the rim. */
export function ornamentColours(input: OrnamentParams): { name: string; node: Node }[] {
	const { base, raised } = laidOut(clampOrnament(input));
	return [
		{ name: m.t_ornament_colour_plate(), node: base },
		{ name: m.t_ornament_colour_raised(), node: raised }
	];
}

const mm = (v: number) => num(v, 4);

export function ornamentSummary(input: OrnamentParams): string {
	const p = clampOrnament(input);
	return m.t_ornament_summary({
		size: mm(p.size),
		thickness: mm(p.thickness + p.relief),
		change: mm(p.thickness)
	});
}

export function ornamentHeader(input: OrnamentParams): string[] {
	const p = clampOrnament(input);
	return [
		m.t_ornament_header_title(),
		m.t_ornament_header_text({ name: p.name, line: p.line }),
		ornamentSummary(p)
	];
}

export function ornamentScad(p: OrnamentParams): string {
	return toScad(ornamentModel(p), ornamentHeader(p));
}
