/**
 * «Шайбы и проставки»: flat washers in DIN 125-A and wide DIN 9021 sizes
 * (or your own), spacers of any length, and gaskets and rings for TPU —
 * a set of them laid out on the bed in a grid.
 */
import {
	cylinder,
	difference,
	part,
	revolve,
	circle,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/washers';
import { clamp } from '../shared/math';

export type WasherKind = 'din125' | 'din9021' | 'spacer' | 'ring';
export type RingSection = 'square' | 'round';

export interface WashersParams {
	kind: WasherKind;
	/** Thread size for the standard washers: M3, M4… */
	size: string;
	/** Own sizes (spacer, ring, or a washer once changed), mm */
	inner: number;
	outer: number;
	thickness: number;
	/** Ring: round section prints worse, square is a gasket */
	section: RingSection;
	quantity: number;
}

/** d1 (hole) × d2 (outside) × h, mm. */
export const DIN125: Record<string, [number, number, number]> = {
	M2: [2.2, 5, 0.3],
	'M2,5': [2.7, 6, 0.5],
	M3: [3.2, 7, 0.5],
	M4: [4.3, 9, 0.8],
	M5: [5.3, 10, 1],
	M6: [6.4, 12, 1.6],
	M8: [8.4, 16, 1.6],
	M10: [10.5, 20, 2],
	M12: [13, 24, 2.5],
	M14: [15, 28, 2.5],
	M16: [17, 30, 3],
	M20: [21, 37, 3]
};

export const DIN9021: Record<string, [number, number, number]> = {
	M3: [3.2, 9, 0.8],
	M4: [4.3, 12, 1],
	M5: [5.3, 15, 1.2],
	M6: [6.4, 18, 1.6],
	M8: [8.4, 24, 2],
	M10: [10.5, 30, 2.5],
	M12: [13, 37, 3]
};

export const WASHERS_DEFAULTS: WashersParams = {
	kind: 'din125',
	size: 'M4',
	inner: 4.3,
	outer: 9,
	thickness: 1.2,
	section: 'square',
	quantity: 10
};

export const WASHERS_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<WashersParams>;
}[] = [
	{
		id: 'm3',
		get label() {
			return m.t_washers_preset_m3();
		},
		params: { kind: 'din125', size: 'M3', quantity: 20 }
	},
	{
		id: 'wide',
		get label() {
			return m.t_washers_preset_wide();
		},
		params: { kind: 'din9021', size: 'M5', quantity: 10 }
	},
	{
		id: 'spacer',
		get label() {
			return m.t_washers_preset_spacer();
		},
		params: { kind: 'spacer', inner: 3.4, outer: 7, thickness: 10, quantity: 8 }
	},
	{
		id: 'gasket',
		get label() {
			return m.t_washers_preset_gasket();
		},
		params: { kind: 'ring', inner: 20, outer: 26, thickness: 2, quantity: 4 }
	}
];

/** A printed washer is at least three layers thick. */
const MIN_T = 0.6;

export function clampWashers(p: WashersParams): WashersParams {
	const kind = (['din125', 'din9021', 'spacer', 'ring'] as const).includes(p.kind)
		? p.kind
		: 'din125';
	const inner = clamp(p.inner, 0.5, 290);
	return {
		kind,
		size: p.size,
		inner,
		outer: clamp(p.outer, inner + 1.2, 300),
		thickness: clamp(p.thickness, MIN_T, 100),
		section: p.section === 'round' ? 'round' : 'square',
		quantity: Math.round(clamp(p.quantity, 1, 100))
	};
}

/** The sizes the parts are made to: the table's for a standard washer. */
export function washerSize(input: WashersParams): {
	inner: number;
	outer: number;
	thickness: number;
} {
	const p = clampWashers(input);
	const table = p.kind === 'din125' ? DIN125 : p.kind === 'din9021' ? DIN9021 : null;
	const row = table?.[p.size];
	if (row) return { inner: row[0], outer: row[1], thickness: Math.max(MIN_T, row[2]) };
	return { inner: p.inner, outer: p.outer, thickness: p.thickness };
}

export function washersModel(input: WashersParams): Node {
	const p = clampWashers(input);
	const s = washerSize(p);
	const fn = Math.max(32, Math.min(128, Math.round(s.outer * 3)));
	let one: Node;
	if (p.kind === 'ring' && p.section === 'round') {
		// A torus: the ring's width is its section.
		const r = (s.outer - s.inner) / 4;
		one = translate(
			[0, 0, r],
			revolve(fn, translate([(s.inner + s.outer) / 4, 0, 0], circle(r, 24)))
		);
	} else {
		one = difference(
			cylinder(s.thickness, s.outer / 2, s.outer / 2, fn),
			translate([0, 0, -1], cylinder(s.thickness + 2, s.inner / 2, s.inner / 2, fn))
		);
	}
	const step = s.outer + 3;
	const perRow = Math.ceil(Math.sqrt(p.quantity));
	const rows = Math.ceil(p.quantity / perRow);
	const items = Array.from({ length: p.quantity }, (_, i) =>
		translate(
			[
				((i % perRow) - (perRow - 1) / 2) * step,
				(Math.floor(i / perRow) - (rows - 1) / 2) * step,
				0
			],
			one
		)
	);
	return part('washers', union(...items));
}

const mm = (v: number) => num(Math.round(v * 100) / 100, 2);

export function washersSummary(input: WashersParams): string {
	const p = clampWashers(input);
	const s = washerSize(p);
	const height = p.kind === 'ring' && p.section === 'round' ? (s.outer - s.inner) / 2 : s.thickness;
	const v = {
		count: p.quantity,
		n: num(p.quantity),
		inner: mm(s.inner),
		outer: mm(s.outer),
		height: mm(height)
	};
	if (p.kind === 'din125') return m.t_washers_summary_din125(v);
	if (p.kind === 'din9021') return m.t_washers_summary_din9021(v);
	if (p.kind === 'spacer') return m.t_washers_summary_spacer(v);
	return m.t_washers_summary_ring(v);
}

export function washersHeader(input: WashersParams): string[] {
	return [m.t_washers_header_title(), washersSummary(input)];
}

export function washersScad(p: WashersParams): string {
	return toScad(washersModel(p), washersHeader(p));
}
