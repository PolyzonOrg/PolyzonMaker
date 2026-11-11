/**
 * «Картина слоями пластика»: a picture printed as a thin relief in a stack of
 * filaments — dark at the bottom, light on top — changing filament on a few
 * layers. Where the picture is light the relief is tall and the light
 * filaments cover the dark ones; thin layers let the colour underneath show
 * through, which gives the in-between tones. Pure.
 *
 * Each filament has a transmission distance (TD): the thickness at which it
 * stops letting the colour underneath through. A stack of whole layers
 * gives one colour per height, so the look of the whole picture is a table
 * of N + 1 colours (N = layers above the base), and the error of a choice of
 * change layers is a sum over that table — cheap enough to search for the
 * best changes exhaustively, one change at a time.
 */
import { writeStl } from '../stl';
import {
	LITHO_DEFAULTS,
	imageToHeights,
	lithoLayout,
	lithophaneBody,
	type LithoLayout,
	type LithoParams
} from '../lithophane-generator/model';
import * as m from '$msg/tools/filament-painting';
import { clamp } from '../shared/math';

export interface Filament {
	/** #RRGGBB */
	colour: string;
	/** Transmission distance, mm. */
	td: number;
	/** Name shown in the list. */
	name: string;
}

export interface PaintParams {
	width: number;
	/** Height of the first layer, mm. */
	firstLayer: number;
	layer: number;
	/** Solid plate of the first filament, mm (snapped to whole layers). */
	base: number;
	/** Top of the tallest relief, mm. */
	height: number;
	/** mm between relief points. */
	resolution: number;
	brightness: number;
	contrast: number;
	gamma: number;
	/** Bottom to top. */
	filaments: Filament[];
	/** Pick the change layers by the picture (otherwise `starts`). */
	auto: boolean;
	/** Layer above the base where each filament after the first starts (1 = right above the base). */
	starts: number[];
}

/** A filament whose name is read in the page language when it is copied into the stack. */
const filament = (name: () => string, colour: string, td: number): Filament => ({
	get name() {
		return name();
	},
	colour,
	td
});

export const FILAMENT_STACKS: readonly { id: string; label: string; filaments: Filament[] }[] = [
	{
		id: 'bw3',
		get label() {
			return m.t_filament_painting_stack_bw3();
		},
		filaments: [
			filament(m.t_filament_painting_colour_black, '#1A1A1A', 0.6),
			filament(m.t_filament_painting_colour_grey, '#8A8A8A', 1.8),
			filament(m.t_filament_painting_colour_white, '#F4F4F2', 3)
		]
	},
	{
		id: 'bw4',
		get label() {
			return m.t_filament_painting_stack_bw4();
		},
		filaments: [
			filament(m.t_filament_painting_colour_black, '#1A1A1A', 0.6),
			filament(m.t_filament_painting_colour_dark_grey, '#555555', 1.2),
			filament(m.t_filament_painting_colour_light_grey, '#B4B4B4', 2.2),
			filament(m.t_filament_painting_colour_white, '#F4F4F2', 3)
		]
	},
	{
		id: 'sepia',
		get label() {
			return m.t_filament_painting_stack_sepia();
		},
		filaments: [
			filament(m.t_filament_painting_colour_black, '#1A1A1A', 0.6),
			filament(m.t_filament_painting_colour_brown, '#6B4428', 1.6),
			filament(m.t_filament_painting_colour_beige, '#D8BE96', 3.2),
			filament(m.t_filament_painting_colour_white, '#F4F4F2', 3)
		]
	},
	{
		id: 'colour',
		get label() {
			return m.t_filament_painting_stack_colour();
		},
		filaments: [
			filament(m.t_filament_painting_colour_black, '#1A1A1A', 0.6),
			filament(m.t_filament_painting_colour_blue, '#1F4FA8', 2.4),
			filament(m.t_filament_painting_colour_red, '#C8282E', 4),
			filament(m.t_filament_painting_colour_yellow, '#F2C81E', 6),
			filament(m.t_filament_painting_colour_white, '#F4F4F2', 3)
		]
	}
];

