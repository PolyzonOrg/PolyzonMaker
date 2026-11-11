/**
 * Soap dishes. «Со сливом»: one piece, the soap rests on ribs above slots
 * in the floor, water runs out underneath — for the edge of a sink or a
 * shower shelf. «С поддоном»: a tray that keeps the water and a grid on
 * short legs that sits in it; the grid prints slats down, legs up. Rounded
 * corners everywhere, nothing to support.
 */
import {
	cube,
	difference,
	extrude,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/soap-dish';
import { clamp as c } from '../shared/math';

export type SoapDishStyle = 'drain' | 'tray';

export interface SoapDishParams {
	style: SoapDishStyle;
	length: number;
	width: number;
	height: number;
	wall: number;
	/** Distance between the ribs (or slats), mm */
	pitch: number;
}

export const SOAP_DISH_DEFAULTS: SoapDishParams = {
	style: 'drain',
	length: 110,
	width: 75,
	height: 18,
	wall: 2.4,
	pitch: 9
};

export interface SoapDishPreset {
	id: string;
	label: string;
	params: Partial<SoapDishParams>;
}

export const SOAP_DISH_PRESETS: readonly SoapDishPreset[] = [
	{
		id: 'drain',
		get label() {
			return m.t_soap_dish_preset_drain();
		},
		params: { style: 'drain' }
	},
	{
		id: 'tray',
		get label() {
			return m.t_soap_dish_preset_tray();
		},
		params: { style: 'tray', height: 20 }
	},
	{
		id: 'small',
		get label() {
			return m.t_soap_dish_preset_small();
		},
		params: { length: 85, width: 60, height: 15 }
	},
	{
		id: 'sponge',
		get label() {
			return m.t_soap_dish_preset_sponge();
		},
		params: { style: 'drain', length: 120, width: 90, height: 22, pitch: 11 }
	}
];

export function clampSoapDish(p: SoapDishParams): SoapDishParams {
	return {
		style: p.style === 'tray' ? 'tray' : 'drain',
		length: c(p.length, 50, 220),
		width: c(p.width, 40, 160),
		height: c(p.height, 10, 50),
		wall: c(p.wall, 1.6, 5),
		pitch: c(p.pitch, 6, 20)
	};
}

const FLOOR = 2;
const RIB = 2.4;

/** Positions across the length, centred, `pitch` apart, inside `room`. */
function spots(room: number, pitch: number): number[] {
	const n = Math.max(1, Math.floor(room / pitch));
	return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * pitch);
}

function shell(L: number, W: number, H: number, wall: number): Node {
	const r = Math.min(10, W * 0.18);
	return difference(
		extrude(H, rrect(L, W, r, 48)),
		translate(
			[0, 0, FLOOR],
			extrude(H, rrect(L - 2 * wall, W - 2 * wall, Math.max(1, r - wall), 48))
		)
	);
}

function drain(p: SoapDishParams): Node {
	const iL = p.length - 2 * p.wall;
	const iW = p.width - 2 * p.wall;
	const body = shell(p.length, p.width, p.height, p.wall);
	const xs = spots(iL - 8, p.pitch);
	const ribH = Math.min(5, p.height - FLOOR - 3);
	const ribs = xs.map((x) =>
		translate([x - RIB / 2, -iW / 2 - 0.01, FLOOR - 0.01], cube([RIB, iW + 0.02, ribH]))
	);
	// Slots between the ribs, through the floor.
	const slots = xs
		.slice(1)
		.map((x) =>
			translate(
				[x - p.pitch / 2, 0, -1],
				extrude(FLOOR + 2, rrect(Math.max(2, p.pitch - RIB - 3), iW - 12, 1, 12))
			)
		);
	return difference(union(body, ...ribs), ...slots);
}

function tray(p: SoapDishParams): Node[] {
	const trayH = Math.max(8, p.height * 0.55);
	const tray = shell(p.length, p.width, trayH, p.wall);
	// The grid: inside the tray with play, slats on a frame, legs to stand on.
	const gL = p.length - 2 * p.wall - 1.2;
	const gW = p.width - 2 * p.wall - 1.2;
	const r = Math.max(1, Math.min(10, p.width * 0.18) - p.wall - 0.6);
	const frame = difference(
		extrude(2.4, rrect(gL, gW, r, 48)),
		translate([0, 0, -1], extrude(5, rrect(gL - 8, gW - 8, Math.max(0.5, r - 4), 48)))
	);
	const slats = spots(gL - 10, p.pitch).map((x) =>
		translate([x - RIB / 2, -gW / 2 + 1, 0], cube([RIB, gW - 2, 2.4]))
	);
	const legH = Math.max(3, trayH - FLOOR - 4);
	// Legs stand on the frame's 4 mm band, past its rounded corners: printed on top of
	// the frame, every layer of them rests on plastic.
	const ly = Math.max(2, gW / 2 - r - 3);
	const legs = [-1, 1].flatMap((sx) =>
		[-1, 1].map((sy) => translate([sx * (gL / 2 - 2), sy * ly, 2.39], extrude(legH, square(4, 4))))
	);
	const grid = union(frame, ...slats, ...legs);
	return [tray, translate([0, p.width + 8, 0], grid)];
}

export function soapDishModel(input: SoapDishParams): Node {
	const p = clampSoapDish(input);
	return p.style === 'tray' ? union(...tray(p)) : drain(p);
}

const mm = (v: number) => num(Math.round(v), 0);

export function soapDishSummary(input: SoapDishParams): string {
	const p = clampSoapDish(input);
	const size = { length: mm(p.length), width: mm(p.width) };
	return p.style === 'tray' ? m.t_soap_dish_summary_tray(size) : m.t_soap_dish_summary_drain(size);
}

export function soapDishHeader(input: SoapDishParams): string[] {
	const p = clampSoapDish(input);
	return [m.t_soap_dish_header_title(), soapDishSummary(p)];
}

export function soapDishScad(p: SoapDishParams): string {
	return toScad(soapDishModel(p), soapDishHeader(p));
}
