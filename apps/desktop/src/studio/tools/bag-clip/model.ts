/**
 * A clip for an open bag: a rod and a C-shaped sleeve. Fold the bag's top
 * over the rod, press the sleeve on — its mouth is narrower than the rod,
 * so it snaps over and holds; a tab at the end pulls it off. Both lie flat
 * on the bed (the rod has a flat, the sleeve's mouth is up).
 */
import {
	circle,
	difference,
	extrude,
	part,
	rotate,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/bag-clip';
import { clamp as c } from '../shared/math';

export interface BagClipParams {
	length: number;
	/** Rod diameter, mm */
	rod: number;
	/** Room for the folded bag between rod and sleeve, mm */
	bag: number;
	wall: number;
	count: number;
}

export const BAG_CLIP_DEFAULTS: BagClipParams = {
	length: 120,
	rod: 8,
	bag: 0.5,
	wall: 2,
	count: 1
};

export interface BagClipPreset {
	id: string;
	label: string;
	params: Partial<BagClipParams>;
}

export const BAG_CLIP_PRESETS: readonly BagClipPreset[] = [
	{
		id: 'chips',
		get label() {
			return m.t_bag_clip_preset_chips();
		},
		params: { length: 120 }
	},
	{
		id: 'coffee',
		get label() {
			return m.t_bag_clip_preset_coffee();
		},
		params: { length: 90, bag: 0.6 }
	},
	{
		id: 'freezer',
		get label() {
			return m.t_bag_clip_preset_freezer();
		},
		params: { length: 160, rod: 10, bag: 0.4 }
	},
	{
		id: 'set',
		get label() {
			return m.t_bag_clip_preset_set();
		},
		params: { length: 100, count: 4 }
	}
];

export function clampBagClip(p: BagClipParams): BagClipParams {
	return {
		length: c(p.length, 40, 300),
		rod: c(p.rod, 5, 16),
		bag: c(p.bag, 0.2, 2),
		wall: c(p.wall, 1.4, 4),
		count: Math.round(c(p.count, 1, 8))
	};
}

/** The sleeve's mouth: narrower than the rod by a fifth, so it snaps. */
export const mouthOf = (p: BagClipParams) => p.rod * 0.78;
const FLAT = 0.6;
const FN = 64;

/** The rod's section: a circle with a flat underneath to lie on. */
function rodSection(p: BagClipParams): Node {
	const r = p.rod / 2;
	return difference(circle(r, FN), translate([0, -r - 5 + FLAT], square(2 * r + 2, 10)));
}

/** The sleeve's section, mouth up, a flat underneath. */
function sleeveSection(p: BagClipParams): Node {
	const ri = p.rod / 2 + p.bag;
	const ro = ri + p.wall;
	const ring = difference(circle(ro, FN), circle(ri, FN));
	const mouth = translate([0, ro], square(mouthOf(p), 2 * p.wall + 2));
	const flat = translate([0, -ro - 5 + FLAT], square(2 * ro + 2, 10));
	return difference(ring, mouth, flat);
}

/** Both lie along X; each section's flat sits on the bed. */
function lying(section: Node, length: number, lift: number): Node {
	return translate([0, 0, lift], rotate([90, 0, 90], extrude(length, section)));
}

function clip(p: BagClipParams): Node {
	const r = p.rod / 2;
	const ro = r + p.bag + p.wall;
	const rod = lying(rodSection(p), p.length, r - FLAT);
	// The sleeve is a little shorter; a tab at one end to pull it off by.
	const sleeveLen = p.length - 6;
	const tab = translate(
		[sleeveLen - 0.01, -ro, 0],
		extrude(2.4, translate([7, ro], square(14, 2 * ro)))
	);
	const sleeve = translate(
		[3, 2 * ro + 6 + r, 0],
		union(lying(sleeveSection(p), sleeveLen, ro - FLAT), tab)
	);
	return union(part('rod', rod), part('sleeve', sleeve));
}

export function bagClipModel(input: BagClipParams): Node {
	const p = clampBagClip(input);
	const one = clip(p);
	if (p.count === 1) return one;
	const row = 2 * (p.rod / 2 + p.bag + p.wall) + p.rod + 12;
	return union(...Array.from({ length: p.count }, (_, i) => translate([0, i * row * 1.2, 0], one)));
}

export function bagClipSummary(input: BagClipParams): string {
	const p = clampBagClip(input);
	return m.t_bag_clip_summary({
		length: num(p.length, 4),
		mouth: num(Math.round(mouthOf(p) * 10) / 10, 4),
		rod: num(p.rod, 4)
	});
}

export function bagClipHeader(input: BagClipParams): string[] {
	const p = clampBagClip(input);
	return [m.t_bag_clip_scad_title(), bagClipSummary(p), m.t_bag_clip_scad_flat()];
}

export function bagClipScad(p: BagClipParams): string {
	return toScad(bagClipModel(p), bagClipHeader(p));
}
