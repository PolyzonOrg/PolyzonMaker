/**
 * «Спиннер»: a fidget spinner with its bearing printed inside — the roller
 * bearing of «Подшипники» in the 608 size, its outer ring part of the body —
 * 2 to 6 lobes with seats for weights (608 bearings, M8 nuts or coins), and
 * two finger caps that press into the bearing. Printed flat in one go; turn
 * the inner ring a few times to free the rollers.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	hull,
	part,
	polygon,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import {
	BEARING_DEFAULTS,
	bearingLayout,
	bearingParts,
	type BearingParams
} from '../bearing/model';
import { currentLocale, num as fmt } from '$lib/i18n/current';
import type { Locale } from '$lib/i18n/locale';
import * as m from '$msg/tools/fidget-spinner';
import { clamp } from '../shared/math';

export type SpinnerWeight = 'bearing608' | 'nutM8' | 'coin' | 'none';

export interface SpinnerParams {
	lobes: number;
	weight: SpinnerWeight;
	/** Coin diameter, mm (10 ₽ — 22, 5 ₽ — 25) */
	coin: number;
	/** Plastic round each seat, mm */
	wall: number;
	clearance: number;
	caps: boolean;
}

/**
 * Coins for the weights, the country's of each language (as written there), the
 * default first; diameters in mm.
 */
const COINS: Record<Locale, readonly { name: string; d: number }[]> = {
	ru: [
		{ name: '10 ₽', d: 22 },
		{ name: '5 ₽', d: 25 },
		{ name: '1 ₽', d: 20.5 }
	],
	en: [
		{ name: 'quarter', d: 24.26 },
		{ name: 'nickel', d: 21.21 },
		{ name: 'penny', d: 19.05 }
	],
	es: [
		{ name: '2 €', d: 25.75 },
		{ name: '1 €', d: 23.25 },
		{ name: '50 céntimos', d: 24.25 }
	],
	de: [
		{ name: '2 €', d: 25.75 },
		{ name: '1 €', d: 23.25 },
		{ name: '50 Cent', d: 24.25 }
	],
	fr: [
		{ name: '2 €', d: 25.75 },
		{ name: '1 €', d: 23.25 },
		{ name: '50 centimes', d: 24.25 }
	],
	it: [
		{ name: '2 €', d: 25.75 },
		{ name: '1 €', d: 23.25 },
		{ name: '50 centesimi', d: 24.25 }
	],
	pt: [
		{ name: 'R$ 1', d: 27 },
		{ name: '50 centavos', d: 23 }
	],
	ja: [
		{ name: '500円', d: 26.5 },
		{ name: '100円', d: 22.6 }
	],
	tr: [
		{ name: '1 lira', d: 26.15 },
		{ name: '50 kuruş', d: 23.85 }
	],
	zh: [
		{ name: '1元', d: 22.25 },
		{ name: '5角', d: 20.5 }
	]
};

export function spinnerCoins(): readonly { name: string; d: number }[] {
	return COINS[currentLocale()];
}

export const SPINNER_DEFAULTS: SpinnerParams = {
	lobes: 3,
	weight: 'bearing608',
	get coin() {
		return spinnerCoins()[0].d;
	},
	wall: 2.4,
	clearance: 0.3,
	caps: true
};

export const SPINNER_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<SpinnerParams>;
}[] = [
	{
		id: 'tri',
		get label() {
			return m.t_fidget_spinner_preset_tri();
		},
		params: { lobes: 3, weight: 'bearing608' }
	},
	{
		id: 'nuts',
		get label() {
			return m.t_fidget_spinner_preset_nuts();
		},
		params: { lobes: 3, weight: 'nutM8' }
	},
	// The coin comes from the defaults: the first coin of the language.
	{
		id: 'coins',
		get label() {
			return m.t_fidget_spinner_preset_coins({ coin: spinnerCoins()[0].name });
		},
		params: { lobes: 4, weight: 'coin' }
	},
	{
		id: 'bar',
		get label() {
			return m.t_fidget_spinner_preset_bar();
		},
		params: { lobes: 2, weight: 'bearing608' }
	}
];

export function clampSpinner(p: SpinnerParams): SpinnerParams {
	return {
		lobes: Math.round(clamp(p.lobes, 2, 6)),
		weight: (['bearing608', 'nutM8', 'coin', 'none'] as const).includes(p.weight)
			? p.weight
			: 'none',
		coin: clamp(p.coin, 12, 32),
		wall: clamp(p.wall, 1.6, 5),
		clearance: clamp(p.clearance, 0.2, 0.5),
		caps: !!p.caps
	};
}

/** The bearing in the middle: 608 size. */
function bearing(p: SpinnerParams): BearingParams {
	return { ...BEARING_DEFAULTS, bore: 8, outer: 22, width: 7, clearance: p.clearance, fit: 0.1 };
}

