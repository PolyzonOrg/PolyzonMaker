/**
 * «Полая модель и шкатулка». The cavity is manifold's `levelSet` over the
 * signed distance to the model's surface: the region more than `wall` mm
 * inside. Subtracting it leaves a shell of that thickness; a drain hole at
 * the bottom lets resin out. The box («шкатулка») cuts the shell by a plane
 * into a lid and a base and adds one of two fits:
 *
 * - «Пластина»: a plate welded into the lid's opening closes it and
 *   stands `plate` mm proud; the base gets a matching recess around its rim,
 *   `clearance` wider, so the lid drops in and stays centred;
 * - «Бортик»: a lip rises from the inner half of the base's wall, the lid's
 *   inner half is cut back to take it.
 *
 * Pure geometry on manifold objects; the worker and the tests feed it.
 */
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import type { Bounds, Triangles } from '../stl';
import { Bin, prism, segments } from '../booleans/kit';
import { planeFrame, type Plane } from '../booleans/plane';
import { deepestPoint } from '../booleans/section';
import { meshSdf } from '../booleans/sdf';
import * as m from '$msg/tools/stl-hollow';

export type HollowMode = 'hollow' | 'box';
export type Detail = 'standard' | 'high';
export type LidFit = 'plate' | 'lip';

export interface HollowParams {
	mode: HollowMode;
	/** Shell thickness, mm */
	wall: number;
	detail: Detail;
	drain: boolean;
	drainDiameter: number;
	lid: 'plus' | 'minus';
	fit: LidFit;
	/** Plate thickness, mm */
	plate: number;
	/** Recess depth, mm; 0 = plate + 0.5 */
	groove: number;
	/** How far the plate reaches under the lid's wall, mm */
	weld: number;
	/** Lip height, mm */
	lip: number;
	clearance: number;
}

/**
 * A 2.4 mm wall is six perimeters of a 0.4 mm nozzle: stiff enough for a
 * box. The plate is five layers of 0.4; the recess leaves 0.5 mm under it;
 * 0.25 mm all round lets a printed lid drop in without sanding.
 */
export const HOLLOW_DEFAULTS: HollowParams = {
	mode: 'hollow',
	wall: 2.4,
	detail: 'standard',
	drain: false,
	drainDiameter: 4,
	lid: 'plus',
	fit: 'plate',
	plate: 2,
	groove: 0,
	weld: 1.2,
	lip: 2,
	clearance: 0.25
};

/** Thinnest wall left beside a recess, mm. */
const MIN_WALL = 0.8;

/**
 * Grid step of the cavity: fine enough for the model, but no more than about
 * 1.5 M (standard) or 4 M (high) distance samples.
 */
export function cavityEdge(b: Bounds, wall: number, detail: Detail): number {
	const volume = Math.max(1, b.size[0] * b.size[1] * b.size[2]);
	const budget = detail === 'high' ? 2.5e6 : 0.8e6;
	// The cavity is inside: its facets can be a third (a fifth) of the wall.
	const fine = detail === 'high' ? Math.max(0.25, wall / 5) : Math.max(0.4, wall / 3);
	return Math.max(fine, Math.cbrt((2 * volume) / budget));
}

/** Rough number of SDF samples levelSet takes on this grid (for progress). */
export function cavitySamples(b: Bounds, edge: number): number {
	return 2 * b.size.reduce((n, s) => n * (s / edge + 3), 1);
}

/** The region deeper than `wall` inside the surface of `tris` (a closed mesh). */
export function makeCavity(
	wasm: ManifoldToplevel,
	tris: Triangles,
	b: Bounds,
	wall: number,
	edge: number,
	onSample?: () => void
): Manifold {
	const sdf = meshSdf(tris, wall + 2 * edge);
	const box = {
		// An odd origin: grid planes then never fall on a round cut position, where
		// coincident faces would pinch the result.
		min: b.min.map((v) => v - edge * 1.3719) as [number, number, number],
		max: b.max.map((v) => v + edge * 1.2113) as [number, number, number]
	};
	const f = onSample
		? (p: [number, number, number]) => {
				onSample();
				return sdf(p);
			}
		: sdf;
	return wasm.Manifold.levelSet(f, box, edge, wall);
}

