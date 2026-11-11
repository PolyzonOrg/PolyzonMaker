/**
 * Tags, nameplates and keychains — one model behind «Таблички»
 * and «Брелки» (the tools differ only by presets and the mounts
 * they offer). A flat base of a chosen shape (or the silhouette of the
 * text), raised or engraved text, an optional QR code and frame, a key
 * loop or screw holes, magnet pockets and a recess for adhesive tape.
 * Pure: 2D layers in, the caller turns them into a solid (relief.ts).
 */
import type { CrossSection } from 'manifold-3d';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/nameplate-generator';
import { ToolError } from '../build.svelte';
import { growApart } from '../shared/bold';
import { BOLD_GROW, DEFAULT_FONT } from '../shared/fonts';
import { encodeQr, QrTooLongError } from '../shared/qr';
import {
	boundsOf,
	circle,
	convexHull,
	inside,
	largestFit,
	layoutText,
	qrRegion,
	qrSide,
	rect,
	regionOf,
	type Box,
	type Cone,
	type Layer,
	type Region,
	type Scope,
	type TextShapes
} from '../shared/relief';
import { clampTo as clamp } from '../shared/math';
import { own } from '$lib/own';

export type TagShape = 'rounded' | 'circle' | 'oval' | 'hexagon' | 'dogtag' | 'heart' | 'bone';
export type TagBase = 'tile' | 'contour';
export type TagMount = 'loop' | 'hole' | 'holes2' | 'holes4' | 'none';
export type TagPlacement = 'left' | 'right' | 'top' | 'top-left' | 'top-right';
export type LoopShape = 'pill' | 'flat';
export type ReliefMode = 'raised' | 'engraved';
export type TextWeight = 'regular' | 'bold';

export interface TagParams {
	base: TagBase;
	shape: TagShape;
	/** mm; a circle uses the width as its diameter */
	width: number;
	height: number;
	thickness: number;
	/** Corner rounding of the rectangle and the hexagon, mm */
	radius: number;
	/** Margin of the silhouette base around the letters, mm */
	contourPad: number;

	lines: string[];
	/** Height of capitals of the first line, mm; other lines are smaller */
	textHeight: number;
	weight: TextWeight;
	/** Font family (shared/fonts.ts); one not opened this visit falls back to Noto Sans. */
	font: string;
	mode: ReliefMode;
	/** Height of raised parts or depth of engraving, mm */
	relief: number;

	qr: boolean;
	qrText: string;
	/** Side of the QR code, mm (shrinks to fit) */
	qrSize: number;

	frame: boolean;
	frameWidth: number;

	mount: TagMount;
	placement: TagPlacement;
	loopShape: LoopShape;
	holeDiameter: number;
	/** Width of the ring around the loop hole, mm */
	ringWidth: number;
	/** A second loop on the opposite side (collars, bracelets) */
	bothSides: boolean;
	/** Countersink for flat-head screws (screw holes) */
	countersink: boolean;

	magnets: 0 | 1 | 2;
	magnetDiameter: number;
	magnetDepth: number;

	adhesive: boolean;
	adhesiveDepth: number;
}

export interface TagPreset {
	id: string;
	label: string;
	params: Partial<TagParams>;
}

/**
 * Starting values, chosen for a 0.4 mm nozzle and 0.2 mm layers: 3.2 mm =
 * 16 layers (stiff enough for keys), relief 1 mm = 5 layers (a clean colour
 * change), frame 1.2 mm = three lines, a 4.5 mm hole takes a split ring or a
 * cord, pockets fit the common 10 × 2 mm neodymium disc.
 */
export const TAG_DEFAULTS: TagParams = {
	base: 'tile',
	shape: 'rounded',
	width: 50,
	height: 22,
	thickness: 3.2,
	radius: 4,
	contourPad: 2.5,
	get lines() {
		return [m.t_nameplate_generator_tag_sample(), '', ''];
	},
	textHeight: 8,
	weight: 'bold',
	font: DEFAULT_FONT,
	mode: 'raised',
	relief: 1,
	qr: false,
	qrText: 'https://polyzon.org',
	qrSize: 24,
	frame: false,
	frameWidth: 1.2,
	mount: 'loop',
	placement: 'left',
	loopShape: 'pill',
	holeDiameter: 4.5,
	ringWidth: 2.5,
	bothSides: false,
	countersink: false,
	magnets: 0,
	magnetDiameter: 10,
	magnetDepth: 2.2,
	adhesive: false,
	adhesiveDepth: 0.6
};