export const PAINT_DEFAULTS: PaintParams = {
	width: 120,
	firstLayer: 0.16,
	layer: 0.08,
	base: 0.48,
	height: 2,
	resolution: 0.3,
	brightness: 0,
	contrast: 0,
	gamma: 1,
	// A getter: the names are copied in the language of whoever reads the defaults.
	get filaments() {
		return FILAMENT_STACKS[1].filaments.map((f) => ({ ...f }));
	},
	auto: true,
	starts: []
};

export const MAX_FILAMENTS = 6;

/** A filament added to the stack: a mid grey, its TD typical of PLA. */
export const NEW_FILAMENT: Filament = filament(m.t_filament_painting_new_filament, '#9A9A9A', 2);

export interface PaintPlan {
	firstLayer: number;
	layer: number;
	/** Solid base, a whole number of layers. */
	base: number;
	/** Layers in the base (first layer included). */
	baseLayers: number;
	/** Layers above the base the relief can rise. */
	steps: number;
	/** Top of the tallest relief. */
	top: number;
}

export function paintPlan(p: PaintParams): PaintPlan {
	const firstLayer = clamp(p.firstLayer, 0.05, 0.4);
	const layer = clamp(p.layer, 0.04, 0.32);
	// A base of at least 0,3 mm: the plate has to hold together.
	const baseLayers = Math.max(
		1,
		1 + Math.ceil((0.3 - firstLayer) / layer - 1e-9),
		1 + Math.round((clamp(p.base, firstLayer, 2) - firstLayer) / layer)
	);
	const base = firstLayer + (baseLayers - 1) * layer;
	// At least a layer per filament, and 1,5 mm in all: thinner pictures warp and break.
	const steps = Math.max(
		p.filaments.length,
		Math.ceil((1.5 - base) / layer - 1e-9),
		Math.round((clamp(p.height, 1.5, 6) - base) / layer)
	);
	return { firstLayer, layer, base, baseLayers, steps, top: base + steps * layer };
}

// ---------- Colour ----------

type Vec3 = [number, number, number];

