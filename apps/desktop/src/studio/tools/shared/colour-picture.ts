/**
 * A picture in colours → a plate with a part per colour, for «Логотип по
 * цветам» (smooth traced contours) and «Пиксельная мозаика» (square or
 * round cells). Pure: the page resamples the picture on a canvas, the worker
 * runs `quantize` and `buildPicture` with manifold-3d.
 *
 *   RGBA → colours (k-means in CIELAB; exact when the picture has few)
 *        → background (the colour along the border, or transparency)
 *        → a region per colour (traced or cells), disjoint
 *        → solids: a base plate and the colours inlaid flush, raised, or
 *          raised in steps for a single nozzle with colour changes by layer.
 */
import type { Manifold } from 'manifold-3d';
import type { Triangles } from '../stl';
import {
	fillHoles,
	offset,
	rect,
	slab,
	toSection,
	trianglesOf,
	union,
	unionSections,
	type Kit
} from './section';
import { dropSmall, traceGray, type Point, type Ring } from './trace';
import type { CrossSection } from 'manifold-3d';
import * as tc from '$msg/tools/common';
import { clamp } from './math';

export type PictureKind = 'logo' | 'mosaic';
/** flat: colours inlaid flush with the top; raised: on top; layers: stepped, for colour changes. */
export type Relief = 'flat' | 'raised' | 'layers';
/** base: the background becomes the plate; remove: the plate follows the drawing. */
export type Background = 'base' | 'remove';
export type CellShape = 'square' | 'gap' | 'round';

export interface PictureParams {
	/** Colours in the picture, the background included. */
	colours: number;
	/** Width of the picture, mm. */
	width: number;
	relief: Relief;
	background: Background;
	/** Plate thickness, mm. */
	base: number;
	/** Colour layer: inlay depth, raise, or one step, mm. */
	top: number;
	/** Plate margin round the drawing when the background goes, mm. */
	border: number;
	/** Plate corner radius when the background stays, mm. */
	corner: number;
	/** Logo: picture resolution, px on the long side. */
	detail: number;
	/** Mosaic: cells across. */
	pixels: number;
	cell: CellShape;
	/** Mosaic: gap between cells, mm (gap and round cells). */
	gap: number;
	/** Layer height the steps snap to and the change list counts by, mm. */
	layer: number;
}

export const PICTURE_DEFAULTS: PictureParams = {
	colours: 4,
	width: 100,
	relief: 'flat',
	background: 'base',
	base: 1.6,
	top: 0.6,
	border: 2,
	corner: 3,
	detail: 500,
	pixels: 48,
	cell: 'square',
	gap: 0.4,
	layer: 0.2
};

export function clampPicture(p: PictureParams): PictureParams {
	const layer = clamp(p.layer, 0.05, 0.4);
	return {
		...p,
		colours: Math.round(clamp(p.colours, 2, 8)),
		width: clamp(p.width, 20, 300),
		base: clamp(p.base, 0.6, 6),
		top: clamp(p.top, 0.2, 3),
		border: clamp(p.border, 0, 15),
		corner: clamp(p.corner, 0, 30),
		detail: Math.round(clamp(p.detail, 200, 1000)),
		pixels: Math.round(clamp(p.pixels, 8, 160)),
		gap: clamp(p.gap, 0.2, 2),
		layer
	};
}

/** Grid size the page resamples the picture to. */
export function pictureGrid(input: PictureParams, kind: PictureKind, aspect: number) {
	const p = clampPicture(input);
	const a = clamp(aspect, 0.05, 20);
	if (kind === 'mosaic') {
		const cols = p.pixels;
		return { cols, rows: Math.max(1, Math.round(cols / a)) };
	}
	const long = p.detail;
	return a >= 1
		? { cols: long, rows: Math.max(8, Math.round(long / a)) }
		: { cols: Math.max(8, Math.round(long * a)), rows: long };
}

// ---------- Colours ----------

type Lab = [number, number, number];