/**
 * `{ ...base, ...more }` that keeps getters as getters. The sample lines are messages, read
 * when a form starts; a spread at module level would read them once, in the first visitor's
 * language.
 */
export function extend<T extends object>(base: T, more: Partial<T>): T {
	return Object.defineProperties(
		{},
		{ ...Object.getOwnPropertyDescriptors(base), ...Object.getOwnPropertyDescriptors(more) }
	) as T;
}

/** What a preset does not mention goes back to these (no leftovers from the previous one). */
export const PRESET_BASE: Partial<TagParams> = {
	base: 'tile',
	lines: ['', '', ''],
	qr: false,
	frame: false,
	mount: 'none',
	bothSides: false,
	countersink: false,
	magnets: 0,
	adhesive: false
};

export const TAG_LIMITS = {
	width: [15, 150],
	height: [10, 100],
	thickness: [1.2, 8],
	radius: [0, 20],
	contourPad: [1, 10],
	textHeight: [3, 30],
	relief: [0.2, 3],
	qrSize: [10, 60],
	frameWidth: [0.4, 6],
	holeDiameter: [2, 12],
	ringWidth: [1, 8],
	magnetDiameter: [3, 25],
	magnetDepth: [0.6, 5],
	adhesiveDepth: [0.2, 2]
} as const satisfies Record<string, readonly [number, number]>;

/** Floor kept under an engraving or a pocket: four 0.2 mm layers. */
export const MIN_FLOOR = 0.8;
/** The frame stands this far from the edge, mm. */
export const FRAME_INSET = 1;
/** A press fit for a magnet: the pocket is this much wider, mm. */
export const MAGNET_CLEARANCE = 0.3;
/** Plastic between a loop's hole and the edge of the plate, mm. */
const LOOP_GAP = 1;
/** Second and third lines, relative to the first. */
const SUBLINE = 0.65;

/** A build request for the tag worker. */
export interface TagJob {
	params: TagParams;
	maxLines: number;
	mounts: TagMount[];
}

export type TagInfo = Omit<TagModel, 'layers'>;

export interface TagModel {
	layers: Layer[];
	warnings: string[];
	/** Where to change the filament for two colours, mm from the bed. */
	colorChange: number | null;
	qr: { version: number; size: number; module: number; side: number } | null;
	/** Cap height of the first line after fitting, mm. */
	textCap: number | null;
}

/** The lines a tag prints (trimmed, without the empty ones). */
export function tagLines(p: TagParams, maxLines = 3): string[] {
	return p.lines
		.slice(0, maxLines)
		.map((l) => l.trim())
		.filter(Boolean);
}

// ---------- Shapes ----------

function signedArea(poly: readonly [number, number][]): number {
	let a = 0;
	for (let i = 0; i < poly.length; i++) {
		const [x0, y0] = poly[i];
		const [x1, y1] = poly[(i + 1) % poly.length];
		a += x0 * y1 - x1 * y0;
	}
	return a / 2;
}

function fillHoles(s: Scope, cs: CrossSection): CrossSection {
	return s.cs(regionOf(cs).filter((p) => signedArea(p) > 0));
}

export function roundedRect(w: number, h: number, r: number): [number, number][] {
	const rr = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
	if (rr < 0.05) return rect(-w / 2, -h / 2, w / 2, h / 2);
	const out: [number, number][] = [];
	const n = Math.max(6, Math.round(rr * 2));
	const corners: [number, number, number][] = [
		[w / 2 - rr, h / 2 - rr, 0],
		[-w / 2 + rr, h / 2 - rr, 90],
		[-w / 2 + rr, -h / 2 + rr, 180],
		[w / 2 - rr, -h / 2 + rr, 270]
	];
	for (const [cx, cy, start] of corners) {
		for (let i = 0; i <= n; i++) {
			const a = ((start + (90 * i) / n) * Math.PI) / 180;
			out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
		}
	}
	return out;
}

