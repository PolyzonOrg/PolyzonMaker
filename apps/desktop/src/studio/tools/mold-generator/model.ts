/**
 * «Силиконовая форма», two kinds:
 *
 * 1. Опалубка для силикона — a printed box of two halves around an uploaded master with
 *    an even gap for silicone: a smooth column following the master's
 *    outline, a floor, a roof with a pour neck (or an open top), side wings
 *    with slots for clamps or zip ties, cone keys on the wings so the halves
 *    meet in one position, an optional pedestal the master stands on (its
 *    print becomes the pour hole of the silicone mold).
 * 2. Форма с ячейками — a block with a grid of cavities for soap, chocolate,
 *    candles, resin, plaster or ice: the cavities widen to the top by the
 *    draft angle, channels can link them, text can be engraved in the floor.
 *
 * Pure geometry on manifold objects; the worker and the tests feed it.
 */
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import { Bin, prism, segments } from '../booleans/kit';
import { deepestPoint } from '../booleans/section';
import { strokeText } from './stroke-text';
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as msg from '$msg/tools/mold-generator';

// ---------- 1. Опалубка для силикона ----------

export type MoldPieces = 2 | 3 | 4 | 6;
export const MOLD_PIECES: readonly MoldPieces[] = [2, 3, 4, 6];

export interface MoldBoxParams {
	/** % of the uploaded size */
	scale: number;
	/** Turn the master upside down (180° about X). */
	flip: boolean;
	/** Silicone between the master and the box, mm */
	silicone: number;
	/** Printed wall, mm */
	wall: number;
	/**
	 * The cut turned about the vertical axis, degrees (0–175): 0 = front and
	 * back halves, 90 = left and right.
	 */
	angle: number;
	/**
	 * The cut moved off the middle of the master, mm, across itself: onto the
	 * widest line, where the undercuts are. Clamped to `shiftLimit`.
	 */
	shift: number;
	/**
	 * The box: one column around the master's outline, a plain rectangle (easy
	 * to clamp), or a shell stepping in and out with the figure up its height
	 * (least silicone and plastic).
	 */
	shape: 'outline' | 'rect' | 'shell';
	/**
	 * Two halves; four parts — each half cut once more across, easier to take
	 * off the silicone; three or six wedges around the vertical axis, for round
	 * and complex masters.
	 */
	pieces: MoldPieces;
	/** Thin fins on the parting line: the silicone gets a groove that shows where to cut it open. */
	ribs: boolean;
	neck: boolean;
	neckWidth: number;
	neckHeight: number;
	/** Silicone above the top of the master, mm */
	above: number;
	pedestal: boolean;
	/** 0 = picked from the master's footprint */
	pedestalDiameter: number;
	flanges: boolean;
	/** Slots between the top and bottom ones */
	extraSlots: number;
	slotWidth: number;
	/** From the top and bottom of the wing to the first slot, mm */
	slotOffset: number;
	keys: boolean;
	/**
	 * The floor is a part of its own with a rim the walls stand in: the
	 * walls come off the silicone sideways, the floor from under it.
	 */
	base: boolean;
	/** With a separate floor: the silicone to mix pressed into a tab of it («~34 мл»). */
	label: boolean;
	/**
	 * A vase, a cup: a printed core hangs from a lid into the cavity open at
	 * the top, so the inside takes only a layer of silicone.
	 */
	core: boolean;
	/** Fill what of the cavity is wider than the neck: the core and the cast come out through it. */
	straighten: boolean;
}

/**
 * 5 mm of silicone is enough to hold its shape when the box comes off; the
 * box itself is six 0.4 mm perimeters. A 20 mm neck takes a cup's pour
 * without spilling; 8 mm of silicone above the top keeps the mold from
 * tearing there.
 */
export const MOLD_BOX_DEFAULTS: MoldBoxParams = {
	scale: 100,
	flip: false,
	silicone: 5,
	wall: 2.4,
	angle: 0,
	shift: 0,
	shape: 'outline',
	pieces: 2,
	ribs: true,
	neck: true,
	neckWidth: 20,
	neckHeight: 12,
	above: 8,
	// Without it the master hangs in the box with nothing holding it.
	pedestal: true,
	pedestalDiameter: 0,
	flanges: true,
	extraSlots: 1,
	slotWidth: 5,
	slotOffset: 10,
	keys: true,
	base: true,
	label: true,
	core: false,
	straighten: false
};

export interface MoldBoxResult {
	/**
	 * The box parts, counter-clockwise from the cut seen from above, and where
	 * each moves in «Раздвинуть»: out of the middle of its sector, a unit
	 * vector. Two halves: the back one (the right one at 90°) with all the key
	 * cones first, then the one with the sockets.
	 */
	parts: { solid: Manifold; dir: [number, number, number] }[];
	/** The master as it sits in the box (scaled, turned). */
	master: Manifold;
	/** The lid with the core hanging from it (only with a core). */
	lid: Manifold | null;
	/** The separate floor with its rim (only with `base`). */
	base: Manifold | null;
	/** The master had its cavity filled to the neck: print it anew. */
	straightened: boolean;
	/** Silicone up to the top of the column, mm³ */
	silicone: number;
	/** Thinnest silicone between the master and the box walls, mm (fins and pedestal aside). */
	clearance: number;
	/** How far the cut may move off the middle of this master, either way, mm. */
	shiftLimit: number;
	note: string | null;
}

/** Wing: how far it reaches out and how thick each half of it is, mm. */
const WING = 16;
const WING_HALF = 4;
const KEY_R = 2.5;
const KEY_TIP = 1.2;
const KEY_H = 2.5;
const KEY_GAP = 0.2;
/**
 * Key heights (share of the wing) on the +X and the −X wing. Different on the
 * two sides, so a half turned upside down no longer fits: the cones meet the
 * sockets in one position only.
 */
