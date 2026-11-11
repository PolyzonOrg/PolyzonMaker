/**
 * Photo → lithophane: a relief whose thickness follows the darkness of the
 * picture, so it shows the photo when lit from behind. Pure: the page
 * resamples the photo on a canvas to the grid `lithoLayout` asks for; the
 * worker turns the pixels into heights and the heights into a closed mesh.
 *
 * Shapes:
 *   - sheets (panel, arc, cylinder): a grid over the picture, the relief on
 *     the front, a flat or curved smooth back;
 *   - flat outlines (circle, hexagon, heart, star): rings around the centre,
 *     the picture covering the outline;
 *   - sphere: the picture wrapped like a globe map (2:1), the relief outside,
 *     a flat-bottomed opening below for the light.
 */
import type { ManifoldToplevel } from 'manifold-3d';
import { layoutInRow, placeOnBed, type Triangles } from '../stl';
import { fromManifold, toManifold } from '../solid';
import { MeshBuilder, extrudePolygon, rotateAxes } from '../shared/mesh-builder';
import {
	heartRadius,
	outlineBounds,
	polygonRadius,
	starRadius,
	type RadiusFn
} from '../shared/mesh-shapes';
import { clamp } from '../shared/math';

export type LithoShape =
	| 'panel'
	| 'arc'
	| 'cylinder'
	| 'sphere'
	| 'circle'
	| 'hexagon'
	| 'heart'
	| 'star';
export type LithoBottom = 'none' | 'closed' | 'hole';

export interface LithoParams {
	shape: LithoShape;
	/** Panel and arc: width of the picture, mm. */
	width: number;
	/** Cylinder (inside) and flat outlines, mm. */
	diameter: number;
	/** Cylinder: height of the picture; the photo is cropped to fill it. */
	height: number;
	arcAngle: number;
	/** Cylinder: how far the picture wraps around, degrees. */
	wrap: number;
	minThickness: number;
	maxThickness: number;
	/** Light parts thicker instead of dark ones. */
	negative: boolean;
	brightness: number;
	contrast: number;
	gamma: number;
	mirror: boolean;
	frame: boolean;
	frameWidth: number;
	/** Frame above the thickest relief, mm. */
	frameHeight: number;
	bottom: LithoBottom;
	holeDiameter: number;
	stand: boolean;
	/** Flat shapes: a tab with a hole at the top, to hang it on a nail or a string. */
	hang: boolean;
	/** mm per grid point. */
	resolution: number;
}

export const LITHO_DEFAULTS: LithoParams = {
	shape: 'panel',
	width: 120,
	diameter: 90,
	height: 120,
	arcAngle: 90,
	wrap: 360,
	// Two 0.3 mm layers where the photo is white; ~3 mm stops light in black.
	minThickness: 0.6,
	maxThickness: 3,
	negative: false,
	brightness: 0,
	contrast: 0,
	gamma: 1,
	mirror: false,
	frame: false,
	frameWidth: 4,
	frameHeight: 1,
	bottom: 'none',
	holeDiameter: 25,
	stand: false,
	hang: false,
	resolution: 0.3
};

export const FLAT_SHAPES: readonly LithoShape[] = ['panel', 'circle', 'hexagon', 'heart', 'star'];
const BOTTOM_THICKNESS = 2.4;
// Beyond this the file grows past ~50 MB with no visible gain.
const MAX_SIDE = 1200;
const MAX_POINTS = 450_000;

export function clampLitho(p: LithoParams): LithoParams {
	const minThickness = clamp(p.minThickness, 0.3, 3);
	const diameter = clamp(p.diameter, 30, 250);
	return {
		...p,
		width: clamp(p.width, 20, 250),
		diameter,
		height: clamp(p.height, 30, 250),
		arcAngle: clamp(p.arcAngle, 20, 180),
		wrap: clamp(p.wrap, 45, 360),
		minThickness,
		maxThickness: clamp(p.maxThickness, Math.max(1.5, minThickness + 0.2), 8),
		brightness: clamp(p.brightness, -50, 50),
		contrast: clamp(p.contrast, -50, 50),
		gamma: clamp(p.gamma, 0.4, 2.5),
		frameWidth: clamp(p.frameWidth, 1.5, 12),
		frameHeight: clamp(p.frameHeight, 0, 6),
		holeDiameter: clamp(p.holeDiameter, 5, Math.max(5, Math.min(80, diameter - 10))),
		resolution: clamp(p.resolution, 0.15, 1)
	};
}

