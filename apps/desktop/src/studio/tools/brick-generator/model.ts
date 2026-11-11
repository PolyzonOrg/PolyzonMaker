/**
 * «Кубики LEGO»: bricks, plates and tiles that fit the common LEGO
 * dimensions — studs on an 8 mm pitch, Ø4.8 × 1.7 mm; a plate 3.2 mm tall, a
 * brick three plates (9.6 mm); the outside 0.1 mm smaller per side than the
 * pitch; walls 1.2 mm, top 1.0 mm; Ø6.51 mm tubes underneath between four
 * studs and Ø3.2 mm pins where the part is one stud wide. FDM prints come
 * out a little different from moulded parts, so the stud diameter has a fit
 * setting. Besides rectangles: an L, a U and a plus of a chosen arm width,
 * or any shape drawn stud by stud on a grid, with the tubes and pins following
 * the shape. Prints studs up, no supports.
 */
import {
	cylinder,
	difference,
	extrude,
	inset,
	part,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/brick-generator';
import { clamp as c } from '../shared/math';

export type BrickShape = 'rect' | 'l' | 'u' | 'plus' | 'custom';
export type BrickFit = 'loose' | 'normal' | 'snug' | 'tight';

export interface BrickParams {
	/** Size in studs */
	length: number;
	width: number;
	/** Height in plates (3 plates = one brick) */
	plates: number;
	/** Smooth top without studs */
	tile: boolean;
	shape: BrickShape;
	/** Arm width of the L/U/plus shapes, in studs */
	arm: number;
	fit: BrickFit;
	wall: number;
	/** The studs of a drawn shape, "i,j" (i along the length, j along the width). */
	cells: string[];
}

export const BRICK_DEFAULTS: BrickParams = {
	length: 2,
	width: 2,
	plates: 3,
	tile: false,
	shape: 'rect',
	arm: 1,
	fit: 'normal',
	wall: 1.2,
	cells: []
};

export const BRICK_PRESETS: readonly { id: string; label: string; params: Partial<BrickParams> }[] =
	[
		{
			id: 'b24',
			get label() {
				return m.t_brick_generator_preset_brick_2x4();
			},
			params: { length: 4, width: 2, plates: 3, tile: false, shape: 'rect' }
		},
		{
			id: 'b16',
			get label() {
				return m.t_brick_generator_preset_brick_1x6();
			},
			params: { length: 6, width: 1, plates: 3, tile: false, shape: 'rect' }
		},
		{
			id: 'p46',
			get label() {
				return m.t_brick_generator_preset_plate_4x6();
			},
			params: { length: 6, width: 4, plates: 1, tile: false, shape: 'rect' }
		},
		{
			id: 't22',
			get label() {
				return m.t_brick_generator_preset_tile_2x2();
			},
			params: { length: 2, width: 2, plates: 1, tile: true, shape: 'rect' }
		},
		{
			id: 'l44',
			get label() {
				return m.t_brick_generator_preset_corner_4x4();
			},
			params: { length: 4, width: 4, plates: 1, tile: false, shape: 'l', arm: 2 }
		}
	];

export const FIT_OPTIONS: readonly { value: BrickFit; label: string; delta: number }[] = [
	{
		value: 'loose',
		get label() {
			return m.t_brick_generator_fit_loose();
		},
		delta: -0.05
	},
	{
		value: 'normal',
		get label() {
			return m.t_brick_generator_fit_normal();
		},
		delta: 0
	},
	{
		value: 'snug',
		get label() {
			return m.t_brick_generator_fit_snug();
		},
		delta: 0.05
	},
	{
		value: 'tight',
		get label() {
			return m.t_brick_generator_fit_tight();
		},
		delta: 0.1
	}
];

export const PITCH = 8;
export const PLATE = 3.2;
const SIDE_GAP = 0.1;
const STUD_D = 4.8;
const STUD_H = 1.7;
const TOP = 1;
const TUBE_OUT = 6.51;
const TUBE_IN = 4.8;
const PIN_D = 3.2;
const FN = 40;

export function clampBrick(p: BrickParams): BrickParams {
	const length = Math.round(c(p.length, 1, 16));
	const width = Math.round(c(p.width, 1, 16));
	const shape = (['rect', 'l', 'u', 'plus', 'custom'] as const).includes(p.shape)
		? p.shape
		: 'rect';
	return {
		length,
		width,
		plates: Math.round(c(p.plates, 1, 12)),
		tile: !!p.tile,
		shape,
		arm: Math.round(c(p.arm, 1, Math.max(1, Math.min(length, width) - 1))),
		fit: FIT_OPTIONS.some((f) => f.value === p.fit) ? p.fit : 'normal',
		wall: c(p.wall, 0.8, 2),
		// Only studs inside the grid, each once, in a stable order.
		cells: [...new Set(Array.isArray(p.cells) ? p.cells : [])]
			.filter((key) => {
				const m = /^(\d+),(\d+)$/.exec(key);
				return !!m && Number(m[1]) < length && Number(m[2]) < width;
			})
			.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
	};
}

/** Occupied studs as [i, j] (i along the length, j along the width). */
export function brickCells(input: BrickParams): [number, number][] {
	const p = clampBrick(input);
	const { length: L, width: W, arm: a } = p;
	if (p.shape === 'custom') {
		return p.cells.map((key) => key.split(',').map(Number) as [number, number]);
	}
	const out: [number, number][] = [];
	const midI = Math.floor((L - a) / 2);
	const midJ = Math.floor((W - a) / 2);
	for (let i = 0; i < L; i++)
		for (let j = 0; j < W; j++) {
			const inside =
				p.shape === 'rect' ||
				(p.shape === 'l' && (i < a || j < a)) ||
				(p.shape === 'u' && (j < a || i < a || i >= L - a)) ||
				(p.shape === 'plus' && ((i >= midI && i < midI + a) || (j >= midJ && j < midJ + a)));
			if (inside) out.push([i, j]);
		}
	return out;
}

/** One piece: every stud reaches every other through its neighbours. */
export function brickConnected(cells: readonly [number, number][]): boolean {
	if (cells.length < 2) return true;
	const left = new Set(cells.map(([i, j]) => `${i},${j}`));
	const queue = [cells[0]];
	left.delete(`${cells[0][0]},${cells[0][1]}`);
	while (queue.length) {
		const [i, j] = queue.pop()!;
		for (const [di, dj] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1]
		]) {
			const key = `${i + di},${j + dj}`;
			if (left.delete(key)) queue.push([i + di, j + dj]);
		}
	}
	return left.size === 0;
}