function superellipse(w: number, h: number, e = 4, n = 96): [number, number][] {
	return Array.from({ length: n }, (_, i) => {
		const t = (i / n) * Math.PI * 2;
		const c = Math.cos(t);
		const sn = Math.sin(t);
		return [
			(w / 2) * Math.sign(c) * Math.abs(c) ** (2 / e),
			(h / 2) * Math.sign(sn) * Math.abs(sn) ** (2 / e)
		] as [number, number];
	});
}

function heart(w: number, h: number, n = 120): [number, number][] {
	const raw = Array.from({ length: n }, (_, i) => {
		const t = (i / n) * Math.PI * 2;
		return [
			16 * Math.sin(t) ** 3,
			13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
		] as [number, number];
	});
	const b = boundsOf([raw]) as Box;
	const sx = w / (b.x1 - b.x0);
	const sy = h / (b.y1 - b.y0);
	const cy = (b.y0 + b.y1) / 2;
	// The parametric heart runs clockwise; outlines are counter-clockwise.
	return raw.map(([x, y]) => [x * sx, (y - cy) * sy] as [number, number]).reverse();
}

/** The base outline, centred on the origin. */
export function tagShape(s: Scope, shape: TagShape, w: number, h: number, r: number): CrossSection {
	switch (shape) {
		case 'circle':
			return s.cs(circle(0, 0, w / 2));
		case 'oval': {
			const n = 96;
			return s.cs(
				Array.from({ length: n }, (_, i) => {
					const a = (i / n) * Math.PI * 2;
					return [(w / 2) * Math.cos(a), (h / 2) * Math.sin(a)] as [number, number];
				})
			);
		}
		case 'hexagon': {
			const hex = s.cs([
				[w / 2, 0],
				[w / 4, h / 2],
				[-w / 4, h / 2],
				[-w / 2, 0],
				[-w / 4, -h / 2],
				[w / 4, -h / 2]
			]);
			const rr = Math.min(r, h / 4);
			return rr > 0.05 ? s.t(s.t(hex.offset(-rr, 'Round')).offset(rr, 'Round')) : hex;
		}
		case 'dogtag':
			return s.cs(superellipse(w, h));
		case 'heart':
			return s.cs(heart(w, h));
		case 'bone': {
			const rc = h * 0.27;
			const ex = w / 2 - rc;
			const ey = h / 2 - rc;
			const bone = s.cs([
				rect(-ex, -h * 0.25, ex, h * 0.25),
				circle(-ex, ey, rc),
				circle(-ex, -ey, rc),
				circle(ex, ey, rc),
				circle(ex, -ey, rc)
			]);
			const k = Math.min(2, h * 0.08);
			return s.t(s.t(bone.offset(k, 'Round')).offset(-k, 'Round'));
		}
		default:
			return s.cs(roundedRect(w, h, r));
	}
}

/** Where text sits best inside a shape (the heart's lobes are above the middle). */
function contentCentre(shape: TagShape, h: number): number {
	return shape === 'heart' ? h * 0.12 : 0;
}

// ---------- Points on the outline ----------

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Farthest crossing of a ray with the outline (the outer edge). */
function rayHit(
	region: Region,
	ox: number,
	oy: number,
	ux: number,
	uy: number
): [number, number] | null {
	let best = -1;
	for (const poly of region) {
		for (let i = 0; i < poly.length; i++) {
			const [ax, ay] = poly[i];
			const [bx, by] = poly[(i + 1) % poly.length];
			const ex = bx - ax;
			const ey = by - ay;
			const den = cross(ux, uy, ex, ey);
			if (Math.abs(den) < 1e-12) continue;
			const wx = ax - ox;
			const wy = ay - oy;
			const t = cross(wx, wy, ex, ey) / den;
			const sAlong = cross(wx, wy, ux, uy) / den;
			if (t >= 0 && sAlong >= -1e-9 && sAlong <= 1 + 1e-9 && t > best) best = t;
		}
	}
	return best < 0 ? null : [ox + ux * best, oy + uy * best];
}

/** Point of the outline nearest to (px, py). */
function nearest(region: Region, px: number, py: number): [number, number] | null {
	let best = Infinity;
	let out: [number, number] | null = null;
	for (const poly of region) {
		for (let i = 0; i < poly.length; i++) {
			const [ax, ay] = poly[i];
			const [bx, by] = poly[(i + 1) % poly.length];
			const ex = bx - ax;
			const ey = by - ay;
			const len2 = ex * ex + ey * ey || 1;
			const k = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / len2));
			const x = ax + ex * k;
			const y = ay + ey * k;
			const d = (x - px) ** 2 + (y - py) ** 2;
			if (d < best) {
				best = d;
				out = [x, y];
			}
		}
	}
	return out;
}