export const isFlat = (shape: LithoShape) => FLAT_SHAPES.includes(shape);

function outlineOf(shape: LithoShape): RadiusFn {
	switch (shape) {
		case 'hexagon':
			return polygonRadius(6);
		case 'heart':
			return heartRadius();
		case 'star':
			return starRadius(5, 0.5);
		default:
			return () => 1;
	}
}

export interface LithoLayout {
	/** Picture grid the photo is resampled to (row 0 at the top). */
	cols: number;
	rows: number;
	/** Physical size of the picture area, mm. */
	width: number;
	height: number;
	/** Distance between grid points, mm (may exceed the asked one on huge prints). */
	step: number;
	/** Crop the photo to the grid's aspect (outlines) or use it whole (sheets). */
	cover: boolean;
}

/** Grid for a photo of this aspect (width / height). */
export function lithoLayout(input: LithoParams, aspect: number): LithoLayout {
	const p = clampLitho(input);
	const a = clamp(aspect, 0.05, 20);
	let width: number;
	let height: number;
	let cover = false;
	if (p.shape === 'panel' || p.shape === 'arc') {
		width = p.width - (p.shape === 'panel' && p.frame ? 2 * p.frameWidth : 0);
		height = width / a;
	} else if (p.shape === 'cylinder') {
		width = (Math.PI * p.diameter * p.wrap) / 360;
		height = p.height;
		cover = true;
	} else if (p.shape === 'sphere') {
		// A globe map: all the way round, pole to pole.
		width = Math.PI * p.diameter;
		height = width / 2;
		cover = true;
	} else {
		const b = outlineBounds(outlineOf(p.shape));
		const scale = p.diameter / Math.max(b.maxX - b.minX, b.maxY - b.minY);
		width = (b.maxX - b.minX) * scale;
		height = (b.maxY - b.minY) * scale;
		cover = true;
	}
	width = Math.max(5, width);
	height = Math.max(5, height);
	let step = p.resolution;
	const sideLimit = Math.max(width, height) / (MAX_SIDE - 1);
	const areaLimit = Math.sqrt((width * height) / MAX_POINTS);
	step = Math.max(step, sideLimit, areaLimit);
	const cols = Math.max(2, Math.round(width / step) + 1);
	const rows = Math.max(2, Math.round(height / step) + 1);
	return { cols, rows, width, height, step, cover };
}

/** What the page sends to the worker. */
export interface LithoJob {
	params: LithoParams;
	layout: LithoLayout;
	/** RGBA of the photo resampled to layout.cols × layout.rows. */
	rgba: Uint8ClampedArray;
}

export interface LithoResult {
	stl: Uint8Array;
	triangles: number;
}

/**
 * RGBA pixels → relief height 0…1 (1 = thickest). Transparent pixels count
 * as white paper; brightness and contrast in −100…100, gamma > 1 lightens
 * the midtones.
 */
export function imageToHeights(
	rgba: ArrayLike<number>,
	count: number,
	input: Pick<LithoParams, 'negative' | 'brightness' | 'contrast' | 'gamma'>
): Float32Array {
	const out = new Float32Array(count);
	const shift = clamp(input.brightness, -100, 100) / 100;
	const c = clamp(input.contrast, -95, 95) / 100;
	const factor = Math.tan(((c + 1) * Math.PI) / 4);
	const power = 1 / clamp(input.gamma, 0.3, 3);
	for (let k = 0; k < count; k++) {
		const r = rgba[k * 4];
		const g = rgba[k * 4 + 1];
		const b = rgba[k * 4 + 2];
		const alpha = rgba[k * 4 + 3] / 255;
		let lum = ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * alpha + (1 - alpha);
		lum = (lum - 0.5) * factor + 0.5 + shift;
		lum = Math.min(1, Math.max(0, lum)) ** power;
		out[k] = input.negative ? lum : 1 - lum;
	}
	return out;
}

