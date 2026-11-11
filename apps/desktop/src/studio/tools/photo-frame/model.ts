/**
 * «Фоторамки»: a frame for a photo of the usual sizes (10 × 15, 13 × 18,
 * 15 × 21, 10 × 10) or an Instax card, printed face down. The photo, an
 * optional sheet of acrylic and the back panel slide in from the top edge;
 * the panel is a dovetail, so its 45° edges hold it under the frame's lips
 * with no glue and nothing printed over air. The back has a keyhole for a
 * nail, and two feet hold the frame leaning back by 15° on a table.
 */
import {
	circle,
	cube,
	difference,
	extrude,
	label,
	loft,
	mirror,
	part,
	rotate,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/photo-frame';
import { clamp } from '../shared/math';
import { ownKey } from '$lib/own';

export type PhotoSize =
	| '10x15'
	| '13x18'
	| '15x21'
	| '10x10'
	| 'instax-mini'
	| 'instax-square'
	| 'instax-wide'
	| 'custom';

/** Photo or card sizes, mm, short side first. */
export const PHOTO_SIZES: Record<Exclude<PhotoSize, 'custom'>, readonly [number, number]> = {
	'10x15': [102, 152],
	'13x18': [127, 178],
	'15x21': [152, 210],
	'10x10': [102, 102],
	'instax-mini': [54, 86],
	'instax-square': [72, 86],
	'instax-wide': [86, 108]
};

export interface PhotoFrameParams {
	size: PhotoSize;
	/** Own photo, mm */
	width: number;
	height: number;
	landscape: boolean;
	/** The frame's width around the window, mm */
	border: number;
	/** How far the frame covers the photo's edge, mm */
	overlap: number;
	/** Acrylic in front of the photo, mm (0 — none) */
	glass: number;
	bevel: boolean;
	/** Cut into the bottom of the frame's face */
	caption: string;
	feet: boolean;
	font: string;
}

export const PHOTO_FRAME_DEFAULTS: PhotoFrameParams = {
	size: '10x15',
	width: 100,
	height: 100,
	landscape: false,
	border: 18,
	overlap: 3,
	glass: 0,
	bevel: true,
	caption: '',
	feet: true,
	font: 'Noto Sans'
};

export const PHOTO_FRAME_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<PhotoFrameParams>;
}[] = [
	{ id: '10x15', label: '10 × 15', params: {} },
	{ id: '13x18', label: '13 × 18', params: { size: '13x18', border: 20 } },
	{ id: '15x21', label: '15 × 21', params: { size: '15x21', border: 16 } },
	{ id: 'instax', label: 'Instax mini', params: { size: 'instax-mini', border: 12, overlap: 2 } },
	{
		id: 'caption',
		get label() {
			return m.t_photo_frame_preset_caption();
		},
		params: {
			size: '10x15',
			landscape: true,
			border: 22,
			// A sample caption cut into the frame: each language gets its own.
			get caption() {
				return m.t_photo_frame_preset_caption_text();
			}
		}
	}
];

export function clampPhotoFrame(p: PhotoFrameParams): PhotoFrameParams {
	return {
		size: ownKey(PHOTO_SIZES, p.size) || p.size === 'custom' ? p.size : '10x15',
		width: clamp(p.width, 30, 250),
		height: clamp(p.height, 30, 250),
		landscape: !!p.landscape,
		border: clamp(p.border, 10, 40),
		overlap: clamp(p.overlap, 1, 6),
		glass: clamp(p.glass, 0, 3),
		bevel: !!p.bevel,
		caption: (p.caption ?? '').trim().slice(0, 40),
		feet: !!p.feet,
		font: p.font || 'Noto Sans'
	};
}

/** Through the frame's thickness, mm: face, photo and acrylic play, panel, rim. */
const FACE = 2.4;
const PAPER = 0.4;
const PANEL = 2;
const RIM = 0.8;
/** Play around the photo, on each side, and of the panel in its groove, mm. */
const PHOTO_PLAY = 0.5;
const PANEL_PLAY = 0.25;
const ENGRAVE = 0.6;
const FOOT = { w: 30, d: 34, h: 12, floor: 3, lean: 15 };

export interface PhotoFrameLayout {
	/** Photo, window and the frame outside, mm (x across, y up) */
	photo: [number, number];
	window: [number, number];
	outer: [number, number];
	thickness: number;
	/** The groove the photo and panel slide along: its width and bottom (y) */
	groove: number;
	grooveBottom: number;
	/** Panel's bottom face (z) and its size */
	panelZ: number;
	panel: [number, number];
}