export const KEY_HEIGHTS: Record<'plus' | 'minus', [number, number]> = {
	plus: [0.25, 0.75],
	minus: [0.4, 0.8]
};
/** Cut-guide fin: thickness and how deep it reaches into the silicone, mm. */
const RIB_T = 0.8;
const RIB_DEPTH = 1.5;
/** The pedestal reaches this far into the master: its top is a socket, not a point of contact. */
export const PEDESTAL_SINK = 1.5;
/** The floor's rim around the foot of the walls: height, thickness, play, mm. */
export const RIM = { height: 3, thickness: 1.6, gap: 0.25 } as const;
/** The tab with the silicone amount: letters this tall, raised this much, mm. */
const LABEL = { height: 6, raise: 0.6, margin: 2, overlap: 3 } as const;
/** A cut moved off the middle leaves every part at least this much box behind it, mm. */
const PART_DEPTH = 10;

/** cos and sin of an angle in degrees, exact at multiples of 90°: the plain cuts stay exact. */
function unit(deg: number): [number, number] {
	const q = ((deg % 360) + 360) % 360;
	if (q % 90 === 0)
		return (
			[
				[1, 0],
				[0, 1],
				[-1, 0],
				[0, -1]
			] as const
		)[q / 90].slice() as [number, number];
	const r = (q * Math.PI) / 180;
	return [Math.cos(r), Math.sin(r)];
}

/**
 * Where the box is cut, in its own frame (the cut's angle turned to 0°):
 * boundary k runs from the hub at `k · 360 / pieces` degrees from +X, and
 * part k lies between boundaries k and k + 1. Two halves are one plane, four
 * parts two planes across; three and six are wedges around the vertical axis.
 */
export function cutDirections(pieces: MoldPieces): number[] {
	return Array.from({ length: pieces }, (_, k) => (k * 360) / pieces);
}

/**
 * The cut on the scene while it is being set: each boundary a vertical
 * half-plane from the hub out past `box` (the bounds of the last build).
 * `shiftLimit` from that build shows a shift it clamped where the box is cut.
 */
export function cutPlanes(
	p: Pick<MoldBoxParams, 'angle' | 'shift' | 'pieces'>,
	shiftLimit: number,
	box: { min: readonly number[]; max: readonly number[] }
): { point: Vec3; normal: Vec3; size: number; width: number }[] {
	const shift = Math.max(-shiftLimit, Math.min(shiftLimit, p.shift));
	// The hub (0, shift) of the box's frame, turned back as the box is.
	const [c, s] = unit(p.angle);
	const hub = [shift * s, shift * c];
	const reach =
		4 +
		Math.max(
			...[box.min[0], box.max[0]].flatMap((x) =>
				[box.min[1], box.max[1]].map((y) => Math.hypot(x - hub[0], y - hub[1]))
			)
		);
	const z0 = box.min[2] - 2;
	const z1 = box.max[2] + 2;
	return cutDirections(p.pieces).map((deg) => {
		const [dx, dy] = unit(deg - p.angle);
		return {
			point: [hub[0] + (dx * reach) / 2, hub[1] + (dy * reach) / 2, (z0 + z1) / 2],
			normal: [-dy, dx, 0],
			size: z1 - z0,
			width: reach
		};
	});
}

/** What the floor's tab says: the silicone to mix, rounded to millilitres. */
export function siliconeLabel(volume: number): string {
	// Plain digits: the stroke font draws nothing else of a number (stroke-text.ts).
	return msg.t_mold_generator_silicone_label({ ml: Math.max(1, Math.round(volume / 1000)) });
}

/** A stretch of the silicone column: its outline from z0 to z1 (box frame). */
interface Band {
	cs: CrossSection;
	z0: number;
	z1: number;
}

type Vec3 = [number, number, number];

/**
 * The shell narrows upwards by at most this share of a band's height per
 * band: the ceilings it leaves stay steep enough for air to slide off.
 */
const SHELL_SLOPE = 0.8;
/** How far the coarse copy the shell is traced from may stray from the master, mm. */
const SHELL_TOLERANCE = 0.2;

