/**
 * «Абажуры и фонари»: a shade for a lamp holder with a shade ring (E27 —
 * a 40,5 mm hole, E14 — 29 mm) on a three-spoke spider, or a lantern for a
 * LED tea light (⌀ 38 mm) on a floor with a socket. The wall is a twisted
 * polygon that may widen, or a drum patterned like «Корзины». Printed with
 * the spider or the floor on the bed: the spider is the shade's top.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	intersection,
	offset,
	part,
	polygon,
	rotate,
	square,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { basketWallHoles, type BasketPattern } from '../basket/model';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/lampshade';
import { clamp } from '../shared/math';

export type LampKind = 'pendant' | 'lantern';
export type LampForm = 'twist' | 'drum';
export type LampHolder = 'E27' | 'E14';

export interface LampshadeParams {
	kind: LampKind;
	form: LampForm;
	holder: LampHolder;
	/** Diameter at the spider or the floor (the bed), mm; a polygon's across the corners */
	diameter: number;
	/** At the other end (twist only), mm */
	diameterEnd: number;
	height: number;
	wall: number;
	sides: number;
	/** Degrees over the height */
	twist: number;
	pattern: BasketPattern;
	hole: number;
	bar: number;
}

export const LAMPSHADE_DEFAULTS: LampshadeParams = {
	kind: 'pendant',
	form: 'twist',
	holder: 'E27',
	diameter: 140,
	diameterEnd: 190,
	height: 160,
	wall: 1.2,
	sides: 12,
	twist: 60,
	pattern: 'hex',
	hole: 14,
	bar: 3
};

export const LAMPSHADE_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<LampshadeParams>;
}[] = [
	{
		id: 'pendant',
		get label() {
			return m.t_lampshade_preset_pendant();
		},
		params: {}
	},
	{
		id: 'drum',
		get label() {
			return m.t_lampshade_preset_drum();
		},
		params: { form: 'drum', holder: 'E14', diameter: 120, height: 110, wall: 1.6, hole: 12 }
	},
	{
		id: 'lantern',
		get label() {
			return m.t_lampshade_preset_lantern();
		},
		params: {
			kind: 'lantern',
			form: 'twist',
			diameter: 80,
			diameterEnd: 80,
			height: 100,
			sides: 8,
			twist: 90
		}
	},
	{
		id: 'lantern-hex',
		get label() {
			return m.t_lampshade_preset_lantern_hex();
		},
		params: {
			kind: 'lantern',
			form: 'drum',
			diameter: 90,
			height: 110,
			wall: 1.6,
			hole: 10,
			bar: 2.4
		}
	}
];

/** Shade-ring holes, mm. */
export const HOLDER_HOLE: Record<LampHolder, number> = { E27: 40.5, E14: 29 };
/** A LED tea light and the socket round it, mm. */
const TEA_LIGHT = 38;
const SOCKET = { play: 1, wall: 1.6, height: 4 };
const SPIDER = { thickness: 3, collar: 6, spoke: 8 };
const FLOOR = 2;
/** How much the wall may lean out, its run over its rise. */
const LEAN = 0.8;

export function clampLampshade(p: LampshadeParams): LampshadeParams {
	const kind = p.kind === 'lantern' ? 'lantern' : 'pendant';
	const height = clamp(p.height, 40, 300);
	const diameter = clamp(p.diameter, kind === 'pendant' ? 90 : 55, 250);
	return {
		kind,
		form: p.form === 'drum' ? 'drum' : 'twist',
		holder: p.holder === 'E14' ? 'E14' : 'E27',
		diameter,
		// No steeper than the printer bridges on its own; never narrower than at the bed.
		diameterEnd: clamp(p.diameterEnd, diameter, Math.min(250, diameter + 2 * LEAN * height)),
		height,
		wall: clamp(p.wall, 0.8, 4),
		sides: Math.round(clamp(p.sides, 3, 24)),
		twist: clamp(p.twist, -180, 180),
		pattern: (['hex', 'diamond', 'slots', 'none'] as const).includes(p.pattern) ? p.pattern : 'hex',
		hole: clamp(p.hole, 4, 30),
		bar: clamp(p.bar, 1.6, 10)
	};
}

const FN = 128;

