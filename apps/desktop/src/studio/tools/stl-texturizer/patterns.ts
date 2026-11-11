/**
 * Procedural relief patterns for «Текстура на модели». Each one is a height
 * h(u, v) ∈ [0, 1] over texture space measured in tiles: 1 = high, 0 = low.
 * Every pattern repeats with period 1 along u, so a whole number of tiles
 * wraps around a cylinder without a seam. Written from scratch for Polyzon
 * Studio; pure, no dependencies.
 */

import * as m from '$msg/tools/stl-texturizer';
import { smoothstep as smooth } from '../shared/math';

export type HeightFn = (u: number, v: number) => number;

const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);

const fract = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const wrap = (i: number, p: number) => ((i % p) + p) % p;

/** Integer lattice point → [0, 1). */
function hash(x: number, y: number, seed = 0): number {
	let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise with `period` lattice cells per tile, tiling in u and v. */
function noise(u: number, v: number, period: number, seed = 0): number {
	const x = u * period;
	const y = v * period;
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const x0 = wrap(ix, period);
	const x1 = wrap(ix + 1, period);
	const y0 = wrap(iy, period);
	const y1 = wrap(iy + 1, period);
	const a = hash(x0, y0, seed);
	const b = hash(x1, y0, seed);
	const c = hash(x0, y1, seed);
	const d = hash(x1, y1, seed);
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Several octaves of noise, normalised back to [0, 1]. */
function fbm(u: number, v: number, period: number, octaves: number, seed = 0): number {
	let sum = 0;
	let amp = 1;
	let total = 0;
	for (let o = 0; o < octaves; o++) {
		sum += amp * noise(u, v, period << o, seed + o);
		total += amp;
		amp *= 0.5;
	}
	return sum / total;
}

/** Cellular noise: distances to the nearest two jittered points and the nearest one's id. */
const cell = { d1: 0, d2: 0, id: 0 };
function cells(u: number, v: number, period: number): typeof cell {
	const x = u * period;
	const y = v * period;
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	let d1 = 9;
	let d2 = 9;
	let id = 0;
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			const cx = wrap(ix + dx, period);
			const cy = wrap(iy + dy, period);
			const px = ix + dx + 0.15 + 0.7 * hash(cx, cy, 1);
			const py = iy + dy + 0.15 + 0.7 * hash(cx, cy, 2);
			const d = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
			if (d < d1) {
				d2 = d1;
				d1 = d;
				id = hash(cx, cy, 3);
			} else if (d < d2) d2 = d;
		}
	}
	cell.d1 = d1;
	cell.d2 = d2;
	cell.id = id;
	return cell;
}

/** A thread seen from above: round across, a little lower where it dives under. */
function strand(across: number, along: number, gamma: number, dip: number): number {
	return Math.pow(Math.sin(Math.PI * across), gamma) * (1 - dip + dip * Math.sin(Math.PI * along));
}

const masonry: HeightFn = (u, v) => {
	// Two courses per repeat, every other one shifted by half a block.
	const y = v * 2;
	const course = Math.floor(y);
	const x = u + (course & 1) * 0.5;
	const dx = Math.min(fract(x), 1 - fract(x));
	const dy = Math.min(fract(y), 1 - fract(y)) / 2;
	return smooth(0.02, 0.05, Math.min(dx, dy));
};

const hexagons: HeightFn = (u, v) => {
	// Two offset rectangular lattices of hexagon centres; the nearer one wins.
	const ax = fract(u) - 0.5;
	const ay = fract(v / SQRT3) * SQRT3 - SQRT3 / 2;
	const bx = fract(u - 0.5) - 0.5;
	const by = fract(v / SQRT3 - 0.5) * SQRT3 - SQRT3 / 2;
	const nearA = ax * ax + ay * ay < bx * bx + by * by;
	const x = Math.abs(nearA ? ax : bx);
	const y = Math.abs(nearA ? ay : by);
	const d = Math.max(x, x / 2 + (y * SQRT3) / 2);
	return 1 - smooth(0.41, 0.47, d);
};

/** Distance to the nearest scale centre of a row, in scale radii. */
function scaleDistance(x: number, y: number, row: number): number {
	const sx = x - (row & 1) * 0.5;
	const dx = sx - Math.round(sx);
	const dy = y - row;
	return Math.sqrt(dx * dx + dy * dy) / 0.75;
}

const scales: HeightFn = (u, v) => {
	// Each row of round scales lies over the row below it; a scale rises
	// towards its free edge, so every edge stands proud of its neighbour.
	const x = u * 2;
	const y = v * 2;
	const row = Math.floor(y);
	const front = scaleDistance(x, y, row + 1);
	return Math.min(1, front < 1 ? front : scaleDistance(x, y, row));
};

