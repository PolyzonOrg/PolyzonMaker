/**
 * «NFC-метки»: a business card of the bank-card size (ISO/IEC 7810 ID-1,
 * 85,6 × 53,98 mm, corners r 3,18), a key fob, a round token or a table
 * stand «для отзывов» with a hidden pocket for a round NFC sticker. The
 * pocket sits on whole 0,2 mm layers, so the slicer pauses right above it:
 * the sticker goes in and the printer closes it over. Up to three lines of
 * raised or cut-in text, and a ring marking where to touch the phone.
 */
import {
	circle,
	cube,
	difference,
	extrude,
	label,
	part,
	rotate,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/nfc-tag';
import { clamp } from '../shared/math';

export type NfcShape = 'card' | 'keychain' | 'round' | 'stand';
export type NfcText = 'raised' | 'engraved';

export interface NfcTagParams {
	shape: NfcShape;
	/** Sticker diameter, mm */
	tag: number;
	/** Sticker with its glue, mm */
	tagThickness: number;
	thickness: number;
	/** Up to three lines */
	text: string;
	style: NfcText;
	/** A ring over the sticker: «touch here» */
	mark: boolean;
	font: string;
}

export const NFC_TAG_DEFAULTS: NfcTagParams = {
	shape: 'card',
	tag: 25,
	tagThickness: 0.4,
	thickness: 2,
	get text() {
		return m.t_nfc_tag_text_default();
	},
	style: 'raised',
	mark: true,
	font: 'Noto Sans'
};

export const NFC_TAG_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<NfcTagParams>;
}[] = [
	{
		id: 'card',
		get label() {
			return m.t_nfc_tag_preset_card();
		},
		params: {}
	},
	{
		id: 'stand',
		get label() {
			return m.t_nfc_tag_preset_stand();
		},
		params: {
			shape: 'stand',
			thickness: 4,
			get text() {
				return m.t_nfc_tag_preset_stand_text();
			}
		}
	},
	{
		id: 'keychain',
		get label() {
			return m.t_nfc_tag_preset_keychain();
		},
		params: {
			shape: 'keychain',
			thickness: 3,
			get text() {
				return m.t_nfc_tag_preset_keychain_text();
			},
			mark: false
		}
	},
	{
		id: 'round',
		get label() {
			return m.t_nfc_tag_preset_round();
		},
		params: { shape: 'round', thickness: 3, text: 'Wi-Fi', mark: true }
	}
];

export function clampNfcTag(p: NfcTagParams): NfcTagParams {
	return {
		shape: (['card', 'keychain', 'round', 'stand'] as const).includes(p.shape) ? p.shape : 'card',
		tag: clamp(p.tag, 15, p.shape === 'card' ? 40 : 50),
		tagThickness: clamp(p.tagThickness, 0.1, 1.5),
		thickness: clamp(p.thickness, 1.2, 8),
		text: (p.text ?? '')
			.split('\n')
			.map((l) => l.trim().slice(0, 32))
			.filter(Boolean)
			.slice(0, 3)
			.join('\n'),
		style: p.style === 'engraved' ? 'engraved' : 'raised',
		mark: !!p.mark,
		font: p.font || 'Noto Sans'
	};
}

/** ISO/IEC 7810 ID-1, mm. */
export const CARD = { w: 85.6, h: 53.98, r: 3.18 } as const;
/** The stand's sign and its base, mm. */
const STAND = { w: 70, h: 100, base: { w: 80, d: 36, h: 14, floor: 4 }, lean: 15, slot: 10 };
const LAYER = 0.2;
const FLOOR = 0.6;
const RELIEF = 0.6;
/** Pocket's play around the sticker, on the diameter, mm. */
const PLAY = 1;
const RING = 0.8;
const KEY_HOLE = 5;

type Pt = [number, number];

interface Outline {
	shape: Node;
	w: number;
	h: number;
	holes: Pt[];
	pocket: Pt;
	/** Text block: its centre line x, top and bottom, and the room at height y */
	cx: number;
	top: number;
	bottom: number;
	room: (y: number) => number;
}