/** The lithophane alone, flat on the bed. */
export function lithophaneBody(
	input: LithoParams,
	heights: Float32Array,
	layout: LithoLayout
): Triangles {
	const p = clampLitho(input);
	if (heights.length !== layout.cols * layout.rows)
		throw new Error('heights do not match the grid');
	const thick = (h: number) => p.minThickness + h * (p.maxThickness - p.minThickness);
	const frameT = p.maxThickness + p.frameHeight;
	if (p.shape === 'sphere') return placeOnBed(sphereMesh(p, heights, layout, thick));
	return placeOnBed(
		isFlat(p.shape) && p.shape !== 'panel'
			? outlineMesh(p, heights, layout, thick, frameT)
			: sheetMesh(p, heights, layout, thick, frameT)
	);
}

/** The body with its stand beside it, if asked: one STL-ready mesh. */
export function withStand(input: LithoParams, body: Triangles): Triangles {
	const p = clampLitho(input);
	if (!p.stand || !isFlat(p.shape)) return body;
	const slot = (p.frame ? p.maxThickness + p.frameHeight : p.maxThickness) + 0.4;
	const span = p.shape === 'panel' ? p.width : p.diameter;
	return layoutInRow([body, standMesh(Math.min(160, Math.max(40, span * 0.6)), slot)], 10);
}

/** The lithophane (and its stand, if asked) as one STL-ready mesh on the bed. */
export function lithophaneMesh(
	input: LithoParams,
	heights: Float32Array,
	layout: LithoLayout
): Triangles {
	return withStand(input, lithophaneBody(input, heights, layout));
}

/** The hanging tab: a disc this big, reaching this far into the picture, a hole for a nail. */
export const HANG = { radius: 6, overlap: 2.5, hole: 1.8 } as const;

/**
 * Where the tab goes: across the middle, on the top edge as it runs there —
 * the dip of a heart, the tip of a star — so the picture hangs straight.
 */
export function hangPoint(body: Triangles): [number, number] {
	let x0 = Infinity;
	let x1 = -Infinity;
	for (let i = 0; i < body.length; i += 3) {
		x0 = Math.min(x0, body[i]);
		x1 = Math.max(x1, body[i]);
	}
	const cx = (x0 + x1) / 2;
	let top = -Infinity;
	for (let i = 0; i < body.length; i += 3) {
		if (Math.abs(body[i] - cx) < 2) top = Math.max(top, body[i + 1]);
	}
	return [cx, top];
}

/** The body with a tab and its hole at the top (manifold: tab ∪ body − hole). */
export function addHangTab(wasm: ManifoldToplevel, input: LithoParams, body: Triangles): Triangles {
	const p = clampLitho(input);
	const t = p.frame ? p.maxThickness + p.frameHeight : p.maxThickness;
	const [x, top] = hangPoint(body);
	const y = top + HANG.radius - HANG.overlap;
	const { Manifold } = wasm;
	const solid = toManifold(wasm, body).solid;
	const tab = Manifold.cylinder(t, HANG.radius, HANG.radius, 48).translate([x, y, 0]);
	const hole = Manifold.cylinder(t + 2, HANG.hole, HANG.hole, 32).translate([x, y + 1, -1]);
	const joined = solid.add(tab);
	const out = joined.subtract(hole);
	const tris = fromManifold(out);
	for (const m of [solid, tab, hole, joined, out]) m.delete();
	return tris;
}

/** A block with a slot the panel stands in. */
export function standMesh(length: number, slot: number): Triangles {
	const depth = Math.max(24, slot + 16);
	const height = 10;
	const slotDepth = 6;
	const d = depth / 2;
	const s = slot / 2;
	// Profile across the stand (x = depth, y = height), counter-clockwise.
	const profile: [number, number][] = [
		[-d, 0],
		[d, 0],
		[d, height],
		[s, height],
		[s, height - slotDepth],
		[-s, height - slotDepth],
		[-s, height],
		[-d, height]
	];
	return rotateAxes(extrudePolygon(profile, length));
}