function ngon(r: number, n: number): Node {
	return polygon(
		Array.from(
			{ length: n },
			(_, k): Vec2 => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n)]
		)
	);
}

/** The bottom's outline: the spider and the floor stay inside it. */
function footprint(p: LampshadeParams): Node {
	return p.form === 'drum' ? circle(p.diameter / 2, FN) : ngon(p.diameter / 2, p.sides);
}

function wall(p: LampshadeParams): Node {
	if (p.form === 'drum') {
		const R = p.diameter / 2;
		const tube = difference(
			cylinder(p.height, R, R, FN),
			translate([0, 0, -1], cylinder(p.height + 2, R - p.wall, R - p.wall, FN))
		);
		const bottom = p.kind === 'pendant' ? SPIDER.thickness : FLOOR;
		const holes = basketWallHoles({
			shape: 'round',
			width: p.diameter,
			depth: p.diameter,
			height: p.height,
			radius: 1,
			wall: p.wall,
			floor: bottom,
			pattern: p.pattern,
			hole: p.hole,
			bar: p.bar,
			rim: 8,
			band: 6,
			floorHoles: false
		});
		return difference(tube, ...holes);
	}
	// A twisted polygon shell; it widens with the height, the wall with it.
	const scale = p.diameterEnd / p.diameter;
	const R = p.diameter / 2;
	const inner = R - p.wall / Math.cos(Math.PI / p.sides);
	const shell = (r: number, h: number): Node => ({
		k: 'extrude',
		h,
		scale,
		twist: p.twist,
		slices: Math.max(8, Math.round(p.height / 4)),
		c: [ngon(r, p.sides)]
	});
	return difference(shell(R, p.height), translate([0, 0, -0.01], shell(inner, p.height + 0.02)));
}

/** The spider: a collar for the shade ring and three spokes out to the wall. */
function spider(p: LampshadeParams): Node {
	const hole = HOLDER_HOLE[p.holder] / 2;
	const reach = p.diameter / 2;
	const spokes = [0, 120, 240].map((a) =>
		rotate([0, 0, a + 90], translate([reach / 2 + hole / 2, 0], square(reach - hole, SPIDER.spoke)))
	);
	const flat = intersection(
		offset(-p.wall / 2, 32, footprint(p)),
		union(difference(circle(hole + SPIDER.collar, FN), circle(hole, FN)), ...spokes)
	);
	return extrude(SPIDER.thickness, difference(flat, circle(hole, FN)));
}

/** The lantern's floor with a ring that keeps the tea light in the middle. */
function floor(p: LampshadeParams): Node {
	const r = TEA_LIGHT / 2 + SOCKET.play / 2;
	return union(
		extrude(FLOOR, offset(-p.wall / 2, 32, footprint(p))),
		translate(
			[0, 0, FLOOR - 0.01],
			extrude(SOCKET.height + 0.01, difference(circle(r + SOCKET.wall, FN), circle(r, FN)))
		)
	);
}

export function lampshadeModel(input: LampshadeParams): Node {
	const p = clampLampshade(input);
	return part('shade', union(wall(p), p.kind === 'pendant' ? spider(p) : floor(p)));
}

const mm = (v: number) => num(Math.round(v * 10) / 10);

export function lampshadeSummary(input: LampshadeParams): string {
	const p = clampLampshade(input);
	const size =
		p.form === 'twist' && p.diameterEnd > p.diameter
			? m.t_lampshade_size_range({
					from: mm(p.diameter),
					to: mm(p.diameterEnd),
					height: mm(p.height)
				})
			: m.t_lampshade_size({ diameter: mm(p.diameter), height: mm(p.height) });
	return p.kind === 'pendant'
		? m.t_lampshade_summary_pendant({ size, holder: p.holder, hole: mm(HOLDER_HOLE[p.holder]) })
		: m.t_lampshade_summary_lantern({ size, candle: num(TEA_LIGHT) });
}

export function lampshadeHeader(input: LampshadeParams): string[] {
	const p = clampLampshade(input);
	return [
		m.t_lampshade_header_title(),
		lampshadeSummary(p),
		p.kind === 'pendant' ? m.t_lampshade_header_pendant() : m.t_lampshade_header_lantern()
	];
}

export function lampshadeScad(p: LampshadeParams): string {
	return toScad(lampshadeModel(p), lampshadeHeader(p));
}
