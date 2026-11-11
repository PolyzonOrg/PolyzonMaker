/**
 * Flat shapes in manifold-3d (CrossSection: Clipper2 offsets and booleans)
 * and the solids extruded from them. OpenSCAD's CGAL needs 10–20 s even for
 * a three-letter sign in the browser; the same work here takes milliseconds.
 * Pure (the WASM module is passed in), so the tests load manifold-3d in node.
 *
 * WASM objects are not garbage-collected: every one a build makes goes
 * through `keep()` and is freed by `free()` at the end of the build.
 */
import type { CrossSection, FillRule, Manifold, ManifoldToplevel } from 'manifold-3d';
import { growApart } from './bold';
import { CAP_HEIGHT, WEIGHTS, type Weight } from './glyphs';
import { ringArea, ringsBounds, type Point, type Ring } from './trace';

export type Wasm = ManifoldToplevel;

export interface Kit {
	wasm: Wasm;
	keep<T extends { delete(): void }>(x: T): T;
	free(): void;
}

export function createKit(wasm: Wasm): Kit {
	const owned: { delete(): void }[] = [];
	return {
		wasm,
		keep(x) {
			owned.push(x);
			return x;
		},
		free() {
			for (const x of owned.splice(0))
				try {
					x.delete();
				} catch {
					/* already freed */
				}
		}
	};
}

export function toSection(
	kit: Kit,
	rings: readonly Ring[],
	fill: FillRule = 'EvenOdd'
): CrossSection {
	// An empty list would be read as one empty polygon and fail.
	return kit.keep(new kit.wasm.CrossSection(rings.length ? (rings as Point[][]) : [[]], fill));
}

export function ringsOf(cs: CrossSection): Ring[] {
	return cs.toPolygons();
}

/** The shape with its holes filled (outer contours only). */
export function fillHoles(kit: Kit, cs: CrossSection): CrossSection {
	const outer = ringsOf(cs).filter((r) => ringArea(r) > 0);
	return toSection(kit, outer, 'Positive');
}

export function offset(
	kit: Kit,
	cs: CrossSection,
	delta: number,
	join: 'Round' | 'Miter' = 'Round'
) {
	if (delta === 0) return cs;
	return kit.keep(cs.offset(delta, join, 2, 48));
}

/** Morphological closing: fills gaps and inner corners narrower than 2r. */
export function closing(kit: Kit, cs: CrossSection, r: number): CrossSection {
	return r > 0 ? offset(kit, offset(kit, cs, r), -r) : cs;
}

/** Rectangle [x0, x1] × [y0, y1]. */
export function rect(kit: Kit, x0: number, y0: number, x1: number, y1: number): CrossSection {
	return toSection(
		kit,
		[
			[
				[x0, y0],
				[x1, y0],
				[x1, y1],
				[x0, y1]
			]
		],
		'Positive'
	);
}

/** A solid from z0 to z1 with this cross-section. */
export function slab(kit: Kit, cs: CrossSection, z0: number, z1: number): Manifold {
	const solid = kit.keep(cs.extrude(Math.max(1e-3, z1 - z0)));
	return z0 === 0 ? solid : kit.keep(solid.translate([0, 0, z0]));
}

export function union(kit: Kit, parts: readonly Manifold[]): Manifold {
	return parts.length === 1 ? parts[0] : kit.keep(kit.wasm.Manifold.union(parts as Manifold[]));
}

export function unionSections(kit: Kit, parts: readonly CrossSection[]): CrossSection {
	return parts.length === 1
		? parts[0]
		: kit.keep(kit.wasm.CrossSection.union(parts as CrossSection[]));
}

/** Scaled to `size` mm — its height or its larger side — and centred. */
export function fitSection(kit: Kit, cs: CrossSection, size: number, by: 'height' | 'max' = 'max') {
	const { min, max } = cs.bounds();
	const span = by === 'height' ? max[1] - min[1] : Math.max(max[0] - min[0], max[1] - min[1]);
	if (!(span > 0)) return cs;
	const moved = kit.keep(cs.translate([-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2]));
	return kit.keep(moved.scale(size / span));
}

/**
 * Glyph outlines (at GLYPH_SIZE) scaled so a capital letter is `cap` mm
 * tall, then made heavier by the chosen weight.
 */
export function glyphSection(kit: Kit, rings: readonly Ring[], cap: number, weight: Weight) {
	const k = cap / CAP_HEIGHT;
	const cs = toSection(
		kit,
		rings.map((r) => r.map(([x, y]) => [x * k, y * k] as Point))
	);
	const grow = WEIGHTS[weight] * cap;
	return grow > 0 ? kit.keep(growApart(cs, grow, grow, 'Miter', 48)) : cs;
}

/** Triangle soup of a solid (positions only). */
export { fromManifold as trianglesOf } from '../solid';

/**
 * A point well inside an even-odd region: the middle of the widest span on
 * a horizontal line through the middle of its bounds (then at ⅓ and ⅔).
 */
export function interiorPoint(rings: readonly Ring[]): Point | null {
	const b = ringsBounds(rings);
	for (const f of [0.5, 0.37, 0.63, 0.25, 0.75]) {
		const y = b.minY + (b.maxY - b.minY) * f + 1e-6;
		const xs: number[] = [];
		for (const r of rings)
			for (let i = 0; i < r.length; i++) {
				const [x1, y1] = r[i];
				const [x2, y2] = r[(i + 1) % r.length];
				if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
			}
		xs.sort((a, c) => a - c);
		let best: Point | null = null;
		let width = 0;
		for (let i = 0; i + 1 < xs.length; i += 2)
			if (xs[i + 1] - xs[i] > width) {
				width = xs[i + 1] - xs[i];
				best = [(xs[i] + xs[i + 1]) / 2, y];
			}
		if (best) return best;
	}
	return null;
}