export interface Anchor {
	/** Point on the outline */
	x: number;
	y: number;
	/** Outward direction */
	ux: number;
	uy: number;
}

const DIRECTIONS: Record<TagPlacement, [number, number]> = {
	left: [-1, 0],
	right: [1, 0],
	top: [0, 1],
	'top-left': [-1, 1],
	'top-right': [1, 1]
};

/** Where a placement meets the outline: along an axis, or nearest to a corner of the bounds. */
export function anchor(region: Region, dir: [number, number], cy: number): Anchor | null {
	const b = boundsOf(region);
	if (!b) return null;
	const [dx, dy] = dir;
	const mx = (b.x0 + b.x1) / 2;
	if (dx === 0 || dy === 0) {
		const hit = rayHit(region, mx, cy, dx, dy);
		return hit ? { x: hit[0], y: hit[1], ux: dx, uy: dy } : null;
	}
	const corner: [number, number] = [dx < 0 ? b.x0 : b.x1, dy < 0 ? b.y0 : b.y1];
	const p = nearest(region, corner[0], corner[1]);
	if (!p) return null;
	const len = Math.hypot(corner[0] - mx, corner[1] - cy) || 1;
	return { x: p[0], y: p[1], ux: (corner[0] - mx) / len, uy: (corner[1] - cy) / len };
}

/**
 * 90° countersinks for flat-head screws (head ≈ twice the hole). The foot
 * of each cone is a hair wider than the hole, so the two surfaces never
 * meet at a grazing angle; the cone runs on through the relief, so a frame
 * never covers a screw head.
 */
export function countersinks(
	centres: readonly [number, number][],
	d: number,
	t: number,
	top: number
): Layer {
	const sink = Math.min(d / 2, t - MIN_FLOOR);
	const rise = top + 0.5 - (t - sink);
	const cones: Cone[] = centres.map(([x, y]) => ({
		x,
		y,
		r0: d / 2 + 0.05,
		r1: d / 2 + 0.05 + rise
	}));
	return { kind: 'cut', part: 'hole', region: [], cones, z0: t - sink, z1: top + 0.5 };
}

/** Same placement mirrored through the centre (the second loop). */
function opposite(dir: [number, number]): [number, number] {
	return [-dir[0], -dir[1]];
}

// ---------- The model ----------

