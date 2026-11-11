/**
 * Snowflakes: six arms, each a spine with pairs of side branches at 60°,
 * mirrored about the arm, plus a hexagonal heart. The number picks the
 * pattern (a seeded generator), so the same number gives the same flake and
 * a set of several flakes are all different. Strokes are never thinner than
 * three lines of a 0.4 mm nozzle; a loop at the top arm for a thread.
 */
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/snowflake';
import {
	circle,
	difference,
	extrude,
	hull,
	polygon,
	rotate,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { clamp as c, seededRandom as random } from '../shared/math';

export interface SnowflakeParams {
	/** Picks the pattern */
	seed: number;
	diameter: number;
	/** Stroke width, mm */
	stroke: number;
	/** Plate thickness, mm */
	thickness: number;
	/** Side branches per arm side */
	branches: number;
	/** Raised spines on top, for a carved look */
	relief: boolean;
	loop: boolean;
	count: number;
}

export const SNOWFLAKE_DEFAULTS: SnowflakeParams = {
	seed: 7,
	diameter: 80,
	stroke: 2.4,
	thickness: 2.4,
	branches: 3,
	relief: true,
	loop: true,
	count: 1
};

export interface SnowflakePreset {
	id: string;
	label: string;
	params: Partial<SnowflakeParams>;
}

export const SNOWFLAKE_PRESETS: readonly SnowflakePreset[] = [
	{
		id: 'tree',
		get label() {
			return m.t_snowflake_preset_tree();
		},
		params: { seed: 7, diameter: 80 }
	},
	{
		id: 'window',
		get label() {
			return m.t_snowflake_preset_window();
		},
		params: { seed: 21, diameter: 140, stroke: 3.2, thickness: 2.8 }
	},
	{
		id: 'set',
		get label() {
			return m.t_snowflake_preset_set();
		},
		params: { seed: 3, diameter: 60, count: 6 }
	},
	{
		id: 'gift',
		get label() {
			return m.t_snowflake_preset_gift();
		},
		params: { seed: 12, diameter: 45, stroke: 2, thickness: 2, branches: 2 }
	}
];

export function clampSnowflake(p: SnowflakeParams): SnowflakeParams {
	return {
		seed: Math.round(c(p.seed, 1, 999)),
		diameter: c(p.diameter, 30, 200),
		stroke: c(p.stroke, 1.2, 6),
		thickness: c(p.thickness, 1.2, 8),
		branches: Math.round(c(p.branches, 1, 5)),
		relief: !!p.relief,
		loop: !!p.loop,
		count: Math.round(c(p.count, 1, 9))
	};
}

type Stroke = [Vec2, Vec2, number];
const FN = 16;

/** A stroke with round ends: the hull of two circles. */
const line = ([a, b, w]: Stroke): Node =>
	hull(translate([a[0], a[1]], circle(w / 2, FN)), translate([b[0], b[1]], circle(w / 2, FN)));

const at = (angle: number, len: number, from: Vec2): Vec2 => [
	from[0] + len * Math.sin(angle),
	from[1] + len * Math.cos(angle)
];

/** One arm along +Y: the spine, side branches, twigs on the long ones; mirrored. */
function armStrokes(p: SnowflakeParams, rnd: () => number): Stroke[] {
	const R = p.diameter / 2 - p.stroke / 2;
	const w = p.stroke;
	const strokes: Stroke[] = [[[0, 0], [0, R], w]];
	const n = p.branches;
	for (let i = 0; i < n; i++) {
		// Branches spread from the heart to near the tip, a little jitter.
		const t = R * (0.28 + (0.6 * (i + 0.3 + 0.4 * rnd())) / n);
		const room = R - t;
		const len = Math.max(w * 2, room * (0.45 + 0.5 * rnd()) * (i === n - 1 ? 0.7 : 1));
		const angle = (Math.PI / 180) * (50 + 20 * rnd());
		const root: Vec2 = [0, t];
		const tip = at(angle, len, root);
		const bw = Math.max(1.2, w * (0.75 + 0.2 * rnd()));
		strokes.push([root, tip, bw]);
		// A twig on a long branch, pointing outwards like the branch.
		if (len > 6 * w && rnd() > 0.3) {
			const k = 0.4 + 0.3 * rnd();
			const from = at(angle, len * k, root);
			strokes.push([
				from,
				at(angle - Math.PI / 3, len * (1 - k) * 0.6, from),
				Math.max(1.2, bw * 0.8)
			]);
		}
	}
	// Mirror every side stroke about the spine.
	const mirrored = strokes.slice(1).map(([a, b, sw]): Stroke => [[-a[0], a[1]], [-b[0], b[1]], sw]);
	return [...strokes, ...mirrored];
}

/** The heart: a hexagon, open in the middle on bigger flakes. */
function heart(p: SnowflakeParams, rnd: () => number): Node {
	const r = p.diameter * (0.08 + 0.05 * rnd());
	const hex = (rr: number) =>
		polygon(
			Array.from(
				{ length: 6 },
				(_, i): Vec2 => [rr * Math.sin((i * Math.PI) / 3), rr * Math.cos((i * Math.PI) / 3)]
			)
		);
	const hole = r - p.stroke * 1.2;
	return hole > 1.6 ? difference(hex(r), hex(hole)) : hex(r);
}

function flake2d(strokes: Stroke[], heartShape: Node): Node {
	const arm = union(...strokes.map(line));
	return union(heartShape, ...Array.from({ length: 6 }, (_, i) => rotate([0, 0, i * 60], arm)));
}

/** One flake, the bottom on the bed, centred on the origin. */
function flake(p: SnowflakeParams, seed: number): Node {
	const rnd = random(seed);
	const strokes = armStrokes(p, rnd);
	const body = extrude(p.thickness, flake2d(strokes, heart(p, rnd)));
	const parts: Node[] = [body];
	if (p.relief) {
		// Narrow ridges along every stroke: light catches them like cut glass.
		const ridge = strokes.map(([a, b, w]): Stroke => [a, b, Math.max(0.8, w * 0.4)]);
		const h = Math.min(1.2, p.thickness * 0.5);
		parts.push(
			translate(
				[0, 0, p.thickness - 0.01],
				extrude(
					h + 0.01,
					union(
						...Array.from({ length: 6 }, (_, i) =>
							rotate([0, 0, i * 60], union(...ridge.map(line)))
						)
					)
				)
			)
		);
	}
	if (p.loop) {
		const ro = Math.max(3, p.stroke * 1.4);
		const ri = Math.max(1.5, ro - Math.max(1.6, p.stroke));
		const y = p.diameter / 2 + ri - 0.2;
		parts.push(extrude(p.thickness, translate([0, y], difference(circle(ro, 32), circle(ri, 32)))));
	}
	return union(...parts);
}

/** Pitch of the grid a set is laid out on. */
export const pitchOf = (p: SnowflakeParams) => p.diameter + (p.loop ? 12 : 6);

export function snowflakeModel(input: SnowflakeParams): Node {
	const p = clampSnowflake(input);
	const cols = Math.ceil(Math.sqrt(p.count));
	const pitch = pitchOf(p);
	return union(
		...Array.from({ length: p.count }, (_, i) =>
			translate([(i % cols) * pitch, -Math.floor(i / cols) * pitch, 0], flake(p, p.seed + i * 101))
		)
	);
}

const mm = (v: number) => num(v, 4);

export function snowflakeSummary(input: SnowflakeParams): string {
	const p = clampSnowflake(input);
	const set =
		p.count > 1
			? m.t_snowflake_summary_set({ count: p.count, n: num(p.count) })
			: m.t_snowflake_summary_single();
	return m.t_snowflake_summary({
		what: set,
		diameter: mm(p.diameter),
		thickness: mm(p.thickness + (p.relief ? Math.min(1.2, p.thickness * 0.5) : 0))
	});
}

export function snowflakeHeader(input: SnowflakeParams): string[] {
	const p = clampSnowflake(input);
	return [
		m.t_snowflake_scad_title(),
		m.t_snowflake_scad_pattern({ seed: p.seed }),
		snowflakeSummary(p)
	];
}

export function snowflakeScad(p: SnowflakeParams): string {
	return toScad(snowflakeModel(p), snowflakeHeader(p));
}
