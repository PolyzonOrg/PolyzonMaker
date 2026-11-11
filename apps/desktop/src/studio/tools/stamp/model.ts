/**
 * Stamps for ink, clay, wax or biscuits: a face in relief, a base and a
 * knob to hold. It prints face down — the face's fine detail comes first,
 * on the bed — which is also how it is used. Drawn as seen from above, so
 * the print reads right (the face itself looks mirrored from below).
 * A notch on the knob shows which way is up.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	hull,
	intersection,
	offset,
	part,
	polygon,
	rrect,
	text,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/stamp';
import { clamp as c } from '../shared/math';

export type StampFace = 'text' | 'heart' | 'star';
export type StampShape = 'round' | 'rect';

export interface StampParams {
	face: StampFace;
	text: string;
	shape: StampShape;
	width: number;
	height: number;
	/** Depth of the relief, mm: 1–1.5 for ink, 2–3 for clay and biscuits */
	relief: number;
	base: number;
	/** A raised frame round the edge of the face. */
	border: boolean;
	knob: boolean;
	knobHeight: number;
}

export const STAMP_DEFAULTS: StampParams = {
	face: 'text',
	text: 'Polyzon',
	shape: 'rect',
	width: 50,
	height: 20,
	relief: 1.5,
	base: 4,
	border: true,
	knob: true,
	knobHeight: 28
};

export interface StampPreset {
	id: string;
	label: string;
	params: Partial<StampParams>;
}

export const STAMP_PRESETS: readonly StampPreset[] = [
	{
		id: 'name',
		get label() {
			return m.t_stamp_preset_name();
		},
		get params(): Partial<StampParams> {
			return { face: 'text', text: m.t_stamp_sample_name(), shape: 'rect', width: 50, height: 18 };
		}
	},
	{
		id: 'wax',
		get label() {
			return m.t_stamp_preset_wax();
		},
		get params(): Partial<StampParams> {
			return {
				face: 'text',
				text: m.t_stamp_sample_wax(),
				shape: 'round',
				width: 25,
				relief: 1.2,
				border: true,
				knobHeight: 40
			};
		}
	},
	{
		id: 'cookie',
		get label() {
			return m.t_stamp_preset_cookie();
		},
		params: { face: 'heart', shape: 'round', width: 50, relief: 2.5, border: false }
	},
	{
		id: 'clay',
		get label() {
			return m.t_stamp_preset_clay();
		},
		params: { face: 'star', shape: 'round', width: 40, relief: 2.5 }
	}
];

export function clampStamp(p: StampParams): StampParams {
	const faces: StampFace[] = ['text', 'heart', 'star'];
	const width = c(p.width, 10, 150);
	return {
		face: faces.includes(p.face) ? p.face : 'text',
		text: (p.text ?? '').trim().slice(0, 24),
		shape: p.shape === 'round' ? 'round' : 'rect',
		width,
		height: c(p.height, 8, 150),
		relief: c(p.relief, 0.6, 5),
		base: c(p.base, 2, 10),
		border: !!p.border,
		knob: !!p.knob,
		knobHeight: c(p.knobHeight, 10, 80)
	};
}

/** The face's footprint: a circle, or a rounded rectangle. */
function outline(p: StampParams, inset = 0): Node {
	if (p.shape === 'round') return circle(p.width / 2 - inset, 96);
	return rrect(p.width - 2 * inset, p.height - 2 * inset, Math.max(0.5, 3 - inset), 24);
}

function heart(size: number): Node {
	// Two lobes, each a hull of a circle and the point at the bottom.
	const r = size * 0.27;
	const tip = translate([0, -size * 0.45], circle(0.5, 12));
	return union(
		hull(translate([-r * 0.95, r * 0.55], circle(r, 48)), tip),
		hull(translate([r * 0.95, r * 0.55], circle(r, 48)), tip)
	);
}

function star(size: number): Node {
	const pts: Vec2[] = [];
	for (let i = 0; i < 10; i++) {
		const a = Math.PI / 2 + (i * Math.PI) / 5;
		const r = i % 2 ? size * 0.2 : size * 0.5;
		pts.push([r * Math.cos(a), r * Math.sin(a)]);
	}
	return polygon(pts);
}

/** The motif, drawn as it should print (seen from above). */
function motif(p: StampParams): Node | null {
	const room = p.shape === 'round' ? p.width * 0.7 : Math.min(p.width, p.height) * 0.8;
	if (p.face === 'heart') return heart(room);
	if (p.face === 'star') return star(room);
	if (!p.text) return null;
	// Letters fit the height; a long word fits the width (about 0.6 of a letter each).
	const byWidth = (p.width * 0.85) / Math.max(1, p.text.length * 0.62);
	const size = Math.min(p.shape === 'round' ? p.width * 0.55 : p.height * 0.6, byWidth);
	return text(p.text, size);
}

/** The knob's diameter: up to 24 mm, never wider than the face. */
const knobD = (p: StampParams) =>
	Math.min(24, (p.shape === 'round' ? p.width : Math.min(p.width, p.height)) * 0.7);

function stamp(p: StampParams): Node {
	const r = p.relief;
	const art = motif(p);
	const parts: Node[] = [];
	if (art && !p.border) {
		// Face down with no border under its edge, the plate would hang in the air
		// past the motif: it starts on the motif's hull and widens at 45° as it rises.
		const steps = Math.max(1, Math.round(p.base / 0.4));
		const s = p.base / steps;
		const core = hull(art);
		for (let k = 0; k < steps; k++)
			parts.push(
				translate(
					[0, 0, r + k * s - 0.01],
					extrude(p.base - k * s + 0.01, intersection(outline(p), offset(k * s + 0.01, 32, core)))
				)
			);
	} else parts.push(translate([0, 0, r - 0.01], extrude(p.base + 0.01, outline(p))));
	if (art) parts.push(extrude(r, art));
	if (p.border) parts.push(extrude(r, difference(outline(p), outline(p, 1.6))));
	if (p.knob) {
		const top = r + p.base;
		const d = knobD(p);
		parts.push(
			translate([0, 0, top - 0.01], cylinder(4, d / 2 + 4, d / 2, 48)),
			translate([0, 0, top + 4 - 0.02], cylinder(p.knobHeight - 4 + 0.02, d / 2, d / 2 + 1.5, 48))
		);
	}
	// A notch on the knob's top towards the top of the print.
	const notch =
		p.knob &&
		translate(
			[0, knobD(p) / 2 - 1, p.relief + p.base + p.knobHeight - 1.5],
			cylinder(2, 1.6, 1.6, 16)
		);
	return difference(union(...parts), notch);
}

export function stampModel(input: StampParams): Node {
	return part('stamp', stamp(clampStamp(input)));
}

const mm = (v: number) => num(v, 4);

export function stampSummary(input: StampParams): string {
	const p = clampStamp(input);
	return p.shape === 'round'
		? m.t_stamp_summary_round({ diameter: mm(p.width), relief: mm(p.relief) })
		: m.t_stamp_summary_rect({ width: mm(p.width), height: mm(p.height), relief: mm(p.relief) });
}

export function stampHeader(input: StampParams): string[] {
	const p = clampStamp(input);
	return [m.t_stamp_header_title(), stampSummary(p)];
}

export function stampScad(p: StampParams): string {
	return toScad(stampModel(p), stampHeader(p));
}
