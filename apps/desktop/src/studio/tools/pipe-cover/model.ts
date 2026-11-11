/**
 * A cover ring for a heating or water pipe where it leaves the wall or the
 * floor: a flat face, a rim round the edge that hides the rough hole, a
 * collar that keeps it centred on the pipe. Split in two, so it goes on a
 * pipe that is already in place: the halves slide together along the pipe
 * and lock on two dovetails (the dovetails run up two ribs, so the joint is
 * as tall as the rim). Printed face down, open side up — no supports.
 * Pipe sizes: steel ГОСТ 3262, PP-R and metal-plastic.
 */
import {
	circle,
	difference,
	extrude,
	intersection,
	polygon,
	square,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/pipe-cover';
import { clamp as c } from '../shared/math';

export interface PipeCoverParams {
	/** Outside of the pipe, mm */
	pipe: number;
	/** Outside of the cover, mm */
	diameter: number;
	/** Rim from the face to the wall, mm */
	rim: number;
	face: number;
	split: boolean;
	clearance: number;
	count: number;
}

export const PIPE_COVER_DEFAULTS: PipeCoverParams = {
	pipe: 26.8,
	diameter: 70,
	rim: 10,
	face: 2.4,
	split: true,
	clearance: 0.5,
	count: 2
};

export interface PipeCoverPreset {
	id: string;
	label: string;
	params: Partial<PipeCoverParams>;
}

/** Outside diameters of common pipes, mm. */
export const PIPES: readonly { label: string; d: number }[] = [
	{
		get label() {
			return m.t_pipe_cover_pipe_steel_dn({ dn: 15, inch: '½″' });
		},
		d: 21.3
	},
	{
		get label() {
			return m.t_pipe_cover_pipe_steel_dn({ dn: 20, inch: '¾″' });
		},
		d: 26.8
	},
	{
		get label() {
			return m.t_pipe_cover_pipe_steel_dn({ dn: 25, inch: '1″' });
		},
		d: 33.5
	},
	{
		get label() {
			return m.t_pipe_cover_pipe_pp({ d: 20 });
		},
		d: 20
	},
	{
		get label() {
			return m.t_pipe_cover_pipe_pp({ d: 25 });
		},
		d: 25
	},
	{
		get label() {
			return m.t_pipe_cover_pipe_pp({ d: 32 });
		},
		d: 32
	},
	{
		get label() {
			return m.t_pipe_cover_pipe_mp({ d: 16 });
		},
		d: 16
	}
];

export const PIPE_COVER_PRESETS: readonly PipeCoverPreset[] = [
	{
		id: 'dn15',
		get label() {
			return m.t_pipe_cover_preset_steel({ inch: '½″' });
		},
		params: { pipe: 21.3, diameter: 60 }
	},
	{
		id: 'dn20',
		get label() {
			return m.t_pipe_cover_preset_steel({ inch: '¾″' });
		},
		params: { pipe: 26.8, diameter: 70 }
	},
	{
		id: 'pp20',
		get label() {
			return m.t_pipe_cover_pipe_pp({ d: 20 });
		},
		params: { pipe: 20, diameter: 55 }
	},
	{
		id: 'pp25',
		get label() {
			return m.t_pipe_cover_pipe_pp({ d: 25 });
		},
		params: { pipe: 25, diameter: 60 }
	},
	{
		id: 'mp16',
		get label() {
			return m.t_pipe_cover_pipe_mp({ d: 16 });
		},
		params: { pipe: 16, diameter: 45, rim: 8 }
	}
];

export function clampPipeCover(p: PipeCoverParams): PipeCoverParams {
	const pipe = c(p.pipe, 8, 110);
	return {
		pipe,
		diameter: c(p.diameter, pipe + 16, pipe + 150),
		rim: c(p.rim, 3, 40),
		face: c(p.face, 1.6, 5),
		split: !!p.split,
		clearance: c(p.clearance, 0.1, 2),
		count: Math.round(c(p.count, 1, 8))
	};
}

const WALL = 2;
const COLLAR = 4;
/** Play in the dovetail, mm. */
const PLAY = 0.2;

/** A dovetail on the cut line (y = 0) at x, widening into −y. */
function dovetail(x: number, a: number, b: number, d: number, grow = 0): Node {
	const pts: Vec2[] = [
		[x - a / 2 - grow, 0.5],
		[x + a / 2 + grow, 0.5],
		[x + b / 2 + grow, -d - grow],
		[x - b / 2 - grow, -d - grow]
	];
	return polygon(pts);
}

/** The whole ring, before it is split; the rib positions. */
function ring(p: PipeCoverParams): { body: Node; ribs: number[]; ri: number; ro: number } {
	const ri = p.pipe / 2 + p.clearance;
	const ro = p.diameter / 2;
	const fn = 128;
	const annulus = (a: number, b: number) => difference(circle(b, fn), circle(a, fn));
	const face = extrude(p.face, annulus(ri, ro));
	const rim = extrude(p.rim, annulus(ro - WALL, ro));
	const collar = extrude(Math.min(p.rim, COLLAR + p.face), annulus(ri, ri + WALL));
	const mid = (ri + WALL + ro - WALL) / 2;
	return { body: union(face, rim, collar), ribs: [-mid, mid], ri, ro };
}

function halves(p: PipeCoverParams): Node[] {
	const { body, ribs, ri, ro } = ring(p);
	if (!p.split) return [body];
	const span = ro - WALL - (ri + WALL);
	const a = Math.min(6, span * 0.4);
	const b = a * 1.6;
	const d = Math.min(5, span * 0.5);
	const ribW = b + 2 * WALL;
	const ribH = Math.min(p.rim, 10);
	// Ribs across the cut: they carry the dovetails up from the face.
	const ribBlocks = ribs.map((x) => extrude(ribH, translate([x, 0], square(ribW, 2 * (d + WALL)))));
	const ringWithRibs = intersection(union(body, ...ribBlocks), extrude(p.rim + 1, circle(ro, 128)));
	const hole = translate([0, 0, -1], extrude(p.rim + 2, circle(ri, 128)));
	const solid = difference(ringWithRibs, hole);
	const upper = extrude(p.rim + 2, translate([0, ro + 1], square(2 * ro + 4, 2 * ro + 2)));
	const lower = extrude(p.rim + 2, translate([0, -ro - 1], square(2 * ro + 4, 2 * ro + 2)));
	const keys = ribs.map((x) => translate([0, 0, -1], extrude(p.rim + 2, dovetail(x, a, b, d))));
	const slots = ribs.map((x) =>
		translate([0, 0, -1], extrude(p.rim + 2, dovetail(x, a, b, d, PLAY)))
	);
	// The upper half keeps its dovetails; the lower half has them cut out with play.
	const top = union(intersection(solid, upper), intersection(solid, union(...keys)));
	const bottom = difference(intersection(solid, lower), ...slots);
	return [top, translate([0, -6, 0], bottom)];
}

export function pipeCoverModel(input: PipeCoverParams): Node {
	const p = clampPipeCover(input);
	const one = union(...halves(p));
	const pitch = p.diameter + 10;
	return union(...Array.from({ length: p.count }, (_, i) => translate([i * pitch, 0, 0], one)));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function pipeCoverSummary(input: PipeCoverParams): string {
	const p = clampPipeCover(input);
	const text = m.t_pipe_cover_summary({
		count: p.count,
		n: num(p.count),
		diameter: mm(p.diameter),
		pipe: mm(p.pipe),
		rim: mm(p.rim)
	});
	if (!p.split) return text;
	return text + sentenceGap(currentLocale()) + m.t_pipe_cover_summary_split();
}

export function pipeCoverHeader(input: PipeCoverParams): string[] {
	const p = clampPipeCover(input);
	return [m.t_pipe_cover_scad_title(), pipeCoverSummary(p)];
}

export function pipeCoverScad(p: PipeCoverParams): string {
	return toScad(pipeCoverModel(p), pipeCoverHeader(p));
}