export function moldBox(wasm: ManifoldToplevel, source: Manifold, p: MoldBoxParams): MoldBoxResult {
	const { Manifold, CrossSection } = wasm;
	const bin = new Bin();
	const s = p.silicone;
	const w = p.wall;

	// Build with the cut at 0° (the plane y = 0 through the middle), the master
	// turned the other way, and turn the result back.
	let m = bin.add(source.scale(Math.max(0.2, p.scale / 100)));
	if (p.flip) m = bin.add(m.rotate([180, 0, 0]));
	if (p.angle) m = bin.add(m.rotate([0, 0, p.angle]));
	const mb = m.boundingBox();
	const floorGap = s;
	m = bin.add(
		m.translate([-(mb.min[0] + mb.max[0]) / 2, -(mb.min[1] + mb.max[1]) / 2, floorGap - mb.min[2]])
	);
	const height = mb.max[2] - mb.min[2];
	const zTop = floorGap + height + p.above;
	const notes: string[] = [];

	// The cut moves across itself, within the master, while every part keeps
	// PART_DEPTH of box behind it. Its boundaries meet at the hub.
	const halfDepth = (mb.max[1] - mb.min[1]) / 2;
	const shiftLimit = Math.max(
		0,
		Math.floor(2 * Math.min(halfDepth, halfDepth + s + w - PART_DEPTH) + 1e-9) / 2
	);
	const shift = Math.max(-shiftLimit, Math.min(shiftLimit, p.shift));
	if (Math.abs(p.shift) > shiftLimit)
		notes.push(msg.t_mold_generator_note_shift_clamped({ mm: num(shiftLimit, 1) }));
	const hub: [number, number] = [0, shift];
	const dirs = cutDirections(p.pieces);

	let core: Cavity['core'] = [];
	let straightened = false;
	if (p.core || p.straighten) {
		const found = topCavity(wasm, bin, m, s, { fill: p.straighten, core: p.core });
		if (!found) notes.push(msg.t_mold_generator_note_no_cavity());
		else {
			if (found.filled) {
				m = found.filled;
				straightened = true;
			}
			core = found.core;
			if (p.core && !core.length) notes.push(msg.t_mold_generator_note_core_no_room());
		}
	}
	// With a core the roof comes off as a lid that holds it.
	const lidded = core.length > 0;

	// The column: the master's outline grown by the silicone, small notches closed.
	const close = 5;
	const grow = (region: CrossSection, extra = 0) =>
		bin.add(
			bin
				.add(bin.add(region.offset(s + extra + close, 'Round')).offset(-close, 'Round'))
				.simplify(0.02)
		);

	/**
	 * Band by band, the outline of the master within the silicone thickness of
	 * the band: the box follows the figure up its height instead of standing
	 * as one column as wide as its widest part.
	 */
	function shellBands(masterTop: number): Band[] {
		// A whole number of 1/64 mm: band boundaries come out exact, and prisms
		// that meet there merge into one shell instead of two touching ones.
		const h = Math.round(Math.max(0.8, height / 100) * 64) / 64;
		const n = Math.max(1, Math.ceil(zTop / h));
		// The master in slabs one band high, seen from above. A coarse copy is
		// plenty for an outline grown by the silicone: the grow makes up for
		// what simplifying took off, and a dense AI mesh is sliced in seconds.
		const slabs: CrossSection[] = [];
		let rest = bin.add(m.simplify(SHELL_TOLERANCE));
		for (let i = 0; i < n; i++) {
			const [above, below] = rest.splitByPlane([0, 0, 1], (i + 1) * h).map((x) => bin.add(x));
			if (!below.isEmpty()) slabs[i] = bin.add(below.project());
			rest = above;
		}
		const reach = Math.ceil(s / h);
		const out: Band[] = [];
		for (let i = 0; i < n; i++) {
			const z0 = i * h;
			const z1 = i === n - 1 ? zTop : (i + 1) * h;
			const prev = out.at(-1);
			if (prev && z0 - s > masterTop) {
				// Above the master: a flat roof.
				prev.z1 = z1;
				continue;
			}
			// Every slab within the silicone thickness of this band.
			const near = slabs.slice(Math.max(0, i - reach), i + reach + 1).filter((x) => !!x);
			const need = near.length ? grow(bin.add(CrossSection.union(near)), SHELL_TOLERANCE) : null;
			const narrowed = prev ? bin.add(prev.cs.offset(-SHELL_SLOPE * h, 'Round')) : null;
			const cs = need && narrowed ? bin.add(need.add(narrowed)) : (need ?? narrowed);
			if (!cs || cs.isEmpty()) throw new ToolError(msg.t_mold_generator_box_failed());
			out.push({ cs, z0, z1 });
		}
		return out;
	}

	let bands: Band[];
	if (p.shape === 'rect') {
		const b = bin.add(m.project()).bounds();
		const corner = Math.min(3, s);
		const column = bin.add(
			bin
				.add(
					CrossSection.square(
						[b.max[0] - b.min[0] + 2 * (s - corner), b.max[1] - b.min[1] + 2 * (s - corner)],
						true
					).translate([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2])
				)
				.offset(corner, 'Round')
		);
		bands = [{ cs: column, z0: 0, z1: zTop }];
	} else if (p.shape === 'shell') {
		bands = shellBands(floorGap + height);
	} else {
		bands = [{ cs: grow(bin.add(m.project())), z0: 0, z1: zTop }];
	}

	const last = bands.length - 1;
	const top = zTop + (p.neck && !lidded ? w : 0);
	// Each band's wall also covers its neighbours' outlines: where the shell
	// steps in or out, the step is a closed ledge, not a gap.
	const covers = bands.map((b, i) => {
		const near = [bands[i - 1]?.cs, b.cs, bands[i + 1]?.cs].filter((x) => x !== undefined);
		return bin.add(bin.add(CrossSection.union(near)).offset(w, 'Round'));
	});
	const solids: Manifold[] = bands.map((b, i) =>
		bin.add(prism(wasm, covers[i], b.z0, i === last ? top : b.z1))
	);
	// The floor is a slab of its own, so it meets the first band exactly at 0 —
	// or a separate part altogether (see `base` below).
	if (!p.base) solids.push(bin.add(prism(wasm, covers[0], -w, 0)));
	// Where the walls and their wings start: on the separate floor, or under the box.
	const foot = p.base ? 0 : -w;
	const wingCuts: Manifold[] = [];
	const holes: Manifold[] = bands.map((b, i) =>
		bin.add(prism(wasm, b.cs, b.z0, i === last ? (p.neck && !lidded ? zTop : top + 1) : b.z1))
	);
	if (p.neck && !lidded) {
		const deep = deepestPoint(bands[last].cs.toPolygons());
		if (!deep) throw new ToolError(msg.t_mold_generator_box_failed());
		let r = p.neckWidth / 2;
		if (r > deep.radius - 1) {
			r = Math.max(2, deep.radius - 1);
			notes.push(msg.t_mold_generator_note_neck_narrowed());
		}
		const [x, y] = deep.at;
		const tubeTop = top + p.neckHeight;
		solids.push(
			bin.add(
				Manifold.cylinder(tubeTop - zTop, r + w, r + w, segments(r + w)).translate([x, y, zTop])
			)
		);
		holes.push(
			bin.add(Manifold.cylinder(tubeTop - zTop + 2, r, r, segments(r)).translate([x, y, zTop - 1]))
		);
	}

	let lid: Manifold | null = null;
	let coreVolume = 0;
	if (lidded) {
		const opening = bands[last].cs;
		const shaft = core[0].cs;
		const solid: Manifold[] = [
			bin.add(prism(wasm, covers[last], zTop, zTop + w)),
			// A lip just inside the opening keeps the lid, and so the core, centred.
			bin.add(
				prism(
					wasm,
					bin.add(
						bin.add(opening.offset(-0.3, 'Round')).subtract(bin.add(opening.offset(-1.5, 'Round')))
					),
					zTop - 2,
					zTop + w / 2
				)
			),
			...core.map((c) => bin.add(prism(wasm, c.cs, c.z0, c.z1))),
			// Up out of the cavity into the lid.
			bin.add(prism(wasm, shaft, core[0].z1, zTop + w))
		];
		const cut: Manifold[] = [];
		if (p.neck) {
			// The pour hole beside the core, never over it: the silicone has to get in.
			const room = bin.add(opening.subtract(bin.add(shaft.offset(w + 1, 'Round'))));
			const deep = deepestPoint(room.toPolygons());
			if (deep && deep.radius > 3) {
				const r = Math.min(p.neckWidth / 2, deep.radius - 1);
				if (r < p.neckWidth / 2) notes.push(msg.t_mold_generator_note_neck_by_core());
				const [x, y] = deep.at;
				const tubeTop = zTop + w + p.neckHeight;
				solid.push(
					bin.add(
						Manifold.cylinder(tubeTop - zTop, r + w, r + w, segments(r + w)).translate([x, y, zTop])
					)
				);
				cut.push(
					bin.add(
						Manifold.cylinder(tubeTop - zTop + 4, r, r, segments(r)).translate([x, y, zTop - 3])
					)
				);
			} else {
				notes.push(msg.t_mold_generator_note_no_neck_by_core());
			}
		}
		lid = bin.add(Manifold.union(solid));
		if (cut.length) lid = bin.add(lid.subtract(bin.add(Manifold.union(cut))));
		coreVolume =
			core.reduce((sum, c) => sum + c.cs.area() * (c.z1 - c.z0), 0) +
			shaft.area() * (zTop - core[0].z1);
	}

	/** A solid made with a boundary along +X from the origin, put on the boundary at `deg`. */
	const onBoundary = (deg: number, x: Manifold) =>
		bin.add(bin.add(x.rotate([0, 0, deg])).translate([hub[0], hub[1], 0]));
	/** The wings seen from above, with the rim's play: the label keeps out from under them. */
	const wingFeet: CrossSection[] = [];

	/**
	 * The wing where the boundary at `deg` leaves the box, with slots for
	 * clamps. Made along +X from the hub; returns where its keys go, in that frame.
	 */
	function wingAt(deg: number): Vec3[] {
		const ray = bin.add(bin.add(CrossSection.square([1e5, 0.02])).translate([0, -0.01]));
		const spans = covers.map((c) =>
			bin
				.add(bin.add(bin.add(c.translate([-hub[0], -hub[1]])).rotate(-deg)).intersect(ray))
				.bounds()
		);
		// One plate from the wall nearest the middle: where the shell is wider,
		// the column cut out of the box takes the plate back to that wall.
		const walls = spans.map((b) => b.max[0]).filter(Number.isFinite);
		if (!walls.length) return [];
		const edge = Math.max(...walls);
		const end = edge + WING;
		const inner = Math.min(...walls) - w;
		const cube = (x0: number, x1: number, half: number, z0: number, z1: number) =>
			onBoundary(
				deg,
				bin.add(bin.add(Manifold.cube([x1 - x0, 2 * half, z1 - z0])).translate([x0, -half, z0]))
			);
		solids.push(cube(inner, end, WING_HALF, foot, top));
		// The floor's rim leaves room for the wing.
		wingCuts.push(cube(inner, end + 1, WING_HALF + RIM.gap, -1, RIM.height + 1));
		const foot2d = CrossSection.square([end + 1 - inner, 2 * (WING_HALF + RIM.gap)]);
		wingFeet.push(
			bin.add(
				bin
					.add(bin.add(bin.add(foot2d).translate([inner, -WING_HALF - RIM.gap])).rotate(deg))
					.translate(hub)
			)
		);
		// Slots through both halves of the wing, near its outer edge.
		const slotAt = end - 4.5;
		const first = foot + p.slotOffset + p.slotWidth / 2;
		const final = top - p.slotOffset - p.slotWidth / 2;
		const zs =
			final - first < p.slotWidth * 1.5
				? [(first + final) / 2]
				: Array.from(
						{ length: p.extraSlots + 2 },
						(_, i) => first + ((final - first) * i) / (p.extraSlots + 1)
					);
		if (top - foot > p.slotWidth + 4) {
			for (const z of zs) {
				holes.push(
					cube(slotAt - 1.5, slotAt + 1.5, WING_HALF + 1, z - p.slotWidth / 2, z + p.slotWidth / 2)
				);
			}
		}
		return KEY_HEIGHTS[deg < 180 ? 'plus' : 'minus'].map(
			(share): Vec3 => [edge + 4.5, 0, foot + (top - foot) * share]
		);
	}
	const keysAt = dirs.map((deg) => (p.flanges ? wingAt(deg) : []));

	let box = bin.add(Manifold.union(solids).subtract(bin.add(Manifold.union(holes))));
	// Measured before the fins and the pedestal, which reach in on purpose.
	const clearance = Math.min(m.minGap(box, s + 1), lid ? m.minGap(lid, s + 1) : Infinity);
	// What goes on the separate floor: its fin across, the pedestal.
	const floorParts: Manifold[] = [];
	if (p.ribs) {
		// Along the cut at 0° and 180° — the parting line the silicone is cut
		// open on (one side of the hub with three parts) — on the walls and
		// across the floor; all on the +Y side so the fin is whole in one part,
		// not split thin. They reach 0.5 mm into the wall and the floor: flush
		// faces leave the STL open.
		const depth = Math.min(RIB_DEPTH, s / 3);
		const odd = p.pieces % 2 === 1;
		const slab = bin.add(
			bin
				.add(CrossSection.square([odd ? 5e4 : 1e5, RIB_T]))
				.translate([odd ? hub[0] : -5e4, hub[1]])
		);
		const fins = bands.map((b, i) => {
			const rim = bin.add(
				bin.add(b.cs.offset(0.5, 'Round')).subtract(bin.add(b.cs.offset(-depth, 'Round')))
			);
			return bin.add(
				prism(wasm, bin.add(rim.intersect(slab)), i === 0 ? (p.base ? 0 : -0.5) : b.z0, b.z1)
			);
		});
		// On a separate floor the fin ends where the walls' fins begin: the two
		// parts meet there instead of running into each other.
		const under = bin.add(bands[0].cs.offset(p.base ? -depth : 0.5, 'Round'));
		const floorFin = bin.add(prism(wasm, bin.add(under.intersect(slab)), -0.5, depth));
		if (p.base) floorParts.push(floorFin);
		else fins.push(floorFin);
		box = bin.add(Manifold.union([box, ...fins]));
	}
	let pedestalVolume = 0;
	if (p.pedestal) {
		const foot = bin.add(m.slice(floorGap + Math.min(0.5, height / 4)));
		const deep = deepestPoint(foot.toPolygons());
		const fb = foot.bounds();
		const auto = Math.min(
			40,
			Math.max(6, 0.6 * Math.min(fb.max[0] - fb.min[0], fb.max[1] - fb.min[1]))
		);
		const d = p.pedestalDiameter > 0 ? p.pedestalDiameter : auto;
		if (deep) {
			const r = d / 2;
			// Up into the master and minus the master: its top is a socket shaped
			// like the master's bottom, so no silicone skin forms over the future
			// pour hole under a rounded base.
			const post = bin.add(
				Manifold.cylinder(floorGap + 0.5 + PEDESTAL_SINK, r, r, segments(r)).translate([
					deep.at[0],
					deep.at[1],
					-0.5
				])
			);
			const ped = bin.add(post.subtract(m));
			if (p.base) floorParts.push(ped);
			else box = bin.add(box.add(ped));
			pedestalVolume = Math.PI * r * r * floorGap;
		}
	}

	// Part k: counter-clockwise of boundary k, clockwise of boundary k + 1 (the
	// two are one plane for two halves). Cut by planes, so neighbours share
	// their faces exactly.
	const n = dirs.length;
	const sideOf = (deg: number): Vec3 => {
		const [c, sn] = unit(deg);
		return [-sn, c, 0];
	};
	const trim = (x: Manifold, normal: Vec3) =>
		bin.add(x.trimByPlane(normal, normal[0] * hub[0] + normal[1] * hub[1]));
	const parts = dirs.map((deg, k) => {
		const part = trim(box, sideOf(deg));
		if (n === 2) return part;
		const next = sideOf(dirs[(k + 1) % n]);
		return trim(part, [-next[0], -next[1], 0]);
	});
	if (p.keys) {
		// Cones on the side of a boundary towards +X+Y of the box's frame: two
		// halves keep them all on one, as four parts did before. Sockets opposite.
		const cone = bin.add(keyShape(wasm, KEY_R, KEY_TIP, KEY_H, 0.5));
		const socket = bin.add(keyShape(wasm, KEY_R + KEY_GAP, KEY_TIP + KEY_GAP, KEY_H + 0.3, 0.01));
		const flipped = [cone, socket].map((x) => bin.add(x.rotate([180, 0, 0])));
		const cones: Manifold[][] = parts.map(() => []);
		const sockets: Manifold[][] = parts.map(() => []);
		dirs.forEach((deg, k) => {
			const [c, sn] = unit(deg);
			// keyShape stands on the counter-clockwise side; turned over, on the other.
			const ccw = c - sn > 0;
			const [coneAt, socketAt] = ccw ? [k, (k + n - 1) % n] : [(k + n - 1) % n, k];
			for (const v of keysAt[k]) {
				cones[coneAt].push(onBoundary(deg, bin.add((ccw ? cone : flipped[0]).translate(v))));
				sockets[socketAt].push(onBoundary(deg, bin.add((ccw ? socket : flipped[1]).translate(v))));
			}
		});
		parts.forEach((part, k) => {
			let keyed = part;
			if (cones[k].length) keyed = bin.add(Manifold.union([keyed, ...cones[k]]));
			if (sockets[k].length) keyed = bin.add(keyed.subtract(bin.add(Manifold.union(sockets[k]))));
			parts[k] = keyed;
		});
	}
	// «Раздвинуть»: out of the middle of each part's sector.
	const pieces = parts.map((solid, k) => {
		const [c, sn] = unit(dirs[k] + 180 / n);
		return { solid, dir: [c, sn, 0] as Vec3 };
	});

	const silicone =
		bands.reduce((sum, b) => sum + b.cs.area() * (b.z1 - b.z0), 0) -
		m.volume() -
		pedestalVolume -
		coreVolume;

	let floor: Manifold | null = null;
	if (p.base) {
		// A plate under the walls with a rim around their foot; the rim gives way
		// to the wings, and a tab carries the silicone to mix.
		const inside = bin.add(covers[0].offset(RIM.gap, 'Round'));
		const plate = bin.add(inside.offset(RIM.thickness, 'Round'));
		const floorSolids = [bin.add(prism(wasm, plate, -w, 0))];
		const rim = bin.add(prism(wasm, bin.add(plate.subtract(inside)), -w / 2, RIM.height));
		floorSolids.push(
			wingCuts.length ? bin.add(rim.subtract(bin.add(Manifold.union(wingCuts)))) : rim
		);
		if (p.label) floorSolids.push(...labelTab(plate, siliconeLabel(silicone)));
		floor = bin.add(Manifold.union([...floorSolids, ...floorParts]));
	}

	/**
	 * The tab with the amount, out from the middle of a part, away from the
	 * cut's fin: in front of two halves, on the front-right diagonal of four.
	 * Laid out with that direction turned to −Y; pushed further out until no
	 * wing stands on the letters.
	 */
	function labelTab(plate: CrossSection, text: string): Manifold[] {
		const letters = strokeText(wasm, bin, text, LABEL.height, 1);
		const lb = letters.bounds();
		const tw = lb.max[0] - lb.min[0] + 2 * LABEL.margin;
		const turn = Math.floor(n / 2) * (360 / n) + 180 / n - 270;
		const local = bin.add(bin.add(plate.translate([-hub[0], -hub[1]])).rotate(-turn));
		const strip = bin.add(CrossSection.square([0.02, 1e5], true));
		const across = bin.add(local.intersect(strip));
		if (across.isEmpty()) return [];
		const edge = across.bounds().min[1];
		const world = (x: CrossSection) => bin.add(bin.add(x.rotate(turn)).translate(hub));
		const lettersAt = (push: number) =>
			world(bin.add(letters.translate([0, edge - LABEL.margin - LABEL.height / 2 - push])));
		const feet = wingFeet.length ? bin.add(CrossSection.union(wingFeet)) : null;
		let push = 0;
		while (feet && push < 2 * WING && bin.add(lettersAt(push).intersect(feet)).area() > 1e-6)
			push += 2;
		const th = LABEL.height + 2 * LABEL.margin + LABEL.overlap + push;
		const rounded = bin.add(CrossSection.square([tw - 4, th - 4], true));
		const tab = world(
			bin.add(bin.add(rounded.offset(2, 'Round')).translate([0, edge + LABEL.overlap - th / 2]))
		);
		return [
			bin.add(prism(wasm, tab, -w, 0)),
			bin.add(prism(wasm, lettersAt(push), -0.2, LABEL.raise))
		];
	}

	const [ca, sa] = unit(p.angle);
	const back = (x: Manifold) => (p.angle ? x.rotate([0, 0, -p.angle]) : x.translate([0, 0, 0]));
	const result: MoldBoxResult = {
		parts: pieces.map(({ solid, dir }) => ({
			solid: back(solid),
			dir: [dir[0] * ca + dir[1] * sa, dir[1] * ca - dir[0] * sa, 0]
		})),
		master: back(m),
		lid: lid ? back(lid) : null,
		base: floor ? back(floor) : null,
		straightened,
		silicone,
		clearance,
		shiftLimit,
		note: notes.join(sentenceGap(currentLocale())) || null
	};
	bin.free(...result.parts.map((x) => x.solid), result.master, result.lid, result.base);
	return result;
}

