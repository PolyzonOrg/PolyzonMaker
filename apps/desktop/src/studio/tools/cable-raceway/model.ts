/**
 * «Кабель-канал»: a straight channel for wires along a wall or under a desk,
 * with a lid that snaps on. Both print without supports: the channel on its
 * back, the lid on its face.
 *
 * The profile (u across, v up from the back): the back plate and two walls;
 * each wall carries a bead on its outside near the top — a 45° face below
 * (the catch, printable), a long slope above (the lead-in). The lid's legs
 * clear the bead tips; a hook on each leg, its catch parallel to the bead's,
 * slips under the bead when the lid is pressed on and the walls give.
 */
import {
	cylinder,
	difference,
	extrude,
	mirror,
	part,
	polygon,
	rotate,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/cable-raceway';
import { clamp } from '../shared/math';

export type RacewayMount = 'tape' | 'screws';

export interface RacewayParams {
	length: number;
	/** Room inside for the wires, mm */
	width: number;
	height: number;
	wall: number;
	mount: RacewayMount;
	/** Screw holes this far apart, mm */
	screwStep: number;
	/** Play of the snap, mm */
	clearance: number;
}

export const RACEWAY_DEFAULTS: RacewayParams = {
	length: 200,
	width: 16,
	height: 10,
	wall: 1.6,
	mount: 'tape',
	screwStep: 100,
	clearance: 0.2
};

export const RACEWAY_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<RacewayParams>;
}[] = [
	{
		id: 'thin',
		get label() {
			return m.t_cable_raceway_preset_thin();
		},
		params: { width: 10, height: 7 }
	},
	{
		id: 'desk',
		get label() {
			return m.t_cable_raceway_preset_desk();
		},
		params: { width: 25, height: 15, mount: 'screws' }
	},
	{
		id: 'tv',
		get label() {
			return m.t_cable_raceway_preset_tv();
		},
		params: { width: 30, height: 12 }
	},
	{
		id: 'wide',
		get label() {
			return m.t_cable_raceway_preset_wide();
		},
		params: { width: 40, height: 20, wall: 2, mount: 'screws' }
	}
];

export function clampRaceway(p: RacewayParams): RacewayParams {
	return {
		length: clamp(p.length, 30, 300),
		width: clamp(p.width, 6, 80),
		height: clamp(p.height, 5, 50),
		wall: clamp(p.wall, 1.2, 3),
		mount: p.mount === 'screws' ? 'screws' : 'tape',
		screwStep: clamp(p.screwStep, 40, 300),
		clearance: clamp(p.clearance, 0.1, 0.5)
	};
}

/** The bead sticks out this far, mm. */
const BEAD = 0.8;
/** The lid's legs are this thick, mm. */
const LEG = 1.2;
/** Screw hole and countersink for a 3.5–4 mm wood screw, mm. */
const SCREW = { hole: 4, head: 8 };

export interface RacewayLayout {
	/** Outer width and height of the channel, mm */
	outerWidth: number;
	outerHeight: number;
	/** Outer width of the lid and the whole closed raceway's height, mm */
	lidWidth: number;
	totalHeight: number;
	/** Screw holes along the length (centres, from the middle) */
	screws: number[];
	/** Round wires of 5 mm (USB, a phone charger) that fit at 40 % fill */
	wires5: number;
}

export function racewayLayout(input: RacewayParams): RacewayLayout {
	const p = clampRaceway(input);
	const outerWidth = p.width + 2 * p.wall;
	const outerHeight = p.wall + p.height;
	const lidWidth = outerWidth + 2 * (BEAD + p.clearance + LEG);
	const screws: number[] = [];
	if (p.mount === 'screws') {
		// A short piece gets one hole in the middle, not two on the same spot.
		const room = p.length - 30;
		const n = room < 10 ? 1 : Math.max(2, Math.floor(room / p.screwStep) + 1);
		const span = n > 1 ? Math.min(room, (n - 1) * p.screwStep) : 0;
		for (let i = 0; i < n; i++) screws.push(-span / 2 + (n > 1 ? (i * span) / (n - 1) : 0));
	}
	const wires5 = Math.floor((0.4 * p.width * p.height) / (Math.PI * 2.5 * 2.5));
	return { outerWidth, outerHeight, lidWidth, totalHeight: outerHeight + p.wall, screws, wires5 };
}