function sheetMesh(
	p: LithoParams,
	heights: Float32Array,
	layout: LithoLayout,
	thick: (h: number) => number,
	frameT: number
): Triangles {
	const frameNodes =
		p.shape === 'panel' && p.frame ? Math.max(1, Math.round(p.frameWidth / layout.step)) : 0;
	const C = layout.cols + 2 * frameNodes;
	const R = layout.rows + 2 * frameNodes;
	const wrap = p.shape === 'cylinder' && p.wrap >= 360;
	const dx = layout.width / (layout.cols - 1);
	const dy = layout.height / (layout.rows - 1);
	const bottomOn = wrap && p.bottom !== 'none';
	const lift = bottomOn ? BOTTOM_THICKNESS : 0;

	// Thickness at node (i, j); j = 0 is the bottom row, the photo's last row.
	const t = (i: number, j: number) => {
		const ii = i - frameNodes;
		const jj = j - frameNodes;
		if (ii < 0 || jj < 0 || ii >= layout.cols || jj >= layout.rows) return frameT;
		const col = p.mirror ? layout.cols - 1 - ii : ii;
		return thick(heights[(layout.rows - 1 - jj) * layout.cols + col]);
	};

	// (column, row, offset from the back) → 3D. The back is offset 0.
	let place: (i: number, j: number, off: number) => [number, number, number];
	let radius = 0;
	let angleOf = (i: number) => i;
	if (p.shape === 'panel') {
		place = (i, j, off) => [i * dx, j * dy, off];
	} else {
		const span = wrap
			? Math.PI * 2
			: p.shape === 'arc'
				? (p.arcAngle * Math.PI) / 180
				: (p.wrap * Math.PI) / 180;
		radius = p.shape === 'arc' ? layout.width / span : p.diameter / 2;
		const denom = wrap ? C : C - 1;
		// Columns run right to left seen from outside, so the picture reads correctly.
		angleOf = (i) => (0.5 - i / denom) * span;
		place = (i, j, off) => {
			const a = angleOf(i);
			const r = radius + off;
			return [r * Math.sin(a), r * Math.cos(a), lift + j * dy];
		};
	}

	const m = new MeshBuilder();
	const v = (xyz: [number, number, number]) => m.vertex(xyz[0], xyz[1], xyz[2]);
	const front: number[] = new Array<number>(C * R);
	for (let j = 0; j < R; j++)
		for (let i = 0; i < C; i++) front[j * C + i] = v(place(i, j, t(i, j)));
	const F = (i: number, j: number) => front[j * C + (i % C)];

	// Back: full columns at the open ends (they meet the side walls), only
	// the top and bottom point elsewhere — the back is flat along the height.
	const backCol: { idx: number; v: number }[][] = [];
	for (let i = 0; i < C; i++) {
		const full = !wrap && (i === 0 || i === C - 1);
		const col: { idx: number; v: number }[] = [];
		for (let j = 0; j < R; j++) {
			if (full || j === 0 || j === R - 1) col.push({ idx: v(place(i, j, 0)), v: j });
		}
		backCol.push(col);
	}
	const backBottom = (i: number) => backCol[i % C][0].idx;
	const backTop = (i: number) => backCol[i % C][backCol[i % C].length - 1].idx;

	const last = wrap ? C : C - 1;
	for (let i = 0; i < last; i++) {
		const i2 = i + 1;
		for (let j = 0; j < R - 1; j++) m.quad(F(i, j), F(i2, j), F(i2, j + 1), F(i, j + 1));
		// Back strip between two columns, zipped by height, facing back.
		const L = backCol[i];
		const Rc = backCol[i2 % C];
		let a = 0;
		let b = 0;
		while (a < L.length - 1 || b < Rc.length - 1) {
			const advanceLeft = b >= Rc.length - 1 || (a < L.length - 1 && L[a + 1].v <= Rc[b + 1].v);
			if (advanceLeft) {
				m.tri(L[a].idx, L[a + 1].idx, Rc[b].idx);
				a++;
			} else {
				m.tri(L[a].idx, Rc[b + 1].idx, Rc[b].idx);
				b++;
			}
		}
		// Top edge.
		m.quad(F(i, R - 1), F(i2, R - 1), backTop(i2), backTop(i));
		if (!bottomOn) m.quad(backBottom(i), backBottom(i2), F(i2, 0), F(i, 0));
	}
	if (!wrap) {
		const left = backCol[0];
		const right = backCol[C - 1];
		for (let j = 0; j < R - 1; j++) {
			m.quad(left[j].idx, F(0, j), F(0, j + 1), left[j + 1].idx);
			m.quad(right[j].idx, right[j + 1].idx, F(C - 1, j + 1), F(C - 1, j));
		}
	}

	if (bottomOn) {
		// A solid disc under the wall: a skirt down to Z = 0 outside, the floor
		// at the wall's foot inside, an optional hole through both.
		const skirt: number[] = [];
		for (let i = 0; i < C; i++) {
			const a = angleOf(i);
			const r = radius + t(i, 0);
			skirt.push(m.vertex(r * Math.sin(a), r * Math.cos(a), 0));
		}
		const floor = Array.from({ length: C }, (_, i) => backBottom(i));
		for (let i = 0; i < C; i++) m.quad(skirt[i], skirt[(i + 1) % C], F(i + 1, 0), F(i, 0));
		if (p.bottom === 'hole') {
			const hr = Math.min(p.holeDiameter / 2, radius - 1);
			const n = Math.max(24, Math.round((Math.PI * 2 * hr) / Math.max(0.5, layout.step * 2)));
			const low: number[] = [];
			const high: number[] = [];
			for (let k = 0; k < n; k++) {
				const a = (0.5 - k / n) * Math.PI * 2;
				low.push(m.vertex(hr * Math.sin(a), hr * Math.cos(a), 0));
				high.push(m.vertex(hr * Math.sin(a), hr * Math.cos(a), BOTTOM_THICKNESS));
			}
			m.zip(skirt, low, true);
			m.zip(floor, high);
			for (let k = 0; k < n; k++) {
				const k2 = (k + 1) % n;
				m.quad(low[k], high[k], high[k2], low[k2]);
			}
		} else {
			m.fan(m.vertex(0, 0, 0), skirt, true);
			m.fan(m.vertex(0, 0, BOTTOM_THICKNESS), floor);
		}
	}
	return m.toTriangles();
}