/** Slab height of the cavity scan, mm: whole millimetres keep slab boundaries exact. */
const CAVITY_STEP = 1;
/** The cavity has to open within this much of the master's top, mm: a vase, not a loop of an arm. */
const CAVITY_MOUTH = 3;
/** The filling reaches this far into the master's wall, mm, so no crevice is left for silicone. */
const FILL_INTO_WALL = 0.3;

interface Cavity {
	/** The master with what lies wider than the neck filled in (null: nothing to fill). */
	filled: Manifold | null;
	/**
	 * The core, from the rim down: the cavity as seen from above, the silicone
	 * thickness in from its walls and floor, never wider below than above.
	 */
	core: { cs: CrossSection; z0: number; z1: number }[];
}

const ringArea = (ring: readonly (readonly [number, number])[]) => {
	let a = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
	}
	return a / 2;
};

/**
 * The cavity open at the top of a vase, a cup or a candle holder, scanned in
 * slabs from the top down. Seen from above it narrows to the neck; whatever
 * of the inside is wider than the neck lies under an overhang: a core made
 * to its shape could not come out, and that is where silicone goes to waste.
 */
function topCavity(
	wasm: ManifoldToplevel,
	bin: Bin,
	m: Manifold,
	s: number,
	want: { fill: boolean; core: boolean }
): Cavity | null {
	const { CrossSection, Manifold } = wasm;
	const box = m.boundingBox();
	// Seen from above: what the master has not covered yet.
	let reach = bin.add(CrossSection.square([1e4, 1e4], true));
	// The coarse copy the shell uses: the scan needs tenths of a millimetre, not microns.
	let rest = bin.add(m.simplify(SHELL_TOLERANCE));
	const top = Math.ceil(box.max[2]);
	const slabs: { z0: number; z1: number; open: CrossSection; hidden: CrossSection | null }[] = [];
	for (let z1 = top; z1 > box.min[2]; z1 -= CAVITY_STEP) {
		const z0 = z1 - CAVITY_STEP;
		const [slab, lower] = rest.splitByPlane([0, 0, 1], z0).map((x) => bin.add(x));
		rest = lower;
		if (slab.isEmpty()) continue;
		const foot = bin.add(slab.project());
		reach = bin.add(reach.subtract(foot));
		// The holes of the outline here that the view from above reaches: the inside.
		const insides = foot
			.toPolygons()
			.filter((ring) => ringArea(ring) < 0)
			.map((ring) => bin.add(new CrossSection([ring], 'EvenOdd')))
			.filter((hole) => bin.add(hole.intersect(reach)).area() > 0.5);
		if (!insides.length) {
			if (slabs.length || z1 < box.max[2] - CAVITY_MOUTH) break;
			continue;
		}
		const inside = bin.add(CrossSection.union(insides));
		const hidden = want.fill ? bin.add(inside.subtract(reach)) : null;
		slabs.push({
			z0,
			z1,
			open: bin.add(inside.intersect(reach)),
			hidden: hidden && hidden.area() > 0.5 ? hidden : null
		});
	}
	if (!slabs.length) return null;

	let filled: Manifold | null = null;
	const fills = slabs.flatMap(({ hidden, z0, z1 }) =>
		hidden ? [bin.add(prism(wasm, bin.add(hidden.offset(FILL_INTO_WALL, 'Round')), z0, z1))] : []
	);
	if (fills.length) filled = bin.add(Manifold.union([m, ...fills]));

	const core: Cavity['core'] = [];
	if (want.core) {
		// Slabs of silicone kept under the core.
		const under = Math.ceil(s / CAVITY_STEP);
		for (let i = 0; i + under < slabs.length; i++) {
			let cs = slabs[i].open;
			for (let j = 1; j <= under; j++) cs = bin.add(cs.intersect(slabs[i + j].open));
			cs = bin.add(cs.offset(-(s + SHELL_TOLERANCE), 'Round'));
			const above = core.at(-1);
			// Never wider than above it: the core comes out the way it went in.
			if (above) cs = bin.add(cs.intersect(above.cs));
			if (cs.area() < 1) break;
			if (
				above &&
				Math.abs(cs.area() - above.cs.area()) < 1e-6 &&
				cs.numVert() === above.cs.numVert()
			)
				above.z0 = slabs[i].z0;
			else core.push({ cs, z0: slabs[i].z0, z1: slabs[i].z1 });
		}
	}
	return { filled, core };
}