type Pt = [number, number];

/** Right half of the channel's profile (u ≥ 0), the back on v = 0. */
function channelProfile(p: RacewayParams): Pt[] {
	const uw = p.width / 2 + p.wall;
	const top = p.wall + p.height;
	const v0 = top - 3.1;
	return [
		[0, 0],
		[uw, 0],
		[uw, v0],
		[uw + BEAD, v0 + BEAD],
		[uw + BEAD, v0 + BEAD + 0.4],
		[uw, top - 0.3],
		[uw, top],
		[p.width / 2, top],
		[p.width / 2, p.wall],
		[0, p.wall]
	];
}

/** Right half of the lid's profile, in place over the channel. */
function lidProfile(p: RacewayParams): Pt[] {
	const uw = p.width / 2 + p.wall;
	const top = p.wall + p.height;
	const v0 = top - 3.1;
	const c = p.clearance;
	const ul = uw + BEAD + c;
	return [
		[0, top + c],
		[ul, top + c],
		[ul, v0 + BEAD - c],
		[uw + c, v0 - c],
		[ul, v0 - c - BEAD],
		[ul, v0 - c - BEAD - 0.6],
		[ul + LEG, v0 - c - BEAD - 0.6],
		[ul + LEG, top + c + p.wall],
		[0, top + c + p.wall]
	];
}

/** Both halves of a profile (each counter-clockwise, from and to the axis), run along the length (y). */
function run(half: Pt[], length: number): Node {
	const left = half.filter(([u]) => u > 0).map(([u, v]) => [-u, v] as Pt);
	const whole: Pt[] = [...half, ...left.reverse()];
	return translate([0, length / 2, 0], rotate([90, 0, 0], extrude(length, polygon(whole))));
}

/** The channel and the lid snapped on it, as in use. */
export function racewayParts(input: RacewayParams): { channel: Node; lid: Node } {
	const p = clampRaceway(input);
	const L = racewayLayout(p);
	const holes = L.screws.map((y) =>
		translate(
			[0, y, 0],
			union(
				translate([0, 0, -1], cylinder(p.wall + 2, SCREW.hole / 2, SCREW.hole / 2, 24)),
				// A 90° countersink from the inside, the head flush with the floor.
				translate(
					[0, 0, p.wall - (SCREW.head - SCREW.hole) / 2],
					cylinder((SCREW.head - SCREW.hole) / 2 + 0.01, SCREW.hole / 2, SCREW.head / 2, 24)
				)
			)
		)
	);
	return {
		channel: difference(run(channelProfile(p), p.length), ...holes),
		lid: run(lidProfile(p), p.length)
	};
}

export function racewayModel(input: RacewayParams): Node {
	const p = clampRaceway(input);
	const L = racewayLayout(p);
	const { channel, lid } = racewayParts(p);
	// The lid face down beside the channel.
	const top = p.wall + p.height + p.clearance + p.wall;
	return union(
		part('channel', channel),
		part('lid', translate([L.outerWidth / 2 + L.lidWidth / 2 + 8, 0, top], mirror([0, 0, 1], lid)))
	);
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function racewaySummary(input: RacewayParams): string {
	const p = clampRaceway(input);
	const L = racewayLayout(p);
	const mount =
		p.mount === 'screws'
			? m.t_cable_raceway_summary_screws({ count: L.screws.length, n: num(L.screws.length) })
			: m.t_cable_raceway_summary_tape();
	return m.t_cable_raceway_summary({
		width: mm(L.lidWidth),
		height: mm(L.totalHeight),
		length: mm(p.length),
		mount,
		wires: m.t_cable_raceway_summary_wires({ count: L.wires5, n: num(L.wires5) })
	});
}

export function racewayHeader(input: RacewayParams): string[] {
	const p = clampRaceway(input);
	return [
		m.t_cable_raceway_scad_title(),
		m.t_cable_raceway_scad_inside({
			width: mm(p.width),
			height: mm(p.height),
			wall: mm(p.wall),
			clearance: mm(p.clearance)
		}),
		racewaySummary(p),
		m.t_cable_raceway_scad_print()
	];
}

export function racewayScad(p: RacewayParams): string {
	return toScad(racewayModel(p), racewayHeader(p));
}
