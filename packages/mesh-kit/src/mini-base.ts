/**
 * Bases for miniatures and figurines: round, oval, square or hex, the edge
 * bevelled the way tabletop bases are, a pocket for a magnet underneath.
 * A hollow base keeps a rim and a boss round the magnet — less plastic.
 * The base lies as it prints: the bottom on the bed.
 */
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { Bin } from './kit.js';

export type BaseShape = 'round' | 'oval' | 'square' | 'hex';

export interface MiniBaseParams {
	shape: BaseShape;
	/** Diameter or side; the length of an oval, mm */
	size: number;
	/** The width of an oval, mm */
	width: number;
	height: number;
	/** How much narrower the top is than the bottom, on each side, mm */
	bevel: number;
	magnet: boolean;
	magnetDiameter: number;
	magnetDepth: number;
	/** Extra width of the magnet pocket, mm */
	clearance: number;
	/** Two magnets along an oval instead of one. */
	twoMagnets: boolean;
	hollow: boolean;
	/** How many bases side by side on the bed. */
	count: number;
}

export const MINI_BASE_DEFAULTS: MiniBaseParams = {
	shape: 'round',
	size: 32,
	width: 35,
	height: 4,
	bevel: 1.2,
	magnet: true,
	magnetDiameter: 8,
	magnetDepth: 2,
	clearance: 0.2,
	twoMagnets: false,
	hollow: false,
	count: 1
};

/** Sizes in common use on tabletop bases (by the millimetre, not by a brand). */
export const MINI_BASE_PRESETS: readonly { id: string; params: Partial<MiniBaseParams> }[] = [
	{ id: 'r25', params: { shape: 'round', size: 25, magnetDiameter: 6 } },
	{ id: 'r32', params: { shape: 'round', size: 32 } },
	{ id: 'r40', params: { shape: 'round', size: 40, magnetDiameter: 10 } },
	{ id: 'r60', params: { shape: 'round', size: 60, hollow: true, magnetDiameter: 10 } },
	{ id: 'o60', params: { shape: 'oval', size: 60, width: 35, twoMagnets: true } },
	{ id: 'o90', params: { shape: 'oval', size: 90, width: 52, hollow: true, twoMagnets: true } },
	{ id: 's25', params: { shape: 'square', size: 25, height: 3, bevel: 0.6 } },
	{ id: 'set', params: { shape: 'round', size: 25, count: 10, magnetDiameter: 6 } }
];

/**
 * `v` kept within [lo, hi]; anything that is not a finite number becomes
 * `lo`. When a derived `hi` falls below `lo`, a number comes out as `hi`.
 */
const c = (v: number, lo: number, hi: number) =>
	Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export function clampMiniBase(p: MiniBaseParams): MiniBaseParams {
	const shapes: BaseShape[] = ['round', 'oval', 'square', 'hex'];
	const size = c(p.size, 10, 200);
	const height = c(p.height, 1.5, 15);
	const magnetDiameter = c(p.magnetDiameter, 2, Math.max(2, size * 0.6));
	return {
		shape: shapes.includes(p.shape) ? p.shape : 'round',
		size,
		width: c(p.width, 10, size),
		height,
		bevel: c(p.bevel, 0, Math.min(height, size / 6)),
		magnet: !!p.magnet,
		magnetDiameter,
		// The floor above the magnet stays at least 0.8 mm.
		magnetDepth: c(p.magnetDepth, 0.5, height - 0.8),
		clearance: c(p.clearance, 0, 0.8),
		twoMagnets: !!p.twoMagnets,
		hollow: !!p.hollow,
		count: Math.round(c(p.count, 1, 30))
	};
}

const FN = 96;

/** Where the magnets go: one in the middle, or two along an oval. */
function magnetSpots(p: MiniBaseParams): [number, number][] {
	if (p.shape === 'oval' && p.twoMagnets) {
		// Towards the ends, where the oval has room; never touching each other.
		const x = Math.max(p.magnetDiameter / 2 + 1, ((p.size - p.width) / 2) * 0.8);
		return [
			[-x, 0],
			[x, 0]
		];
	}
	return [[0, 0]];
}

export interface MiniBaseLayout {
	/** Footprint of one base, mm */
	footprint: [number, number];
	/** Centres of the bases on the bed */
	spots: [number, number][];
}

