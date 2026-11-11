/**
 * «Световой короб»: a picture cut into 3–8 thin plates by its tones — the
 * darker a place, the more plates cover it — standing one behind another
 * in a box with a LED strip at the back. Lit, the stack shows the picture
 * with depth, like a paper shadow box. Each plate has a thin film across
 * its window (light goes through, islands of the drawing are held) or none
 * (only what joins the frame stays). The box prints standing on its bottom:
 * the grooves for the plates run up the side walls, open at the top.
 *
 * Pure: the page resamples the picture to grey, the worker traces each tone
 * level (shared/trace.ts) and builds the plates with manifold-3d.
 */
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { Bin } from '../booleans/kit';
import { blurGray, traceGray, type Ring } from '../shared/trace';
import * as m from '$msg/tools/light-box';
import { clamp } from '../shared/math';

export interface LightBoxParams {
	/** Plates, back to front */
	layers: number;
	/** Picture width, mm; the height follows the picture */
	width: number;
	/** Plate thickness where the drawing is, mm */
	plate: number;
	/** A thin film across each window */
	film: boolean;
	/** Between plates, mm */
	gap: number;
	/** Light parts of the picture cut away instead of the dark ones */
	invert: boolean;
	/** Picture resolution: px across */
	detail: number;
	/** Smoothing of the outlines, px */
	smooth: number;
	box: boolean;
	/** Room for the LED strip behind the last plate, mm */
	led: number;
}

export const LIGHT_BOX_DEFAULTS: LightBoxParams = {
	layers: 5,
	width: 150,
	plate: 1.2,
	film: true,
	gap: 6,
	invert: false,
	detail: 300,
	smooth: 1.5,
	box: true,
	led: 15
};

export function clampLightBox(p: LightBoxParams): LightBoxParams {
	return {
		layers: Math.round(clamp(p.layers, 3, 8)),
		width: clamp(p.width, 60, 240),
		plate: clamp(p.plate, 0.6, 2.4),
		film: !!p.film,
		gap: clamp(p.gap, 3, 12),
		invert: !!p.invert,
		detail: Math.round(clamp(p.detail, 120, 480)),
		smooth: clamp(p.smooth, 0, 4),
		box: !!p.box,
		led: clamp(p.led, 8, 30)
	};
}

/** Film across the window: two layers of 0,2 mm. */
export const FILM = 0.4;
/** Solid edge of every plate, mm: it goes into the box's grooves. */
export const EDGE = 4;
/** The box: walls, how deep the grooves go into them, play, mm. */
const BOX = { wall: 4, groove: 2, play: 0.3, floor: 3, back: 3, front: 3, cable: 7 };

export interface LightBoxLayout {
	/** Plate size, mm */
	width: number;
	height: number;
	/** Grey picture size, px */
	cols: number;
	rows: number;
	/** mm per pixel */
	scale: number;
	/** Plate pitch in the box, mm */
	pitch: number;
	/** The box outside: across, depth (front to back) and height, mm */
	box: [number, number, number];
}

export function lightBoxLayout(input: LightBoxParams, aspect: number): LightBoxLayout {
	const p = clampLightBox(input);
	const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
	const width = p.width;
	const height = Math.round(clamp(width / a, 40, 240) * 10) / 10;
	const cols = p.detail;
	const rows = Math.max(8, Math.round(cols / (width / height)));
	const pitch = p.plate + p.gap;
	const depth = BOX.front + p.layers * pitch + p.led + BOX.back;
	return {
		width,
		height,
		cols,
		rows,
		scale: width / cols,
		pitch,
		box: [width + 2 * (BOX.wall - BOX.groove + BOX.play), depth, height + BOX.floor]
	};
}

/**
 * The grey value under which a pixel is covered by plate `i` (1 = back,
 * `layers` = front): the back plate covers all but the lightest, the front
 * only the darkest; a pixel under k plates looks k steps dark.
 */
export function plateThreshold(i: number, layers: number): number {
	return Math.round(255 - (i * 255) / (layers + 1));
}

/** How many plates cover each pixel (for the lit preview). */
export function coverage(gray: ArrayLike<number>, input: LightBoxParams): Uint8Array {
	const p = clampLightBox(input);
	const out = new Uint8Array(gray.length);
	for (let k = 0; k < gray.length; k++) {
		const g = p.invert ? 255 - gray[k] : gray[k];
		let n = 0;
		for (let i = 1; i <= p.layers; i++) if (g < plateThreshold(i, p.layers)) n++;
		out[k] = n;
	}
	return out;
}

/**
 * The lit stack, 0…255 per pixel: light through white plastic falls off
 * about e-fold per `HALF` mm (a rough figure for white PLA).
 */
const HALF = 1.6;
/**
 * Blur before the tone levels, px — the outlines and the preview alike; it
 * grows with the smoothing, so a gradient crossing a level gives one clean
 * edge, not a comb of specks.
 */
const blurOf = (p: LightBoxParams) => 0.8 + 0.8 * p.smooth;
/** Specks smaller than this go, px² (about 4 mm² at the default detail). */
const specks = (p: LightBoxParams) => 4 * (0.5 + p.smooth) ** 2;
export function litPreview(
	gray: ArrayLike<number>,
	cols: number,
	rows: number,
	input: LightBoxParams
): Uint8ClampedArray {
	const p = clampLightBox(input);
	const cover = coverage(blurGray(gray, cols, rows, blurOf(p)), p);
	const film = p.film ? p.layers * FILM : 0;
	const brightest = Math.exp(-film / HALF);
	const out = new Uint8ClampedArray(gray.length);
	for (let k = 0; k < cover.length; k++) {
		const mm = film + cover[k] * (p.plate - (p.film ? FILM : 0));
		out[k] = Math.round((255 * Math.exp(-mm / HALF)) / brightest);
	}
	return out;
}

