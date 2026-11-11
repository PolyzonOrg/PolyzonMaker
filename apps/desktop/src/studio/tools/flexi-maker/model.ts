/**
 * Flexi toy: a solid model cut into links that print already joined
 * and move. Each cut becomes a hinge on its own axis (the hinge axis lies in
 * the cut plane) — one for every separate part the cut crosses:
 *
 * - the link after the cut ends in a drum — a cylinder around the hinge axis
 *   that covers the whole cut face; the link before it gets a matching
 *   hollow, `clearance` wider, so the two turn against each other without
 *   rubbing (concentric surfaces);
 * - a tongue from the link before reaches into a slot through the drum;
 * - a pin, part of the drum, passes through a hole in the tongue: the links
 *   cannot be pulled apart, only turned, up to `swing` degrees each way.
 *
 * Vertical pin, vertical drum: every gap is a wall or a bridge, nothing hangs
 * at a shallow angle when the hinge axis is Z. Pure geometry on manifold.
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import * as m from '$msg/tools/flexi-maker';
import { Bin, segments } from '../booleans/kit';
import {
	AXIS_INDEX,
	cross,
	planeFrame,
	type Axis,
	type Mat4,
	type Plane,
	type Vec3
} from '../booleans/plane';
import { deepestPoint, polysBounds } from '../booleans/section';

export interface FlexiParams {
	/** Links follow this axis; every cut is a plane across it. */
	axis: Axis;
	/** Cut positions along the axis, mm. */
	cuts: number[];
	/** The axis the links turn about (perpendicular to `axis`). */
	hinge: Axis;
	/** Gap between moving surfaces, mm */
	clearance: number;
	/** How far a link turns each way, degrees */
	swing: number;
	/** Hinge size, % of what fits the cut face */
	size: number;
	/**
	 * Cut this much off the bottom, mm: a flat base on the bed, so a rounded
	 * belly prints without supports (0 = the model as it is).
	 */
	flat: number;
}

/**
 * 0.35 mm frees a print-in-place joint on a typical 0.4 mm nozzle without
 * making it rattle; 25° each way bends a ten-link toy into a full curl.
 */
export const FLEXI_DEFAULTS: Omit<FlexiParams, 'cuts'> = {
	axis: 'x',
	hinge: 'z',
	clearance: 0.35,
	swing: 25,
	size: 100,
	flat: 0
};

export interface Joint {
	/** A point on the hinge axis (world), at the middle of the tongue. */
	point: Vec3;
	axis: Vec3;
	pin: number;
	tongue: number;
}

export interface FlexiResult {
	links: Manifold[];
	joints: Joint[];
}

/** Cut positions for `links` equal links along the model's extent on `axis`. */
export function evenCuts(min: number, max: number, links: number): number[] {
	const n = Math.max(2, Math.round(links));
	return Array.from({ length: n - 1 }, (_, i) => min + ((max - min) * (i + 1)) / n);
}

/** The hinge axes allowed for links along `axis`, the one to start with first. */
export function hingeOptions(axis: Axis): Axis[] {
	return axis === 'z' ? ['y', 'x'] : axis === 'x' ? ['z', 'y'] : ['z', 'x'];
}

const unit = (a: Axis): Vec3 => {
	const v: Vec3 = [0, 0, 0];
	v[AXIS_INDEX[a]] = 1;
	return v;
};