export function miniBaseLayout(input: MiniBaseParams): MiniBaseLayout {
	const p = clampMiniBase(input);
	const w = p.size;
	const d = p.shape === 'oval' ? p.width : p.size;
	const cols = Math.ceil(Math.sqrt(p.count));
	const gap = 4;
	const spots: [number, number][] = [];
	for (let i = 0; i < p.count; i++) {
		const col = i % cols;
		const row = Math.floor(i / cols);
		spots.push([col * (w + gap), row * (d + gap)]);
	}
	return { footprint: [w, d], spots };
}

/** The base (or the set of bases), as a solid standing on z = 0. */
export function miniBase(wasm: ManifoldToplevel, input: Partial<MiniBaseParams> = {}): Manifold {
	const { CrossSection: CS, Manifold: M } = wasm;
	const p = clampMiniBase({ ...MINI_BASE_DEFAULTS, ...input });
	const bin = new Bin();

	/** The footprint shrunk by `inset` on every side. */
	const outline = (inset: number): CrossSection => {
		const s = p.size - 2 * inset;
		switch (p.shape) {
			case 'oval':
				// A circle stretched to the oval: the inset is exact at the ends and the sides.
				return bin.add(bin.add(CS.circle(s / 2, FN)).scale([1, (p.width - 2 * inset) / s]));
			case 'square':
				return bin.add(CS.square([s, s], true));
			case 'hex':
				// Flats left and right: the size is across them.
				return bin.add(bin.add(CS.circle(s / Math.cos(Math.PI / 6) / 2, 6)).rotate(30));
			default:
				return bin.add(CS.circle(s / 2, FN));
		}
	};
	/** A convex solid whose section goes linearly from `a` at z0 to `b` at z1. */
	const loft = (a: CrossSection, z0: number, b: CrossSection, z1: number) => {
		const at = (cs: CrossSection, z: number) =>
			cs.toPolygons().flatMap((ring) => ring.map(([x, y]) => [x, y, z] as [number, number, number]));
		return bin.add(M.hull([...at(a, z0), ...at(b, z1)]));
	};
	const cylinder = (h: number, r: number, x: number, y: number, z: number) =>
		bin.add(bin.add(M.cylinder(h, r, r, 48)).translate([x, y, z]));

	const body = loft(outline(0), 0, outline(p.bevel), p.height);
	const spots = magnetSpots(p);
	const pocketR = p.magnetDiameter / 2 + p.clearance;
	const pockets = p.magnet
		? spots.map(([x, y]) => cylinder(p.magnetDepth + 0.01, pocketR, x, y, -0.01))
		: [];
	let one: Manifold;
	if (!p.hollow) one = pockets.length ? bin.add(body.subtract(bin.add(M.union(pockets)))) : body;
	else {
		// Hollow: a rim 1.6 mm, the top 1.2 mm, a boss round each magnet.
		const top = 1.2;
		const rim = 1.6;
		const cavity = loft(
			outline(rim),
			-0.01,
			outline(rim + p.bevel * ((p.height - top) / p.height)),
			p.height - top
		);
		const bosses = p.magnet
			? spots.map(([x, y]) => cylinder(p.height, pocketR + 1.6, x, y, 0))
			: [];
		// Two ribs across a wide base halve the top's bridge over the cavity.
		const span = Math.max(p.size, p.shape === 'oval' ? p.width : 0);
		const ribs =
			span > 30
				? [
						bin.add(
							body.intersect(
								bin.add(
									M.union(
										bin.add(bin.add(M.cube([2 * span, 1.2, p.height])).translate([-span, -0.6, 0])),
										bin.add(bin.add(M.cube([1.2, 2 * span, p.height])).translate([-0.6, -span, 0]))
									)
								)
							)
						)
					]
				: [];
		const shell = bin.add(M.union([bin.add(body.subtract(cavity)), ...bosses, ...ribs]));
		one = pockets.length ? bin.add(shell.subtract(bin.add(M.union(pockets)))) : shell;
	}
	const { spots: places } = miniBaseLayout(p);
	const out =
		places.length === 1
			? one.translate([0, 0, 0])
			: M.union(places.map(([x, y]) => bin.add(one.translate([x, y, 0]))));
	bin.free(out);
	return out;
}
