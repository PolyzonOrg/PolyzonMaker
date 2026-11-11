/**
 * «Подшипник»: a roller bearing printed in one go, already assembled, in the
 * sizes of ISO 15 (608, 625, 688, 6200…). Between the inner and the outer
 * ring stand rollers with a 45° ridge round their middle; the ridge runs in a
 * V-groove in each ring, so the rollers neither fall out nor rub the rings
 * anywhere but there. Every gap is at least the clearance; every overhang is
 * 45°. The bottom edges facing a gap are chamfered so the first layer's
 * squish does not weld the rollers to the rings.
 */
import { part, polygon, revolve, toScad, translate, union, type Node } from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/bearing';
import { clamp } from '../shared/math';

export interface BearingParams {
	/** Bore, outer diameter and width, mm */
	bore: number;
	outer: number;
	width: number;
	/** Gap between moving parts, mm */
	clearance: number;
	/** Extra on the bore so it slides on a shaft, mm */
	fit: number;
}

/** Deep groove ball bearing sizes (ISO 15), d × D × B. */
export const BEARING_SIZES: readonly { id: string; d: number; D: number; B: number }[] = [
	{ id: '625', d: 5, D: 16, B: 5 },
	{ id: '688', d: 8, D: 16, B: 5 },
	{ id: '608', d: 8, D: 22, B: 7 },
	{ id: '6000', d: 10, D: 26, B: 8 },
	{ id: '6200', d: 10, D: 30, B: 9 },
	{ id: '6001', d: 12, D: 28, B: 8 },
	{ id: '6202', d: 15, D: 35, B: 11 },
	{ id: '6204', d: 20, D: 47, B: 14 }
];

export const BEARING_DEFAULTS: BearingParams = {
	bore: 8,
	outer: 22,
	width: 7,
	clearance: 0.3,
	fit: 0.1
};

export function clampBearing(p: BearingParams): BearingParams {
	const bore = clamp(p.bore, 2, 80);
	return {
		bore,
		// Room for two rings and rollers at least 2 mm thick.
		outer: clamp(p.outer, bore + 7, 150),
		width: clamp(p.width, 3, 40),
		clearance: clamp(p.clearance, 0.15, 0.6),
		fit: clamp(p.fit, 0, 0.5)
	};
}

/** Chamfer on the bottom edges at the gaps, mm. */
const FOOT = 0.4;

export interface BearingLayout {
	/** Ring thickness, mm */
	ring: number;
	/** Inner ring's outside and outer ring's inside radius, mm */
	ri: number;
	ro: number;
	/** Roller radius, ridge height, the circle the rollers stand on, mm */
	roller: number;
	ridge: number;
	pitchRadius: number;
	rollers: number;
}

export function bearingLayout(input: BearingParams): BearingLayout {
	const p = clampBearing(input);
	const space = (p.outer - p.bore) / 2;
	const ring = Math.max(1, space * 0.22);
	const c = p.clearance;
	const roller = (space - 2 * ring - 2 * c) / 2;
	const ri = p.bore / 2 + ring;
	const ro = p.outer / 2 - ring;
	const ridge = Math.min(roller * 0.35, 1, (p.width - 2 * FOOT) / 4);
	const pitchRadius = (ri + ro) / 2;
	// Rollers round the circle, their ridges this far apart at least.
	const step = 2 * (roller + ridge) + Math.max(0.6, 2 * c);
	const rollers = Math.max(3, Math.floor((2 * Math.PI * pitchRadius) / step));
	return { ring, ri, ro, roller, ridge, pitchRadius, rollers };
}

type Pt = [number, number];

/** The rings and the rollers, in place: for a bearing set into another part. */
export function bearingParts(input: BearingParams): { inner: Node; outer: Node; rollers: Node } {
	const p = clampBearing(input);
	const L = bearingLayout(p);
	const B = p.width;
	const k = L.ridge;
	const c = p.clearance;
	// The grooves follow the ridge at the clearance across its 45° faces.
	const e = c * (Math.SQRT2 - 1);
	const mid = B / 2;
	const inner: Pt[] = [
		[p.bore / 2 + p.fit / 2, 0],
		[L.ri - FOOT, 0],
		[L.ri, FOOT],
		[L.ri, mid - k - e],
		[L.ri - k - e, mid],
		[L.ri, mid + k + e],
		[L.ri, B],
		[p.bore / 2 + p.fit / 2, B]
	];
	const outer: Pt[] = [
		[L.ro + FOOT, 0],
		[p.outer / 2, 0],
		[p.outer / 2, B],
		[L.ro, B],
		[L.ro, mid + k + e],
		[L.ro + k + e, mid],
		[L.ro, mid - k - e],
		[L.ro, FOOT]
	];
	const r = L.roller;
	const roller: Pt[] = [
		[0, 0],
		[r - FOOT, 0],
		[r, FOOT],
		[r, mid - k],
		[r + k, mid],
		[r, mid + k],
		[r, B],
		[0, B]
	];
	const one = revolve(32, polygon(roller));
	const rollers = Array.from({ length: L.rollers }, (_, i) => {
		const a = (i / L.rollers) * Math.PI * 2;
		return translate([L.pitchRadius * Math.cos(a), L.pitchRadius * Math.sin(a), 0], one);
	});
	return {
		inner: revolve(128, polygon(inner)),
		outer: revolve(160, polygon(outer)),
		rollers: union(...rollers)
	};
}

export function bearingModel(input: BearingParams): Node {
	const b = bearingParts(input);
	return union(
		part('inner_ring', b.inner),
		part('outer_ring', b.outer),
		part('rollers', b.rollers)
	);
}

const mm = (v: number) => num(Math.round(v * 100) / 100);

export function bearingName(input: BearingParams): string | null {
	const p = clampBearing(input);
	return (
		BEARING_SIZES.find((s) => s.d === p.bore && s.D === p.outer && s.B === p.width)?.id ?? null
	);
}

export function bearingSummary(input: BearingParams): string {
	const p = clampBearing(input);
	const L = bearingLayout(p);
	const name = bearingName(p);
	const values = {
		bore: mm(p.bore),
		outer: mm(p.outer),
		width: mm(p.width),
		rollers: m.t_bearing_rollers({ count: L.rollers, n: num(L.rollers) }),
		roller: mm(2 * L.roller),
		clearance: mm(p.clearance)
	};
	return name ? m.t_bearing_summary_as({ name, ...values }) : m.t_bearing_summary(values);
}

export function bearingHeader(input: BearingParams): string[] {
	const p = clampBearing(input);
	return [m.t_bearing_header_title(), bearingSummary(p), m.t_bearing_header_print()];
}

export function bearingScad(p: BearingParams): string {
	return toScad(bearingModel(p), bearingHeader(p));
}
