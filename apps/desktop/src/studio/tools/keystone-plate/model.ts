/**
 * «Розетки keystone»: a wall plate for one to four keystone jacks (network,
 * TV, HDMI, USB — any module of that standard) or a blank, 80 × 80 mm (the
 * European frame) or 86 × 86 (the «86» type), with two screws 60 mm apart
 * as an in-wall box takes them. For a wall without a box there is a surface
 * box to go behind it: screwed to the wall, the plate screwed to its posts,
 * the cable in through a notch. Printed face down, no supports.
 */
import {
	cube,
	cylinder,
	difference,
	extrude,
	part,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { KEYSTONE } from '../rack-panel/model';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/keystone-plate';
import { clamp } from '../shared/math';

export type PlateSize = '80' | '86';
export type PlateMount = 'flush' | 'surface';

export interface KeystonePlateParams {
	size: PlateSize;
	/** 0 — a blank */
	ports: number;
	mount: PlateMount;
	thickness: number;
	/** The surface box's depth, mm */
	depth: number;
}

export const KEYSTONE_PLATE_DEFAULTS: KeystonePlateParams = {
	size: '80',
	ports: 2,
	mount: 'flush',
	thickness: 3,
	depth: 38
};

export const KEYSTONE_PLATE_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<KeystonePlateParams>;
}[] = [
	{
		id: 'two',
		get label() {
			return m.t_keystone_plate_preset_two();
		},
		params: {}
	},
	{
		id: 'one',
		get label() {
			return m.t_keystone_plate_preset_one();
		},
		params: { ports: 1 }
	},
	{
		id: 'four',
		get label() {
			return m.t_keystone_plate_preset_four();
		},
		params: { ports: 4 }
	},
	{
		id: 'surface',
		get label() {
			return m.t_keystone_plate_preset_surface();
		},
		params: { ports: 2, mount: 'surface' }
	},
	{
		id: 'blank',
		get label() {
			return m.t_keystone_plate_preset_blank();
		},
		params: { ports: 0 }
	}
];

export function clampKeystonePlate(p: KeystonePlateParams): KeystonePlateParams {
	return {
		size: p.size === '86' ? '86' : '80',
		ports: Math.round(clamp(p.ports, 0, 4)),
		mount: p.mount === 'surface' ? 'surface' : 'flush',
		thickness: clamp(p.thickness, 2.4, 5),
		depth: clamp(p.depth, 32, 60)
	};
}

/** Screws of an in-wall box, apart, and their heads, mm. */
const SCREW = { spacing: 60, d: 3.5, head: 7 };
const RIM = { wall: 2, height: 5 };
const BOX = { wall: 2, floor: 2.5, post: 8, pilot: 2.5, notch: 14 };
/** Jack pitch: side by side and one above the other, mm. */
const PITCH = [KEYSTONE.pocket[0] + 2.5, KEYSTONE.pocket[1] + 2];

/** Centres of the jacks: a row of two, or two over one, or two by two. */
export function keystonePorts(n: number): [number, number][] {
	const [dx, dy] = PITCH;
	switch (n) {
		case 1:
			return [[0, 0]];
		case 2:
			return [
				[-dx / 2, 0],
				[dx / 2, 0]
			];
		case 3:
			return [
				[-dx / 2, dy / 2],
				[dx / 2, dy / 2],
				[0, -dy / 2]
			];
		case 4:
			return [
				[-dx / 2, dy / 2],
				[dx / 2, dy / 2],
				[-dx / 2, -dy / 2],
				[dx / 2, -dy / 2]
			];
		default:
			return [];
	}
}