/** A cone key pointing to −Y from the plane y = 0, `embed` mm into +Y. */
function keyShape(
	wasm: ManifoldToplevel,
	base: number,
	tip: number,
	height: number,
	embed: number
): Manifold {
	const { Manifold } = wasm;
	const n = segments(base);
	const root = Manifold.cylinder(embed + 0.01, base, base, n).translate([0, 0, -embed]);
	const end = Manifold.cylinder(0.01, tip, tip, n).translate([0, 0, height - 0.01]);
	const along = Manifold.hull([root, end]);
	const out = along.rotate([90, 0, 0]);
	out.numTri();
	root.delete();
	end.delete();
	along.delete();
	return out;
}

// ---------- 2. Форма с ячейками ----------

export type CavityShape = 'rect' | 'circle' | 'oval' | 'hex' | 'heart';

export interface PourParams {
	shape: CavityShape;
	/** Width (diameter for a circle), mm */
	width: number;
	length: number;
	depth: number;
	corner: number;
	/** Walls lean outwards by this much towards the top, degrees */
	draft: number;
	cols: number;
	rows: number;
	wall: number;
	floor: number;
	outerRadius: number;
	channels: boolean;
	channelWidth: number;
	channelDepth: number;
	text: string;
	textDepth: number;
	mirror: boolean;
}