function toLab(r: number, g: number, b: number): Lab {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const R = lin(r);
	const G = lin(g);
	const B = lin(b);
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
	const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
	const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
	const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
	return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const d2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export interface Quantized {
	/** Colours, the most common first. */
	palette: [number, number, number][];
	/** Colour of every pixel; −1 where the picture is transparent. */
	labels: Int16Array;
	counts: number[];
}

/**
 * The picture in at most `k` colours: k-means in CIELAB (seeded, so the same
 * picture always splits the same way), or the picture's own colours when it
 * has no more than `k` (pixel art, flat logos).
 */
export function quantize(rgba: ArrayLike<number>, count: number, k: number): Quantized {
	const opaque: number[] = [];
	for (let i = 0; i < count; i++) if (rgba[i * 4 + 3] >= 128) opaque.push(i);
	const labels = new Int16Array(count).fill(-1);
	if (!opaque.length) return { palette: [], labels, counts: [] };
	const key = (i: number) => (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];

	let centres: Lab[] = [];
	let rgb: [number, number, number][] = [];
	const distinct = new Map<number, number>();
	for (const i of opaque) {
		distinct.set(key(i), (distinct.get(key(i)) ?? 0) + 1);
		if (distinct.size > k) break;
	}
	if (distinct.size <= k) {
		rgb = [...distinct.keys()].map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
		centres = rgb.map((c) => toLab(...c));
	} else {
		// k-means++ on a sample, then a few Lloyd steps.
		const step = Math.max(1, Math.floor(opaque.length / 30000));
		const sample: Lab[] = [];
		for (let s = 0; s < opaque.length; s += step) {
			const i = opaque[s];
			sample.push(toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]));
		}
		let seed = 12345;
		const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
		centres = [sample[Math.floor(rnd() * sample.length)]];
		const near = new Float64Array(sample.length).fill(Infinity);
		while (centres.length < k) {
			const last = centres[centres.length - 1];
			let total = 0;
			for (let s = 0; s < sample.length; s++) {
				near[s] = Math.min(near[s], d2(sample[s], last));
				total += near[s];
			}
			if (!(total > 0)) break;
			let pick = rnd() * total;
			let s = 0;
			while (s < sample.length - 1 && (pick -= near[s]) > 0) s++;
			centres.push(sample[s]);
		}
		const owner = new Int32Array(sample.length);
		for (let iter = 0; iter < 16; iter++) {
			const sum = centres.map(() => [0, 0, 0, 0]);
			for (let s = 0; s < sample.length; s++) {
				let best = 0;
				let bd = Infinity;
				for (let c = 0; c < centres.length; c++) {
					const d = d2(sample[s], centres[c]);
					if (d < bd) {
						bd = d;
						best = c;
					}
				}
				owner[s] = best;
				const t = sum[best];
				t[0] += sample[s][0];
				t[1] += sample[s][1];
				t[2] += sample[s][2];
				t[3]++;
			}
			centres = centres.map((c, i) =>
				sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c
			);
		}
		// Each colour as the mean of its real pixels, in RGB.
		const acc = centres.map(() => [0, 0, 0, 0]);
		for (const i of opaque) {
			const lab = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
			let best = 0;
			let bd = Infinity;
			for (let c = 0; c < centres.length; c++) {
				const d = d2(lab, centres[c]);
				if (d < bd) {
					bd = d;
					best = c;
				}
			}
			const t = acc[best];
			t[0] += rgba[i * 4];
			t[1] += rgba[i * 4 + 1];
			t[2] += rgba[i * 4 + 2];
			t[3]++;
		}
		rgb = acc
			.filter((t) => t[3] > 0)
			.map((t) => [Math.round(t[0] / t[3]), Math.round(t[1] / t[3]), Math.round(t[2] / t[3])]);
		centres = rgb.map((c) => toLab(...c));
	}

	const counts = centres.map(() => 0);
	for (const i of opaque) {
		const lab = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
		let best = 0;
		let bd = Infinity;
		for (let c = 0; c < centres.length; c++) {
			const d = d2(lab, centres[c]);
			if (d < bd) {
				bd = d;
				best = c;
			}
		}
		labels[i] = best;
		counts[best]++;
	}
	// The most common colour first; empty ones go.
	const order = counts.map((_, i) => i).filter((i) => counts[i] > 0);
	order.sort((a, b) => counts[b] - counts[a]);
	const remap = new Int16Array(centres.length).fill(-1);
	order.forEach((c, n) => (remap[c] = n));
	for (let i = 0; i < count; i++) if (labels[i] >= 0) labels[i] = remap[labels[i]];
	return { palette: order.map((c) => rgb[c]), labels, counts: order.map((c) => counts[c]) };
}