export interface BrickInfo {
	studs: number;
	tubes: number;
	pins: number;
	/** Without the studs, mm */
	size: [number, number, number];
}

function features(p: BrickParams) {
	const cells = brickCells(p);
	const has = new Set(cells.map(([i, j]) => `${i},${j}`));
	const at = (i: number, j: number) => has.has(`${i},${j}`);
	// Tubes: grid corners surrounded by four studs.
	const tubes: [number, number][] = [];
	for (let i = 1; i < p.length; i++)
		for (let j = 1; j < p.width; j++)
			if (at(i - 1, j - 1) && at(i, j - 1) && at(i - 1, j) && at(i, j)) tubes.push([i, j]);
	const tubeAt = new Set(tubes.map(([i, j]) => `${i},${j}`));
	// Pins: the middle of an edge between two studs where no tube is at either end.
	const pins: [number, number][] = [];
	for (const [i, j] of cells) {
		if (at(i + 1, j) && !tubeAt.has(`${i + 1},${j}`) && !tubeAt.has(`${i + 1},${j + 1}`))
			pins.push([i + 1, j + 0.5]);
		if (at(i, j + 1) && !tubeAt.has(`${i},${j + 1}`) && !tubeAt.has(`${i + 1},${j + 1}`))
			pins.push([i + 0.5, j + 1]);
	}
	return { cells, tubes, pins };
}

export function brickInfo(input: BrickParams): BrickInfo {
	const p = clampBrick(input);
	const f = features(p);
	return {
		studs: p.tile ? 0 : f.cells.length,
		tubes: f.tubes.length,
		pins: f.pins.length,
		size: [p.length * PITCH - 2 * SIDE_GAP, p.width * PITCH - 2 * SIDE_GAP, p.plates * PLATE]
	};
}

export function brickModel(input: BrickParams): Node {
	const p = clampBrick(input);
	const { cells, tubes, pins } = features(p);
	const H = p.plates * PLATE;
	const delta = FIT_OPTIONS.find((f) => f.value === p.fit)?.delta ?? 0;
	// The footprint: the studs' squares merged, 0.1 mm in from the pitch.
	const footprint = inset(
		-SIDE_GAP,
		union(...cells.map(([i, j]) => translate([i * PITCH, j * PITCH], square(PITCH, PITCH, false))))
	);
	const hollow = H - TOP;
	const studs = p.tile
		? []
		: cells.map(([i, j]) =>
				translate(
					[(i + 0.5) * PITCH, (j + 0.5) * PITCH, H - 0.01],
					cylinder(STUD_H + 0.01, (STUD_D + delta) / 2, (STUD_D + delta) / 2, FN)
				)
			);
	const under = [
		...tubes.map(([i, j]) =>
			translate(
				[i * PITCH, j * PITCH, 0],
				difference(
					cylinder(hollow + 0.01, TUBE_OUT / 2, TUBE_OUT / 2, FN),
					translate([0, 0, -1], cylinder(hollow + 2, TUBE_IN / 2, TUBE_IN / 2, FN))
				)
			)
		),
		...pins.map(([i, j]) =>
			translate([i * PITCH, j * PITCH, 0], cylinder(hollow + 0.01, PIN_D / 2, PIN_D / 2, FN))
		)
	];
	// The whole part centred on the origin, bottom on the bed.
	const shift = [(-p.length * PITCH) / 2, (-p.width * PITCH) / 2, 0];
	return translate(
		shift,
		part(
			'brick',
			difference(
				extrude(H, footprint),
				translate([0, 0, -1], extrude(hollow + 1, inset(-p.wall, footprint)))
			),
			...studs,
			...under
		)
	);
}

export function brickHeader(input: BrickParams): string[] {
	const p = clampBrick(input);
	const size = { length: num(p.length), width: num(p.width), plates: num(p.plates) };
	return [
		m.t_brick_generator_header_title(),
		p.tile ? m.t_brick_generator_header_size_tile(size) : m.t_brick_generator_header_size(size),
		m.t_brick_generator_header_standard()
	];
}

export function brickScad(p: BrickParams): string {
	return toScad(brickModel(p), brickHeader(p));
}