/** Two bars side by side; 3° of draft is plenty for a flexible silicone cast. */
export const POUR_DEFAULTS: PourParams = {
	shape: 'rect',
	width: 50,
	length: 80,
	depth: 22,
	corner: 6,
	draft: 3,
	cols: 2,
	rows: 1,
	wall: 6,
	floor: 4,
	outerRadius: 4,
	channels: false,
	channelWidth: 4,
	channelDepth: 2,
	text: '',
	textDepth: 0.8,
	mirror: true
};

/** Ready layouts by what comes out of the mold. */
export const POUR_PRESETS: readonly {
	id: string;
	label: string;
	note: string;
	params: Partial<PourParams>;
}[] = [
	{
		id: 'bars',
		get label() {
			return msg.t_mold_generator_preset_bars();
		},
		get note() {
			return msg.t_mold_generator_preset_bars_note();
		},
		params: {
			shape: 'rect',
			width: 50,
			length: 80,
			depth: 22,
			corner: 6,
			draft: 3,
			cols: 2,
			rows: 1,
			wall: 6,
			floor: 4
		}
	},
	{
		id: 'candy',
		get label() {
			return msg.t_mold_generator_preset_candy();
		},
		get note() {
			return msg.t_mold_generator_preset_candy_note();
		},
		params: {
			shape: 'circle',
			width: 26,
			length: 26,
			depth: 12,
			corner: 0,
			draft: 8,
			cols: 4,
			rows: 3,
			wall: 5,
			floor: 3
		}
	},
	{
		id: 'pillar',
		get label() {
			return msg.t_mold_generator_preset_pillar();
		},
		get note() {
			return msg.t_mold_generator_preset_pillar_note();
		},
		params: {
			shape: 'circle',
			width: 60,
			length: 60,
			depth: 50,
			corner: 0,
			draft: 1.5,
			cols: 1,
			rows: 1,
			wall: 6,
			floor: 5
		}
	},
	{
		id: 'coaster',
		get label() {
			return msg.t_mold_generator_preset_coaster();
		},
		get note() {
			return msg.t_mold_generator_preset_coaster_note();
		},
		params: {
			shape: 'circle',
			width: 95,
			length: 95,
			depth: 6,
			corner: 0,
			draft: 2,
			cols: 1,
			rows: 1,
			wall: 6,
			floor: 3
		}
	},
	{
		id: 'tile',
		get label() {
			return msg.t_mold_generator_preset_tile();
		},
		get note() {
			return msg.t_mold_generator_preset_tile_note();
		},
		params: {
			shape: 'rect',
			width: 100,
			length: 100,
			depth: 15,
			corner: 3,
			draft: 4,
			cols: 1,
			rows: 1,
			wall: 8,
			floor: 5
		}
	},
	{
		id: 'cubes',
		get label() {
			return msg.t_mold_generator_preset_cubes();
		},
		get note() {
			return msg.t_mold_generator_preset_cubes_note();
		},
		params: {
			shape: 'rect',
			width: 28,
			length: 28,
			depth: 28,
			corner: 4,
			draft: 3,
			cols: 4,
			rows: 2,
			wall: 4,
			floor: 3
		}
	}
];