/** The colour along the picture's edge (−1: transparent), if it holds most of it. */
export function backgroundOf(labels: Int16Array, w: number, h: number): number | null {
	const seen = new Map<number, number>();
	let n = 0;
	const add = (i: number) => {
		seen.set(labels[i], (seen.get(labels[i]) ?? 0) + 1);
		n++;
	};
	for (let x = 0; x < w; x++) {
		add(x);
		add((h - 1) * w + x);
	}
	for (let y = 1; y < h - 1; y++) {
		add(y * w);
		add(y * w + w - 1);
	}
	let best: number | null = null;
	let most = 0;
	for (const [label, c] of seen)
		if (c > most) {
			most = c;
			best = label;
		}
	return most >= n * 0.4 ? best : null;
}

export const hex = (c: readonly number[]) =>
	'#' +
	c
		.map((v) => Math.round(v).toString(16).padStart(2, '0'))
		.join('')
		.toUpperCase();

// ---------- Solids ----------

export interface PicturePart {
	/** 'base' or the colour's index in the palette. */
	key: 'base' | number;
	name: string;
	tris: Triangles;
}

export interface ColourChange {
	/** The first layer printed in this colour (1 = the first layer). */
	layer: number;
	/** Height where it starts, mm. */
	z: number;
	/** 'base' or the colour's index in the palette. */
	key: 'base' | number;
}

export interface PictureJob {
	params: PictureParams;
	kind: PictureKind;
	rgba: Uint8ClampedArray;
	w: number;
	h: number;
}

export interface PictureResult {
	palette: string[];
	/** Share of the picture per colour, 0…1. */
	shares: number[];
	/** The background colour's index, −1 for transparency, null for none. */
	background: number | null;
	parts: PicturePart[];
	/** All parts as one solid. */
	whole: Triangles;
	/** Single nozzle: where to change the filament (empty for flat and raised). */
	changes: ColourChange[];
	size: [number, number, number];
}

/** Heights snapped to whole layers. */
export function snapped(p: PictureParams) {
	const L = p.layer;
	const snap = (v: number) => Math.max(L, Math.round(v / L) * L);
	return { base: snap(p.base), top: snap(p.top) };
}

/** Rows of runs of one label as rectangles (cells merged along each row). */
function cellRings(
	labels: Int16Array,
	w: number,
	h: number,
	label: number,
	pitch: number,
	shape: CellShape,
	gap: number
): Ring[] {
	const rings: Ring[] = [];
	const top = h * pitch;
	for (let y = 0; y < h; y++) {
		const y1 = top - y * pitch;
		const y0 = y1 - pitch;
		let x = 0;
		while (x < w) {
			if (labels[y * w + x] !== label) {
				x++;
				continue;
			}
			if (shape === 'square') {
				let end = x;
				while (end + 1 < w && labels[y * w + end + 1] === label) end++;
				rings.push([
					[x * pitch, y0],
					[(end + 1) * pitch, y0],
					[(end + 1) * pitch, y1],
					[x * pitch, y1]
				]);
				x = end + 1;
				continue;
			}
			const g = gap / 2;
			if (shape === 'gap') {
				rings.push([
					[x * pitch + g, y0 + g],
					[(x + 1) * pitch - g, y0 + g],
					[(x + 1) * pitch - g, y1 - g],
					[x * pitch + g, y1 - g]
				]);
			} else {
				const r = pitch / 2 - g;
				const cx = (x + 0.5) * pitch;
				const cy = (y0 + y1) / 2;
				const n = 24;
				const ring: Ring = [];
				for (let k = 0; k < n; k++) {
					const a = (k / n) * Math.PI * 2;
					ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
				}
				rings.push(ring);
			}
			x++;
		}
	}
	return rings;
}

/** Traced contours of one label, in mm (y up from the bottom edge). */
function tracedRings(labels: Int16Array, w: number, h: number, label: number, k: number): Ring[] {
	const gray = new Uint8Array(w * h).fill(255);
	for (let i = 0; i < w * h; i++) if (labels[i] === label) gray[i] = 0;
	const rings = traceGray(gray, w, h, { threshold: 128, invert: false, blur: 0.8, smooth: 1 }, 1.5);
	return dropSmall(
		rings.map((r) => r.map(([x, y]) => [x * k, y * k] as Point)),
		0.5
	);
}