/** A hole of diameter `d` from the bottom of the model into the lowest part of the cavity. */
export function drainHole(wasm: ManifoldToplevel, solid: Manifold, cavity: Manifold, d: number) {
	const cb = cavity.boundingBox();
	const sb = solid.boundingBox();
	const z = cb.min[2] + Math.min(1, (cb.max[2] - cb.min[2]) / 4);
	const section = cavity.slice(z);
	const deep = deepestPoint(section.toPolygons());
	section.delete();
	if (!deep) return null;
	const r = d / 2;
	const height = z - sb.min[2] + 1.5;
	return wasm.Manifold.cylinder(height, r, r, segments(r)).translate([
		deep.at[0],
		deep.at[1],
		sb.min[2] - 1
	]);
}

export interface BoxResult {
	lid: Manifold;
	base: Manifold;
	note: string | null;
}

/**
 * Lid and base from a solid and its cavity, cut by `plane`; the lid is on
 * the side the normal points to when `p.lid` is «plus».
 */
export function makeBox(
	wasm: ManifoldToplevel,
	solid: Manifold,
	cavity: Manifold,
	plane: Plane,
	p: HollowParams
): BoxResult {
	const { CrossSection } = wasm;
	const bin = new Bin();
	const { toLocal, toWorld } = planeFrame(plane);
	const s = bin.add(solid.transform(toLocal));
	const c = bin.add(cavity.transform(toLocal));
	const shell = bin.add(s.subtract(c));
	const [plus, minus] = shell.splitByPlane([0, 0, 1], 0).map((m) => bin.add(m));
	if (plus.isEmpty() || minus.isEmpty()) {
		bin.free();
		throw new ToolError(m.t_stl_hollow_plane_misses_model());
	}
	const outer = bin.add(s.slice(0));
	const inner = bin.add(c.slice(0));
	if (inner.area() < 1) {
		bin.free();
		throw new ToolError(m.t_stl_hollow_plane_misses_cavity());
	}
	const up = p.lid === 'plus' ? 1 : -1;
	let lid = p.lid === 'plus' ? plus : minus;
	let base = p.lid === 'plus' ? minus : plus;
	// A prism between two heights measured from the plane towards the lid.
	const slab = (region: CrossSection, from: number, to: number) =>
		bin.add(prism(wasm, region, Math.min(from * up, to * up), Math.max(from * up, to * up)));
	const g = Math.max(0, p.clearance);
	let note: string | null = null;

	if (p.fit === 'plate') {
		// How deep the base's cavity goes below the plane, along the axis.
		const cb = bin.add(c.trimByPlane([0, 0, -up], 0)).boundingBox();
		const cavityDepth = up > 0 ? -cb.min[2] : cb.max[2];
		let depth = p.groove > 0 ? p.groove : p.plate + 0.5;
		let plate = p.plate;
		if (depth > cavityDepth - 0.6) {
			depth = Math.max(0.6, cavityDepth - 0.6);
			plate = Math.min(plate, depth - 0.2);
			note = m.t_stl_hollow_base_shallow();
		}
		if (plate < 0.6) {
			bin.free();
			throw new ToolError(m.t_stl_hollow_base_too_shallow());
		}
		// The recess keeps MIN_WALL to the outside at every depth.
		const room = [0, depth / 2, depth].map((d) =>
			bin.add(
				bin.add(s.slice(-d * up + (d === 0 ? -0.01 * up : 0))).offset(-(MIN_WALL + g), 'Round')
			)
		);
		const region = bin.add(
			CrossSection.intersection([bin.add(inner.offset(p.weld, 'Round')), ...room])
		);
		const welded = bin.add(region.subtract(inner)).area();
		if (welded < 0.5) {
			bin.free();
			throw new ToolError(m.t_stl_hollow_wall_thin_plate());
		}
		const plateSolid = slab(region, -plate, Math.min(0.6, p.wall / 2));
		const recess = slab(bin.add(region.offset(g, 'Round')), -depth, 0.01);
		lid = bin.add(lid.add(plateSolid));
		base = bin.add(base.subtract(recess));
	} else {
		const half = p.wall / 2;
		// The lip's inner face stands a hair into the cavity, never on its wall.
		const ring = bin.add(
			bin
				.add(outer.offset(-(half + g / 2), 'Round'))
				.subtract(bin.add(inner.offset(-0.05, 'Round')))
		);
		if (ring.area() < 0.5) {
			bin.free();
			throw new ToolError(m.t_stl_hollow_wall_thin_lip());
		}
		const lip = slab(ring, -0.3, p.lip);
		const pocket = slab(bin.add(outer.offset(-(half - g / 2), 'Round')), -0.01, p.lip + g);
		base = bin.add(base.add(lip));
		lid = bin.add(lid.subtract(pocket));
	}
	const result = { lid: lid.transform(toWorld), base: base.transform(toWorld), note };
	bin.free(result.lid, result.base);
	return result;
}