export function rgbOf(hex: string): Vec3 {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	const v = m ? parseInt(m[1], 16) : 0x808080;
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const toLinear = (c: number) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (l: number) => {
	const v = Math.min(1, Math.max(0, l));
	return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
};

function linToLab(r: number, g: number, b: number): Vec3 {
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
	const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
	const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
	const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Relative lightness 0…1 of a colour (for sorting a stack dark to light). */
export function lightnessOf(hex: string): number {
	const [r, g, b] = rgbOf(hex).map(toLinear);
	return linToLab(r, g, b)[0] / 100;
}

/**
 * What the picture looks like at every height: colour after `n` layers
 * above the base, n = 0…steps, in linear RGB. A layer of filament with
 * TD lets exp(−3·layer/TD) of what is under it through (5 % at TD).
 */
export function stackColours(
	filaments: readonly Filament[],
	plan: PaintPlan,
	starts: readonly number[]
): Vec3[] {
	const lin = filaments.map((f) => rgbOf(f.colour).map(toLinear) as Vec3);
	const pass = filaments.map((f) => Math.exp((-3 * plan.layer) / clamp(f.td, 0.1, 50)));
	const out: Vec3[] = [];
	let c: Vec3 = [...lin[0]];
	out.push([...c]);
	let f = 0;
	for (let n = 1; n <= plan.steps; n++) {
		while (f + 1 < filaments.length && n >= starts[f]) f++;
		const t = pass[f];
		c = [
			c[0] * t + lin[f][0] * (1 - t),
			c[1] * t + lin[f][1] * (1 - t),
			c[2] * t + lin[f][2] * (1 - t)
		];
		out.push([...c]);
	}
	return out;
}

/** Change layers spread by the filaments' lightness: each starts halfway between its neighbours'. */
export function evenStarts(filaments: readonly Filament[], steps: number): number[] {
	const L = filaments.map((f) => lightnessOf(f.colour));
	const lo = L[0];
	const hi = Math.max(L[L.length - 1], lo + 1e-3);
	const F = filaments.length;
	const starts: number[] = [];
	let prev = 0;
	for (let i = 1; i < F; i++) {
		const mid = ((L[i - 1] + L[i]) / 2 - lo) / (hi - lo);
		const s = Math.min(
			steps - (F - 1 - i),
			Math.max(prev + 1, Math.round(clamp(mid, 0, 1) * steps))
		);
		starts.push(s);
		prev = s;
	}
	return starts;
}

/** Lightness bins the picture is sorted into. */
const BINS = 128;

/** The picture by lightness: each pixel's bin and, per bin, sums of its colours in CIELAB. */
export interface PictureStats {
	bins: Uint8Array;
	count: Float64Array;
	sum: Float64Array;
	/** ΣL² and Σ(a² + b²) per bin. */
	sqL: Float64Array;
	sqAB: Float64Array;
	/** The picture's dark and light ends (L*, 1st and 99th percentile). */
	lo: number;
	hi: number;
}

/**
 * Lightness bins after brightness, contrast and gamma — and the colours
 * the print should match: the picture's own, at that lightness.
 */
export function pictureStats(rgba: ArrayLike<number>, count: number, p: PaintParams): PictureStats {
	const lum = imageToHeights(rgba, count, {
		negative: true,
		brightness: p.brightness,
		contrast: p.contrast,
		gamma: p.gamma
	});
	const bins = new Uint8Array(count);
	const n = new Float64Array(BINS);
	const sum = new Float64Array(BINS * 3);
	const sqL = new Float64Array(BINS);
	const sqAB = new Float64Array(BINS);
	for (let i = 0; i < count; i++) {
		// Transparent is white paper, as for the heights.
		const a = rgba[i * 4 + 3] / 255;
		const rgb = [0, 1, 2].map((k) => rgba[i * 4 + k] * a + 255 * (1 - a));
		const own = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
		const k = own > 1e-3 ? lum[i] / own : 0;
		const c = rgb.map((v) => toLinear(Math.min(255, own > 1e-3 ? v * k : lum[i] * 255)));
		const lab = linToLab(c[0], c[1], c[2]);
		const b = Math.round(lum[i] * (BINS - 1));
		bins[i] = b;
		n[b]++;
		sum[b * 3] += lab[0];
		sum[b * 3 + 1] += lab[1];
		sum[b * 3 + 2] += lab[2];
		sqL[b] += lab[0] ** 2;
		sqAB[b] += lab[1] ** 2 + lab[2] ** 2;
	}
	// Percentiles of lightness over the bins (bins rise with lightness).
	const end = (q: number) => {
		let seen = 0;
		for (let b = 0; b < BINS; b++) {
			seen += n[b];
			if (n[b] && seen >= q * count) return sum[b * 3] / n[b];
		}
		return 100;
	};
	const lo = end(0.01);
	const hi = Math.max(lo + 1, end(0.99));
	return { bins, count: n, sum, sqL, sqAB, lo, hi };
}

/**
 * The best height for every lightness, given the stack's colour at each
 * height: rising with lightness (so the relief stays smooth), as close to
 * the picture as it gets (dynamic programming over bins × heights). The
 * picture's lightness is first stretched over `range` — what these
 * filaments can show at this height — so tones stay apart, and a stack
 * that cannot reach the light end pays for it.
 */
export function toneMap(
	stats: PictureStats,
	colours: readonly Vec3[],
	range: readonly [number, number]
): { map: Int16Array; error: number } {
	const N = colours.length;
	const labs = colours.map((c) => linToLab(...c));
	const [Lmin, Lmax] = range;
	// L' = αL + β takes the picture's lo…hi to Lmin…Lmax.
	const alpha = (Lmax - Lmin) / (stats.hi - stats.lo);
	const beta = Lmin - alpha * stats.lo;
	const cost = (b: number, h: number) => {
		const k = stats.count[b];
		if (!k) return 0;
		const l = labs[h];
		const sL = alpha * stats.sum[b * 3] + beta * k;
		const qL = alpha * alpha * stats.sqL[b] + 2 * alpha * beta * stats.sum[b * 3] + beta * beta * k;
		return (
			qL +
			stats.sqAB[b] -
			2 * (l[0] * sL + l[1] * stats.sum[b * 3 + 1] + l[2] * stats.sum[b * 3 + 2]) +
			k * (l[0] ** 2 + l[1] ** 2 + l[2] ** 2)
		);
	};
	const back = new Int16Array(BINS * N);
	let prev = new Float64Array(N);
	for (let h = 0; h < N; h++) prev[h] = cost(0, h);
	for (let b = 1; b < BINS; b++) {
		const cur = new Float64Array(N);
		let best = Infinity;
		let arg = 0;
		for (let h = 0; h < N; h++) {
			if (prev[h] < best) {
				best = prev[h];
				arg = h;
			}
			cur[h] = cost(b, h) + best;
			back[b * N + h] = arg;
		}
		prev = cur;
	}
	let h = 0;
	for (let k = 1; k < N; k++) if (prev[k] < prev[h]) h = k;
	const total = stats.count.reduce((s, c) => s + c, 0);
	const error = total ? Math.max(0, prev[h]) / total : 0;
	const map = new Int16Array(BINS);
	for (let b = BINS - 1; b >= 0; b--) {
		map[b] = h;
		h = back[b * N + h];
	}
	return { map, error };
}

/**
 * Darkest and lightest the filaments can look at this height (L*): the
 * first filament alone, and each next one a layer after the last.
 */
export function stackRange(filaments: readonly Filament[], plan: PaintPlan): [number, number] {
	const earliest = Array.from({ length: filaments.length - 1 }, (_, i) => i + 1);
	const L = stackColours(filaments, plan, earliest).map((c) => linToLab(...c)[0]);
	const lo = Math.min(...L);
	return [lo, Math.max(lo + 1, ...L)];
}

const errorOf = (
	filaments: readonly Filament[],
	plan: PaintPlan,
	stats: PictureStats,
	starts: number[],
	range: readonly [number, number]
) => toneMap(stats, stackColours(filaments, plan, starts), range).error;

/**
 * The change layers that make the print look most like the picture:
 * coordinate descent, one change at a time over all its layers, from two
 * starting points (by lightness and evenly spread); the better wins.
 */
export function bestStarts(
	filaments: readonly Filament[],
	plan: PaintPlan,
	stats: PictureStats
): number[] {
	const F = filaments.length;
	if (F < 2) return [];
	const spread = Array.from({ length: F - 1 }, (_, i) => Math.round(((i + 1) * plan.steps) / F));
	const range = stackRange(filaments, plan);
	let winner: number[] = [];
	let winnerError = Infinity;
	for (const init of [evenStarts(filaments, plan.steps), spread]) {
		const starts = [...init];
		let best = errorOf(filaments, plan, stats, starts, range);
		for (let pass = 0; pass < 12; pass++) {
			let moved = false;
			for (let i = 0; i < F - 1; i++) {
				const lo = i ? starts[i - 1] + 1 : 1;
				const hi = i < F - 2 ? starts[i + 1] - 1 : plan.steps;
				let keep = starts[i];
				for (let s = lo; s <= hi; s++) {
					if (s === keep) continue;
					starts[i] = s;
					const e = errorOf(filaments, plan, stats, starts, range);
					if (e < best - 1e-9) {
						best = e;
						keep = s;
						moved = true;
					}
				}
				starts[i] = keep;
			}
			if (!moved) break;
		}
		if (best < winnerError) {
			winnerError = best;
			winner = starts;
		}
	}
	return winner;
}

// ---------- The job ----------

export interface PaintJob {
	params: PaintParams;
	layout: LithoLayout;
	/** RGBA resampled to layout.cols × layout.rows. */
	rgba: Uint8ClampedArray;
}

export interface PaintChange {
	filament: number;
	/** The first layer printed with it (1 = the first layer). */
	layer: number;
	/** Where that layer starts, mm. */
	z: number;
}

export interface PaintResult {
	stl: Uint8Array;
	triangles: number;
	/** The look of the print, RGBA at layout.cols × layout.rows. */
	preview: Uint8ClampedArray;
	/** The relief's triangles by the filament at their height (the 3D preview). */
	bands: Float32Array[];
	changes: PaintChange[];
	starts: number[];
	/** Root mean square ΔE between the picture and its look. */
	error: number;
}

/** Layout of the relief grid for a picture of this aspect. */
export function paintLayout(p: PaintParams, aspect: number): LithoLayout {
	return lithoLayout(litho(p), aspect);
}

function litho(p: PaintParams): LithoParams {
	const plan = paintPlan(p);
	return {
		...LITHO_DEFAULTS,
		shape: 'panel',
		width: clamp(p.width, 20, 250),
		minThickness: plan.base,
		maxThickness: plan.top,
		resolution: clamp(p.resolution, 0.15, 1)
	};
}

/** The filament on top at each layer above the base. */
export function filamentAt(n: number, starts: readonly number[]): number {
	let f = 0;
	while (f < starts.length && n >= starts[f]) f++;
	return f;
}

export function paint(job: PaintJob): PaintResult {
	const p = job.params;
	const plan = paintPlan(p);
	const filaments = p.filaments.slice(0, MAX_FILAMENTS);
	const F = filaments.length;
	const count = job.layout.cols * job.layout.rows;
	const stats = pictureStats(job.rgba, count, p);
	let starts: number[];
	if (p.auto || p.starts.length !== F - 1) starts = bestStarts(filaments, plan, stats);
	else {
		starts = [];
		for (let i = 0; i < F - 1; i++)
			starts.push(
				Math.round(clamp(p.starts[i], (starts[i - 1] ?? 0) + 1, plan.steps - (F - 2 - i)))
			);
	}
	const colours = stackColours(filaments, plan, starts);
	const { map, error } = toneMap(stats, colours, stackRange(filaments, plan));

	const levels = new Int16Array(count);
	const preview = new Uint8ClampedArray(count * 4);
	for (let i = 0; i < count; i++) {
		const n = map[stats.bins[i]];
		levels[i] = n;
		const c = colours[n];
		preview[i * 4] = toSrgb(c[0]);
		preview[i * 4 + 1] = toSrgb(c[1]);
		preview[i * 4 + 2] = toSrgb(c[2]);
		preview[i * 4 + 3] = 255;
	}

	const heights = new Float32Array(count);
	for (let i = 0; i < count; i++) heights[i] = levels[i] / plan.steps;
	const tris = lithophaneBody(litho(p), heights, job.layout);

	// The 3D look: every triangle in the colour of the filament at its height.
	const groups: number[][] = filaments.map(() => []);
	for (let t = 0; t < tris.length; t += 9) {
		const z = Math.max(tris[t + 2], tris[t + 5], tris[t + 8]);
		const n = Math.ceil((z - plan.base) / plan.layer - 1e-4);
		groups[n <= 0 ? 0 : filamentAt(n, starts)].push(t);
	}
	const bands = groups.map((g) => {
		const out = new Float32Array(g.length * 9);
		g.forEach((t, k) => out.set(tris.subarray(t, t + 9), k * 9));
		return out;
	});

	const changes: PaintChange[] = [{ filament: 0, layer: 1, z: 0 }];
	starts.forEach((s, i) =>
		changes.push({
			filament: i + 1,
			layer: plan.baseLayers + s,
			z: plan.base + (s - 1) * plan.layer
		})
	);
	return {
		stl: writeStl(tris),
		triangles: tris.length / 9,
		preview,
		bands,
		changes,
		starts,
		error: Math.sqrt(error)
	};
}
