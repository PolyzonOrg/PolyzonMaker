/**
 * Screw threads as a turning cross-section: the cut of a threaded rod across
 * its axis is one closed curve, and extruding it while it turns one lead per
 * lead of height gives the exact helix (right-hand: the top turns
 * counter-clockwise). Cheap in manifold and in OpenSCAD alike.
 *
 * Profiles:
 * - `iso` — ISO 68-1 metric: 60° flanks, crest flat P/8, root flat P/4,
 *   depth 5/8·H (H = 0.866·P);
 * - `jar` — for lids and jars: 90° flanks (45° to the bed, prints upright
 *   without supports), depth 0.4·P.
 */
import {
	circle,
	cylinder,
	difference,
	intersection,
	polygon,
	rotate,
	translate,
	twistExtrude,
	union,
	type Node
} from '../csg/csg';

export type ThreadProfile = 'iso' | 'jar';

export interface Thread {
	/** Outer (major) diameter, mm */
	major: number;
	/** Pitch, mm: the distance between neighbouring crests */
	pitch: number;
	/** Number of starts: the lid turns `starts` times less to close */
	starts?: number;
	profile?: ThreadProfile;
}

/** Radial depth of the thread, mm. */
export function threadDepth(t: Thread): number {
	return t.profile === 'jar' ? 0.4 * t.pitch : (5 / 8) * 0.866025 * t.pitch;
}

/** Inner (minor) diameter, mm. */
export const minorDiameter = (t: Thread) => t.major - 2 * threadDepth(t);

// Crest flat, flank, root flat — as fractions of the pitch (summing to 1 with two flanks).
const SHAPE: Record<ThreadProfile, { crest: number; flank: number }> = {
	iso: { crest: 1 / 8, flank: 5 / 16 },
	jar: { crest: 0.1, flank: 0.4 }
};

/** Radius of the axial profile at `u` pitches from a crest (periodic). */
function profileRadius(t: Thread, u: number, grow: number): number {
	const { crest, flank } = SHAPE[t.profile ?? 'iso'];
	const a = Math.abs(u - Math.round(u));
	const R = t.major / 2 + grow;
	const depth = threadDepth(t);
	if (a <= crest / 2) return R;
	if (a <= crest / 2 + flank) return R - (depth * (a - crest / 2)) / flank;
	return R - depth;
}

/** Points around the axis: enough that each crest flat gets several. */
const SEGMENTS = 96;
/** Slices per turn of the section: a 15° step leaves a few hundredths of a millimetre. */
const PER_TURN = 24;

function section(t: Thread, grow: number): [number, number][] {
	const starts = t.starts ?? 1;
	const pts: [number, number][] = [];
	for (let i = 0; i < SEGMENTS; i++) {
		const a = (2 * Math.PI * i) / SEGMENTS;
		// One turn round the axis passes `starts` crests; going counter-clockwise
		// the crest lies lower, so the helix climbs counter-clockwise.
		const r = profileRadius(t, (-starts * i) / SEGMENTS, grow);
		pts.push([r * Math.cos(a), r * Math.sin(a)]);
	}
	return pts;
}

/**
 * A threaded rod from z = 0 to `length`. `grow` widens every radius (the
 * hole of a nut is the bolt's rod grown by the print clearance); the
 * chamfers take 45° off the thread at the ends that ask for it.
 */
export function threadedRod(
	t: Thread,
	length: number,
	opts: { grow?: number; chamferBottom?: boolean; chamferTop?: boolean } = {}
): Node {
	const grow = opts.grow ?? 0;
	const lead = t.pitch * (t.starts ?? 1);
	const turns = length / lead;
	const rod = twistExtrude(
		length,
		360 * turns,
		Math.max(2, Math.ceil(turns * PER_TURN)),
		polygon(section(t, grow))
	);
	const depth = threadDepth(t);
	const R = t.major / 2 + grow;
	const c = Math.min(depth, length / 3);
	if (!opts.chamferBottom && !opts.chamferTop) return rod;
	// A body of revolution that keeps the rod and cuts its ends at 45°.
	const keep = union(
		opts.chamferBottom
			? cylinder(c, R - c, R + 0.01, SEGMENTS)
			: cylinder(c, R + 1, R + 1, SEGMENTS),
		translate([0, 0, c - 0.001], cylinder(length - 2 * c + 0.002, R + 1, R + 1, SEGMENTS)),
		translate(
			[0, 0, length - c],
			opts.chamferTop ? cylinder(c, R + 0.01, R - c, SEGMENTS) : cylinder(c, R + 1, R + 1, SEGMENTS)
		)
	);
	return intersection(rod, between(keep));
}

/**
 * A body of revolution turned half a step, its edges between the section's.
 * On the same angles a cone met the thread edge on edge (on the root, on a
 * flank), in edges of four faces that a slicer reports as broken.
 */
const between = (n: Node) => rotate([0, 0, 180 / SEGMENTS], n);

/**
 * A threaded hole through `solid` from z = 0 to `length`, `clearance` mm
 * wider than the matching bolt, its mouths countersunk so the bolt finds it.
 */
export function threadedHole(t: Thread, length: number, clearance: number): Node {
	const R = t.major / 2 + clearance;
	const sink = threadDepth(t) + clearance;
	return union(
		translate([0, 0, -0.01], threadedRod(t, length + 0.02, { grow: clearance })),
		// 90° countersinks at both mouths.
		between(
			union(
				translate([0, 0, -0.01], cylinder(sink, R + 0.01, R - sink, SEGMENTS)),
				translate([0, 0, length - sink + 0.01], cylinder(sink, R - sink, R + 0.01, SEGMENTS))
			)
		)
	);
}

/** A plain round hole for a bolt to pass (no thread), with a little play. */
export function clearanceHole(major: number, length: number, play = 0.4): Node {
	return translate([0, 0, -1], cylinder(length + 2, major / 2 + play, major / 2 + play, 48));
}

/**
 * A countersunk hole for a wood screw of diameter d at (x, y) through a
 * plate T thick, head up: the shank with 0.15 mm play, a 90° cone to a
 * head twice the shank.
 */
export function countersunk(x: number, y: number, d: number, T: number): Node {
	const head = d * 2;
	return union(
		translate([x, y, -1], cylinder(T + 2, d / 2 + 0.15, d / 2 + 0.15, 32)),
		translate(
			[x, y, T - (head - d) / 2],
			cylinder((head - d) / 2 + 0.01, d / 2 + 0.15, head / 2 + 0.15, 32)
		)
	);
}

/** The core inside a thread — what is left of a rod with the thread taken off. */
export function threadCore(t: Thread, length: number): Node {
	return cylinder(length, minorDiameter(t) / 2, minorDiameter(t) / 2, SEGMENTS);
}

/** An annulus of the given diameters (washers, spacers): 2D. */
export function ring(outer: number, inner: number, fn = 96): Node {
	return difference(circle(outer / 2, fn), circle(inner / 2, fn));
}
