/**
 * «Шкатулка-лабиринт»: a gift box that opens only along a maze. A cup with
 * a maze cut round its outside and a flange at the foot; a sleeve with a
 * closed top and a small nub inside its rim. The sleeve goes on from above,
 * the nub enters the maze at the cup's rim and must find its way down; on
 * the bottom row the sleeve sits on the flange, closed. To open, find the
 * way back.
 *
 * The maze is a perfect one (one path between any two places) on a grid of
 * cells round the cup, dug from the entrance by a seeded depth-first walk.
 * Grooves have a 45° ceiling and the nub the same 45° face, so the cup
 * prints upright and the sleeve upside down, both without supports.
 */
import { num } from '$lib/i18n/current';
import * as msg from '$msg/tools/maze-box';
import {
	cube,
	cylinder,
	difference,
	mirror,
	part,
	polygon,
	revolveArc,
	rotate,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { clamp, seededRandom as random } from '../shared/math';

export interface MazeBoxParams {
	/** Inside of the cup: diameter and height, mm */
	inner: number;
	height: number;
	/** Groove width and depth, mm */
	groove: number;
	depth: number;
	clearance: number;
	seed: number;
}

export const MAZE_BOX_DEFAULTS: MazeBoxParams = {
	inner: 40,
	height: 60,
	groove: 4,
	depth: 1.6,
	clearance: 0.35,
	seed: 1
};

export const MAZE_BOX_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<MazeBoxParams>;
}[] = [
	{
		id: 'gift',
		get label() {
			return msg.t_maze_box_preset_gift();
		},
		params: { inner: 40, height: 60 }
	},
	{
		id: 'money',
		get label() {
			return msg.t_maze_box_preset_money();
		},
		params: { inner: 25, height: 80 }
	},
	{
		id: 'big',
		get label() {
			return msg.t_maze_box_preset_big();
		},
		params: { inner: 60, height: 80, groove: 5 }
	}
];

export function clampMazeBox(p: MazeBoxParams): MazeBoxParams {
	const groove = clamp(p.groove, 3, 8);
	return {
		inner: clamp(p.inner, 15, 120),
		height: clamp(p.height, 30, 150),
		groove,
		depth: clamp(p.depth, 1, Math.min(3, groove / 2)),
		clearance: clamp(p.clearance, 0.2, 0.6),
		seed: Math.round(clamp(p.seed, 1, 9999))
	};
}

/** Plastic behind the groove, the floor, the flange's height, the sleeve's wall and top, mm. */
const BACK = 1.2;
const FLOOR = 1.6;
const FLANGE = 3;
const SLEEVE = 2;
const TOP = 2;

export interface MazeLayout {
	/** Cup outside radius, sleeve inside and outside radius, mm */
	cup: number;
	sleeveIn: number;
	sleeveOut: number;
	/** Cells round and up; their centres (angle, degrees; height, mm) */
	cols: number;
	rows: number;
	angleOf: (i: number) => number;
	zOf: (j: number) => number;
	/** Passages: from cell to cell (i, j) */
	links: [[number, number], [number, number]][];
	/** The cell the way in reaches from the rim */
	entry: [number, number];
	/** Cells on the way from the entrance to the bottom row, for the solution */
	path: [number, number][];
}

