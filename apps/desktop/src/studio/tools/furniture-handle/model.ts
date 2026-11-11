/**
 * Furniture handles for the 32 mm system: hole centres 64–320 mm, M4 screws
 * from inside the door into a pilot hole (or a heat-set insert). A straight
 * bar on two posts prints bar down — the face you touch is the smooth bed
 * side; an arch handle prints on its side, so every layer runs along the
 * curve and the handle does not split; its screw holes are teardrops.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	hull,
	intersection,
	rotate,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/furniture-handle';
import { clamp as c } from '../shared/math';

export type HandleStyle = 'bar' | 'arch';
export type HandleScrew = 'm4' | 'insert';

export interface FurnitureHandleParams {
	style: HandleStyle;
	/** Between the screw holes, mm */
	centres: number;
	/** Bar beyond each post, mm */
	overhang: number;
	/** From the door to the outside of the grip, mm */
	projection: number;
	/** Grip width and thickness, mm */
	width: number;
	thickness: number;
	screw: HandleScrew;
	count: number;
}

export const FURNITURE_HANDLE_DEFAULTS: FurnitureHandleParams = {
	style: 'bar',
	centres: 128,
	overhang: 18,
	projection: 32,
	width: 12,
	thickness: 10,
	screw: 'm4',
	count: 1
};

export interface FurnitureHandlePreset {
	id: string;
	label: string;
	params: Partial<FurnitureHandleParams>;
}

export const FURNITURE_HANDLE_PRESETS: readonly FurnitureHandlePreset[] = [
	{
		id: '96',
		get label() {
			return m.t_furniture_handle_preset_bar({ size: 96 });
		},
		params: { centres: 96 }
	},
	{
		id: '128',
		get label() {
			return m.t_furniture_handle_preset_bar({ size: 128 });
		},
		params: { centres: 128 }
	},
	{
		id: '160',
		get label() {
			return m.t_furniture_handle_preset_long({ size: 160 });
		},
		params: { centres: 160, overhang: 24 }
	},
	{
		id: 'arch64',
		get label() {
			return m.t_furniture_handle_preset_arch({ size: 64 });
		},
		params: { style: 'arch', centres: 64, projection: 28, width: 10 }
	},
	{
		id: 'arch96',
		get label() {
			return m.t_furniture_handle_preset_arch({ size: 96 });
		},
		params: { style: 'arch', centres: 96, projection: 30 }
	},
	{
		id: 'set',
		get label() {
			return m.t_furniture_handle_preset_set();
		},
		params: { centres: 96, count: 4 }
	}
];

export function clampFurnitureHandle(p: FurnitureHandleParams): FurnitureHandleParams {
	const width = c(p.width, 8, 30);
	const projection = c(p.projection, 18, 60);
	return {
		style: p.style === 'arch' ? 'arch' : 'bar',
		centres: c(p.centres, 32, 320),
		overhang: c(p.overhang, 0, 60),
		projection,
		width,
		// At least 12 mm stay between the grip and the door for the fingers.
		thickness: c(p.thickness, 6, Math.max(6, Math.min(20, projection - 12))),
		screw: p.screw === 'insert' ? 'insert' : 'm4',
		count: Math.round(c(p.count, 1, 8))
	};
}

/** Pilot for an M4 screw in plastic; a heat-set M4 insert's hole. */
const HOLE = { m4: { d: 3.4, depth: 12 }, insert: { d: 5.6, depth: 9 } } as const;
const POST = 12;

function bar(p: FurnitureHandleParams): Node {
	// The grip reaches past each post's flared foot, however small the overhang.
	const L = p.centres + 2 * Math.max(p.overhang, POST / 2 + 1);
	const grip = extrude(p.thickness, rrect(L, p.width, p.width / 2, 32));
	const h = HOLE[p.screw];
	const posts = [-1, 1].map((s) =>
		translate(
			[(s * p.centres) / 2, 0, p.thickness - 0.01],
			cylinder(p.projection - p.thickness + 0.01, POST / 2 + 1, POST / 2, 48)
		)
	);
	const holes = [-1, 1].map((s) =>
		translate(
			[(s * p.centres) / 2, 0, p.projection - h.depth],
			cylinder(h.depth + 1, h.d / 2, h.d / 2, 32)
		)
	);
	return difference(union(grip, ...posts), ...holes);
}

/** A teardrop hole along −Y from y = 0 (the side the door is on), its point up (+Z). */
function teardropY(x: number, z: number, d: number, depth: number): Node {
	const r = d / 2;
	const drop = hull(circle(r, 32), translate([0, r * Math.SQRT2], square(0.01, 0.01)));
	return translate([x, depth, z], rotate([90, 0, 0], extrude(depth + 1, drop)));
}

function arch(p: FurnitureHandleParams): Node {
	const half = p.centres / 2;
	const t = p.thickness;
	const top = p.projection - t / 2;
	// The circle through both feet and the top of the grip's centre line.
	const R = (half * half + top * top) / (2 * top);
	const cy = top - R;
	const a0 = Math.atan2(-cy, half);
	const pts: Vec2[] = Array.from({ length: 33 }, (_, i) => {
		const a = a0 + ((Math.PI - 2 * a0) * i) / 32;
		return [R * Math.cos(a), cy + R * Math.sin(a)];
	});
	const stroke = union(
		...pts
			.slice(1)
			.map((q, i) =>
				hull(
					translate([pts[i][0], pts[i][1]], circle(t / 2, 24)),
					translate([q[0], q[1]], circle(t / 2, 24))
				)
			)
	);
	const feet = [-1, 1].map((s) => translate([s * half, t * 0.6], rrect(POST + 4, t * 1.2, 2, 16)));
	const profile = intersection(
		union(stroke, ...feet),
		translate([0, p.projection], square(p.centres + 4 * POST, 2 * p.projection))
	);
	const body = extrude(p.width, profile);
	const h = HOLE[p.screw];
	const holes = [-1, 1].map((s) =>
		teardropY(s * half, p.width / 2, h.d, Math.min(h.depth, p.projection - 3))
	);
	return difference(body, ...holes);
}

function handle(p: FurnitureHandleParams): Node {
	return p.style === 'arch' ? arch(p) : bar(p);
}

export function furnitureHandleModel(input: FurnitureHandleParams): Node {
	const p = clampFurnitureHandle(input);
	const one = handle(p);
	const pitch = p.style === 'arch' ? p.projection + 8 : p.width + POST + 8;
	return union(...Array.from({ length: p.count }, (_, i) => translate([0, i * pitch, 0], one)));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function furnitureHandleSummary(input: FurnitureHandleParams): string {
	const p = clampFurnitureHandle(input);
	const values = {
		count: p.count,
		n: num(p.count),
		centres: mm(p.centres),
		projection: mm(p.projection)
	};
	const handles =
		p.screw === 'insert'
			? m.t_furniture_handle_summary_insert(values)
			: m.t_furniture_handle_summary_m4(values);
	const print =
		p.style === 'arch' ? m.t_furniture_handle_print_side() : m.t_furniture_handle_print_face_down();
	return handles + sentenceGap(currentLocale()) + print;
}

export function furnitureHandleHeader(input: FurnitureHandleParams): string[] {
	const p = clampFurnitureHandle(input);
	return [m.t_furniture_handle_scad_title(), furnitureHandleSummary(p)];
}

export function furnitureHandleScad(p: FurnitureHandleParams): string {
	return toScad(furnitureHandleModel(p), furnitureHandleHeader(p));
}