export interface LightBoxPiece {
	name: string;
	/** Latin file name without extension */
	file: string;
	/** As printed: on the bed */
	solid: Manifold;
	/** Where it stands in the assembled box (for the scene) */
	place: { y: number; z: number; standing: boolean };
}

export interface LightBoxBuild {
	pieces: LightBoxPiece[];
	/** Bits of the drawing dropped for not touching the frame (no film) */
	dropped: number;
}

/** Rings of the traced picture (px, y up from the bottom) → a region in mm on the plate, centred. */
function regionOf(
	wasm: ManifoldToplevel,
	bin: Bin,
	rings: Ring[],
	L: LightBoxLayout
): CrossSection {
	const pts = rings.map((r) =>
		r.map(([x, y]) => [x * L.scale - L.width / 2, y * L.scale - L.height / 2] as [number, number])
	);
	return bin.add(new wasm.CrossSection(pts.length ? pts : [[]], 'EvenOdd'));
}

/** Plates and the box, each on the bed as it prints. */
export function buildLightBox(
	wasm: ManifoldToplevel,
	gray: ArrayLike<number>,
	input: LightBoxParams,
	L: LightBoxLayout
): LightBoxBuild {
	const p = clampLightBox(input);
	const { CrossSection: CS } = wasm;
	const bin = new Bin();
	const outer = bin.add(CS.square([L.width, L.height], true));
	const window = bin.add(CS.square([L.width - 2 * EDGE, L.height - 2 * EDGE], true));
	const frame = bin.add(outer.subtract(window));
	const pieces: LightBoxPiece[] = [];
	let dropped = 0;
	for (let i = 1; i <= p.layers; i++) {
		const rings = traceGray(
			gray,
			L.cols,
			L.rows,
			{
				threshold: plateThreshold(i, p.layers),
				invert: p.invert,
				blur: blurOf(p),
				smooth: p.smooth
			},
			specks(p)
		);
		const drawing = bin.add(regionOf(wasm, bin, rings, L).intersect(window));
		// Into the frame a hair, so the drawing and the frame are one piece.
		let flat = bin.add(bin.add(drawing.offset(0.01, 'Miter', 2)).add(frame));
		if (!p.film) {
			// Only what holds on to the frame stays.
			const parts = flat.decompose().map((c) => bin.add(c));
			const keep = parts.filter((c) => !bin.add(c.intersect(frame)).isEmpty());
			dropped += parts.length - keep.length;
			flat = keep.length > 1 ? bin.add(CS.union(keep)) : (keep[0] ?? frame);
		}
		let plate = bin.add(flat.extrude(p.plate));
		if (p.film) plate = bin.add(plate.add(bin.add(window.offset(0.01, 'Miter', 2).extrude(FILM))));
		pieces.push({
			name: m.t_light_box_part_plate({ n: i }),
			file: `${m.t_light_box_plate_filename()}-${i}`,
			solid: plate,
			// Plate 1 at the back: the front one is nearest the open side.
			place: { y: BOX.front + (p.layers - i) * L.pitch, z: BOX.floor, standing: true }
		});
	}
	if (p.box)
		pieces.push({
			name: m.t_light_box_part_box(),
			file: m.t_light_box_box_filename(),
			solid: box(wasm, bin, p, L),
			place: { y: 0, z: 0, standing: false }
		});
	for (const piece of pieces) piece.solid.numTri();
	bin.free(...pieces.map((x) => x.solid));
	return { pieces, dropped };
}

/**
 * The box, standing on its bottom: side walls with a groove per plate, the
 * back closed, the front and top open; the cable goes out low in the back.
 * Its own frame: x across, y from the front (0) to the back, z up.
 */
function box(wasm: ManifoldToplevel, bin: Bin, p: LightBoxParams, L: LightBoxLayout): Manifold {
	const { Manifold: M } = wasm;
	const [W, D, H] = L.box;
	const inner = W - 2 * BOX.wall;
	const shell = bin.add(
		bin
			.add(M.cube([W, D, H]).translate([-W / 2, 0, 0]))
			.subtract(bin.add(M.cube([inner, D - BOX.back, H]).translate([-inner / 2, -1, BOX.floor])))
	);
	const slot = p.plate + 2 * BOX.play;
	const grooves: Manifold[] = [];
	for (let i = 0; i < p.layers; i++) {
		const y = BOX.front + i * L.pitch - BOX.play;
		const reach = inner / 2 + BOX.groove;
		grooves.push(bin.add(M.cube([2 * reach, slot, H]).translate([-reach, y, BOX.floor - 0.5])));
	}
	const cable = bin.add(
		M.cylinder(BOX.back + 2, BOX.cable / 2, BOX.cable / 2, 32)
			.rotate([-90, 0, 0])
			.translate([0, D - BOX.back - 1, BOX.floor + BOX.cable])
	);
	return bin.add(shell.subtract(bin.add(M.union([...grooves, cable]))));
}