export function mazeLayout(input: MazeBoxParams): MazeLayout {
	const p = clampMazeBox(input);
	const cup = p.inner / 2 + p.depth + BACK;
	const sleeveIn = cup + p.clearance;
	const sleeveOut = sleeveIn + SLEEVE;
	const pitch = p.groove * 2;
	const cols = Math.max(6, Math.floor((2 * Math.PI * cup) / pitch));
	// Rows from just above the flange to a groove below the rim.
	const z0 = FLANGE + p.groove;
	const z1 = FLANGE + p.height - 1.5 * p.groove;
	const rows = Math.max(3, Math.floor((z1 - z0) / pitch) + 1);
	const step = rows > 1 ? (z1 - z0) / (rows - 1) : 0;
	const angleOf = (i: number) => ((((i % cols) + cols) % cols) * 360) / cols;
	const zOf = (j: number) => z0 + j * step;

	// Depth-first walk from the entrance (top row, column 0).
	const rnd = random(p.seed);
	const seen = new Set<string>();
	const key = (i: number, j: number) => `${(i + cols) % cols},${j}`;
	const links: MazeLayout['links'] = [];
	const parent = new Map<string, string>();
	const entry: [number, number] = [0, rows - 1];
	const stack: [number, number][] = [entry];
	seen.add(key(...entry));
	while (stack.length) {
		const [i, j] = stack[stack.length - 1];
		const next = (
			[
				[i + 1, j],
				[i - 1, j],
				[i, j + 1],
				[i, j - 1]
			] as [number, number][]
		)
			.map(([a, b]) => [(a + cols) % cols, b] as [number, number])
			.filter(([a, b]) => b >= 0 && b < rows && !seen.has(key(a, b)));
		if (!next.length) {
			stack.pop();
			continue;
		}
		const pick = next[Math.floor(rnd() * next.length)];
		seen.add(key(...pick));
		parent.set(key(...pick), key(i, j));
		links.push([[i, j], pick]);
		stack.push(pick);
	}
	// The way down: from the bottom-row cell furthest along the maze back to the entrance.
	let far: [number, number] = [0, 0];
	let farLen = -1;
	for (let i = 0; i < cols; i++) {
		let len = 0;
		for (let k = key(i, 0); parent.has(k); k = parent.get(k)!) len++;
		if (len > farLen) {
			farLen = len;
			far = [i, 0];
		}
	}
	const path: [number, number][] = [];
	for (let k: string | undefined = key(...far); k; k = parent.get(k)) {
		const [a, b] = k.split(',').map(Number);
		path.unshift([a, b]);
	}
	return { cup, sleeveIn, sleeveOut, cols, rows, angleOf, zOf, links, entry, path };
}

type Pt = [number, number];

/** The groove's cross-section at the surface radius r, centred on height z: a 45° ceiling. */
function grooveProfile(r: number, z: number, w: number, d: number): Pt[] {
	return [
		[r - d, z - w / 2],
		[r + 1, z - w / 2],
		[r + 1, z + w / 2 + 1],
		[r - d, z + w / 2 - d]
	];
}

/** A stretch of groove round the cup, from angle a over `sweep` degrees. */
function arcGroove(r: number, z: number, w: number, d: number, a: number, sweep: number): Node {
	return rotate([0, 0, a], revolveArc(48, sweep, polygon(grooveProfile(r, z, w, d))));
}