function plate(p: KeystonePlateParams): Node {
	const W = Number(p.size);
	const T = p.thickness;
	const rim = difference(
		extrude(T + RIM.height, rrect(W, W, 4, 32)),
		translate([0, 0, T], extrude(RIM.height + 1, rrect(W - 2 * RIM.wall, W - 2 * RIM.wall, 2, 32)))
	);
	const cuts: Node[] = [];
	for (const [x, y] of keystonePorts(p.ports)) {
		cuts.push(
			translate(
				[x - KEYSTONE.window[0] / 2, y - KEYSTONE.window[1] / 2, -1],
				cube([KEYSTONE.window[0], KEYSTONE.window[1], T + 2])
			),
			translate(
				[x - KEYSTONE.pocket[0] / 2, y - KEYSTONE.pocket[1] / 2, KEYSTONE.plate],
				cube([KEYSTONE.pocket[0], KEYSTONE.pocket[1], T])
			)
		);
	}
	// Screws: the head sunk into the face (at the bed, opening out to it).
	const sink = (SCREW.head - SCREW.d) / 2;
	for (const s of [-1, 1])
		cuts.push(
			translate([(s * SCREW.spacing) / 2, 0, -1], cylinder(T + 2, SCREW.d / 2, SCREW.d / 2, 32)),
			translate(
				[(s * SCREW.spacing) / 2, 0, -0.01],
				cylinder(sink + 0.01, SCREW.head / 2, SCREW.d / 2, 32)
			)
		);
	return difference(rim, ...cuts);
}

/** The surface box: fits inside the plate's rim, posts for its screws. */
function surfaceBox(p: KeystonePlateParams): Node {
	const W = Number(p.size) - 2 * RIM.wall - 0.4;
	const D = p.depth;
	const shell = difference(
		extrude(D, rrect(W, W, 2, 32)),
		translate([0, 0, BOX.floor], extrude(D, rrect(W - 2 * BOX.wall, W - 2 * BOX.wall, 1, 32)))
	);
	const posts = [-1, 1].map((s) =>
		translate([(s * SCREW.spacing) / 2, 0, 0], cylinder(D, BOX.post / 2, BOX.post / 2, 32))
	);
	const cuts: Node[] = [
		// Pilot holes for the plate's screws.
		...[-1, 1].map((s) =>
			translate(
				[(s * SCREW.spacing) / 2, 0, BOX.floor + 2],
				cylinder(D, BOX.pilot / 2, BOX.pilot / 2, 24)
			)
		),
		// Two screws into the wall in opposite corners, clear of the jacks; heads sunk from inside.
		...[-1, 1].flatMap((s) => {
			const c = W / 2 - BOX.wall - 6;
			return [
				translate([-s * c, s * c, -1], cylinder(BOX.floor + 2, 2, 2, 24)),
				translate([-s * c, s * c, BOX.floor - 1.5], cylinder(1.51, 2, 4, 24))
			];
		}),
		// The cable comes in at the bottom, through a notch from the open edge.
		translate([-BOX.notch / 2, -W / 2 - 1, D - 12], cube([BOX.notch, BOX.wall + 2, 13]))
	];
	return difference(union(shell, ...posts), ...cuts);
}

export function keystonePlateModel(input: KeystonePlateParams): Node {
	const p = clampKeystonePlate(input);
	const W = Number(p.size);
	return union(
		part('plate', plate(p)),
		p.mount === 'surface' ? part('box', translate([W + 8, 0, 0], surfaceBox(p))) : null
	);
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function keystonePlateSummary(input: KeystonePlateParams): string {
	const p = clampKeystonePlate(input);
	const values = { size: p.size, spacing: num(SCREW.spacing) };
	const ports = { ...values, count: p.ports, n: num(p.ports) };
	if (p.mount === 'surface') {
		const depth = mm(p.depth);
		return p.ports
			? m.t_keystone_plate_summary_ports_surface({ ...ports, depth })
			: m.t_keystone_plate_summary_blank_surface({ ...values, depth });
	}
	return p.ports
		? m.t_keystone_plate_summary_ports_flush(ports)
		: m.t_keystone_plate_summary_blank_flush(values);
}

export function keystonePlateHeader(input: KeystonePlateParams): string[] {
	return [
		m.t_keystone_plate_header_title(),
		keystonePlateSummary(input),
		m.t_keystone_plate_header_print()
	];
}

export function keystonePlateScad(p: KeystonePlateParams): string {
	return toScad(keystonePlateModel(p), keystonePlateHeader(p));
}
