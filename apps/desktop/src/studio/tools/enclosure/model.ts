/**
 * A case for a board: standoffs at the board's mounting holes, windows in
 * the walls where its connectors are, a lid that presses in on a lip, with
 * vent slots. Boards: Raspberry Pi 5, Raspberry Pi 4, Raspberry Pi Zero, Arduino Uno, or
 * any board by its size and four holes.
 *
 * Positions are the boards' published dimensions (mm from the lower left
 * corner, the board seen from above); windows get a margin round them, so
 * a few tenths either way still fit. Box and lid print open side up and
 * top down — no supports.
 */
import {
	cube,
	cylinder,
	difference,
	extrude,
	part,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { listJoin, sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/enclosure';
import { clamp as c } from '../shared/math';

export type BoardId = 'rpi5' | 'rpi4' | 'rpizero' | 'uno' | 'custom';
/** Which edge of the board a connector faces. */
export type Edge = 'front' | 'back' | 'left' | 'right';

export interface Port {
	name: string;
	edge: Edge;
	/** Along the edge from the board's left / front corner, mm */
	at: number;
	width: number;
	/** Bottom and top of the opening above the board's top face, mm */
	z0: number;
	z1: number;
}

export interface Board {
	label: string;
	width: number;
	depth: number;
	holes: [number, number][];
	hole: number;
	/** Tallest part above the board, mm */
	parts: number;
	ports: Port[];
}

export const BOARDS: Readonly<Record<Exclude<BoardId, 'custom'>, Board>> = {
	// The Pi 4 outline and holes; Ethernet and USB swapped, no audio jack
	// (Raspberry Pi 5 mechanical drawing). Room above for the active cooler.
	rpi5: {
		label: 'Raspberry Pi 5',
		width: 85,
		depth: 56,
		holes: [
			[3.5, 3.5],
			[61.5, 3.5],
			[3.5, 52.5],
			[61.5, 52.5]
		],
		hole: 2.7,
		parts: 17,
		ports: [
			{ name: 'USB-C', edge: 'front', at: 11.2, width: 9.5, z0: 0, z1: 3.5 },
			{ name: 'micro HDMI', edge: 'front', at: 25.8, width: 7.5, z0: 0, z1: 3.5 },
			{ name: 'micro HDMI', edge: 'front', at: 39.2, width: 7.5, z0: 0, z1: 3.5 },
			{ name: 'Ethernet', edge: 'right', at: 10.2, width: 16, z0: 0, z1: 13.5 },
			{ name: 'USB', edge: 'right', at: 29.1, width: 13.5, z0: 0, z1: 16 },
			{ name: 'USB', edge: 'right', at: 47, width: 13.5, z0: 0, z1: 16 },
			{ name: 'microSD', edge: 'left', at: 28.5, width: 12, z0: -2.5, z1: 0 }
		]
	},
	rpi4: {
		label: 'Raspberry Pi 4',
		width: 85,
		depth: 56,
		holes: [
			[3.5, 3.5],
			[61.5, 3.5],
			[3.5, 52.5],
			[61.5, 52.5]
		],
		hole: 2.7,
		parts: 16,
		ports: [
			{ name: 'USB-C', edge: 'front', at: 11.2, width: 9.5, z0: 0, z1: 3.5 },
			{ name: 'micro HDMI', edge: 'front', at: 26, width: 7.5, z0: 0, z1: 3.5 },
			{ name: 'micro HDMI', edge: 'front', at: 39.5, width: 7.5, z0: 0, z1: 3.5 },
			{
				get name() {
					return m.t_enclosure_port_audio();
				},
				edge: 'front',
				at: 53.5,
				width: 7,
				z0: 0,
				z1: 6
			},
			{ name: 'USB', edge: 'right', at: 9, width: 13.5, z0: 0, z1: 16 },
			{ name: 'USB', edge: 'right', at: 27, width: 13.5, z0: 0, z1: 16 },
			{ name: 'Ethernet', edge: 'right', at: 45.75, width: 16, z0: 0, z1: 13.5 },
			{ name: 'microSD', edge: 'left', at: 28, width: 12, z0: -2.5, z1: 0 }
		]
	},
	rpizero: {
		label: 'Raspberry Pi Zero',
		width: 65,
		depth: 30,
		holes: [
			[3.5, 3.5],
			[61.5, 3.5],
			[3.5, 26.5],
			[61.5, 26.5]
		],
		hole: 2.75,
		parts: 5,
		ports: [
			{ name: 'mini HDMI', edge: 'front', at: 12.4, width: 11.5, z0: 0, z1: 3.5 },
			{ name: 'micro USB', edge: 'front', at: 41.4, width: 8, z0: 0, z1: 3 },
			{
				get name() {
					return m.t_enclosure_port_power();
				},
				edge: 'front',
				at: 54,
				width: 8,
				z0: 0,
				z1: 3
			},
			{ name: 'microSD', edge: 'left', at: 16.9, width: 12, z0: 0, z1: 1.6 },
			{
				get name() {
					return m.t_enclosure_port_camera();
				},
				edge: 'right',
				at: 15,
				width: 17,
				z0: 0,
				z1: 1.6
			}
		]
	},
	uno: {
		label: 'Arduino Uno',
		width: 68.6,
		depth: 53.3,
		holes: [
			[13.97, 2.54],
			[15.24, 50.8],
			[66.04, 7.62],
			[66.04, 35.56]
		],
		hole: 3.2,
		parts: 13,
		ports: [
			{ name: 'USB', edge: 'left', at: 38.1, width: 12.5, z0: 0, z1: 11 },
			{
				get name() {
					return m.t_enclosure_port_power();
				},
				edge: 'left',
				at: 7.6,
				width: 9.5,
				z0: 0,
				z1: 11
			}
		]
	}
};

export interface EnclosureParams {
	board: BoardId;
	/** Custom board: size, holes inset from the corners, hole diameter, parts height */
	width: number;
	depth: number;
	inset: number;
	hole: number;
	parts: number;
	/** Gap round the board, mm */
	margin: number;
	wall: number;
	/** Board above the floor, mm */
	standoff: number;
	/** Above the tallest part, mm */
	headroom: number;
	vents: boolean;
	/** Tabs outside the box with screw holes, to fix it to a wall or a desk. */
	ears: boolean;
	/** Play of the lid's lip in the box, mm */
	clearance: number;
}

export const ENCLOSURE_DEFAULTS: EnclosureParams = {
	board: 'rpi4',
	width: 60,
	depth: 40,
	inset: 3.5,
	hole: 3,
	parts: 10,
	margin: 1.5,
	wall: 2,
	standoff: 5,
	headroom: 2,
	vents: true,
	ears: false,
	clearance: 0.25
};

export interface EnclosurePreset {
	id: string;
	label: string;
	params: Partial<EnclosureParams>;
}

export const ENCLOSURE_PRESETS: readonly EnclosurePreset[] = [
	{ id: 'rpi5', label: 'Raspberry Pi 5', params: { board: 'rpi5' } },
	{ id: 'rpi4', label: 'Raspberry Pi 4', params: { board: 'rpi4' } },
	{ id: 'zero', label: 'Raspberry Pi Zero', params: { board: 'rpizero', standoff: 3 } },
	{ id: 'uno', label: 'Arduino Uno', params: { board: 'uno', standoff: 4 } },
	{
		id: 'relay',
		get label() {
			return m.t_enclosure_preset_board_50x70();
		},
		params: { board: 'custom', width: 70, depth: 50, parts: 18, ears: true }
	}
];

export function clampEnclosure(p: EnclosureParams): EnclosureParams {
	const boards: BoardId[] = ['rpi5', 'rpi4', 'rpizero', 'uno', 'custom'];
	const width = c(p.width, 15, 300);
	const depth = c(p.depth, 15, 300);
	return {
		board: boards.includes(p.board) ? p.board : 'rpi4',
		width,
		depth,
		inset: c(p.inset, 1.5, Math.min(width, depth) / 3),
		hole: c(p.hole, 1.5, 5),
		parts: c(p.parts, 1, 120),
		margin: c(p.margin, 0.5, 15),
		wall: c(p.wall, 1.2, 5),
		standoff: c(p.standoff, 2, 30),
		headroom: c(p.headroom, 0, 40),
		vents: !!p.vents,
		ears: !!p.ears,
		clearance: c(p.clearance, 0, 1)
	};
}

/** The board the parameters describe (a preset, or the custom one). */
export function boardOf(input: EnclosureParams): Board {
	const p = clampEnclosure(input);
	if (p.board !== 'custom') return BOARDS[p.board];
	const i = p.inset;
	return {
		label: m.t_enclosure_custom_board(),
		width: p.width,
		depth: p.depth,
		holes: [
			[i, i],
			[p.width - i, i],
			[i, p.depth - i],
			[p.width - i, p.depth - i]
		],
		hole: p.hole,
		parts: p.parts,
		ports: []
	};
}

const PCB = 1.6;
const FLOOR = 2;
const WINDOW_MARGIN = 1;
/** How deep the lid's lip reaches into the box: the box is that much taller, so it stops above the parts. */
const LIP = 4;

export interface EnclosureLayout {
	board: Board;
	/** Outside of the box, mm */
	outer: [number, number, number];
	/** Where the board's lower left corner sits, mm */
	origin: [number, number, number];
	lid: number;
}

export function enclosureLayout(input: EnclosureParams): EnclosureLayout {
	const p = clampEnclosure(input);
	const b = boardOf(p);
	const W = b.width + 2 * (p.margin + p.wall);
	const D = b.depth + 2 * (p.margin + p.wall);
	const H = FLOOR + p.standoff + PCB + b.parts + p.headroom + LIP;
	return {
		board: b,
		outer: [W, D, H],
		origin: [-b.width / 2, -b.depth / 2, FLOOR + p.standoff],
		lid: 2
	};
}

/** A window through the wall for a port: board coordinates → a box through the wall. */
function window(p: EnclosureParams, L: EnclosureLayout, port: Port): Node {
	const [ox, oy, oz] = L.origin;
	const [W, D] = L.outer;
	const w = port.width + 2 * WINDOW_MARGIN;
	const z0 = oz + PCB + port.z0 - WINDOW_MARGIN;
	const h = port.z1 - port.z0 + 2 * WINDOW_MARGIN;
	const t = p.wall + p.margin + 2;
	switch (port.edge) {
		case 'front':
			return translate([ox + port.at - w / 2, -D / 2 - 1, z0], cube([w, t, h]));
		case 'back':
			return translate([ox + port.at - w / 2, D / 2 - t + 1, z0], cube([w, t, h]));
		case 'left':
			return translate([-W / 2 - 1, oy + port.at - w / 2, z0], cube([t, w, h]));
		default:
			return translate([W / 2 - t + 1, oy + port.at - w / 2, z0], cube([t, w, h]));
	}
}

function box(p: EnclosureParams, L: EnclosureLayout): Node {
	const [W, D, H] = L.outer;
	const r = Math.max(1, p.wall + 1);
	const shell = difference(
		extrude(H, rrect(W, D, r, 32)),
		translate([0, 0, FLOOR], extrude(H, rrect(W - 2 * p.wall, D - 2 * p.wall, r - p.wall, 32)))
	);
	const [ox, oy] = L.origin;
	const b = L.board;
	// Standoffs: a post with a pilot hole for a self-tapping screw.
	const posts = b.holes.map(([x, y]) =>
		translate(
			[ox + x, oy + y, 0],
			cylinder(FLOOR + p.standoff, b.hole * 1.1 + 1.2, b.hole * 1.1 + 1.2, 32)
		)
	);
	const pilots = b.holes.map(([x, y]) =>
		translate(
			[ox + x, oy + y, 1],
			cylinder(FLOOR + p.standoff, (b.hole - 0.5) / 2, (b.hole - 0.5) / 2, 24)
		)
	);
	const ears = p.ears
		? [-1, 1].map((s) =>
				difference(
					translate([s * (W / 2 + 6), 0, 0], extrude(3, rrect(14, Math.min(24, D - 4), 4, 24))),
					translate([s * (W / 2 + 7), 0, -1], cylinder(5, 2.2, 2.2, 24))
				)
			)
		: [];
	return difference(
		union(shell, ...posts, ...ears),
		...pilots,
		...b.ports.map((port) => window(p, L, port))
	);
}

/** The lid, top down: a plate and a lip that presses into the box; slots over the board. */
function lid(p: EnclosureParams, L: EnclosureLayout): Node {
	const [W, D] = L.outer;
	const r = Math.max(1, p.wall + 1);
	const inW = W - 2 * p.wall - 2 * p.clearance;
	const inD = D - 2 * p.wall - 2 * p.clearance;
	const lip = difference(
		extrude(L.lid + LIP, rrect(inW, inD, Math.max(0.5, r - p.wall), 32)),
		translate([0, 0, -1], extrude(L.lid + 6, rrect(inW - 2 * 1.6, inD - 2 * 1.6, 0.5, 16)))
	);
	const plate = extrude(L.lid, rrect(W, D, r, 32));
	const slots: Node[] = [];
	if (p.vents) {
		const n = Math.max(2, Math.floor((L.board.width * 0.6) / 4));
		const len = Math.max(6, L.board.depth * 0.5);
		for (let i = 0; i < n; i++)
			slots.push(
				translate([-((n - 1) * 4) / 2 + i * 4, 0, -1], extrude(L.lid + 2, square(2, len)))
			);
	}
	return difference(union(plate, lip), ...slots);
}

export function enclosureModel(input: EnclosureParams): Node {
	const p = clampEnclosure(input);
	const L = enclosureLayout(p);
	// The lid beside the box, 10 mm apart.
	return union(part('box', box(p, L)), part('lid', translate([0, L.outer[1] + 10, 0], lid(p, L))));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function enclosureSummary(input: EnclosureParams): string {
	const p = clampEnclosure(input);
	const L = enclosureLayout(p);
	const b = L.board;
	const text = m.t_enclosure_summary({
		board: b.label,
		x: mm(L.outer[0]),
		y: mm(L.outer[1]),
		z: mm(L.outer[2] + L.lid),
		screw: mm(b.hole - 0.5)
	});
	if (!b.ports.length) return text;
	const ports = m.t_enclosure_summary_ports({
		ports: listJoin([...new Set(b.ports.map((x) => x.name))], currentLocale())
	});
	return text + sentenceGap(currentLocale()) + ports;
}

export function enclosureHeader(input: EnclosureParams): string[] {
	const p = clampEnclosure(input);
	return [m.t_enclosure_scad_title(), enclosureSummary(p), m.t_enclosure_scad_print()];
}

export function enclosureScad(p: EnclosureParams): string {
	return toScad(enclosureModel(p), enclosureHeader(p));
}