export function mazeParts(input: MazeBoxParams): {
	cup: Node;
	sleeve: Node;
	sleeveInUse: Node;
	/** The nub alone, in use, at angle 0 on the bottom row */
	nub: Node;
	layout: MazeLayout;
} {
	const p = clampMazeBox(input);
	const L = mazeLayout(p);
	const w = p.groove;
	const d = p.depth;
	const R = L.cup;
	// A cell: a short stretch of groove a groove wide.
	const cellSweep = (w / R) * (180 / Math.PI);
	const cells: Node[] = [];
	for (let i = 0; i < L.cols; i++)
		for (let j = 0; j < L.rows; j++)
			cells.push(arcGroove(R, L.zOf(j), w, d, L.angleOf(i) - cellSweep / 2, cellSweep));
	const passages = L.links.map(([[i1, j1], [i2, j2]]) => {
		if (j1 === j2) {
			// Round the cup: the short way between neighbouring columns.
			const a1 = L.angleOf(i1);
			let delta = L.angleOf(i2) - a1;
			if (delta > 180) delta -= 360;
			if (delta < -180) delta += 360;
			const from = delta > 0 ? a1 : a1 + delta;
			return arcGroove(R, L.zOf(j1), w, d, from, Math.abs(delta));
		}
		// Up the cup: a straight slot between the two cells' heights.
		const lo = Math.min(L.zOf(j1), L.zOf(j2));
		const hi = Math.max(L.zOf(j1), L.zOf(j2));
		return rotate(
			[0, 0, L.angleOf(i1)],
			// A hair inside the cells' sides, back and floors: coinciding faces leave
			// specks, and touching ones (the back on the cell's wall, a passage on
			// the one under it) edges of four faces that a slicer reports as broken.
			translate(
				[R - d + 0.02, -w / 2 + 0.02, lo - w / 2 + 0.05],
				cube([d + 0.98, w - 0.04, hi - lo + 0.05])
			)
		);
	});
	// The way in: from the top cell straight up through the rim.
	const top = L.zOf(L.entry[1]);
	const entrance = rotate(
		[0, 0, L.angleOf(L.entry[0])],
		translate(
			[R - d + 0.02, -w / 2 + 0.02, top - w / 2 + 0.05],
			cube([d + 0.98, w - 0.04, FLANGE + p.height - top + w / 2 + 1])
		)
	);
	const cup = difference(
		union(cylinder(FLANGE, L.sleeveOut, L.sleeveOut, 128), cylinder(FLANGE + p.height, R, R, 128)),
		translate([0, 0, FLOOR], cylinder(FLANGE + p.height, p.inner / 2, p.inner / 2, 96)),
		...cells,
		...passages,
		entrance
	);

	// The sleeve as in use: its rim on the flange, closed at the top, the nub inside the rim.
	const c = p.clearance;
	const sleeveH = p.height + c + TOP;
	const zn = L.zOf(0);
	const nubW = w - 2 * c;
	const nub = rotate(
		[0, 0, -((nubW / L.sleeveIn) * (180 / Math.PI)) / 2],
		revolveArc(
			24,
			(nubW / L.sleeveIn) * (180 / Math.PI),
			polygon([
				[R - d + c, zn - w / 2 + c],
				[L.sleeveIn + 0.5, zn - w / 2 + c],
				[L.sleeveIn + 0.5, zn + w / 2 - c * Math.SQRT2 + (L.sleeveIn + 0.5 - R)],
				[R - d + c, zn + w / 2 - c * Math.SQRT2 - (d - c)]
			])
		)
	);
	const sleeveInUse = union(
		difference(
			translate([0, 0, FLANGE], cylinder(sleeveH, L.sleeveOut, L.sleeveOut, 128)),
			translate([0, 0, FLANGE - 1], cylinder(sleeveH - TOP + 1, L.sleeveIn, L.sleeveIn, 128))
		),
		nub
	);
	// Printed upside down, its top on the bed, beside the cup.
	const sleeve = translate(
		[2 * L.sleeveOut + 10, 0, FLANGE + sleeveH],
		mirror([0, 0, 1], sleeveInUse)
	);
	return { cup, sleeve, sleeveInUse, nub, layout: L };
}

export function mazeBoxModel(input: MazeBoxParams): Node {
	const m = mazeParts(input);
	return union(part('cup', m.cup), part('sleeve', m.sleeve));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function mazeBoxSummary(input: MazeBoxParams): string {
	const p = clampMazeBox(input);
	const L = mazeLayout(p);
	return msg.t_maze_box_summary({
		inner: mm(p.inner),
		height: mm(p.height),
		outer: mm(2 * L.sleeveOut),
		cols: L.cols,
		rows: L.rows,
		count: L.path.length,
		n: num(L.path.length)
	});
}

export function mazeBoxHeader(input: MazeBoxParams): string[] {
	const p = clampMazeBox(input);
	return [
		msg.t_maze_box_header_title(),
		mazeBoxSummary(p),
		msg.t_maze_box_header_grooves({
			groove: mm(p.groove),
			depth: mm(p.depth),
			clearance: mm(p.clearance),
			seed: p.seed
		}),
		msg.t_maze_box_header_print()
	];
}

export function mazeBoxScad(p: MazeBoxParams): string {
	return toScad(mazeBoxModel(p), mazeBoxHeader(p));
}
