/**
 * Coasters: a plate with a rim that keeps drips in, a raised pattern or
 * monogram on top — two colours with a filament change at the floor — and
 * pockets for rubber feet or a recess for cork underneath.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	intersection,
	loft,
	part,
	rotate,
	square,
	label,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/coaster';
import { clamp as c } from '../shared/math';

export type CoasterShape = 'round' | 'square' | 'hex';
export type CoasterTop = 'plain' | 'rings' | 'honeycomb' | 'text';
export type CoasterBottom = 'none' | 'feet' | 'cork';

export interface CoasterParams {
	shape: CoasterShape;
	size: number;
	thickness: number;
	rim: boolean;
	top: CoasterTop;
	/** The monogram, up to three letters */
	text: string;
	/** Height of the raised pattern above the floor, mm */
	relief: number;
	bottom: CoasterBottom;
	count: number;
}

export const COASTER_DEFAULTS: CoasterParams = {
	shape: 'round',
	size: 95,
	thickness: 4,
	rim: true,
	top: 'rings',
	text: 'P',
	relief: 0.8,
	bottom: 'feet',
	count: 1
};

export interface CoasterPreset {
	id: string;
	label: string;
	params: Partial<CoasterParams>;
}

export const COASTER_PRESETS: readonly CoasterPreset[] = [
	{
		id: 'rings',
		get label() {
			return m.t_coaster_preset_rings();
		},
		params: { shape: 'round', top: 'rings' }
	},
	{
		id: 'honey',
		get label() {
			return m.t_coaster_preset_honey();
		},
		params: { shape: 'hex', top: 'honeycomb' }
	},
	{
		id: 'mono',
		get label() {
			return m.t_coaster_preset_mono();
		},
		params: { shape: 'round', top: 'text', text: 'A' }
	},
	{
		id: 'set',
		get label() {
			return m.t_coaster_preset_set();
		},
		params: { shape: 'square', top: 'plain', bottom: 'cork', count: 4 }
	}
];

export function clampCoaster(p: CoasterParams): CoasterParams {
	const shapes: CoasterShape[] = ['round', 'square', 'hex'];
	const tops: CoasterTop[] = ['plain', 'rings', 'honeycomb', 'text'];
	const bottoms: CoasterBottom[] = ['none', 'feet', 'cork'];
	return {
		shape: shapes.includes(p.shape) ? p.shape : 'round',
		size: c(p.size, 50, 200),
		thickness: c(p.thickness, 2.4, 10),
		rim: !!p.rim,
		top: tops.includes(p.top) ? p.top : 'plain',
		text: (p.text ?? '').trim().slice(0, 3),
		relief: c(p.relief, 0.4, 3),
		bottom: bottoms.includes(p.bottom) ? p.bottom : 'none',
		count: Math.round(c(p.count, 1, 8))
	};
}

const FN = 96;
const RIM = { width: 2.4, height: 1.2 } as const;
const CHAMFER = 0.6;

/** The footprint shrunk by `inset`: convex, so it lofts. */
function outline(p: CoasterParams, inset: number): Node {
	const s = p.size - 2 * inset;
	if (p.shape === 'square') return square(s, s);
	if (p.shape === 'hex') return rotate([0, 0, 30], circle(s / Math.cos(Math.PI / 6) / 2, 6));
	return circle(s / 2, FN);
}

/** The pattern inside the rim, 2D. */
function pattern(p: CoasterParams, inner: number): Node | null {
	const area = outline(p, inner);
	const R = p.size / 2 - inner;
	if (p.top === 'rings') {
		const rings: Node[] = [];
		for (let r = 6; r + 1 < R; r += 6)
			rings.push(difference(circle(r + 0.6, FN), circle(r - 0.6, FN)));
		return intersection(union(...rings), area);
	}
	if (p.top === 'honeycomb') {
		// A lattice of 1.2 mm walls round 8 mm cells.
		const cell = 8;
		const dy = (cell * Math.sqrt(3)) / 2;
		const holes: Node[] = [];
		const n = Math.ceil(R / cell) + 1;
		for (let j = -n; j <= n; j++)
			for (let i = -n; i <= n; i++)
				holes.push(
					translate(
						[i * cell + (Math.abs(j) % 2 ? cell / 2 : 0), j * dy],
						rotate([0, 0, 30], circle((cell - 1.2) / Math.sqrt(3), 6))
					)
				);
		return difference(area, ...holes);
	}
	// Sized by its capitals and never wider than the field: three letters stay on the coaster.
	if (p.top === 'text' && p.text)
		return label(p.text, Math.min(R * 0.8, 43), { fit: R * 1.5, valign: 'center' });
	return null;
}

function coaster(p: CoasterParams): Node {
	const T = p.thickness;
	const body = loft([
		{ z: 0, shape: outline(p, CHAMFER) },
		{ z: CHAMFER, shape: outline(p, 0) },
		{ z: T, shape: outline(p, 0) }
	]);
	const parts: Node[] = [body];
	if (p.rim)
		parts.push(
			translate(
				[0, 0, T - 0.01],
				extrude(RIM.height + 0.01, difference(outline(p, 0), outline(p, RIM.width)))
			)
		);
	const art = pattern(p, p.rim ? RIM.width + 1.5 : 3);
	if (art) parts.push(translate([0, 0, T - 0.01], extrude(p.relief + 0.01, art)));
	const cuts: Node[] = [];
	if (p.bottom === 'feet') {
		// Four pockets for 10 × 1 mm rubber bumpers.
		const r = p.size * 0.33;
		for (let i = 0; i < 4; i++) {
			const a = (Math.PI / 2) * i + Math.PI / 4;
			cuts.push(translate([r * Math.cos(a), r * Math.sin(a), -0.01], cylinder(1.01, 5.2, 5.2, 32)));
		}
	} else if (p.bottom === 'cork') {
		cuts.push(translate([0, 0, -0.01], extrude(1.61, outline(p, 3))));
	}
	return difference(union(...parts), ...cuts);
}

export function coasterModel(input: CoasterParams): Node {
	const p = clampCoaster(input);
	const one = coaster(p);
	if (p.count === 1) return part('coaster', one);
	const cols = Math.ceil(Math.sqrt(p.count));
	const step = p.size + 5;
	return part(
		'coasters',
		union(
			...Array.from({ length: p.count }, (_, i) =>
				translate([(i % cols) * step, Math.floor(i / cols) * step, 0], one)
			)
		)
	);
}

export function coasterSummary(input: CoasterParams): string {
	const p = clampCoaster(input);
	const thickness = num(p.thickness, 4);
	return [
		m.t_coaster_summary({ size: num(p.size, 4), thickness }),
		p.top !== 'plain' ? m.t_coaster_summary_two_colours({ height: thickness }) : '',
		p.bottom === 'feet'
			? m.t_coaster_summary_feet()
			: p.bottom === 'cork'
				? m.t_coaster_summary_cork()
				: ''
	]
		.filter(Boolean)
		.join(sentenceGap(currentLocale()));
}

export function coasterHeader(input: CoasterParams): string[] {
	const p = clampCoaster(input);
	return [m.t_coaster_scad_title(), coasterSummary(p), m.t_coaster_scad_pattern_up()];
}

export function coasterScad(p: CoasterParams): string {
	return toScad(coasterModel(p), coasterHeader(p));
}