export function buildTag(
	s: Scope,
	raw: TagParams,
	text: TextShapes | null,
	{ maxLines = 3, mounts }: { maxLines?: number; mounts?: readonly TagMount[] } = {}
): TagModel {
	const L = TAG_LIMITS;
	const contour = raw.base === 'contour';
	const shapeId = raw.shape;
	const W = clamp(raw.width, L.width);
	const H = shapeId === 'circle' ? W : clamp(raw.height, L.height);
	const t = clamp(raw.thickness, L.thickness);
	const relief = clamp(raw.relief, L.relief);
	const engraved = raw.mode === 'engraved';
	const depth = Math.min(relief, t - MIN_FLOOR);
	const d = clamp(raw.holeDiameter, L.holeDiameter);
	const ring = clamp(raw.ringWidth, L.ringWidth);
	const allowedMounts = mounts ?? (['loop', 'hole', 'holes2', 'holes4', 'none'] as const);
	let mount: TagMount = allowedMounts.includes(raw.mount) ? raw.mount : 'none';
	if (contour && mount !== 'loop') mount = 'none';
	const warnings: string[] = [];
	const lines = tagLines(raw, maxLines);
	const cap = clamp(raw.textHeight, L.textHeight);
	const textLines = lines.map((l, i) => ({ text: l, cap: i ? cap * SUBLINE : cap }));
	const reliefTop = engraved ? t : t + relief;

	const layers: Layer[] = [];
	const cuts: Layer[] = [];
	const keepouts: [number, number][] = []; // hole centres inside the plate
	const textPart = engraved ? 'engrave' : 'relief';
	const z0 = engraved ? t - depth : t;
	const z1 = engraved ? t + 0.01 : t + relief;

	const bold = (region: Region, capMm: number): Region =>
		raw.weight === 'bold' && region.length
			? regionOf(s.t(growApart(s.cs(region), boldOffset(capMm), boldOffset(capMm))))
			: region;

	// --- Base outline ---
	let plate: CrossSection;
	let textBlock: ReturnType<typeof layoutText> | null = null;
	if (contour) {
		if (!text || !lines.length) throw new ToolError(m.t_nameplate_generator_contour_no_text());
		textBlock = layoutText(text, textLines, { x0: -500, y0: -500, x1: 500, y1: 500 });
		const letters = s.cs(bold(textBlock.region, textBlock.caps[0] ?? cap));
		const pad = clamp(raw.contourPad, L.contourPad);
		const k = Math.max(3, cap * 0.35);
		// Closing: the margin plus a little more and back — gaps between lines fill in.
		plate = fillHoles(s, s.t(s.t(letters.offset(pad + k, 'Round')).offset(-k, 'Round')));
	} else {
		plate = tagShape(s, shapeId, W, H, clamp(raw.radius, L.radius));
	}
	const plateRegion = regionOf(plate);
	const pb = boundsOf(plateRegion) as Box;
	const cy = contour ? (pb.y0 + pb.y1) / 2 : contentCentre(shapeId, H);
	const bodyRegions: Region[] = [plateRegion];

	// --- Mounting ---
	const dir = own(DIRECTIONS, raw.placement) || DIRECTIONS.left;
	const holeAt = (x: number, y: number) =>
		cuts.push({
			kind: 'cut',
			part: 'hole',
			region: [circle(x, y, d / 2)],
			z0: -1,
			z1: reliefTop + 1
		});
	let placed = 0;
	if (mount === 'loop') {
		const ro = d / 2 + ring;
		for (const side of raw.bothSides ? [dir, opposite(dir)] : [dir]) {
			const a = anchor(plateRegion, side, cy);
			if (!a) continue;
			const cx = a.x + a.ux * (d / 2 + LOOP_GAP);
			const cyy = a.y + a.uy * (d / 2 + LOOP_GAP);
			const px = -a.uy;
			const py = a.ux;
			// Pill: a capsule from inside the plate out to the ring; flat: a D-shaped tab.
			const inner: [number, number][] =
				raw.loopShape === 'flat'
					? [
							[a.x + px * ro, a.y + py * ro],
							[a.x - a.ux * ro + px * ro, a.y - a.uy * ro + py * ro],
							[a.x - a.ux * ro - px * ro, a.y - a.uy * ro - py * ro],
							[a.x - px * ro, a.y - py * ro]
						]
					: circle(a.x - a.ux * ro, a.y - a.uy * ro, ro);
			bodyRegions.push([convexHull([...circle(cx, cyy, ro), ...inner])]);
			holeAt(cx, cyy);
			placed++;
		}
	} else if (mount === 'hole' || mount === 'holes2' || mount === 'holes4') {
		const inner = regionOf(s.t(plate.offset(-(d / 2 + ring), 'Round')));
		const dirs: [number, number][] =
			mount === 'hole'
				? [dir]
				: mount === 'holes2'
					? [
							[-1, 0],
							[1, 0]
						]
					: [
							[-1, 1],
							[1, 1],
							[-1, -1],
							[1, -1]
						];
		for (const dd of dirs) {
			const a = anchor(inner, dd, cy);
			if (!a) continue;
			holeAt(a.x, a.y);
			keepouts.push([a.x, a.y]);
			placed++;
		}
		if (raw.countersink && mount !== 'hole') cuts.push(countersinks(keepouts, d, t, reliefTop));
	}

	if (mount !== 'none' && placed === 0) warnings.push(m.t_nameplate_generator_warn_hole_no_room());

	// --- Where text and QR go (tile) ---
	const margin =
		raw.frame && !contour ? FRAME_INSET + clamp(raw.frameWidth, L.frameWidth) + 1.2 : 2;
	const qrOn = raw.qr && !contour && raw.qrText.trim().length > 0;
	let content: Box | null = null;
	if (!contour) {
		const allowedCs = s.t(plate.offset(-margin, 'Round'));
		let allowed = allowedCs;
		const ab = boundsOf(regionOf(allowedCs));
		if (ab) {
			const box = { ...ab };
			const keep = d / 2 + ring + 0.8;
			const wide = W >= H;
			for (const [x, y] of keepouts) {
				// Give up the strip beside the hole on the side it is on.
				const sideways =
					mount === 'holes2' ||
					(mount === 'holes4' && wide) ||
					(mount === 'hole' && (dir[1] === 0 || (dir[0] !== 0 && wide)));
				if (sideways) {
					if (x < 0) box.x0 = Math.max(box.x0, x + keep);
					else box.x1 = Math.min(box.x1, x - keep);
				} else if (y > cy) box.y1 = Math.min(box.y1, y - keep);
				else box.y0 = Math.max(box.y0, y + keep);
			}
			if (keepouts.length)
				allowed = s.t(allowedCs.subtract(s.cs(keepouts.map(([x, y]) => circle(x, y, keep)))));
			const bw = box.x1 - box.x0;
			const bh = box.y1 - box.y0;
			if (bw > 1 && bh > 1) {
				const mx = (box.x0 + box.x1) / 2;
				const my = shapeId === 'heart' ? cy : (box.y0 + box.y1) / 2;
				const fit = (w: number, h: number): Box => {
					const k = largestFit(s, allowed, (f) => [
						rect(mx - (w * f) / 2, my - (h * f) / 2, mx + (w * f) / 2, my + (h * f) / 2)
					]);
					return {
						x0: mx - (w * k) / 2,
						y0: my - (h * k) / 2,
						x1: mx + (w * k) / 2,
						y1: my + (h * k) / 2
					};
				};
				content = fit(bw, bh);
				// Text alone in a curved shape: a flatter box often holds bigger letters.
				const natural =
					!qrOn && text && lines.length
						? layoutText(text, textLines, { x0: -500, y0: -500, x1: 500, y1: 500 }).box
						: null;
				if (natural && shapeId !== 'rounded') {
					const tw = natural.x1 - natural.x0;
					const th = natural.y1 - natural.y0;
					const score = (b: Box) => Math.min((b.x1 - b.x0) / tw, (b.y1 - b.y0) / th);
					for (const flatter of [1.5, 2.2, 3.2]) {
						const candidate = fit(bw, bh / flatter);
						if (score(candidate) > score(content) * 1.02) content = candidate;
					}
				}
			}
		}
	}

	// --- QR ---
	let qrInfo: TagModel['qr'] = null;
	let textBox: Box | null = content;
	if (qrOn && content) {
		let code;
		try {
			code = encodeQr(raw.qrText.trim(), 'M');
		} catch (e) {
			if (e instanceof QrTooLongError) throw new ToolError(m.t_nameplate_generator_qr_too_long());
			throw e;
		}
		const cw = content.x1 - content.x0;
		const ch = content.y1 - content.y0;
		const quiet = raw.frame ? 2 : 1;
		const wide = cw >= ch * 1.15;
		const gap = 2;
		let side = clamp(raw.qrSize, L.qrSize);
		if (!lines.length) side = Math.min(side, cw, ch);
		else if (wide) side = Math.min(side, ch, cw * 0.62);
		else side = Math.min(side, cw, ch * 0.65);
		let qx: number;
		let qy: number;
		if (!lines.length) {
			qx = (content.x0 + content.x1) / 2 - side / 2;
			qy = (content.y0 + content.y1) / 2 - side / 2;
			textBox = null;
		} else if (wide) {
			qx = content.x0;
			qy = (content.y0 + content.y1) / 2 - side / 2;
			textBox = { ...content, x0: content.x0 + side + gap };
		} else {
			qx = (content.x0 + content.x1) / 2 - side / 2;
			qy = content.y1 - side;
			textBox = { ...content, y1: content.y1 - side - gap };
		}
		const module = side / (code.size + 2 * quiet);
		const region = qrRegion(s, code, { x: qx, y: qy, module, quiet });
		layers.push({ kind: textPart, part: 'qr', region, z0, z1 });
		qrInfo = { version: code.version, size: code.size, module, side: qrSide(code, module, quiet) };
		if (module < 0.8)
			warnings.push(m.t_nameplate_generator_warn_qr_module({ module: fmt(module) }));
		else if (side < 15) warnings.push(m.t_nameplate_generator_warn_qr_small());
	}

	// --- Text ---
	let textCap: number | null = null;
	if (lines.length && text) {
		if (!contour && textBox) textBlock = layoutText(text, textLines, textBox);
		if (textBlock && textBlock.region.length) {
			textCap = textBlock.caps[0] ?? null;
			const region = bold(textBlock.region, textCap ?? cap);
			layers.push({ kind: textPart, part: 'text', region, z0, z1 });
			if (textCap !== null && textCap < cap * 0.8 && !contour)
				warnings.push(m.t_nameplate_generator_warn_text_shrunk({ cap: fmt(textCap) }));
			if (Math.min(...textBlock.caps) < 3) warnings.push(m.t_nameplate_generator_warn_text_small());
		}
	}

	if (lines.length && !contour && !textBox)
		warnings.push(m.t_nameplate_generator_warn_text_no_room());

	// --- Frame ---
	if (raw.frame && !contour) {
		const fw = clamp(raw.frameWidth, L.frameWidth);
		const outer = s.t(plate.offset(-FRAME_INSET, 'Round'));
		const inner = s.t(plate.offset(-FRAME_INSET - fw, 'Round'));
		layers.push({
			kind: 'relief',
			part: 'frame',
			region: regionOf(s.t(s.t(outer.subtract(inner)).simplify(0.01))),
			z0: t,
			z1: t + relief
		});
	}

	// --- Back: magnets and tape ---
	const engravedDepth = engraved && layers.some((l) => l.kind === 'engrave') ? depth : 0;
	const backLimit = t - MIN_FLOOR - engravedDepth;
	if (raw.magnets > 0 && !contour) {
		const md = clamp(raw.magnetDiameter, L.magnetDiameter) + MAGNET_CLEARANCE;
		const want = clamp(raw.magnetDepth, L.magnetDepth);
		const mdep = Math.min(want, backLimit);
		if (want > backLimit + 1e-6)
			warnings.push(m.t_nameplate_generator_warn_magnet_depth({ depth: fmt(mdep) }));
		const fitArea = s.t(plate.offset(-(md / 2 + 1), 'Round'));
		let centres: [number, number][] = [[0, cy]];
		if (raw.magnets === 2) {
			const x = W / 4;
			const both = [circle(-x, cy, 0.05, 8), circle(x, cy, 0.05, 8)];
			if (x >= md / 2 + 1 && inside(s, fitArea, both))
				centres = [
					[-x, cy],
					[x, cy]
				];
			else warnings.push(m.t_nameplate_generator_warn_magnets_one());
		}
		if (!inside(s, fitArea, [circle(centres[0][0], cy, 0.05, 8)]))
			warnings.push(m.t_nameplate_generator_warn_magnet_wide());
		if (mdep > 0.2)
			cuts.push({
				kind: 'cut',
				part: 'magnet',
				region: centres.map(([x, y]) => circle(x, y, md / 2)),
				z0: -1,
				z1: mdep
			});
	}
	if (raw.adhesive && !contour) {
		const want = clamp(raw.adhesiveDepth, L.adhesiveDepth);
		const ad = Math.min(want, backLimit);
		const recess = regionOf(s.t(plate.offset(-2, 'Round')));
		if (ad > 0.1) cuts.push({ kind: 'cut', part: 'tape', region: recess, z0: -1, z1: ad });
	}

	// --- Checks ---
	if (t < 2) warnings.push(m.t_nameplate_generator_warn_thin());
	if (mount !== 'none' && d < 3) warnings.push(m.t_nameplate_generator_warn_small_hole());
	if (engraved && relief > t - MIN_FLOOR + 1e-6)
		warnings.push(m.t_nameplate_generator_warn_engrave_depth({ depth: fmt(depth) }));

	layers.unshift({ kind: 'body', part: 'base', region: bodyRegions.flat(), z0: 0, z1: t });
	layers.push(...cuts);
	const marks = layers.some((l) => l.kind === 'relief' || l.kind === 'engrave');
	return {
		layers,
		warnings,
		colorChange: marks ? (engraved ? t - depth : t) : null,
		qr: qrInfo,
		textCap
	};
}

/** A bolder face from the regular font: the outline grown (set wider on the page, boldSpacing). */
function boldOffset(capMm: number): number {
	return capMm * BOLD_GROW;
}

/** A size in mm the page language's way: «0,6», «0.6». */
export const fmt = (v: number) => num(v, 1);
