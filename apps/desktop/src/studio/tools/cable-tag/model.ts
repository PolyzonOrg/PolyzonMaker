/**
 * «Кабельные бирки»: marking tags of the usual shapes — У-134 (square
 * 55 × 55 mm, power cables up to 1 kV), У-135 (circle ⌀ 55, above 1 kV),
 * У-136 (triangle 55 mm, control cables) — or your own rectangle, with two
 * holes for a tie and up to four lines of marking, raised (for a second
 * colour from a layer up) or cut in. A set at once: «{n}» in the text
 * becomes each tag's number.
 */
import {
	circle,
	difference,
	extrude,
	label,
	part,
	polygon,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/cable-tag';
import { clamp } from '../shared/math';

export type TagShape = 'square' | 'circle' | 'triangle' | 'rect';
export type TagText = 'raised' | 'engraved';

export interface CableTagParams {
	shape: TagShape;
	/** Own rectangle, mm */
	width: number;
	height: number;
	thickness: number;
	/** Up to four lines; {n} is the tag's number */
	text: string;
	style: TagText;
	quantity: number;
	start: number;
	font: string;
}

export const CABLE_TAG_DEFAULTS: CableTagParams = {
	shape: 'square',
	width: 60,
	height: 25,
	thickness: 1.2,
	// A sample marking printed into the model: each language gets its own.
	get text() {
		return m.t_cable_tag_default_text();
	},
	style: 'raised',
	quantity: 6,
	start: 1,
	font: 'Noto Sans'
};

export const CABLE_TAG_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<CableTagParams>;
}[] = [
	{
		id: 'u134',
		get label() {
			return m.t_cable_tag_shape_square();
		},
		params: { shape: 'square' }
	},
	{
		id: 'u135',
		get label() {
			return m.t_cable_tag_shape_circle();
		},
		params: {
			shape: 'circle',
			get text() {
				return m.t_cable_tag_preset_circle_text();
			}
		}
	},
	{
		id: 'u136',
		get label() {
			return m.t_cable_tag_shape_triangle();
		},
		params: {
			shape: 'triangle',
			get text() {
				return m.t_cable_tag_preset_triangle_text();
			}
		}
	},
	{
		id: 'strip',
		get label() {
			return m.t_cable_tag_preset_strip();
		},
		params: {
			shape: 'rect',
			width: 50,
			height: 14,
			get text() {
				return m.t_cable_tag_preset_strip_text();
			}
		}
	}
];

export function clampCableTag(p: CableTagParams): CableTagParams {
	return {
		shape: (['square', 'circle', 'triangle', 'rect'] as const).includes(p.shape)
			? p.shape
			: 'square',
		width: clamp(p.width, 20, 150),
		height: clamp(p.height, 10, 150),
		thickness: clamp(p.thickness, 0.8, 4),
		text: (p.text ?? '')
			.split('\n')
			.slice(0, 4)
			.map((l) => l.slice(0, 30))
			.join('\n'),
		style: p.style === 'engraved' ? 'engraved' : 'raised',
		quantity: Math.round(clamp(p.quantity, 1, 60)),
		start: Math.round(clamp(p.start, 0, 9999)),
		font: p.font || 'Noto Sans'
	};
}

/** The standard tags' side, mm. */
const SIDE = 55;
/** Tie holes: diameter and their distance from the top edge, mm. */
const HOLE = { d: 4, inset: 5 };
const RELIEF = 0.6;

type Pt = [number, number];

interface Outline {
	shape: Node;
	w: number;
	h: number;
	/** Hole centres */
	holes: Pt[];
	/** Width free for text at height y (from the centre, y up) */
	room: (y: number) => number;
	/** Text block: its top and bottom, mm */
	top: number;
	bottom: number;
}

function outline(p: CableTagParams): Outline {
	switch (p.shape) {
		case 'circle': {
			const r = SIDE / 2;
			return {
				shape: circle(r, 96),
				w: SIDE,
				h: SIDE,
				holes: [
					[-9, r - HOLE.inset - 2],
					[9, r - HOLE.inset - 2]
				],
				room: (y) => 2 * Math.sqrt(Math.max(0, (r - 4) ** 2 - y * y)),
				top: r - 13,
				bottom: -r + 6
			};
		}
		case 'triangle': {
			// Point down, the top edge level; centred on its centroid.
			const h = (SIDE * Math.sqrt(3)) / 2;
			const yTop = h / 3;
			const pts: Pt[] = [
				[-SIDE / 2, yTop],
				[0, yTop - h],
				[SIDE / 2, yTop]
			];
			return {
				shape: polygon(pts),
				w: SIDE,
				h,
				holes: [
					[-9, yTop - HOLE.inset],
					[9, yTop - HOLE.inset]
				],
				room: (y) => Math.max(0, (SIDE * (y - (yTop - h))) / h - 8),
				// High up, where the triangle is wide.
				top: yTop - 9,
				bottom: yTop - h * 0.5
			};
		}
		case 'rect':
		case 'square': {
			const w = p.shape === 'square' ? SIDE : p.width;
			const h = p.shape === 'square' ? SIDE : p.height;
			// A narrow strip has its holes at the ends instead of the top.
			const ends = p.shape === 'rect' && h < 30;
			// Two holes 24 mm apart where the tag is wide enough, one in the middle otherwise.
			const hx = Math.min(12, w / 2 - HOLE.inset);
			const y = h / 2 - HOLE.inset;
			return {
				shape: rrect(w, h, 3, 32),
				w,
				h,
				holes: ends
					? [
							[-w / 2 + HOLE.inset, 0],
							[w / 2 - HOLE.inset, 0]
						]
					: hx > HOLE.d
						? [
								[-hx, y],
								[hx, y]
							]
						: [[0, y]],
				room: () => w - (ends ? 2 * HOLE.inset + 2 * HOLE.d : 8),
				top: ends ? h / 2 - 2 : h / 2 - 2 * HOLE.inset - 2,
				bottom: -h / 2 + 2
			};
		}
	}
}