export function flexi(wasm: ManifoldToplevel, source: Manifold, p: FlexiParams): FlexiResult {
	if (p.hinge === p.axis) throw new ToolError(m.t_flexi_maker_hinge_off_plane());
	const { Manifold, CrossSection } = wasm;
	const bin = new Bin();
	let model = source;
	if (p.flat > 0) {
		const low = source.boundingBox().min[2];
		model = bin.add(source.trimByPlane([0, 0, 1], low + p.flat));
		if (model.isEmpty()) throw new ToolError(m.t_flexi_maker_flat_cut_all());
	}
	const g = Math.min(0.8, Math.max(0.15, p.clearance));
	const swing = Math.min(60, Math.max(5, p.swing));
	const k = Math.min(1.6, Math.max(0.4, p.size / 100));
	const n = unit(p.axis);
	const a = unit(p.hinge);
	const side = cross(a, n);
	const bb = model.boundingBox();
	const big = 4 * Math.max(...[0, 1, 2].map((i) => bb.max[i] - bb.min[i])) + 10;
	const center: Vec3 = [0, 1, 2].map((i) => (bb.min[i] + bb.max[i]) / 2) as Vec3;
	const cuts = [...p.cuts].sort((x, y) => x - y);

	const links: Manifold[] = [];
	const joints: Joint[] = [];
	let piece = model;
	let reachBack = -Infinity; // how far the previous joint's parts reach along the axis
	cuts.forEach((at, index) => {
		const cut = index + 1;
		const fail = (message: string): never => {
			bin.free(...links, piece === model ? null : piece);
			throw new ToolError(message);
		};
		const point: Vec3 = [...center];
		point[AXIS_INDEX[p.axis]] = at;
		const plane: Plane = { normal: n, point, offset: at };
		// The cut face in plane coordinates: u along the hinge, v along n × hinge.
		const { toLocal } = planeFrame(plane, a);
		const local = bin.add(piece.transform(toLocal));
		// Every separate part the cut crosses (two legs, a tail beside the body)
		// gets its own hinge: a part cut without one would come off the print.
		const islands = bin
			.add(local.slice(0))
			.decompose()
			.map((island) => bin.add(island))
			.filter((island) => island.area() > 0.5)
			.map((island) => {
				const polys = island.toPolygons();
				const deep = deepestPoint(polys);
				if (!deep || deep.radius < 1.5) {
					fail(m.t_flexi_maker_cut_too_thin({ n: cut }));
				}
				const { at: hingeAt, radius: r } = deep!;
				const [hu, hv] = hingeAt;
				const box = polysBounds(polys);
				const drum = Math.max(box.max[1] - hv, hv - box.min[1]) + 0.5;
				const pin = Math.min(4, Math.max(1, 0.3 * r * k));
				const tongue = Math.min(2 * (r - g - 1), Math.min(10, Math.max(1.6, 0.7 * r * k)));
				const disk = Math.min(drum - 1, pin + g + Math.max(1.2, 0.35 * r * k));
				if (tongue < 1.2 || disk < pin + g + 1) {
					fail(m.t_flexi_maker_cut_no_room({ n: cut }));
				}
				return { hu, hv, r, box, drum, pin, tongue, disk };
			});
		if (!islands.length) fail(m.t_flexi_maker_cut_misses({ n: cut }));
		const widest = Math.max(...islands.map((x) => x.drum));
		if (at - widest - g - 1 < reachBack) fail(m.t_flexi_maker_cut_too_close({ n: cut }));

		// How far each drum may run along its hinge axis: past its own part, short
		// of the others. Parts side by side across the hinge cannot share a cut.
		const reach = islands.map((x, i) => {
			let room = x.drum;
			islands.forEach((y, j) => {
				if (i === j) return;
				const across =
					Math.max(x.hv - x.drum - g - 1, y.box.min[1]) <=
					Math.min(x.hv + x.drum + g + 1, y.box.max[1]);
				if (!across) return;
				const gap = Math.max(y.box.min[0] - x.box.max[0], x.box.min[0] - y.box.max[0]);
				if (gap < 2 * g + 1) {
					fail(m.t_flexi_maker_cut_touching({ n: cut }));
				}
				room = Math.min(room, gap / 2 - g);
			});
			return room;
		});

		// The cut's frame: X along the axis, Y = hinge × axis, Z along the hinge,
		// origin at the cut's point; each part's hinge axis is a line along Z.
		const toWorld: Mat4 = [...n, 0, ...side, 0, ...a, 0, ...point, 1] as Mat4;
		const toJoint: Mat4 = [
			n[0],
			side[0],
			a[0],
			0,
			n[1],
			side[1],
			a[1],
			0,
			n[2],
			side[2],
			a[2],
			0,
			-(n[0] * point[0] + n[1] * point[1] + n[2] * point[2]),
			-(side[0] * point[0] + side[1] * point[1] + side[2] * point[2]),
			-(a[0] * point[0] + a[1] * point[1] + a[2] * point[2]),
			1
		];
		const P = bin.add(piece.transform(toJoint));
		const before = (x: number) =>
			bin.add(Manifold.cube([big, big, big], true).translate([x - big / 2, 0, 0]));
		// Turning sector: the half towards the previous link, widened by the swing.
		const fan: [number, number][] = [[0, 0]];
		for (let i = 0; i <= 24; i++) {
			const t = ((90 - swing + ((180 + 2 * swing) * i) / 24) * Math.PI) / 180;
			fan.push([big * Math.cos(t), big * Math.sin(t)]);
		}
		const fanCs = bin.add(CrossSection.ofPolygons([fan]));
		const sector = bin.add(Manifold.extrude(fanCs, big, 0, 0, [1, 1], true));

		const backCut: Manifold[] = [];
		const frontKeep: Manifold[] = [];
		const tongues: Manifold[] = [];
		const slots: Manifold[] = [];
		const pins: Manifold[] = [];
		islands.forEach((x, i) => {
			// On this part's hinge axis: Y = −v, Z from the part's u-range.
			const z0 = x.box.min[0] - reach[i];
			const z1 = x.box.max[0] + reach[i];
			const place = (solid: Manifold) => bin.add(solid.translate([0, -x.hv, 0]));
			// Facets turned by an odd angle: lined up with the model's own facets they
			// leave sub-micron slivers that weld into non-manifold edges in the STL.
			const cyl = (radius: number) =>
				place(
					bin.add(
						bin
							.add(
								Manifold.cylinder(z1 - z0, radius, radius, segments(radius)).rotate([0, 0, 1.37])
							)
							.translate([0, 0, z0])
					)
				);
			const slab = (thick: number) =>
				bin.add(Manifold.cube([big, big, thick], true).translate([0, 0, x.hu]));
			backCut.push(cyl(x.drum + g));
			frontKeep.push(cyl(x.drum));
			tongues.push(
				bin.add(
					P.intersect(slab(x.tongue))
						.intersect(
							bin.add(
								Manifold.union(bin.add(before(0).intersect(cyl(x.drum + g + 0.6))), cyl(x.disk))
							)
						)
						.subtract(cyl(x.pin + g))
				)
			);
			slots.push(
				bin.add(
					slab(x.tongue + 2 * g).intersect(
						bin.add(
							Manifold.union(cyl(x.disk + g), bin.add(place(sector).intersect(cyl(x.drum + 0.6))))
						)
					)
				)
			);
			const grip = Math.min(x.r - x.tongue / 2 - g, 3);
			pins.push(
				bin.add(
					cyl(x.pin)
						.intersect(slab(x.tongue + 2 * g + 2 * grip))
						.intersect(P)
				)
			);
			joints.push({
				point: [0, 1, 2].map((c) => point[c] + a[c] * x.hu - side[c] * x.hv) as Vec3,
				axis: a,
				pin: x.pin,
				tongue: x.tongue
			});
		});

		const back = bin.add(P.intersect(before(-g / 2)).subtract(bin.add(Manifold.union(backCut))));
		const front = bin.add(
			P.subtract(bin.add(before(g / 2).subtract(bin.add(Manifold.union(frontKeep)))))
		);
		const linkBefore = bin.add(Manifold.union([back, ...tongues])).transform(toWorld);
		const rest = bin
			.add(Manifold.union([bin.add(front.subtract(bin.add(Manifold.union(slots)))), ...pins]))
			.transform(toWorld);
		// Evaluate now: the inputs are freed below and at the end (see Bin).
		linkBefore.numTri();
		rest.numTri();
		if (piece !== model) piece.delete();
		links.push(linkBefore);
		piece = rest;
		reachBack = at + Math.max(...islands.map((x) => x.disk)) + g;
	});
	links.push(piece === model ? model.translate([0, 0, 0]) : piece);
	bin.free(...links);
	return { links, joints };
}
