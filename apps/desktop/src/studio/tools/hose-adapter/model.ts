/**
 * Hose and pipe adapters, and funnels — bodies of revolution.
 * An end either goes into a hose (its outside is the hose's inside,
 * barbs hold it) or takes a pipe into it (its inside is the pipe's outside
 * plus a little play). Between two ends the wall changes at 45°, so a
 * straight adapter prints standing up without supports; an elbow needs
 * supports under its bend. A funnel prints mouth down.
 */
import {
	circle,
	cube,
	difference,
	part,
	polygon,
	revolve,
	revolveArc,
	rotate,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/hose-adapter';
import { clamp as c } from '../shared/math';

export type HoseKind = 'straight' | 'elbow' | 'funnel';
/** inside — the end goes into a hose; outside — a pipe goes into the end. */
export type EndFit = 'inside' | 'outside';

export interface HoseParams {
	kind: HoseKind;
	diameterA: number;
	fitA: EndFit;
	lengthA: number;
	diameterB: number;
	fitB: EndFit;
	lengthB: number;
	wall: number;
	/** Ribs on ends that go into a hose. */
	barbs: boolean;
	/** A ring the hose stops against. */
	collar: boolean;
	/** Play for a pipe that goes into an end, mm */
	clearance: number;
	/** Elbow: angle and the radius of the bend's axis, mm */
	angle: number;
	bend: number;
	/** Funnel: mouth and spout outer diameters, spout length, mm */
	mouth: number;
	spout: number;
	spoutLength: number;
}

export const HOSE_DEFAULTS: HoseParams = {
	kind: 'straight',
	diameterA: 32,
	fitA: 'inside',
	lengthA: 30,
	diameterB: 40,
	fitB: 'outside',
	lengthB: 30,
	wall: 2.4,
	barbs: true,
	collar: true,
	clearance: 0.3,
	angle: 90,
	bend: 40,
	mouth: 100,
	spout: 14,
	spoutLength: 30
};

export interface HosePreset {
	id: string;
	label: string;
	params: Partial<HoseParams>;
}

export const HOSE_PRESETS: readonly HosePreset[] = [
	{
		id: 'vacuum',
		get label() {
			return m.t_hose_adapter_preset_vacuum();
		},
		params: {
			kind: 'straight',
			diameterA: 32,
			fitA: 'inside',
			diameterB: 35,
			fitB: 'outside',
			barbs: false
		}
	},
	{
		id: 'garden',
		get label() {
			return m.t_hose_adapter_preset_garden();
		},
		params: {
			kind: 'straight',
			diameterA: 13,
			fitA: 'inside',
			diameterB: 19,
			fitB: 'inside',
			lengthA: 25,
			lengthB: 25,
			wall: 2
		}
	},
	{
		id: 'dust',
		get label() {
			return m.t_hose_adapter_preset_dust();
		},
		params: {
			kind: 'straight',
			diameterA: 35,
			fitA: 'outside',
			diameterB: 50,
			fitB: 'outside',
			barbs: false
		}
	},
	{
		id: 'elbow',
		get label() {
			return m.t_hose_adapter_preset_elbow();
		},
		params: {
			kind: 'elbow',
			diameterA: 32,
			fitA: 'inside',
			diameterB: 32,
			fitB: 'inside',
			angle: 90,
			bend: 40
		}
	},
	{
		id: 'funnel',
		get label() {
			return m.t_hose_adapter_preset_funnel();
		},
		params: { kind: 'funnel', mouth: 100, spout: 14, spoutLength: 30 }
	}
];

export function clampHose(p: HoseParams): HoseParams {
	const kinds: HoseKind[] = ['straight', 'elbow', 'funnel'];
	const fit = (f: EndFit): EndFit => (f === 'outside' ? 'outside' : 'inside');
	const wall = c(p.wall, 1.2, 6);
	const mouth = c(p.mouth, 30, 250);
	return {
		kind: kinds.includes(p.kind) ? p.kind : 'straight',
		diameterA: c(p.diameterA, 4, 200),
		fitA: fit(p.fitA),
		lengthA: c(p.lengthA, 5, 150),
		diameterB: c(p.diameterB, 4, 200),
		fitB: fit(p.fitB),
		lengthB: c(p.lengthB, 5, 150),
		wall,
		barbs: !!p.barbs,
		collar: !!p.collar,
		clearance: c(p.clearance, 0, 1.5),
		angle: c(p.angle, 15, 180),
		bend: c(p.bend, 10, 300),
		mouth,
		spout: c(p.spout, 4 + 2 * wall, mouth - 10),
		spoutLength: c(p.spoutLength, 5, 150)
	};
}

/** An end's radii: outside and inside of the wall. */
function radii(d: number, fit: EndFit, p: HoseParams): { ro: number; ri: number } {
	if (fit === 'inside') return { ro: d / 2, ri: Math.max(1, d / 2 - p.wall) };
	const ri = d / 2 + p.clearance;
	return { ro: ri + p.wall, ri };
}

const BARB = 0.8;
const BARB_PITCH = 5;
const FN = 96;

/**
 * The outer contour of an end, from its tip (z = 0) to `length`: points
 * (r, z). A hose end tapers at the tip and carries barbs that hold the hose.
 */
function endContour(r: number, length: number, fit: EndFit, barbs: boolean): Vec2[] {
	if (fit === 'outside')
		return [
			[r, 0],
			[r, length]
		];
	const pts: Vec2[] = [
		[r - 0.6, 0],
		[r, 2]
	];
	if (barbs) {
		// Each barb: a ramp out from the tip, then a step back — the hose slides on, not off.
		for (let z = 2 + 1; z + BARB_PITCH <= length - 2; z += BARB_PITCH) {
			pts.push([r, z], [r + BARB, z + BARB_PITCH - 1], [r, z + BARB_PITCH - 1 + 0.01]);
		}
	}
	pts.push([r, length]);
	return pts;
}

/** A stop ring only where a hose goes over an end. */
const hasCollar = (p: HoseParams) => p.collar && (p.fitA === 'inside' || p.fitB === 'inside');

export interface HoseLayout {
	a: { ro: number; ri: number };
	b: { ro: number; ri: number };
	/** Length of the 45° change between the ends, mm */
	transition: number;
	/** The stop ring: its outer radius and its height (0 — none), mm */
	collarR: number;
	collar: number;
	/** Total height of a straight adapter, mm */
	height: number;
}

export function hoseLayout(input: HoseParams): HoseLayout {
	const p = clampHose(input);
	const a = radii(p.diameterA, p.fitA, p);
	const b = radii(p.diameterB, p.fitB, p);
	const transition = Math.max(Math.abs(b.ro - a.ro), Math.abs(b.ri - a.ri), 1);
	const collarR = Math.max(a.ro, b.ro) + 2;
	const collar = hasCollar(p) ? 2 * (collarR - a.ro) + 3 : 0;
	return { a, b, transition, collarR, collar, height: p.lengthA + collar + transition + p.lengthB };
}

/**
 * The wall of a straight adapter as a closed profile (r, z): the outside up
 * from end A's tip, the inside back down.
 */
function straightProfile(p: HoseParams): Vec2[] {
	const L = hoseLayout(p);
	const { a, b } = L;
	const outer: Vec2[] = [...endContour(a.ro, p.lengthA, p.fitA, p.barbs)];
	const z0 = p.lengthA;
	if (L.collar > 0) {
		// A stop ring with 45° faces: the hose stops on it, nothing overhangs.
		const rise = L.collarR - a.ro;
		outer.push([L.collarR, z0 + rise], [L.collarR, z0 + rise + 3], [a.ro, z0 + L.collar]);
	}
	// Outside and inside change together over the same 45° stretch.
	const zt = z0 + L.collar;
	const zB = zt + L.transition;
	const endB = endContour(b.ro, p.lengthB, p.fitB, p.barbs).map(
		([r, t]): Vec2 => [r, L.height - t]
	);
	outer.push([b.ro, zB], ...endB.reverse());
	const inner: Vec2[] = [
		[b.ri, L.height],
		[b.ri, zB],
		[a.ri, zt],
		[a.ri, 0]
	];
	return [...outer, ...inner];
}

function straight(p: HoseParams): Node {
	return revolve(FN, polygon(straightProfile(p)));
}

/** A plain tube from radius pair `from` to `to` over `length`, 45° change at its start. */
function tube(
	from: { ro: number; ri: number },
	to: { ro: number; ri: number },
	length: number
): Node {
	const t = Math.min(length, Math.max(Math.abs(to.ro - from.ro), Math.abs(to.ri - from.ri), 0.01));
	return revolve(
		FN,
		polygon([
			[from.ro, 0],
			[to.ro, t],
			[to.ro, length],
			[to.ri, length],
			[to.ri, t],
			[from.ri, 0]
		])
	);
}

function elbow(p: HoseParams): Node {
	const L = hoseLayout(p);
	// The bend carries the narrower bore with one wall round it.
	const ri = Math.min(L.a.ri, L.b.ri);
	const t = { ri, ro: ri + p.wall };
	const R = Math.max(p.bend, t.ro + 2);
	const endA = revolve(
		FN,
		polygon([...endContour(L.a.ro, p.lengthA, p.fitA, p.barbs), [L.a.ri, p.lengthA], [L.a.ri, 0]])
	);
	const stepA = Math.max(Math.abs(t.ro - L.a.ro), Math.abs(t.ri - L.a.ri), 1);
	const neckA = translate([0, 0, p.lengthA - 0.01], tube(L.a, t, stepA + 0.02));
	const h = p.lengthA + stepA;
	// The bend: an annulus swept round an axis R to the side, turned so it rises from end A.
	// A hair thinner than the neck and the end it joins: walls of one radius
	// met in edges of four faces, which a slicer reports as broken. Not 0.01:
	// the ends overlap the bend by that much and change at 45°.
	const ring = difference(
		translate([R, 0], circle(t.ro - 0.005, 48)),
		translate([R, 0], circle(t.ri + 0.005, 48))
	);
	const bendNode = translate([-R, 0, h], rotate([90, 0, 0], revolveArc(FN, p.angle, ring)));
	const th = (p.angle * Math.PI) / 180;
	const end: [number, number, number] = [-R + R * Math.cos(th), 0, h + R * Math.sin(th)];
	const stepB = Math.max(Math.abs(t.ro - L.b.ro), Math.abs(t.ri - L.b.ri), 1);
	const outB = endContour(L.b.ro, p.lengthB, p.fitB, p.barbs).map(
		([r, z]): Vec2 => [r, stepB + p.lengthB - z]
	);
	const endB = union(
		translate([0, 0, -0.01], tube(t, L.b, stepB + 0.02)),
		revolve(FN, polygon([...outB.reverse(), [L.b.ri, stepB + p.lengthB], [L.b.ri, stepB]]))
	);
	return union(endA, neckA, bendNode, translate(end, rotate([0, -p.angle, 0], endB)));
}

function funnel(p: HoseParams): Node {
	const t = p.wall;
	const Rm = p.mouth / 2;
	// «Диаметр носика» is what goes into the bottle: the air ribs included.
	const rib = p.spout / 2 - 1 - t >= 1.5 ? 1 : 0;
	const Rs = p.spout / 2 - rib;
	// 50° from the bed: steep enough to print mouth down, shallow enough to pour.
	const cone = (Rm - Rs) * Math.tan((50 * Math.PI) / 180);
	const top = 2 + cone + p.spoutLength;
	const profile = polygon([
		[Rm + 2, 0],
		[Rm + 2, 2],
		[Rm, 2 + 0.01],
		[Rs, 2 + cone],
		[Rs, top],
		[Rs - t, top],
		[Rs - t, 2 + cone + 0.01],
		[Rm - t / Math.sin((50 * Math.PI) / 180), 2],
		[Rm - t / Math.sin((50 * Math.PI) / 180), 0]
	]);
	// Three ribs on the spout let the air out of a bottle while it fills.
	const ribs = rib
		? [0, 120, 240].map((a) =>
				rotate(
					[0, 0, a],
					translate([Rs - 0.3, -0.6, 2 + cone], cube([rib + 0.3, 1.2, p.spoutLength - 2]))
				)
			)
		: [];
	return union(revolve(FN, profile), ...ribs);
}

export function hoseModel(input: HoseParams): Node {
	const p = clampHose(input);
	if (p.kind === 'funnel') return part('funnel', funnel(p));
	if (p.kind === 'elbow') return part('elbow', elbow(p));
	return part('adapter', straight(p));
}

const mm = (v: number) => num(v, 4);
const endWords = (diameter: number, fit: EndFit) =>
	fit === 'inside'
		? m.t_hose_adapter_end_inside({ diameter: mm(diameter) })
		: m.t_hose_adapter_end_outside({ diameter: mm(diameter) });

export function hoseSummary(input: HoseParams): string {
	const p = clampHose(input);
	if (p.kind === 'funnel')
		return m.t_hose_adapter_summary_funnel({ mouth: mm(p.mouth), spout: mm(p.spout) });
	const L = hoseLayout(p);
	const a = endWords(p.diameterA, p.fitA);
	const b = endWords(p.diameterB, p.fitB);
	const bore = mm(Math.round(2 * Math.min(L.a.ri, L.b.ri) * 10) / 10);
	if (p.kind === 'elbow') return m.t_hose_adapter_summary_elbow({ angle: mm(p.angle), a, b, bore });
	return m.t_hose_adapter_summary_straight({ a, b, bore, height: mm(Math.round(L.height)) });
}

export function hoseHeader(input: HoseParams): string[] {
	const p = clampHose(input);
	return [m.t_hose_adapter_scad_title(), hoseSummary(p)];
}

export function hoseScad(p: HoseParams): string {
	return toScad(hoseModel(p), hoseHeader(p));
}
