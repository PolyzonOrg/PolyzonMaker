/**
 * A pair of involute gears that mesh: spur, helical or herringbone. The
 * pair is laid out at its centre distance, teeth in mesh, as a preview of
 * the drive — each gear is a body of its own, printable as it lies.
 * Helical teeth are a turning extrusion; a herringbone is two halves turning
 * opposite ways (no axial thrust, prints without supports).
 */
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/gear-generator';
import {
	circle,
	cylinder,
	difference,
	extrude,
	part,
	polygon,
	rotate,
	square,
	toScad,
	translate,
	twistExtrude,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { clamp as c } from '../shared/math';

export type GearKind = 'spur' | 'helical' | 'herringbone';
export type GearShow = 'pair' | 'first' | 'second';
export type BoreShape = 'round' | 'dflat' | 'hex';

export interface GearParams {
	kind: GearKind;
	show: GearShow;
	/** Normal module, mm: tooth size (pitch diameter = module × teeth) */
	module: number;
	teeth1: number;
	teeth2: number;
	thickness: number;
	pressureAngle: number;
	/** Helix angle of helical and herringbone teeth, ° */
	helix: number;
	/** Taken off each tooth's thickness at the pitch circle, mm */
	backlash: number;
	bore1: number;
	bore2: number;
	boreShape: BoreShape;
	/** Hub above the gear: diameter as a share of the root circle, height in mm (0 — none) */
	hub: number;
	/** Round windows in the web of big gears. */
	lighten: boolean;
}

export const GEAR_DEFAULTS: GearParams = {
	kind: 'spur',
	show: 'pair',
	module: 2,
	teeth1: 15,
	teeth2: 30,
	thickness: 8,
	pressureAngle: 20,
	helix: 20,
	backlash: 0.15,
	bore1: 5,
	bore2: 8,
	boreShape: 'round',
	hub: 4,
	lighten: true
};

export interface GearPreset {
	id: string;
	label: string;
	params: Partial<GearParams>;
}

export const GEAR_PRESETS: readonly GearPreset[] = [
	{
		id: 'reduce',
		get label() {
			return m.t_gear_generator_preset_reduce();
		},
		params: { kind: 'spur', module: 2, teeth1: 15, teeth2: 30 }
	},
	{
		id: 'herring',
		get label() {
			return m.t_gear_generator_preset_herringbone();
		},
		params: { kind: 'herringbone', module: 2, teeth1: 18, teeth2: 36, thickness: 12, helix: 25 }
	},
	{
		id: 'motor',
		get label() {
			return m.t_gear_generator_preset_motor();
		},
		params: {
			kind: 'spur',
			module: 0.8,
			teeth1: 12,
			teeth2: 40,
			thickness: 6,
			bore1: 3,
			boreShape: 'dflat',
			bore2: 4
		}
	},
	{
		id: 'big',
		get label() {
			return m.t_gear_generator_preset_big();
		},
		params: { kind: 'helical', module: 3, teeth1: 20, teeth2: 20, thickness: 15, helix: 15 }
	}
];

export function clampGear(p: GearParams): GearParams {
	const kinds: GearKind[] = ['spur', 'helical', 'herringbone'];
	const shows: GearShow[] = ['pair', 'first', 'second'];
	const shapes: BoreShape[] = ['round', 'dflat', 'hex'];
	const module = c(p.module, 0.5, 8);
	return {
		kind: kinds.includes(p.kind) ? p.kind : 'spur',
		show: shows.includes(p.show) ? p.show : 'pair',
		module,
		teeth1: Math.round(c(p.teeth1, 8, 150)),
		teeth2: Math.round(c(p.teeth2, 8, 150)),
		thickness: c(p.thickness, 2, 80),
		pressureAngle: c(p.pressureAngle, 14.5, 25),
		helix: c(p.helix, 5, 45),
		backlash: c(p.backlash, 0, 1),
		bore1: c(p.bore1, 0, 100),
		bore2: c(p.bore2, 0, 100),
		boreShape: shapes.includes(p.boreShape) ? p.boreShape : 'round',
		hub: c(p.hub, 0, 40),
		lighten: !!p.lighten
	};
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Transverse module and pressure angle: helical teeth are cut in the normal plane. */
function transverse(p: GearParams): { mt: number; at: number; beta: number } {
	const beta = p.kind === 'spur' ? 0 : rad(p.helix);
	return {
		mt: p.module / Math.cos(beta),
		at: Math.atan(Math.tan(rad(p.pressureAngle)) / Math.cos(beta)),
		beta
	};
}

export interface GearInfo {
	pitch: [number, number];
	tip: [number, number];
	root: [number, number];
	/** Centre distance of the pair, mm */
	distance: number;
	ratio: number;
}

export function gearInfo(input: GearParams): GearInfo {
	const p = clampGear(input);
	const { mt } = transverse(p);
	const pitch: [number, number] = [mt * p.teeth1, mt * p.teeth2];
	return {
		pitch,
		tip: [pitch[0] + 2 * p.module, pitch[1] + 2 * p.module],
		root: [pitch[0] - 2.5 * p.module, pitch[1] - 2.5 * p.module],
		distance: (pitch[0] + pitch[1]) / 2,
		ratio: p.teeth2 / p.teeth1
	};
}

/** One tooth round +X, from the root circle out: the two involute flanks. */
function tooth(p: GearParams, z: number): Vec2[] {
	const { mt, at } = transverse(p);
	const r = (mt * z) / 2;
	const rb = r * Math.cos(at);
	const ra = r + p.module;
	const rf = r - 1.25 * p.module;
	// Half the tooth's angle at the base circle, less half the backlash.
	const half = Math.PI / (2 * z) + (Math.tan(at) - at) - p.backlash / 2 / r;
	const tAt = (rr: number) => Math.sqrt(Math.max(0, (rr / rb) ** 2 - 1));
	const t0 = tAt(Math.max(rb, rf));
	const t1 = tAt(ra);
	const steps = 10;
	const flank: Vec2[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = t0 + ((t1 - t0) * i) / steps;
		const rr = rb * Math.sqrt(1 + t * t);
		const a = t - Math.atan(t) - half;
		flank.push([rr * Math.cos(a), rr * Math.sin(a)]);
	}
	const root = (sign: number): Vec2 => [
		(rf - 0.5) * Math.cos(sign * half),
		(rf - 0.5) * Math.sin(sign * half)
	];
	return [root(-1), ...flank, ...flank.reverse().map(([x, y]): Vec2 => [x, -y]), root(1)];
}

function gearOutline(p: GearParams, z: number): Node {
	const rf = (transverse(p).mt * z) / 2 - 1.25 * p.module;
	return union(
		circle(rf, Math.max(48, z * 4)),
		...Array.from({ length: z }, (_, i) => rotate([0, 0, (360 * i) / z], polygon(tooth(p, z))))
	);
}

function bore(p: GearParams, d: number, h: number): Node | null {
	if (d <= 0) return null;
	let shape: Node;
	// The same 0.2 mm of play as the round bores, across the flats.
	if (p.boreShape === 'hex') shape = circle((d + 0.2) / Math.cos(Math.PI / 6) / 2, 6);
	else if (p.boreShape === 'dflat')
		// A D: the flat at 0.8 of the diameter, as on small motor shafts.
		shape = difference(
			circle(d / 2 + 0.1, 40),
			translate([0.3 * d + 0.1, -d], square(d, 2 * d, false))
		);
	else shape = circle(d / 2 + 0.1, 40);
	return translate([0, 0, -1], extrude(h + 2, shape));
}

/** Gear `which` at the origin, standing on the bed; `hand` turns its helix. */
function gear(p: GearParams, z: number, asked: number, hand: 1 | -1): Node {
	const { beta } = transverse(p);
	const r = (transverse(p).mt * z) / 2;
	// A bore wider than the root circle would cut the gear away: 1.5 mm of rim stays.
	const d = Math.min(asked, 2 * (r - 1.25 * p.module - 1.5));
	const outline = gearOutline(p, z);
	const b = p.thickness;
	// Over the full width the teeth turn by b·tan β along the pitch circle.
	const twist = deg((b * Math.tan(beta)) / r) * hand;
	let body: Node;
	if (p.kind === 'spur') body = extrude(b, outline);
	else if (p.kind === 'helical')
		body = twistExtrude(b, twist, Math.ceil(Math.abs(twist) / 2) + 2, outline);
	else {
		const halfTwist = twist / 2;
		const slices = Math.ceil(Math.abs(halfTwist) / 2) + 2;
		// The halves overlap by 0.01 mm: by less, the oppositely twisted teeth
		// crossed in corners under a micron apart, which checkers read as broken.
		body = union(
			twistExtrude(b / 2, halfTwist, slices, outline),
			translate(
				[0, 0, b / 2 - 0.01],
				rotate([0, 0, halfTwist], twistExtrude(b / 2 + 0.01, -halfTwist, slices, outline))
			)
		);
	}
	const rf = r - 1.25 * p.module;
	const hubR = Math.min(rf - 1.5, Math.max(d / 2 + 3, d * 0.9 + 2));
	const hub =
		p.hub > 0 && hubR > d / 2 + 1
			? translate([0, 0, b - 0.01], cylinder(p.hub + 0.01, hubR, hubR, 48))
			: null;
	// Windows between the hub and the rim when there is room for them.
	const inner = hubR + 2;
	const outer = rf - Math.max(2.5, p.module * 1.5);
	const windows =
		p.lighten && outer - inner > 6
			? Array.from({ length: 5 }, (_, i) => {
					const a = (2 * Math.PI * i) / 5 + Math.PI / 5;
					const w = (outer - inner) / 2;
					const mid = (outer + inner) / 2;
					const size = Math.min(w, mid * Math.sin(Math.PI / 5) - 2);
					return size > 2
						? translate([mid * Math.cos(a), mid * Math.sin(a), -1], cylinder(b + 2, size, size, 32))
						: null;
				})
			: [];
	return difference(union(body, hub), bore(p, d, b + p.hub), ...windows);
}

export function gearModel(input: GearParams): Node {
	const p = clampGear(input);
	const info = gearInfo(p);
	const first = gear(p, p.teeth1, p.bore1, 1);
	// The second turns the other way; a gap of its own faces the first's tooth.
	const second = rotate([0, 0, 180 - 180 / p.teeth2], gear(p, p.teeth2, p.bore2, -1));
	if (p.show === 'first') return part('gear1', first);
	if (p.show === 'second') return part('gear2', second);
	return union(part('gear1', first), part('gear2', translate([info.distance, 0, 0], second)));
}

/**
 * What goes to the printer: the pair in mesh is only a backlash apart, which
 * a slicer fuses, so a pair is laid out with room between the tips.
 */
export function gearPrintModel(input: GearParams): Node {
	const p = clampGear(input);
	if (p.show !== 'pair') return gearModel(p);
	const { tip } = gearInfo(p);
	return union(
		gearModel({ ...p, show: 'first' }),
		translate([(tip[0] + tip[1]) / 2 + 5, 0, 0], gearModel({ ...p, show: 'second' }))
	);
}

const mm = (v: number) => num(v, 4);

export function gearHeader(input: GearParams): string[] {
	const p = clampGear(input);
	const info = gearInfo(p);
	const kind =
		p.kind === 'spur'
			? m.t_gear_generator_scad_kind_spur()
			: p.kind === 'helical'
				? m.t_gear_generator_scad_kind_helical({ angle: mm(p.helix) })
				: m.t_gear_generator_scad_kind_herringbone({ angle: mm(p.helix) });
	return [
		m.t_gear_generator_scad_title({
			count: p.teeth2,
			n: num(p.teeth2),
			module: mm(p.module),
			teeth1: num(p.teeth1),
			kind
		}),
		m.t_gear_generator_scad_distance({
			distance: mm(info.distance),
			ratio: mm(Math.round(info.ratio * 100) / 100)
		}),
		m.t_gear_generator_scad_print()
	];
}

export function gearScad(p: GearParams): string {
	return toScad(gearModel(p), gearHeader(p));
}

export function gearSummary(input: GearParams): string {
	const p = clampGear(input);
	const info = gearInfo(p);
	return m.t_gear_generator_summary({
		distance: mm(Math.round(info.distance * 100) / 100),
		ratio: mm(Math.round(info.ratio * 100) / 100),
		tip1: mm(Math.round(info.tip[0] * 10) / 10),
		tip2: mm(Math.round(info.tip[1] * 10) / 10)
	});
}