export function clampPour(p: PourParams): PourParams {
	const fit = (v: number, lo: number, hi: number) =>
		Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
	return {
		...p,
		width: fit(p.width, 10, 150),
		length: fit(p.length, 10, 180),
		depth: fit(p.depth, 3, 60),
		corner: fit(p.corner, 0, 30),
		draft: fit(p.draft, 0, 15),
		cols: Math.round(fit(p.cols, 1, 8)),
		rows: Math.round(fit(p.rows, 1, 8)),
		wall: fit(p.wall, 3, 20),
		floor: fit(p.floor, 2, 15),
		outerRadius: fit(p.outerRadius, 0, 20),
		channelWidth: fit(p.channelWidth, 2, 10),
		// A channel never cuts through the cavity's floor.
		channelDepth: fit(p.channelDepth, 1, Math.max(1, Math.min(10, fit(p.depth, 3, 60) - 0.5))),
		textDepth: fit(p.textDepth, 0.4, Math.min(3, p.floor - 1)),
		text: p.text.slice(0, 24)
	};
}

/** The outline of one cavity at its bottom, centred on the origin. */
export function cavityOutline(wasm: ManifoldToplevel, p: PourParams): CrossSection {
	const { CrossSection } = wasm;
	const w = p.width;
	const l = p.shape === 'circle' ? p.width : p.length;
	let shape: CrossSection;
	if (p.shape === 'circle') shape = CrossSection.circle(w / 2, segments(w / 2));
	else if (p.shape === 'oval') {
		const unit = CrossSection.circle(1, segments(Math.max(w, l) / 2));
		shape = unit.scale([w / 2, l / 2]);
		unit.delete();
	} else if (p.shape === 'hex') {
		const hex = CrossSection.circle(1, 6);
		// Corner to corner along X is the width; flat to flat along Y follows.
		shape = hex.scale([w / 2, w / 2]);
		hex.delete();
	} else if (p.shape === 'heart') {
		const pts: [number, number][] = [];
		for (let i = 0; i < 160; i++) {
			const t = (i / 160) * 2 * Math.PI;
			const x = 16 * Math.sin(t) ** 3;
			const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
			// y runs from −17 to 12: +2.5 centres the heart, as the draft and the block assume.
			pts.push([(x / 32) * w, ((y + 2.5) / 29) * l]);
		}
		// The curve runs clockwise: reverse it for a positive (filled) outline.
		shape = CrossSection.ofPolygons([pts.reverse()], 'NonZero');
	} else shape = CrossSection.square([w, l], true);
	// Round the corners: shrink, then grow back with round joins.
	const r = Math.min(p.corner, Math.min(w, l) / 2 - 0.5);
	if (r > 0.05 && p.shape !== 'circle' && p.shape !== 'oval') {
		const a = shape.offset(-r, 'Round');
		const b = a.offset(r, 'Round', 2, segments(r));
		shape.delete();
		a.delete();
		shape = b;
	}
	return shape;
}