export function buildPicture(kit: Kit, job: PictureJob, q: Quantized): PictureResult {
	const p = clampPicture(job.params);
	const { w, h, kind } = job;
	const k = p.width / w;
	const bg = backgroundOf(q.labels, w, h);
	const { base: B, top } = snapped(p);
	// Inlaid colours leave at least a layer of plate under them.
	const T = p.relief === 'flat' ? Math.min(top, B - p.layer) : top;
	const total = q.counts.reduce((s, c) => s + c, 0) || 1;

	// A region per colour but the background, largest first, never overlapping.
	const colours = q.palette.map((_, i) => i).filter((i) => i !== bg);
	const regions: { key: number; cs: CrossSection }[] = [];
	let taken: CrossSection | null = null;
	// Each region grown a hair: neighbours then meet without slivers of plate
	// between them or cells touching only at a corner (an edge four faces share).
	const grow = kind === 'mosaic' ? 0.01 : 0.05;
	for (const c of colours) {
		let cs = offset(
			kit,
			kind === 'mosaic'
				? toSection(kit, cellRings(q.labels, w, h, c, k, p.cell, p.gap), 'Positive')
				: toSection(kit, tracedRings(q.labels, w, h, c, k), 'EvenOdd'),
			grow,
			'Miter'
		);
		if (taken) cs = kit.keep(cs.subtract(taken));
		if (cs.isEmpty()) continue;
		regions.push({ key: c, cs });
		taken = taken ? kit.keep(taken.add(cs)) : cs;
	}

	// The plate: the whole picture, or the drawing with a margin.
	let plate: CrossSection;
	if (p.background === 'base' || !taken) {
		const W = w * k;
		const H = h * k;
		const r = Math.min(p.corner, W / 2 - 0.01, H / 2 - 0.01);
		plate = r > 0 ? offset(kit, rect(kit, r, r, W - r, H - r), r) : rect(kit, 0, 0, W, H);
	} else {
		const grown = offset(
			kit,
			unionSections(
				kit,
				regions.map((r) => r.cs)
			),
			// Separate cells need a margin at least as wide as the gaps to stand on one plate.
			Math.max(0.01, p.border, kind === 'mosaic' && p.cell !== 'square' ? p.gap : 0),
			kind === 'mosaic' && p.cell === 'square' ? 'Miter' : 'Round'
		);
		plate = fillHoles(kit, grown);
	}
	// Colours clipped a hair inside the plate: a colour's wall exactly over the
	// plate's would leave a seam the union cannot close.
	const inside = offset(kit, plate, -0.01);
	for (const r of regions) r.cs = kit.keep(r.cs.intersect(inside));

	const solids: { key: 'base' | number; m: Manifold }[] = [];
	const changes: ColourChange[] = [];
	let whole: Manifold | null = null;
	if (p.relief === 'flat') {
		// One plate with pockets cut from above: two slabs stacked would share
		// their walls, and the seam would not quite close.
		// The pockets are cut by the colours before they are clipped to the
		// plate, so at the plate's edge the cut runs through its wall.
		whole = slab(kit, plate, 0, B);
		solids.push({
			key: 'base',
			m: taken ? kit.keep(whole.subtract(slab(kit, taken, B - T, B + 1))) : whole
		});
		for (const r of regions) solids.push({ key: r.key, m: slab(kit, r.cs, B - T, B) });
	} else {
		solids.push({ key: 'base', m: slab(kit, plate, 0, B) });
		if (p.relief === 'layers') changes.push({ layer: 1, z: 0, key: 'base' });
		regions.forEach((r, i) => {
			const z1 = p.relief === 'layers' ? B + (i + 1) * T : B + T;
			solids.push({ key: r.key, m: slab(kit, r.cs, B, z1) });
			if (p.relief === 'layers')
				changes.push({ layer: Math.round((B + i * T) / p.layer) + 1, z: B + i * T, key: r.key });
		});
	}
	const live = solids.filter((s) => !s.m.isEmpty());
	// Flat, all parts together are the plate itself.
	whole ??= union(
		kit,
		live.map((s) => s.m)
	);
	const box = whole.boundingBox();
	const name = (key: 'base' | number) =>
		key === 'base' ? tc.tc_colour_base() : tc.tc_colour_n({ n: colours.indexOf(key) + 1 });
	return {
		palette: q.palette.map(hex),
		shares: q.counts.map((c) => c / total),
		background: bg,
		parts: live.map((s) => ({ key: s.key, name: name(s.key), tris: trianglesOf(s.m) })),
		whole: trianglesOf(whole),
		changes,
		size: [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]]
	};
}
