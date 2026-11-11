/**
 * A stand for a phone, a tablet or an e-reader: a base, a front lip that
 * holds the device's bottom edge, a back rest at the chosen angle and a
 * rear leg that makes a triangle of it. With the cable option the device
 * stands on a shelf SEAT mm up: a straight charger plug goes down through a
 * window in it, and the cable runs back through a channel under the rest.
 * Prints on its side: the side profile is on the bed, every layer holds the
 * whole triangle — it does not snap.
 */
import {
	circle,
	difference,
	extrude,
	hull,
	polygon,
	toScad,
	translate,
	union,
	cube,
	type Node,
	type Vec2
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/phone-stand';
import { clamp as c } from '../shared/math';

export interface PhoneStandParams {
	/** Back rest from the table, degrees */
	angle: number;
	/** Device with its case, mm */
	device: number;
	lip: number;
	/** Height of the back rest, mm */
	height: number;
	width: number;
	thickness: number;
	cable: boolean;
}

export const PHONE_STAND_DEFAULTS: PhoneStandParams = {
	angle: 65,
	device: 12,
	lip: 10,
	height: 85,
	width: 70,
	thickness: 4,
	cable: true
};

export interface PhoneStandPreset {
	id: string;
	label: string;
	params: Partial<PhoneStandParams>;
}

export const PHONE_STAND_PRESETS: readonly PhoneStandPreset[] = [
	{
		id: 'phone',
		get label() {
			return m.t_phone_stand_preset_phone();
		},
		params: {}
	},
	{
		id: 'video',
		get label() {
			return m.t_phone_stand_preset_video();
		},
		params: { angle: 75, height: 55, width: 60, lip: 8 }
	},
	{
		id: 'tablet',
		get label() {
			return m.t_phone_stand_preset_tablet();
		},
		params: { angle: 60, device: 14, height: 120, width: 120, thickness: 5, lip: 12 }
	},
	{
		id: 'reader',
		get label() {
			return m.t_phone_stand_preset_reader();
		},
		params: { angle: 55, device: 11, height: 100, width: 90 }
	}
];

export function clampPhoneStand(p: PhoneStandParams): PhoneStandParams {
	return {
		angle: c(p.angle, 45, 85),
		device: c(p.device, 5, 30),
		lip: c(p.lip, 4, 30),
		height: c(p.height, 40, 200),
		width: c(p.width, 30, 200),
		thickness: c(p.thickness, 2.4, 8),
		cable: !!p.cable
	};
}

/** How high the device stands with the cable option: room for a plug up to PLUG mm under it. */
export const SEAT = 26;
const PLUG = 22;

export interface PhoneStandLayout {
	/** Where the device's back meets the base, and the top of the back rest's front face */
	foot: Vec2;
	top: Vec2;
	/** Base depth front to back, mm */
	depth: number;
}

export function phoneStandLayout(input: PhoneStandParams): PhoneStandLayout {
	const p = clampPhoneStand(input);
	const T = p.thickness;
	const a = (p.angle * Math.PI) / 180;
	const foot: Vec2 = [T + p.device, T + (p.cable ? SEAT : 0)];
	const L = p.height / Math.sin(a);
	const top: Vec2 = [foot[0] + L * Math.cos(a), foot[1] + L * Math.sin(a)];
	// The leg comes down behind the rest; the base runs a little past it.
	const depth = Math.max(top[0] + 0.45 * p.height, foot[0] + 30);
	return { foot, top, depth };
}

/** A stroke between two points, `w` thick, round ends. */
const stroke = (a: Vec2, b: Vec2, w: number): Node =>
	hull(translate([a[0], a[1]], circle(w / 2, 32)), translate([b[0], b[1]], circle(w / 2, 32)));

function profile(p: PhoneStandParams): Node {
	const T = p.thickness;
	const { foot, top, depth } = phoneStandLayout(p);
	const a = (p.angle * Math.PI) / 180;
	const n: Vec2 = [Math.sin(a) * T, -Math.cos(a) * T];
	const base = polygon([
		[0, 0],
		[depth, 0],
		[depth, T],
		[0, T]
	]);
	const seat = foot[1] - T;
	const lip = polygon([
		[0, 0],
		[T, 0],
		[T, seat + p.lip + T],
		[0, seat + p.lip + T]
	]);
	// With the cable option: the shelf the device stands on, and the wall under the rest.
	const shelf =
		seat > 0 &&
		union(
			polygon([
				[0, seat],
				[foot[0] + T, seat],
				[foot[0] + T, seat + T],
				[0, seat + T]
			]),
			polygon([
				[foot[0], 0],
				[foot[0] + T, 0],
				[foot[0] + T, seat + T],
				[foot[0], seat + T]
			])
		);
	const rest = polygon([
		foot,
		top,
		[top[0] + n[0], top[1] + n[1]],
		[foot[0] + n[0] + T, foot[1] + n[1]]
	]);
	const backTop: Vec2 = [top[0] + n[0] / 2, top[1] + n[1] / 2];
	const leg = stroke(backTop, [depth - T / 2, T / 2], T);
	// Round the top of the rest, where the device leans.
	const cap = translate([backTop[0], backTop[1]], circle(T / 2, 32));
	return union(
		base,
		lip,
		shelf,
		rest,
		leg,
		cap,
		translate([T / 2, seat + p.lip + T], circle(T / 2, 32))
	);
}

export function phoneStandModel(input: PhoneStandParams): Node {
	const p = clampPhoneStand(input);
	const T = p.thickness;
	const { foot, depth } = phoneStandLayout(p);
	const body = extrude(p.width, profile(p));
	if (!p.cable) return body;
	// The profile is X (front → back) by Y (up); the width runs along Z.
	const mid = p.width / 2;
	// The plug goes down through the shelf, the cable back through the wall and the leg.
	const window = translate([T - 1, SEAT - 1, mid - 7], cube([p.device + 3, T + 2, 14]));
	const channel = translate([foot[0] - 1, T, mid - 5], cube([depth, 9, 10]));
	return difference(body, window, channel);
}

const mm = (v: number) => num(Math.round(v), 0);

export function phoneStandSummary(input: PhoneStandParams): string {
	const p = clampPhoneStand(input);
	const { depth } = phoneStandLayout(p);
	return [
		m.t_phone_stand_summary({
			angle: mm(p.angle),
			gap: num(p.device, 4),
			depth: mm(depth),
			width: mm(p.width)
		}),
		p.cable && m.t_phone_stand_summary_cable({ plug: num(PLUG) })
	]
		.filter(Boolean)
		.join(sentenceGap(currentLocale()));
}

export function phoneStandHeader(input: PhoneStandParams): string[] {
	const p = clampPhoneStand(input);
	return [m.t_phone_stand_scad_title(), phoneStandSummary(p)];
}

export function phoneStandScad(p: PhoneStandParams): string {
	return toScad(phoneStandModel(p), phoneStandHeader(p));
}