/** Solid band above the opening of a sphere, mm: it stands on the bed and holds the shape. */
export const SPHERE_COLLAR = 3;

/** Latitude of the opening's edge (radians, below the equator) for this inner radius. */
export function sphereCut(radius: number, hole: number): number {
	return -Math.acos(Math.min(0.95, hole / 2 / radius));
}

/**
 * A hollow ball: the relief outside over a smooth inside of the asked
 * diameter, open below. The opening's rim is flat, so the ball stands on it
 * and prints without supports (every layer rests on the one below), and a
 * solid collar runs round it.
 */
function sphereMesh(
	p: LithoParams,
	heights: Float32Array,
	layout: LithoLayout,
	thick: (h: number) => number
): Triangles {
	const R = p.diameter / 2;
	const C = layout.cols;
	const rows = layout.rows;
	const T = p.maxThickness;
	const cut = sphereCut(R, p.holeDiameter);
	const zCut = R * Math.sin(cut);
	// The outside meets the bed plane higher up than the inside does.
	const outerCut = Math.asin(zCut / (R + T));
	const latOf = (j: number) => Math.PI / 2 - (j * Math.PI) / (rows - 1);
	const angleOf = (i: number, n: number) => (0.5 - i / n) * Math.PI * 2;
	const at = (r: number, lat: number, a: number): [number, number, number] => [
		r * Math.cos(lat) * Math.sin(a),
		r * Math.cos(lat) * Math.cos(a),
		r * Math.sin(lat)
	];
	const m = new MeshBuilder();

	// Outside, bottom to top: the rim at the bed, then the picture's rows.
	const outer: number[][] = [];
	outer.push(Array.from({ length: C }, (_, i) => m.vertex(...at(R + T, outerCut, angleOf(i, C)))));
	const step = Math.PI / (rows - 1);
	const tops: number[] = [];
	for (let j = rows - 2; j >= 1; j--) {
		const lat = latOf(j);
		if (lat < outerCut + step * 0.25) continue;
		const collar = (lat - outerCut) * R < SPHERE_COLLAR;
		const ring: number[] = [];
		for (let i = 0; i < C; i++) {
			const col = p.mirror ? C - 1 - i : i;
			const t = collar ? T : thick(heights[j * layout.cols + col]);
			if (j === 1) tops.push(t);
			ring.push(m.vertex(...at(R + t, lat, angleOf(i, C))));
		}
		outer.push(ring);
	}
	for (let k = 0; k + 1 < outer.length; k++) m.band(outer[k], outer[k + 1]);
	const poleT = tops.length ? tops.reduce((s, t) => s + t, 0) / tops.length : T;
	m.fan(m.vertex(0, 0, R + poleT), outer[outer.length - 1]);

	// Inside: a smooth sphere, coarser — it has no picture on it.
	const Cin = Math.max(48, Math.round((Math.PI * 2 * R) / 1.5));
	const nIn = Math.max(12, Math.round(((Math.PI / 2 - cut) * R) / 1.5));
	const inner: number[][] = [];
	for (let k = 0; k < nIn; k++) {
		const lat = cut + (k * (Math.PI / 2 - cut)) / nIn;
		inner.push(Array.from({ length: Cin }, (_, i) => m.vertex(...at(R, lat, angleOf(i, Cin)))));
	}
	for (let k = 0; k + 1 < inner.length; k++) m.band(inner[k + 1], inner[k]);
	m.fan(m.vertex(0, 0, R), inner[inner.length - 1], true);

	// The flat rim between them, facing the bed.
	m.zip(outer[0], inner[0], true);
	return m.toTriangles();
}