export function photoFrameLayout(input: PhotoFrameParams): PhotoFrameLayout {
	const p = clampPhotoFrame(input);
	const [a, b] = p.size === 'custom' ? [p.width, p.height] : PHOTO_SIZES[p.size];
	const [pw, ph] =
		p.size === 'custom'
			? [a, b]
			: p.landscape
				? [Math.max(a, b), Math.min(a, b)]
				: [Math.min(a, b), Math.max(a, b)];
	const window: [number, number] = [pw - 2 * p.overlap, ph - 2 * p.overlap];
	const outer: [number, number] = [window[0] + 2 * p.border, window[1] + 2 * p.border];
	const panelZ = FACE + PAPER + p.glass;
	const groove = pw + 2 * PHOTO_PLAY;
	const grooveBottom = -(ph / 2 + PHOTO_PLAY);
	return {
		photo: [pw, ph],
		window,
		outer,
		thickness: panelZ + PANEL + RIM,
		groove,
		grooveBottom,
		panelZ,
		// The panel runs from the groove's end out to the frame's top edge.
		panel: [groove - 2 * PANEL_PLAY, outer[1] / 2 - grooveBottom - PANEL_PLAY]
	};
}

/** A rectangle from x0..x1, y0..y1. */
const box2 = (x0: number, x1: number, y0: number, y1: number): Node =>
	translate([(x0 + x1) / 2, (y0 + y1) / 2], square(x1 - x0, y1 - y0));

function frame(p: PhotoFrameParams, L: PhotoFrameLayout): Node {
	const [W, H] = L.outer;
	const [vw, vh] = L.window;
	const T = L.thickness;
	const g = L.groove / 2;
	const y0 = L.grooveBottom;
	const top = H / 2 + 1;
	const z1 = L.panelZ;
	const z2 = z1 + PANEL;
	const bevel = p.bevel ? FACE - 0.8 : 0;
	const cuts: Node[] = [
		// The window, opening out to the face at 45° when bevelled.
		bevel
			? loft([
					{ z: -0.01, shape: square(vw + 2 * bevel + 0.02, vh + 2 * bevel + 0.02) },
					{ z: bevel, shape: square(vw, vh) },
					{ z: T + 1, shape: square(vw, vh) }
				])
			: translate([0, 0, -1], extrude(T + 2, square(vw, vh))),
		// Photo and acrylic, square-edged; then the panel's dovetail, then the open back.
		translate([0, 0, FACE], extrude(z1 - FACE + 0.01, box2(-g, g, y0, top))),
		loft([
			{ z: z1, shape: box2(-g, g, y0, top) },
			{ z: z2, shape: box2(-g + PANEL, g - PANEL, y0 + PANEL, top) },
			{ z: T + 1, shape: box2(-g + PANEL, g - PANEL, y0 + PANEL, top) }
		])
	];
	if (p.caption) {
		const cap = Math.min(8, p.border * 0.4);
		// Face down: mirrored so it reads from the front.
		cuts.push(
			translate(
				[0, -(vh / 2 + p.border / 2) - cap / 2, -1],
				extrude(
					ENGRAVE + 1,
					mirror(
						[1, 0, 0],
						label(p.caption, cap, { font: p.font, bold: true, fit: vw, valign: 'baseline' })
					)
				)
			)
		);
	}
	return difference(extrude(T, rrect(W, H, 3, 32)), ...cuts);
}

/** How far the hanger stands out of the panel's back, mm. */
const HANGER = 3.5;

/**
 * The back panel, printed back face up: 45° edges on three sides and a
 * keyhole hanger near the top — on a boss on the back, so the nail head
 * slides up under its lip and never reaches the photo behind a whole panel.
 */
function panel(L: PhotoFrameLayout): Node {
	const [w, h] = L.panel;
	const s = PANEL - PANEL_PLAY;
	const body = loft([
		{ z: 0, shape: box2(-w / 2, w / 2, 0, h) },
		{ z: s, shape: box2(-w / 2 + s, w / 2 - s, s, h) }
	]);
	const ky = Math.min(h - Math.min(30, h * 0.2), h - 10);
	const lip = 1.5;
	const boss = translate([0, ky - 4, s - 0.01], extrude(HANGER + 0.01, rrect(16, 26, 4, 24)));
	// The head goes in the round end, then slides up under the lip; the shank runs in the slot.
	const entry = translate([0, ky - 10, s], extrude(HANGER + 1, circle(4.75, 32)));
	const run = translate([0, ky - 3, s - 0.01], extrude(HANGER - lip + 0.01, square(9.5, 14)));
	const slot = translate([0, ky - 3, s + HANGER - lip - 0.01], extrude(lip + 1, square(4.4, 14)));
	return difference(union(body, boss), entry, run, slot);
}

