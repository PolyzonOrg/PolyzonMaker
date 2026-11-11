/**
 * «Крючки и держатели»: wall hooks that print lying on their back, without
 * supports. A base plate (screw holes with a 90° countersink, or a flat back
 * for double-sided tape) carries one or more arms. The arm's side profile is
 * rounded: a straight arm out of the wall, a lip rising at 45° at its end
 * (steeper would need support when printed on the back), a 45° gusset under
 * the root and filleted inside corners.
 *
 * Coordinates: x along the wall, y up the wall, z out of the wall — the same
 * as the print, where the back of the plate lies on the bed.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	hull,
	loft,
	offset,
	part,
	polygon,
	rotate,
	rrect,
	square,
	label as lettering,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import * as m from '$msg/tools/hook-generator';
import { num } from '../scad-literals';
import { clamp as c } from '../shared/math';

export type HookKind = 'hook' | 'keys' | 'headphones' | 'tool';
export type Mount = 'screws' | 'tape';

export interface HookParams {
	kind: HookKind;
	/** Arms on the plate (for «tool»: the slots between prongs) */
	count: number;
	/** Width of one arm, mm */
	armWidth: number;
	/** Distance between arms (for «tool»: the slot width), mm */
	gap: number;
	/** How far the arm reaches out of the plate, mm */
	reach: number;
	/** Arm thickness, mm */
	thickness: number;
	/** Length of the 45° lip at the end, mm */
	lip: number;
	plateHeight: number;
	plateThickness: number;
	radius: number;
	mount: Mount;
	screwD: number;
	headD: number;
	label: string;
	labelSize: number;
}

export const HOOK_KIND_DEFAULTS: Record<HookKind, Partial<HookParams>> = {
	hook: { count: 1, armWidth: 18, gap: 20, reach: 34, thickness: 7, lip: 14, plateHeight: 48 },
	keys: { count: 5, armWidth: 8, gap: 17, reach: 24, thickness: 5.5, lip: 9, plateHeight: 36 },
	headphones: {
		count: 1,
		armWidth: 42,
		gap: 20,
		reach: 52,
		thickness: 9,
		lip: 12,
		plateHeight: 64
	},
	tool: { count: 4, armWidth: 9, gap: 13, reach: 42, thickness: 6, lip: 5, plateHeight: 40 }
};

export const HOOK_DEFAULTS: HookParams = {
	kind: 'hook',
	count: 1,
	armWidth: 18,
	gap: 20,
	reach: 34,
	thickness: 7,
	lip: 14,
	plateHeight: 48,
	plateThickness: 5,
	radius: 5,
	mount: 'screws',
	screwD: 4,
	headD: 8,
	label: '',
	labelSize: 7
};

export const HOOK_PRESETS: readonly { id: string; label: string; params: Partial<HookParams> }[] = [
	{
		id: 'coat',
		get label() {
			return m.t_hook_generator_preset_coat();
		},
		params: { kind: 'hook', ...HOOK_KIND_DEFAULTS.hook }
	},
	{
		id: 'keys',
		get label() {
			return m.t_hook_generator_preset_keys();
		},
		params: { kind: 'keys', ...HOOK_KIND_DEFAULTS.keys }
	},
	{
		id: 'cable',
		get label() {
			return m.t_hook_generator_preset_cable();
		},
		params: {
			kind: 'hook',
			count: 1,
			armWidth: 26,
			reach: 48,
			thickness: 8,
			lip: 18,
			plateHeight: 56
		}
	},
	{
		id: 'phones',
		get label() {
			return m.t_hook_generator_preset_phones();
		},
		params: { kind: 'headphones', ...HOOK_KIND_DEFAULTS.headphones }
	},
	{
		id: 'drivers',
		get label() {
			return m.t_hook_generator_preset_drivers();
		},
		params: { kind: 'tool', ...HOOK_KIND_DEFAULTS.tool, count: 6, gap: 8, armWidth: 7 }
	}
];