function outline(p: NfcTagParams): Outline {
	const D = p.tag + PLAY;
	switch (p.shape) {
		case 'card': {
			const { w, h } = CARD;
			if (!p.mark)
				return {
					shape: rrect(w, h, CARD.r, 32),
					w,
					h,
					holes: [],
					pocket: [0, 0],
					cx: 0,
					top: h / 2 - 5,
					bottom: -h / 2 + 5,
					room: () => w - 10
				};
			// The ring at the right, the lines to its left.
			const px = w / 2 - 6 - D / 2;
			const left = -w / 2 + 5;
			const right = px - D / 2 - 4;
			return {
				shape: rrect(w, h, CARD.r, 32),
				w,
				h,
				holes: [],
				pocket: [px, 0],
				cx: (left + right) / 2,
				top: h / 2 - 5,
				bottom: -h / 2 + 5,
				room: () => right - left
			};
		}
		case 'keychain': {
			const h = D + 8;
			const w = h + KEY_HOLE + 6;
			const px = (KEY_HOLE + 6) / 2;
			return {
				shape: rrect(w, h, 6, 32),
				w,
				h,
				holes: [[-w / 2 + 3 + KEY_HOLE / 2, 0]],
				pocket: [px, 0],
				cx: px,
				...inside(p.mark ? D / 2 - RING - 1.5 : h / 2 - 3)
			};
		}
		case 'round': {
			const w = D + 14;
			return {
				shape: circle(w / 2, 96),
				w,
				h: w,
				holes: [],
				pocket: [0, 0],
				cx: 0,
				...inside(p.mark ? D / 2 - RING - 1.5 : w / 2 - 4)
			};
		}
		case 'stand': {
			const { w, h } = STAND;
			const py = h / 2 - 8 - D / 2;
			return {
				shape: rrect(w, h, 6, 32),
				w,
				h,
				holes: [],
				pocket: [0, py],
				cx: 0,
				top: py - D / 2 - 6,
				// Clear of the base's slot.
				bottom: -h / 2 + STAND.slot + 4,
				room: () => w - 10
			};
		}
	}
}

/** Text inside a circle of radius r around the pocket. */
function inside(r: number): Pick<Outline, 'top' | 'bottom' | 'room'> {
	return {
		top: r * 0.8,
		bottom: -r * 0.8,
		room: (y) => 2 * Math.sqrt(Math.max(0, r * r - y * y))
	};
}

export interface NfcPocket {
	/** The plate's thickness, mm (raised once the pocket needs it) */
	thickness: number;
	/** Pocket diameter and its bottom and top, mm */
	diameter: number;
	bottom: number;
	top: number;
}

/**
 * The pocket on whole layers, near the middle of the plate and under at
 * least two layers of plastic (or the cut-in text and two more).
 */
export function nfcPocket(input: NfcTagParams): NfcPocket {
	const p = clampNfcTag(input);
	const depth = Math.ceil((p.tagThickness + 0.1) / LAYER - 1e-6) * LAYER;
	const cover = (p.style === 'engraved' ? RELIEF : 0) + 2 * LAYER;
	const thickness = Math.max(p.thickness, FLOOR + depth + cover);
	const highest = Math.floor((thickness - cover - depth) / LAYER + 1e-6) * LAYER;
	const bottom = Math.min(
		highest,
		Math.max(FLOOR, Math.round((thickness - depth) / 2 / LAYER + 1e-6) * LAYER)
	);
	return { thickness, diameter: p.tag + PLAY, bottom, top: bottom + depth };
}

export interface NfcLayout {
	lines: string[];
	cap: number;
	/** Baselines, from the centre, y up */
	baselines: number[];
}

export function nfcLayout(input: NfcTagParams): NfcLayout {
	const p = clampNfcTag(input);
	const o = outline(p);
	const lines = p.text ? p.text.split('\n') : [];
	const n = Math.max(1, lines.length);
	const pitch = (o.top - o.bottom) / n;
	const cap = Math.min(pitch / 1.5, p.shape === 'stand' ? 9 : 6);
	const baselines = lines.map((_, i) => o.top - pitch * i - (pitch + cap) / 2);
	return { lines, cap, baselines };
}