function outlineMesh(
	p: LithoParams,
	heights: Float32Array,
	layout: LithoLayout,
	thick: (h: number) => number,
	frameT: number
): Triangles {
	const shape = outlineOf(p.shape);
	const b = outlineBounds(shape);
	const scale = layout.width / (b.maxX - b.minX);
	const step = layout.step;
	const rMax = scale; // outline radius is at most 1
	const rings = Math.max(2, Math.round(rMax / step));
	const sample = (x: number, y: number) => {
		// Picture over the outline's bounding box, bilinear between grid points.
		let u = (x / scale - b.minX) / (b.maxX - b.minX);
		const w = (y / scale - b.minY) / (b.maxY - b.minY);
		if (p.mirror) u = 1 - u;
		const fx = Math.min(1, Math.max(0, u)) * (layout.cols - 1);
		const fy = Math.min(1, Math.max(0, 1 - w)) * (layout.rows - 1);
		const x0 = Math.min(layout.cols - 2, Math.floor(fx));
		const y0 = Math.min(layout.rows - 2, Math.floor(fy));
		const sx = fx - x0;
		const sy = fy - y0;
		const at = (cx: number, cy: number) => heights[cy * layout.cols + cx];
		const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
		const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
		return top * (1 - sy) + bottom * sy;
	};
	const m = new MeshBuilder();
	const centre = m.vertex(0, 0, thick(sample(0, 0)));
	let inner: number[] = [];
	let outerFront: number[] = [];
	for (let q = 1; q <= rings; q++) {
		const s = q / rings;
		const n = Math.max(12, Math.round((Math.PI * 2 * s * rMax) / step));
		const ring: number[] = [];
		const back: number[] = [];
		for (let k = 0; k < n; k++) {
			const a = (k / n) * Math.PI * 2;
			const edge = scale * shape(a);
			const x = s * edge * Math.cos(a);
			const y = s * edge * Math.sin(a);
			const inFrame = p.frame && edge * (1 - s) < p.frameWidth;
			ring.push(m.vertex(x, y, inFrame ? frameT : thick(sample(x, y))));
			if (q === rings) back.push(m.vertex(x, y, 0));
		}
		if (q === 1) m.fan(centre, ring);
		else m.zip(ring, inner);
		inner = ring;
		if (q === rings) {
			outerFront = ring;
			m.band(back, outerFront);
			m.fan(m.vertex(0, 0, 0), back, true);
		}
	}
	return m.toTriangles();
}

/** Short latin file name. */
export function lithoFileName(p: LithoParams): string {
	return `litho-${p.shape}.stl`;
}