export function clampHook(p: HookParams): HookParams {
	const kind = (['hook', 'keys', 'headphones', 'tool'] as const).includes(p.kind) ? p.kind : 'hook';
	const thickness = c(p.thickness, 3, 20);
	const screwD = c(p.screwD, 2.5, 8);
	return {
		kind,
		count: Math.round(c(p.count, 1, 12)),
		armWidth: c(p.armWidth, 4, 80),
		gap: c(p.gap, 3, 80),
		reach: c(p.reach, 8, 150),
		thickness,
		lip: c(p.lip, 0, 60),
		plateHeight: c(p.plateHeight, 16, 200),
		plateThickness: c(p.plateThickness, 2.5, 12),
		radius: c(p.radius, 0, 20),
		mount: p.mount === 'tape' ? 'tape' : 'screws',
		screwD,
		headD: c(p.headD, screwD + 1, 16),
		label: (p.label ?? '').trim().slice(0, 30),
		labelSize: c(p.labelSize, 3, 20)
	};
}

const FN = 40;
const SIN45 = Math.SQRT1_2;
/** Front edge chamfer of the plate, mm */
const CHAMFER = 0.8;
const ENGRAVE = 0.6;

export interface HookLayout {
	/** Plate width × height, mm */
	plate: [number, number];
	/** Centre x of every arm */
	arms: number[];
	/** Arm centre line height above the plate bottom */
	armY: number;
	/** Screw holes on the plate, [x, y] */
	holes: [number, number][];
	/** Top of the lip above the plate bottom and its distance from the wall */
	lipTop: [number, number];
}

export function hookLayout(input: HookParams): HookLayout {
	const p = clampHook(input);
	const arms = p.kind === 'tool' ? p.count + 1 : p.count;
	const span = arms * p.armWidth + (arms - 1) * p.gap;
	const side = p.mount === 'screws' ? p.headD + 7 : 5;
	const W = span + 2 * side;
	const gusset = Math.min(p.thickness, p.reach * 0.4);
	const armY = Math.max(p.thickness / 2 + gusset + 3, p.plateHeight * 0.3);
	const H = Math.max(
		p.plateHeight,
		armY + p.thickness / 2 + 4,
		p.mount === 'screws' ? p.headD + 8 : 0
	);
	const xs = Array.from(
		{ length: arms },
		(_, i) => -span / 2 + p.armWidth / 2 + i * (p.armWidth + p.gap)
	);
	// Holes at both ends, beside the arms, where a screwdriver reaches them.
	const hx = W / 2 - side / 2 - 1;
	const holes: [number, number][] =
		p.mount === 'screws'
			? [
					[-hx, H / 2],
					[hx, H / 2]
				]
			: [];
	const lipLen = p.lip;
	return {
		plate: [W, H],
		arms: xs,
		armY,
		holes,
		lipTop: [armY + p.thickness / 2 + lipLen * SIN45, p.plateThickness + p.reach + lipLen * SIN45]
	};
}

/**
 * Side profile of an arm, drawn as (u, v) = (y up the wall, z out of the
 * wall) — the axes rotate([90, 0, 90]) turns into Y and Z.
 */
function armProfile(p: HookParams, L: HookLayout): Node {
	const T = p.thickness;
	const r = T / 2;
	const z0 = p.plateThickness;
	const zEnd = z0 + p.reach - r;
	const y = L.armY;
	const g = Math.min(T, p.reach * 0.4);
	const at = (z: number, yy: number): [number, number] => [yy, z];
	const dot = (z: number, yy: number) => translate(at(z, yy), circle(r, FN));
	// Flat at the back, inside the plate; round at the far end.
	const arm = hull(translate([y - r, 0.5], square(T, 1, false)), dot(zEnd, y));
	const lip = p.lip > 0.5 ? hull(dot(zEnd, y), dot(zEnd + p.lip * SIN45, y + p.lip * SIN45)) : null;
	// 45° under the root: printed on the back, it is a 45° slope.
	const gusset = polygon([
		at(z0 - 0.5, y - r - g - 0.5),
		at(z0 + g, y - r),
		at(z0 + g, y),
		at(z0 - 0.5, y)
	]);
	// A strip inside the plate lets the fillets reach the plate's face.
	const lo = Math.max(CHAMFER + 0.5, y - r - g - 3);
	const hi = Math.min(L.plate[1] - CHAMFER - 0.5, y + r + 4);
	const strip = translate([lo, 0.5], square(hi - lo, z0 - 0.51, false));
	const f = Math.min(2.5, T * 0.4);
	return offset(-f, FN, offset(f, FN, union(arm, lip, gusset, strip)));
}