const herringbone: HeightFn = (u, v) => {
	// Columns of slanted ribs; the slant flips and the ribs jump half a step
	// at every column seam.
	const x = u * 4;
	const k = Math.floor(x);
	const f = x - k;
	const t = 6 * v + (k & 1 ? f : -f) * 1.5;
	return (0.5 + 0.5 * Math.cos(TAU * t)) * smooth(0, 0.08, Math.min(f, 1 - f));
};

const zigzag: HeightFn = (u, v) =>
	0.5 + 0.5 * Math.cos(TAU * (4 * v + 1.2 * Math.abs(2 * fract(2 * u) - 1)));

const weave: HeightFn = (u, v) => {
	// Plain weave: each thread goes over one and under the next.
	const x = u * 6;
	const y = v * 6;
	const i = Math.floor(x);
	const j = Math.floor(y);
	const over = ((i + j) & 1) === 0;
	return strand(over ? y - j : x - i, over ? x - i : y - j, 0.7, 0.4);
};

const knurl: HeightFn = (u, v) => {
	// Two crossing sets of grooves leave a field of small pyramids.
	const a = fract(u + v);
	const b = fract(u - v);
	return Math.min(1 - Math.abs(2 * a - 1), 1 - Math.abs(2 * b - 1));
};

const waves: HeightFn = (u, v) => 0.5 + 0.5 * Math.sin(TAU * (v + 0.25 * Math.sin(TAU * u)));

const ribs: HeightFn = (u) => 0.5 + 0.5 * Math.cos(TAU * u);

const cobbles: HeightFn = (u, v) => {
	// Irregular stones of slightly different heights with joints between them.
	const c = cells(u, v, 5);
	return smooth(0, 0.25, c.d2 - c.d1) * (0.7 + 0.3 * c.id);
};

const sand: HeightFn = (u, v) => fbm(u, v, 8, 3);

export const PATTERNS = [
	{
		id: 'hexagons',
		get label() {
			return m.t_stl_texturizer_pattern_hexagons();
		},
		fn: hexagons
	},
	{
		id: 'scales',
		get label() {
			return m.t_stl_texturizer_pattern_scales();
		},
		fn: scales
	},
	{
		id: 'masonry',
		get label() {
			return m.t_stl_texturizer_pattern_masonry();
		},
		fn: masonry
	},
	{
		id: 'cobbles',
		get label() {
			return m.t_stl_texturizer_pattern_cobbles();
		},
		fn: cobbles
	},
	{
		id: 'herringbone',
		get label() {
			return m.t_stl_texturizer_pattern_herringbone();
		},
		fn: herringbone
	},
	{
		id: 'zigzag',
		get label() {
			return m.t_stl_texturizer_pattern_zigzag();
		},
		fn: zigzag
	},
	{
		id: 'weave',
		get label() {
			return m.t_stl_texturizer_pattern_weave();
		},
		fn: weave
	},
	{
		id: 'knurl',
		get label() {
			return m.t_stl_texturizer_pattern_knurl();
		},
		fn: knurl
	},
	{
		id: 'waves',
		get label() {
			return m.t_stl_texturizer_pattern_waves();
		},
		fn: waves
	},
	{
		id: 'ribs',
		get label() {
			return m.t_stl_texturizer_pattern_ribs();
		},
		fn: ribs
	},
	{
		id: 'sand',
		get label() {
			return m.t_stl_texturizer_pattern_sand();
		},
		fn: sand
	}
] as const satisfies readonly { id: string; label: string; fn: HeightFn }[];

export type PatternId = (typeof PATTERNS)[number]['id'];

export function patternFn(id: PatternId): HeightFn {
	return (PATTERNS.find((p) => p.id === id) ?? PATTERNS[0]).fn;
}

/** A grayscale picture as a height map: row 0 is the top, values 0..1. */
export interface HeightImage {
	width: number;
	height: number;
	data: Float32Array;
}

/**
 * Bilinear sample of a repeating height image (v grows upwards). A tile is
 * the picture's width; its height keeps the picture's proportions.
 */
export function imageFn(img: HeightImage): HeightFn {
	const { width: w, height: h, data } = img;
	const aspect = w / h;
	return (u, v) => {
		const x = fract(u) * w - 0.5;
		const y = (1 - fract(v * aspect)) * h - 0.5;
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const fx = x - x0;
		const fy = y - y0;
		const at = (i: number, j: number) => data[wrap(j, h) * w + wrap(i, w)];
		const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
		const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
		return clamp01(top + (bottom - top) * fy);
	};
}