function letters(p: NfcTagParams, o: Outline, L: NfcLayout): Node[] {
	return L.lines.map((line, i) => {
		const y = L.baselines[i];
		const fit = Math.max(4, Math.min(o.room(y), o.room(y + L.cap)));
		return translate(
			[o.cx, y, 0],
			label(line, L.cap, { font: p.font, bold: true, fit, valign: 'baseline' })
		);
	});
}

function plate(p: NfcTagParams): Node {
	const o = outline(p);
	const k = nfcPocket(p);
	const T = k.thickness;
	const [px, py] = o.pocket;
	const marks: Node[] = [...letters(p, o, nfcLayout(p))];
	if (p.mark)
		marks.push(
			translate(
				[px, py, 0],
				difference(circle(k.diameter / 2, 96), circle(k.diameter / 2 - RING, 96))
			)
		);
	const body = difference(
		extrude(T, o.shape),
		translate([px, py, k.bottom], extrude(k.top - k.bottom, circle(k.diameter / 2, 96))),
		...o.holes.map(([x, y]) => translate([x, y, -1], extrude(T + 2, circle(KEY_HOLE / 2, 32))))
	);
	if (!marks.length) return body;
	return p.style === 'raised'
		? union(body, translate([0, 0, T - 0.01], extrude(RELIEF + 0.01, union(...marks))))
		: difference(body, translate([0, 0, T - RELIEF], extrude(RELIEF + 1, union(...marks))));
}

/** The stand's base: a block with a slot leaning the sign back by 15°. */
function standBase(thickness: number): Node {
	const B = STAND.base;
	const slotW = thickness + 0.4;
	return difference(
		extrude(B.h, rrect(B.w, B.d, 6, 32)),
		translate(
			[0, 3, B.floor],
			rotate(
				[STAND.lean, 0, 0],
				translate([-(STAND.w + 1) / 2, -slotW / 2, 0], cube([STAND.w + 1, slotW, B.h * 2]))
			)
		)
	);
}

export function nfcTagModel(input: NfcTagParams): Node {
	const p = clampNfcTag(input);
	if (p.shape !== 'stand') return part('tag', plate(p));
	const T = nfcPocket(p).thickness;
	return union(
		part('sign', plate(p)),
		part('base', translate([0, -(STAND.h / 2 + 8 + STAND.base.d / 2), 0], standBase(T)))
	);
}

export function nfcTagTexts(input: NfcTagParams): Node[] {
	const p = clampNfcTag(input);
	const L = nfcLayout(p);
	return L.lines.map((line) =>
		label(line, L.cap, { font: p.font, bold: true, valign: 'baseline' })
	);
}

const mm = (v: number) => num(Math.round(v * 100) / 100, 2);

/** Where to pause, at 0,2 mm layers. */
export function nfcPause(input: NfcTagParams): string {
	const k = nfcPocket(input);
	return m.t_nfc_tag_pause({ top: mm(k.top), next: mm(k.top + LAYER) });
}

export function nfcTagSummary(input: NfcTagParams): string {
	const p = clampNfcTag(input);
	const k = nfcPocket(p);
	const o = outline(p);
	const pocket = {
		thickness: mm(k.thickness),
		pocket: mm(k.diameter),
		depth: mm(k.top - k.bottom),
		tag: mm(p.tag)
	};
	switch (p.shape) {
		case 'card':
			return m.t_nfc_tag_summary_card({ w: mm(CARD.w), h: mm(CARD.h), ...pocket });
		case 'keychain':
			return m.t_nfc_tag_summary_keychain({ w: mm(o.w), h: mm(o.h), ...pocket });
		case 'round':
			return m.t_nfc_tag_summary_round({ w: mm(o.w), ...pocket });
		default:
			return m.t_nfc_tag_summary_stand({
				w: num(STAND.w),
				h: num(STAND.h),
				lean: num(STAND.lean),
				...pocket
			});
	}
}

export function nfcTagHeader(input: NfcTagParams): string[] {
	return [m.t_nfc_tag_scad_title(), nfcTagSummary(input), nfcPause(input)];
}

export function nfcTagScad(p: NfcTagParams): string {
	return toScad(nfcTagModel(p), nfcTagHeader(p));
}