export interface PourResult {
	mold: Manifold;
	/** One cast, mm³ */
	castVolume: number;
	cavities: number;
}

/**
 * The pour mold. `text` is the engraving as a solid (glyphs extruded 1 mm
 * high, centred on the origin) — it is scaled to fit the cavity floor.
 */
export function pourMold(
	wasm: ManifoldToplevel,
	params: PourParams,
	text: Manifold | null = null
): PourResult {
	const { Manifold } = wasm;
	const p = clampPour(params);
	const bin = new Bin();
	const outline = bin.add(cavityOutline(wasm, p));
	const ob = outline.bounds();
	const bw = ob.max[0] - ob.min[0];
	const bl = ob.max[1] - ob.min[1];
	const lean = Math.tan((p.draft * Math.PI) / 180);
	const rise = p.depth + 0.5;
	const topW = bw + 2 * rise * lean;
	const topL = bl + 2 * rise * lean;
	const cavity = bin.add(prism(wasm, outline, p.floor, p.floor + rise, [topW / bw, topL / bl]));
	const atTop = bw + 2 * p.depth * lean;
	const atTopL = bl + 2 * p.depth * lean;
	const pitchX = atTop + p.wall;
	const pitchY = atTopL + p.wall;
	const totalW = p.cols * atTop + (p.cols + 1) * p.wall;
	const totalL = p.rows * atTopL + (p.rows + 1) * p.wall;
	const height = p.floor + p.depth;
	const r = Math.min(p.outerRadius, Math.min(totalW, totalL) / 2 - 0.5);
	const square = bin.add(wasm.CrossSection.square([totalW, totalL], true));
	const rounded =
		r > 0.05
			? bin.add(bin.add(square.offset(-r, 'Round')).offset(r, 'Round', 2, segments(r)))
			: square;
	const body = bin.add(prism(wasm, rounded, 0, height));
	const centers: [number, number][] = [];
	for (let j = 0; j < p.rows; j++)
		for (let i = 0; i < p.cols; i++)
			centers.push([
				-totalW / 2 + p.wall + atTop / 2 + i * pitchX,
				-totalL / 2 + p.wall + atTopL / 2 + j * pitchY
			]);
	const cuts: Manifold[] = centers.map(([x, y]) => bin.add(cavity.translate([x, y, 0])));
	if (p.channels && centers.length > 1) {
		const cz = height - p.channelDepth;
		const hz = p.channelDepth + 1;
		for (let j = 0; j < p.rows; j++)
			for (let i = 0; i < p.cols; i++) {
				const [x, y] = centers[j * p.cols + i];
				if (i + 1 < p.cols)
					cuts.push(
						bin.add(
							Manifold.cube([pitchX, p.channelWidth, hz], true).translate([
								x + pitchX / 2,
								y,
								cz + hz / 2
							])
						)
					);
				if (j + 1 < p.rows)
					cuts.push(
						bin.add(
							Manifold.cube([p.channelWidth, pitchY, hz], true).translate([
								x,
								y + pitchY / 2,
								cz + hz / 2
							])
						)
					);
			}
	}
	if (text && !text.isEmpty()) {
		const tb = text.boundingBox();
		const tw = tb.max[0] - tb.min[0];
		const tl = tb.max[1] - tb.min[1];
		const room = p.shape === 'circle' || p.shape === 'oval' || p.shape === 'heart' ? 0.6 : 0.8;
		const k = Math.min((room * bw) / tw, (0.6 * bl) / tl);
		const th = tb.max[2] - tb.min[2] || 1;
		const glyphs = bin.add(
			text
				.translate([-(tb.min[0] + tb.max[0]) / 2, -(tb.min[1] + tb.max[1]) / 2, -tb.min[2]])
				.scale([p.mirror ? -k : k, k, (p.textDepth + 0.01) / th])
		);
		for (const [x, y] of centers)
			cuts.push(bin.add(glyphs.translate([x, y, p.floor - p.textDepth])));
	}
	const mold = body.subtract(bin.add(Manifold.union(cuts)));
	// The cast: the outline's area scaled up linearly in X and Y over the depth.
	const a = (topW / bw - 1) / rise;
	const b = (topL / bl - 1) / rise;
	const d = p.depth;
	const castVolume = outline.area() * (d + ((a + b) * d * d) / 2 + (a * b * d * d * d) / 3);
	const result: PourResult = {
		mold,
		castVolume,
		cavities: centers.length
	};
	bin.free(result.mold);
	return result;
}

// ---------- silicone to mix ----------

export interface SiliconeRatio {
	id: string;
	label: string;
	/** Parts A : B by weight. */
	a: number;
	b: number;
}

/** The common mixing ratios by weight: platinum silicones 1:1, tin-cure ones 10:1 or 100:5. */
export const SILICONE_RATIOS: readonly SiliconeRatio[] = [
	{ id: '1:1', label: '1 : 1', a: 1, b: 1 },
	{ id: '10:1', label: '10 : 1', a: 10, b: 1 },
	{ id: '100:5', label: '100 : 5', a: 100, b: 5 }
];

export interface SiliconeMix {
	/** g, with the reserve */
	total: number;
	a: number;
	b: number;
}

/**
 * Grams to weigh out for `volume` mm³ of silicone: density in g/cm³ (most
 * mold silicones are 1.05–1.2), a reserve for what stays in the cup. Under
 * 10 g to 0.1 g: a gram off is a fifth of the hardener in a small 100 : 5 batch.
 */
export function siliconeMix(
	volume: number,
	density: number,
	ratio: Pick<SiliconeRatio, 'a' | 'b'>,
	reserve = 0.1
): SiliconeMix {
	const total = (Math.max(0, volume) / 1000) * density * (1 + reserve);
	const grams = (x: number) => (x < 10 ? Math.round(x * 10) / 10 : Math.round(x));
	const a = grams((total * ratio.a) / (ratio.a + ratio.b));
	const b = grams((total * ratio.b) / (ratio.a + ratio.b));
	return { total: Math.round((a + b) * 10) / 10, a, b };
}
