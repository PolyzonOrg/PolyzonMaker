/**
 * «Пружины»: springs that print flat and work: a zigzag that compresses
 * along its length (pads with holes at both ends) and a spiral (clock)
 * spring that winds round its hub. A printed coil spring prints badly — its
 * turns hang in the air — so both of these lie on the bed. Print in PETG or
 * nylon; PLA tires and creeps.
 */
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/flat-spring';
import {
	circle,
	cylinder,
	difference,
	extrude,
	part,
	polygon,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { clamp } from '../shared/math';

export type SpringKind = 'zigzag' | 'spiral';

export interface SpringParams {
	kind: SpringKind;
	/** Strip width in the plane and thickness (the height on the bed), mm */
	strip: number;
	thickness: number;
	/** Zigzag: free length between the pads, width, number of turns */
	length: number;
	width: number;
	turns: number;
	/** Spiral: hub and outer diameter, turns, hub bore */
	hub: number;
	outer: number;
	spiralTurns: number;
	bore: number;
	/** Screw holes in the zigzag's pads, mm (0: none) */
	hole: number;
}

export const SPRING_DEFAULTS: SpringParams = {
	kind: 'zigzag',
	strip: 1.2,
	thickness: 5,
	length: 40,
	width: 20,
	turns: 8,
	hub: 10,
	outer: 50,
	spiralTurns: 5,
	bore: 3.2,
	hole: 3.2
};

export const SPRING_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<SpringParams>;
}[] = [
	{
		id: 'soft',
		get label() {
			return m.t_flat_spring_preset_soft();
		},
		params: { kind: 'zigzag', strip: 1, turns: 10, length: 40 }
	},
	{
		id: 'stiff',
		get label() {
			return m.t_flat_spring_preset_stiff();
		},
		params: { kind: 'zigzag', strip: 2, turns: 6, length: 40, width: 16 }
	},
	{
		id: 'clock',
		get label() {
			return m.t_flat_spring_preset_clock();
		},
		params: { kind: 'spiral', strip: 1, spiralTurns: 6, outer: 50 }
	},
	{
		id: 'return',
		get label() {
			return m.t_flat_spring_preset_return();
		},
		params: { kind: 'spiral', strip: 1.6, spiralTurns: 3, outer: 40, hub: 12 }
	}
];

/** Gap that stays open between neighbouring turns, mm. */
const GAP = 0.6;

export function clampSpring(p: SpringParams): SpringParams {
	const strip = clamp(p.strip, 0.8, 4);
	const length = clamp(p.length, 10, 200);
	// Every turn needs its strip and a gap.
	const turns = Math.round(clamp(p.turns, 2, Math.floor(length / (strip + GAP)) - 1));
	const hub = clamp(p.hub, 4, 60);
	const outer = clamp(p.outer, hub + 10, 200);
	const room = (outer - hub) / 2 - strip - 2;
	const spiralTurns = clamp(p.spiralTurns, 1, Math.max(1, Math.floor(room / (strip + GAP))));
	return {
		kind: p.kind === 'spiral' ? 'spiral' : 'zigzag',
		strip,
		thickness: clamp(p.thickness, 1, 30),
		length,
		width: clamp(p.width, 6 * strip, 150),
		turns,
		hub,
		outer,
		spiralTurns,
		bore: clamp(p.bore, 1, hub - 2),
		hole: clamp(p.hole, 0, 8)
	};
}

/** Distance between neighbouring turns of the zigzag, mm. */
export function zigzagPitch(input: SpringParams): number {
	const p = clampSpring(input);
	return p.length / p.turns;
}