/** The tag's lines with its number put in. */
export function tagLines(input: CableTagParams, index: number): string[] {
	const p = clampCableTag(input);
	return p.text
		.split('\n')
		.map((l) => l.replace(/\{n\}/g, String(p.start + index)).trim())
		.filter(Boolean);
}

export interface TagLayout {
	cap: number;
	/** Baselines of the lines, from the centre, y up */
	baselines: number[];
}

/** Lines evenly in the text block, as large as they fit (four lines at most). */
export function tagLayout(input: CableTagParams, lines: number): TagLayout {
	const p = clampCableTag(input);
	const o = outline(p);
	const n = Math.max(1, lines);
	const pitch = (o.top - o.bottom) / n;
	const cap = Math.min(pitch / 1.5, 9);
	const baselines = Array.from({ length: n }, (_, i) => o.top - pitch * i - (pitch + cap) / 2);
	return { cap, baselines };
}

function tag(p: CableTagParams, index: number): Node {
	const o = outline(p);
	const lines = tagLines(p, index);
	const L = tagLayout(p, lines.length);
	const T = p.thickness;
	const body = difference(
		extrude(T, o.shape),
		...o.holes.map(([x, y]) => translate([x, y, -1], extrude(T + 2, circle(HOLE.d / 2, 24))))
	);
	const letters = lines.map((line, i) => {
		const y = L.baselines[i];
		// The narrower of the room at the line's foot and at its top.
		const fit = Math.max(4, Math.min(o.room(y), o.room(y + L.cap)));
		return translate(
			[0, y, 0],
			label(line, L.cap, { font: p.font, bold: true, fit, valign: 'baseline' })
		);
	});
	if (!letters.length) return body;
	return p.style === 'raised'
		? union(body, translate([0, 0, T - 0.01], extrude(RELIEF + 0.01, union(...letters))))
		: // At least 0.6 mm stays under engraved letters.
			difference(
				body,
				translate([0, 0, T - Math.min(RELIEF, T - 0.6)], extrude(RELIEF + 1, union(...letters)))
			);
}

export function cableTagModel(input: CableTagParams): Node {
	const p = clampCableTag(input);
	const o = outline(p);
	const perRow = Math.min(p.quantity, Math.max(1, Math.round(Math.sqrt(p.quantity * 1.4))));
	const rows = Math.ceil(p.quantity / perRow);
	const dx = o.w + 4;
	const dy = o.h + 4;
	return part(
		'tags',
		union(
			...Array.from({ length: p.quantity }, (_, i) =>
				translate(
					[
						((i % perRow) - (perRow - 1) / 2) * dx,
						((rows - 1) / 2 - Math.floor(i / perRow)) * dy,
						0
					],
					tag(p, i)
				)
			)
		)
	);
}

export function cableTagTexts(input: CableTagParams): Node[] {
	const p = clampCableTag(input);
	const lines = tagLines(p, 0);
	const L = tagLayout(p, lines.length);
	return lines.map((line) => label(line, L.cap, { font: p.font, bold: true, valign: 'baseline' }));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

function shapeWords(p: CableTagParams): string {
	switch (p.shape) {
		case 'square':
			return m.t_cable_tag_summary_square();
		case 'circle':
			return m.t_cable_tag_summary_circle();
		case 'triangle':
			return m.t_cable_tag_summary_triangle();
		case 'rect':
			return m.t_cable_tag_summary_size({ width: mm(p.width), height: mm(p.height) });
	}
}

export function cableTagSummary(input: CableTagParams): string {
	const p = clampCableTag(input);
	const first = tagLines(p, 0).join(' / ');
	const last = tagLines(p, p.quantity - 1).join(' / ');
	const shape = shapeWords(p);
	// A sheet bigger than a common bed: say how many fit.
	const o = outline(p);
	const perBed = Math.floor(224 / (o.w + 4)) * Math.floor(224 / (o.h + 4));
	const tags = { count: p.quantity, n: num(p.quantity), shape, first };
	const set =
		p.quantity > 1 && last !== first
			? m.t_cable_tag_summary_range({ ...tags, last })
			: m.t_cable_tag_summary(tags);
	return p.quantity > perBed
		? set +
				sentenceGap(currentLocale()) +
				m.t_cable_tag_summary_bed({ count: perBed, n: num(perBed) })
		: set;
}

export function cableTagHeader(input: CableTagParams): string[] {
	return [m.t_cable_tag_scad_title(), cableTagSummary(input)];
}

export function cableTagScad(p: CableTagParams): string {
	return toScad(cableTagModel(p), cableTagHeader(p));
}