/** A foot: a block with a slot leaning the frame back by 15°. */
function foot(thickness: number): Node {
	const slot = thickness + 0.4;
	return difference(
		extrude(FOOT.h, rrect(FOOT.w, FOOT.d, 4, 24)),
		translate(
			[0, 3, FOOT.floor],
			rotate(
				[FOOT.lean, 0, 0],
				translate([-FOOT.w, -slot / 2, 0], cube([2 * FOOT.w, slot, FOOT.h * 2]))
			)
		)
	);
}

/** The frame, and the back panel where it sits when slid all the way in. */
export function photoFrameFit(input: PhotoFrameParams): { frame: Node; back: Node } {
	const p = clampPhotoFrame(input);
	const L = photoFrameLayout(p);
	return {
		frame: frame(p, L),
		back: translate([0, L.grooveBottom + PANEL_PLAY, L.panelZ], panel(L))
	};
}

export function photoFrameModel(input: PhotoFrameParams): Node {
	const p = clampPhotoFrame(input);
	const L = photoFrameLayout(p);
	const [W, H] = L.outer;
	const [pw, ph] = L.panel;
	const feet = p.feet
		? [-1, 1].map((s) =>
				translate([s * (FOOT.w / 2 + 4), -(H / 2 + 8 + FOOT.d / 2), 0], foot(L.thickness))
			)
		: [];
	return union(
		part('frame', frame(p, L)),
		part('back', translate([W / 2 + 8 + pw / 2, -ph / 2, 0], panel(L))),
		feet.length ? part('feet', union(...feet)) : null
	);
}

/** Each part on its own, for a bed too small for all of them at once. */
export function photoFrameParts(
	input: PhotoFrameParams
): { name: string; file: string; node: Node }[] {
	const p = clampPhotoFrame(input);
	const L = photoFrameLayout(p);
	const parts = [
		{
			name: m.t_photo_frame_part_frame(),
			file: m.t_photo_frame_part_frame_filename(),
			node: frame(p, L)
		},
		{
			name: m.t_photo_frame_part_back(),
			file: m.t_photo_frame_part_back_filename(),
			node: panel(L)
		}
	];
	if (p.feet)
		parts.push({
			name: m.t_photo_frame_part_feet(),
			file: m.t_photo_frame_part_feet_filename(),
			node: union(...[-1, 1].map((s) => translate([s * (FOOT.w / 2 + 4), 0, 0], foot(L.thickness))))
		});
	return parts;
}

/** Everything as photoFrameModel lays it out on the bed, mm. */
export function photoFrameExtent(input: PhotoFrameParams): [number, number] {
	const p = clampPhotoFrame(input);
	const L = photoFrameLayout(p);
	const [W, H] = L.outer;
	const [pw, ph] = L.panel;
	return [W + 8 + pw, Math.max(H, ph) / 2 + H / 2 + (p.feet ? 8 + FOOT.d : 0)];
}

export function photoFrameTexts(input: PhotoFrameParams): Node[] {
	const p = clampPhotoFrame(input);
	const L = photoFrameLayout(p);
	return p.caption
		? [
				label(p.caption, Math.min(8, p.border * 0.4), {
					font: p.font,
					bold: true,
					fit: L.window[0],
					valign: 'baseline'
				})
			]
		: [];
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function photoFrameSummary(input: PhotoFrameParams): string {
	const p = clampPhotoFrame(input);
	const L = photoFrameLayout(p);
	const [W, H] = L.outer;
	const sizes = {
		width: mm(W),
		height: mm(H),
		thickness: mm(L.thickness),
		photo_width: mm(L.photo[0]),
		photo_height: mm(L.photo[1]),
		window_width: mm(L.window[0]),
		window_height: mm(L.window[1])
	};
	return p.glass
		? m.t_photo_frame_summary_glass({ ...sizes, glass: mm(p.glass) })
		: m.t_photo_frame_summary(sizes);
}

export function photoFrameHeader(input: PhotoFrameParams): string[] {
	return [m.t_photo_frame_scad_title(), photoFrameSummary(input), m.t_photo_frame_scad_print()];
}

export function photoFrameScad(p: PhotoFrameParams): string {
	return toScad(photoFrameModel(p), photoFrameHeader(p));
}