function zigzag(p: SpringParams): Node {
	const s = p.strip;
	const pitch = p.length / p.turns;
	const r = pitch / 2;
	const reach = p.width / 2 - r;
	const pieces: Node[] = [];
	// Straight runs across, joined by half rings at alternate ends.
	for (let i = 0; i <= p.turns; i++) {
		const y = i * pitch;
		// A little into the half rings: a joint end to end would leave a seam.
		pieces.push(translate([0, y, 0], square(2 * reach + s / 2, s)));
		if (i < p.turns) {
			// The half ring drawn as arcs: cut out of a circle, its vertices would
			// fall on the cut and leave slivers.
			const side = i % 2 ? -1 : 1;
			const n = 24;
			const arc = (rr: number) =>
				Array.from({ length: n + 1 }, (_, k) => {
					const a = -Math.PI / 2 + (k / n) * Math.PI;
					return [side * reach + side * rr * Math.cos(a), y + r + rr * Math.sin(a)] as [
						number,
						number
					];
				});
			const outerArc = arc(r + s / 2);
			const innerArc = arc(r - s / 2).reverse();
			const ring = [...outerArc, ...innerArc];
			pieces.push(polygon(side > 0 ? ring : ring.reverse()));
		}
	}
	// Pads at both ends: as wide as the spring, with a hole.
	const pad = Math.max(8, p.hole + 5);
	const pads = [-pad / 2 - s / 2 + 0.01, p.length + pad / 2 + s / 2 - 0.01].map((y) => {
		const block = translate([0, y, 0], rrect(p.width, pad, 1.5, 24));
		return p.hole > 0 ? difference(block, translate([0, y, 0], circle(p.hole / 2, 32))) : block;
	});
	return extrude(p.thickness, union(...pieces, ...pads));
}

function spiral(p: SpringParams): Node {
	const s = p.strip;
	const r0 = p.hub / 2 + s / 2;
	const r1 = p.outer / 2 - s / 2 - 2;
	const turns = p.spiralTurns;
	const steps = Math.ceil(turns * 96);
	const outerEdge: [number, number][] = [];
	const innerEdge: [number, number][] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const a = t * turns * Math.PI * 2;
		const r = r0 + (r1 - r0) * t;
		outerEdge.push([(r + s / 2) * Math.cos(a), (r + s / 2) * Math.sin(a)]);
		innerEdge.push([(r - s / 2) * Math.cos(a), (r - s / 2) * Math.sin(a)]);
	}
	const strip = polygon([...outerEdge, ...innerEdge.reverse()]);
	// The hub with its bore, and a tab with a hole at the outer end.
	const aEnd = turns * Math.PI * 2;
	// Out past the turn under it by the gap, so the tab never welds to it.
	const under = r1 - (r1 - r0) / turns + s / 2;
	const end = Math.max(r1 + 2, under + GAP + 3.5 + 0.1);
	const tab = translate(
		[end * Math.cos(aEnd), end * Math.sin(aEnd), 0],
		difference(circle(3.5, 32), circle(1.6, 24))
	);
	const shape = union(strip, circle(p.hub / 2 + 0.2, 48), tab);
	return difference(
		extrude(p.thickness, shape),
		translate([0, 0, -1], cylinder(p.thickness + 2, p.bore / 2, p.bore / 2, 32))
	);
}

export function springModel(input: SpringParams): Node {
	const p = clampSpring(input);
	return part('spring', p.kind === 'spiral' ? spiral(p) : zigzag(p));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

/** «3 витка», «5 витков», «2,5 витка» (a fraction takes the plural category «other»). */
const turns = (n: number) => m.t_flat_spring_turns_count({ count: n, n: mm(n) });

export function springSummary(input: SpringParams): string {
	const p = clampSpring(input);
	if (p.kind === 'spiral')
		return m.t_flat_spring_summary_spiral({
			outer: mm(p.outer),
			turns: turns(p.spiralTurns),
			strip: mm(p.strip),
			hub: mm(p.hub),
			bore: mm(p.bore)
		});
	const travel = (zigzagPitch(p) - p.strip - GAP) * p.turns;
	return m.t_flat_spring_summary_zigzag({
		width: mm(p.width),
		length: mm(p.length),
		turns: turns(p.turns),
		strip: mm(p.strip),
		travel: mm(Math.max(0, travel))
	});
}

export function springHeader(input: SpringParams): string[] {
	const p = clampSpring(input);
	return [
		m.t_flat_spring_scad_title(),
		springSummary(p),
		m.t_flat_spring_scad_thickness({ thickness: mm(p.thickness) })
	];
}

export function springScad(p: SpringParams): string {
	return toScad(springModel(p), springHeader(p));
}
