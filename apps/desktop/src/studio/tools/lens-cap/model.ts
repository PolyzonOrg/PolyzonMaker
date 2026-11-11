/**
 * Lens caps: one that presses into the filter thread (by the thread's
 * diameter, 37–95 mm, as written on the lens), or one that slips over the
 * barrel (by its outside diameter). Ribbed edge for grip, a loop for a cord,
 * the size on top. Printed top down.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	mirror,
	part,
	rotate,
	square,
	text,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/lens-cap';
import { clamp as c } from '../shared/math';

export type LensFit = 'thread' | 'over';

export const FILTER_SIZES = [37, 40.5, 43, 46, 49, 52, 55, 58, 62, 67, 72, 77, 82, 86, 95] as const;

export interface LensCapParams {
	fit: LensFit;
	/** Filter thread diameter, or the barrel's outside diameter, mm */
	diameter: number;
	/** Extra width of the fit, mm: more if it is loose, less if tight */
	adjust: number;
	loop: boolean;
	label: boolean;
}

export const LENS_CAP_DEFAULTS: LensCapParams = {
	fit: 'thread',
	diameter: 58,
	adjust: 0,
	loop: true,
	label: true
};

export interface LensCapPreset {
	id: string;
	label: string;
	params: Partial<LensCapParams>;
}

export const LENS_CAP_PRESETS: readonly LensCapPreset[] = [
	{
		id: 'kit',
		get label() {
			return m.t_lens_cap_preset_kit();
		},
		params: { fit: 'thread', diameter: 58 }
	},
	{
		id: '52',
		get label() {
			return m.t_lens_cap_preset_thread_52();
		},
		params: { fit: 'thread', diameter: 52 }
	},
	{
		id: '77',
		get label() {
			return m.t_lens_cap_preset_thread_77();
		},
		params: { fit: 'thread', diameter: 77 }
	},
	{
		id: 'over',
		get label() {
			return m.t_lens_cap_preset_over();
		},
		params: { fit: 'over', diameter: 60 }
	}
];

export function clampLensCap(p: LensCapParams): LensCapParams {
	return {
		fit: p.fit === 'over' ? 'over' : 'thread',
		diameter: c(p.diameter, 20, 150),
		adjust: c(p.adjust, -1, 1),
		loop: !!p.loop,
		label: !!p.label
	};
}

const TOP = 1.6;
const FN = 128;

export interface LensCapLayout {
	/** Outside of the cap, mm */
	outer: number;
	/** The lip's outside (thread) or the cup's inside (over), mm */
	fit: number;
	depth: number;
}

export function lensCapLayout(input: LensCapParams): LensCapLayout {
	const p = clampLensCap(input);
	if (p.fit === 'thread') {
		// Into the thread: a hair under its inner diameter (about 0.6 mm under the size).
		const fit = p.diameter - 0.6 + p.adjust;
		return { outer: p.diameter + 3, fit, depth: 3 };
	}
	const fit = p.diameter + 0.3 + p.adjust;
	return { outer: fit + 3.2, fit, depth: 8 };
}

/** A ring of grip ribs round the rim. */
function ribbed(d: number): Node {
	const n = Math.max(24, Math.round((Math.PI * d) / 3));
	return union(
		circle(d / 2 - 0.7, FN),
		// The ribs reach exactly the diameter.
		...Array.from({ length: n }, (_, i) =>
			rotate([0, 0, (360 * i) / n], translate([d / 2 - 0.7, 0], circle(0.7, 12)))
		)
	);
}

function cap(p: LensCapParams): Node {
	const L = lensCapLayout(p);
	const parts: Node[] = [];
	const cuts: Node[] = [];
	if (p.fit === 'thread') {
		// A flat top, and a lip slotted into eight springy fingers.
		parts.push(extrude(TOP, ribbed(L.outer)));
		const lip = difference(circle(L.fit / 2, FN), circle(L.fit / 2 - 1.4, FN));
		const slots = Array.from({ length: 8 }, (_, i) =>
			rotate([0, 0, i * 45], translate([L.fit / 2, 0], square(4, 1.2)))
		);
		parts.push(translate([0, 0, TOP - 0.01], extrude(L.depth + 0.01, difference(lip, ...slots))));
	} else {
		// A cup over the barrel, six ribs inside for friction.
		parts.push(extrude(TOP + L.depth, ribbed(L.outer)));
		cuts.push(translate([0, 0, TOP], cylinder(L.depth + 1, L.fit / 2, L.fit / 2, FN)));
		for (let i = 0; i < 6; i++)
			parts.push(
				rotate(
					[0, 0, i * 60],
					translate([L.fit / 2 - 0.3, -1, TOP], extrude(L.depth, square(0.8, 2, false)))
				)
			);
	}
	if (p.loop) {
		// A tab with a hole for a cord, flush with the top.
		const r = L.outer / 2;
		parts.push(
			difference(
				translate(
					[r + 3, 0, 0],
					extrude(TOP, union(circle(4, 32), translate([-3, 0], square(6, 8))))
				),
				translate([r + 4, 0, -1], cylinder(TOP + 2, 1.8, 1.8, 24))
			)
		);
	}
	if (p.label) {
		// The size engraved into the outside (the top, printed on the bed: mirrored to read right).
		const size = m.t_lens_cap_engraved_size({ size: num(p.diameter, 4) });
		cuts.push(
			translate([0, 0, -0.01], extrude(0.6, mirror([1, 0], text(size, Math.max(4, L.fit * 0.12)))))
		);
	}
	return difference(union(...parts), ...cuts);
}

export function lensCapModel(input: LensCapParams): Node {
	return part('cap', cap(clampLensCap(input)));
}

const mm = (v: number) => num(v, 4);

export function lensCapSummary(input: LensCapParams): string {
	const p = clampLensCap(input);
	const L = lensCapLayout(p);
	const values = { diameter: mm(p.diameter), fit: mm(Math.round(L.fit * 10) / 10) };
	return p.fit === 'thread'
		? m.t_lens_cap_summary_thread(values)
		: m.t_lens_cap_summary_over(values);
}

export function lensCapHeader(input: LensCapParams): string[] {
	const p = clampLensCap(input);
	return [m.t_lens_cap_header_title(), lensCapSummary(p), m.t_lens_cap_header_print()];
}

export function lensCapScad(p: LensCapParams): string {
	return toScad(lensCapModel(p), lensCapHeader(p));
}
