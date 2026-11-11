/**
 * A grommet for the cable hole in a desk (60 and 80 mm are the furniture
 * standards, 35 mm is a hinge-cup bit): a sleeve with barbed ribs that holds
 * in the hole, a flange over its edge and a cap with a notch for the cables
 * that sits flush in a 45° seat. The ring prints flange down, the cap top
 * down — both without supports.
 */
import {
	circle,
	difference,
	extrude,
	loft,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/desk-grommet';
import { clamp as c } from '../shared/math';

export interface GrommetParams {
	/** Diameter of the hole in the desk, mm */
	hole: number;
	/** How deep the sleeve goes into the hole, mm */
	depth: number;
	/** How far the flange covers the desk round the hole, mm */
	rim: number;
	/** Width of the cable notch in the cap, mm; 0 — a closed cap */
	slot: number;
	/** Between the sleeve and the hole, per side, mm (the ribs hold anyway) */
	play: number;
	count: number;
}

export const GROMMET_DEFAULTS: GrommetParams = {
	hole: 60,
	depth: 18,
	rim: 6,
	slot: 20,
	play: 0.2,
	count: 1
};

export interface GrommetPreset {
	id: string;
	label: string;
	params: Partial<GrommetParams>;
}

export const GROMMET_PRESETS: readonly GrommetPreset[] = [
	{
		id: 'd60',
		get label() {
			return m.t_desk_grommet_preset_diameter({ d: 60 });
		},
		params: {}
	},
	{
		id: 'd80',
		get label() {
			return m.t_desk_grommet_preset_diameter({ d: 80 });
		},
		params: { hole: 80, slot: 26 }
	},
	{
		id: 'd50',
		get label() {
			return m.t_desk_grommet_preset_diameter({ d: 50 });
		},
		params: { hole: 50, slot: 16 }
	},
	{
		id: 'd35',
		get label() {
			return m.t_desk_grommet_preset_diameter({ d: 35 });
		},
		params: { hole: 35, slot: 12, rim: 5, depth: 14 }
	},
	{
		id: 'closed',
		get label() {
			return m.t_desk_grommet_preset_closed();
		},
		params: { slot: 0 }
	}
];

const WALL = 2;
const FLANGE = 3;
/** The cap's seat: 45°, this deep and this wide. */
const SEAT = 2;
const CAP_PLAY = 0.25;
const SKIRT = 1.6;
const RIB = 0.5;
const FN = 96;

export function clampGrommet(p: GrommetParams): GrommetParams {
	const hole = c(p.hole, 25, 100);
	return {
		hole,
		depth: c(p.depth, 8, 40),
		rim: c(p.rim, 3, 15),
		slot: c(p.slot, 0, Math.round(hole * 0.5)),
		play: c(p.play, 0, 0.8),
		count: Math.round(c(p.count, 1, 4))
	};
}

/** Radii, mm: sleeve outside and inside, flange, the cap's top. */
export function grommetRadii(input: GrommetParams) {
	const p = clampGrommet(input);
	const sleeve = p.hole / 2 - p.play;
	const inner = sleeve - WALL;
	return { sleeve, inner, flange: p.hole / 2 + p.rim, cap: inner + SEAT - CAP_PLAY };
}

/** The ring: flange on the bed, the sleeve up. */
function ring(p: GrommetParams): Node {
	const r = grommetRadii(p);
	const top = FLANGE + p.depth;
	// The flange's visible edge is chamfered 1 mm.
	const flange = loft([
		{ z: 0, shape: circle(r.flange - 1, FN) },
		{ z: 1, shape: circle(r.flange, FN) },
		{ z: FLANGE, shape: circle(r.flange, FN) }
	]);
	// The sleeve's deep end is narrower, to find the hole.
	const sleeve = loft([
		{ z: FLANGE - 0.01, shape: circle(r.sleeve, FN) },
		{ z: top - 1, shape: circle(r.sleeve, FN) },
		{ z: top, shape: circle(r.sleeve - 0.8, FN) }
	]);
	// Barbed ribs lean back: the sleeve goes in and does not come out.
	const ribs: Node[] = [];
	for (let z = FLANGE + 2; z + 3 <= top - 1; z += 3)
		ribs.push(
			loft([
				{ z, shape: circle(r.sleeve + RIB, FN) },
				{ z: z + 2.4, shape: circle(r.sleeve, FN) }
			])
		);
	const bore = translate([0, 0, -1], extrude(top + 2, circle(r.inner, FN)));
	const seat = loft([
		{ z: -0.01, shape: circle(r.inner + SEAT, FN) },
		{ z: SEAT, shape: circle(r.inner, FN) }
	]);
	return difference(union(flange, sleeve, ...ribs), bore, seat);
}

/** The cap: top on the bed, the skirt up into the sleeve, the notch at +X. */
function cap(p: GrommetParams): Node {
	const r = grommetRadii(p);
	const fit = r.inner - CAP_PLAY;
	const skirt = Math.min(5, p.depth - 2);
	const body = union(
		loft([
			{ z: 0, shape: circle(r.cap, FN) },
			{ z: SEAT, shape: circle(fit, FN) }
		]),
		translate(
			[0, 0, SEAT - 0.01],
			difference(
				extrude(skirt, circle(fit, FN)),
				translate([0, 0, -1], extrude(skirt + 2, circle(fit - SKIRT, FN)))
			)
		)
	);
	if (p.slot <= 0) return body;
	// A U-shaped notch from the edge: as wide as the slot, 4 mm deeper than its round end.
	const w = p.slot;
	const reach = w / 2 + 4;
	const notch = union(
		translate([r.cap - reach + w / 2, 0], circle(w / 2, 48)),
		translate([r.cap - reach + w / 2, -w / 2], square(reach + 2, w, false))
	);
	return difference(body, translate([0, 0, -1], extrude(SEAT + skirt + 2, notch)));
}

export function grommetModel(input: GrommetParams): Node {
	const p = clampGrommet(input);
	const r = grommetRadii(p);
	const step = 2 * r.flange + 6;
	const one = union(ring(p), translate([r.flange + 6 + r.cap, 0, 0], cap(p)));
	return union(...Array.from({ length: p.count }, (_, i) => translate([0, -i * step, 0], one)));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function grommetSummary(input: GrommetParams): string {
	const p = clampGrommet(input);
	const r = grommetRadii(p);
	const values = {
		count: p.count,
		n: num(p.count),
		hole: mm(p.hole),
		flange: mm(2 * r.flange),
		depth: mm(p.depth)
	};
	return p.slot
		? m.t_desk_grommet_summary_slot({ ...values, slot: mm(p.slot) })
		: m.t_desk_grommet_summary_closed(values);
}

export function grommetHeader(input: GrommetParams): string[] {
	return [m.t_desk_grommet_scad_title(), grommetSummary(input)];
}

export function grommetScad(p: GrommetParams): string {
	return toScad(grommetModel(p), grommetHeader(p));
}