export function hookModel(input: HookParams): Node {
	const p = clampHook(input);
	const L = hookLayout(p);
	const [W, H] = L.plate;
	const t = p.plateThickness;
	const outline = (inset: number) => rrect(W - 2 * inset, H - 2 * inset, p.radius - inset, FN);
	const plate = translate(
		[0, H / 2, 0],
		loft([
			{ z: 0, shape: outline(0) },
			{ z: t - CHAMFER, shape: outline(0) },
			{ z: t, shape: outline(CHAMFER) }
		])
	);
	// The profile lies in the YZ plane and is extruded along X over the arm width.
	const profile = armProfile(p, L);
	const arms = L.arms.map((x) =>
		translate([x - p.armWidth / 2, 0, 0], rotate([90, 0, 90], extrude(p.armWidth, profile)))
	);
	const holes = L.holes.map(([x, y]) => {
		const sink = (p.headD - p.screwD) / 2;
		return translate(
			[x, y, 0],
			union(
				translate([0, 0, -1], cylinder(t + 2, p.screwD / 2, p.screwD / 2, FN)),
				translate([0, 0, t - sink], cylinder(sink + 0.01, p.screwD / 2, p.headD / 2, FN)),
				translate([0, 0, t], cylinder(1, p.headD / 2, p.headD / 2, FN))
			)
		);
	});
	// The label goes above the arms, engraved into the front face.
	let label: Node | null = null;
	if (p.label) {
		const top = H - 3;
		const bottom = L.armY + p.thickness / 2 + 3;
		const room = top - bottom;
		const holeRoom = p.mount === 'screws' ? W - 2 * (p.headD + 9) : W - 8;
		// «Высота букв» is the capital's; a long word shrinks to the room between the holes.
		const cap = Math.min(p.labelSize, room * 0.5);
		if (Math.min(cap, holeRoom / Math.max(1, p.label.length * 0.86)) >= 2.2)
			label = translate(
				[0, (top + bottom) / 2, t - ENGRAVE],
				extrude(ENGRAVE + 1, lettering(p.label, cap, { fit: holeRoom, valign: 'center' }))
			);
	}
	// Centre the part on the bed.
	return translate(
		[0, -H / 2, 0],
		part('hook', difference(union(plate, ...arms), ...holes, label))
	);
}

const mm = (v: number) => num(v, -1e4, 1e4);

function headerTitle(kind: HookKind): string {
	switch (kind) {
		case 'keys':
			return m.t_hook_generator_header_keys();
		case 'headphones':
			return m.t_hook_generator_header_headphones();
		case 'tool':
			return m.t_hook_generator_header_tool();
		default:
			return m.t_hook_generator_header_hook();
	}
}

export function hookHeader(input: HookParams): string[] {
	const p = clampHook(input);
	const L = hookLayout(p);
	return [
		headerTitle(p.kind),
		m.t_hook_generator_header_size({
			width: mm(L.plate[0]),
			height: mm(L.plate[1]),
			thickness: mm(p.plateThickness),
			reach: mm(p.reach),
			arm: mm(p.thickness)
		}),
		m.t_hook_generator_header_print()
	];
}

export function hookScad(p: HookParams): string {
	return toScad(hookModel(p), hookHeader(p));
}