/** Seat for a weight: its outline and how wide it is across, mm. */
function seat(p: SpinnerParams): { shape: Node | null; across: number } {
	switch (p.weight) {
		case 'bearing608':
			return { shape: circle(11.05, 64), across: 22.1 };
		case 'nutM8': {
			// 13 mm across the flats, a little play.
			const r = 13.2 / Math.sqrt(3);
			const pts = Array.from(
				{ length: 6 },
				(_, k) =>
					[r * Math.cos((k * Math.PI) / 3), r * Math.sin((k * Math.PI) / 3)] as [number, number]
			);
			return { shape: polygon(pts), across: 2 * r };
		}
		case 'coin':
			return { shape: circle(p.coin / 2 + 0.1, 64), across: p.coin + 0.2 };
		default:
			return { shape: null, across: 16 };
	}
}

export interface SpinnerLayout {
	/** Lobe centres from the middle and the lobe radius, mm */
	reach: number;
	lobe: number;
	/** Body thickness (the bearing's width), whole span, mm */
	thickness: number;
	span: number;
}

export function spinnerLayout(input: SpinnerParams): SpinnerLayout {
	const p = clampSpinner(input);
	const s = seat(p);
	const lobe = s.across / 2 + p.wall;
	// Clear of the centre bearing, and of the neighbouring seats by a wall.
	const reach = Math.max(
		11 + p.wall + s.across / 2 + 1,
		(s.across + p.wall) / (2 * Math.sin(Math.PI / p.lobes))
	);
	return { reach, lobe, thickness: 7, span: 2 * (reach + lobe) };
}

export function spinnerModel(input: SpinnerParams): Node {
	const p = clampSpinner(input);
	const L = spinnerLayout(p);
	const b = bearingParts(bearing(p));
	const T = L.thickness;
	const centreR = 11 + p.wall;
	const s = seat(p);
	const outline = union(
		...Array.from({ length: p.lobes }, (_, i) => {
			const a = (i / p.lobes) * Math.PI * 2;
			return hull(
				circle(centreR, 96),
				translate([L.reach * Math.cos(a), L.reach * Math.sin(a), 0], circle(L.lobe, 96))
			);
		})
	);
	const seats = s.shape
		? Array.from({ length: p.lobes }, (_, i) => {
				const a = (i / p.lobes) * Math.PI * 2;
				return translate(
					[L.reach * Math.cos(a), L.reach * Math.sin(a), -1],
					extrude(T + 2, s.shape)
				);
			})
		: [];
	// The body takes the bearing's outer ring: its hole is a little smaller than the ring, so they join.
	const body = union(
		difference(
			extrude(T, outline),
			translate([0, 0, -1], cylinder(T + 2, 11 - 0.4, 11 - 0.4, 96)),
			...seats
		),
		b.outer
	);
	const parts: Node[] = [part('spinner', union(body, b.rollers, b.inner))];
	if (p.caps) {
		// Finger caps: a disc on a step that keeps it off the outer ring, a peg into the bore.
		const ri = bearingLayout(bearing(p)).ri;
		const cap = union(
			cylinder(1.6, 10, 10, 64),
			translate([0, 0, 1.59], cylinder(0.81, ri - 0.4, ri - 0.4, 48)),
			translate([0, 0, 2.39], cylinder(T / 2 - 0.6, 4 - 0.08, 4 - 0.08, 32))
		);
		const x = L.span / 2 + 14;
		parts.push(part('caps', union(translate([x, -12, 0], cap), translate([x, 12, 0], cap))));
	}
	return union(...parts);
}

const mm = (v: number) => fmt(Math.round(v * 10) / 10, 1);

export function spinnerSummary(input: SpinnerParams): string {
	const p = clampSpinner(input);
	const L = spinnerLayout(p);
	const facts = {
		lobes: m.t_fidget_spinner_summary_lobes({ count: p.lobes, n: fmt(p.lobes) }),
		span: mm(L.span),
		thickness: mm(L.thickness)
	};
	switch (p.weight) {
		case 'bearing608':
			return m.t_fidget_spinner_summary_bearing(facts);
		case 'nutM8':
			return m.t_fidget_spinner_summary_nut(facts);
		case 'coin':
			return m.t_fidget_spinner_summary_coin({ ...facts, coin: mm(p.coin) });
		default:
			return m.t_fidget_spinner_summary_none(facts);
	}
}

export function spinnerHeader(input: SpinnerParams): string[] {
	return [m.t_fidget_spinner_scad_title(), spinnerSummary(input), m.t_fidget_spinner_scad_print()];
}

export function spinnerScad(p: SpinnerParams): string {
	return toScad(spinnerModel(p), spinnerHeader(p));
}
