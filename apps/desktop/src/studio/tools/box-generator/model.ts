/**
 * «Коробки и Gridfinity»: Gridfinity bins and baseplates after the public
 * Gridfinity specification (Zack Freedman, gridfinity.xyz), and plain
 * rounded boxes (the geometry of «Коробочка с крышкой»).
 *
 * Gridfinity numbers used here (42 mm grid):
 *  - a bin is 0.5 mm smaller than its grid (41.5 mm per cell, 0.25 mm each
 *    side), corner radius 3.75 mm; height 7 mm per unit, measured from the
 *    bottom of the feet to the top of the walls, the stacking lip on top;
 *  - foot profile, bottom up: 0.8 mm at 45°, 1.8 mm straight, 2.15 mm at 45°
 *    (4.75 mm) — the foot bottom is 35.6 mm with a 0.8 mm radius;
 *  - stacking lip, bottom up: 0.7 mm at 45°, 1.8 mm straight, 1.9 mm at 45°
 *    (4.4 mm), the innermost point 2.6 mm in from the outer wall, with a 45°
 *    support under it; a bin stacked on top seats on the 45° faces;
 *  - baseplate pocket, top down: 2.15 mm at 45°, 1.8 mm straight, 0.7 mm at
 *    45° (4.65 mm), 42 mm with a 4 mm radius at the top;
 *  - magnets 6×2 mm in Ø6.5 × 2.4 mm holes, M3 screws Ø3 × 6 mm, both 13 mm
 *    from the cell centre in X and Y.
 */
import {
	circle,
	cube,
	cylinder,
	difference,
	intersection,
	extrude,
	loft,
	part,
	polygon,
	rotate,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import {
	BOX_MASTER_DEFAULTS,
	boxSolids,
	clampBox,
	type BoxMasterParams
} from '../box-master/model';
import { num } from '../scad-literals';
import * as m from '$msg/tools/box-generator';
import { clamp as c } from '../shared/math';

export type BoxMode = 'gridfinity' | 'baseplate' | 'box';
export type LipStyle = 'standard' | 'thin' | 'none';
export type BaseStyle = 'standard' | 'flat';
export type HolePlace = 'none' | 'corners' | 'all';

export interface BoxGeneratorParams {
	mode: BoxMode;
	/** Gridfinity grid, mm (42 by the standard) */
	pitch: number;
	/** Bin size in grid cells and in 7 mm height units */
	unitsX: number;
	unitsY: number;
	unitsZ: number;
	lip: LipStyle;
	base: BaseStyle;
	wall: number;
	divider: number;
	/** Compartments inside the bin */
	compX: number;
	compY: number;
	scoop: boolean;
	labelShelf: boolean;
	magnets: HolePlace;
	magnetD: number;
	magnetH: number;
	screws: HolePlace;
	heatSet: boolean;
	lid: boolean;
	/** Baseplate size in cells */
	plateX: number;
	plateY: number;
	plateMagnets: boolean;
	/** Fill a drawer: as many cells as fit, the rest a solid margin round them. */
	plateFit: boolean;
	/** Inside of the drawer, mm. */
	drawerW: number;
	drawerD: number;
	/** Cut into pieces no larger than the bed, along the cell walls. */
	plateSplit: boolean;
	/** Printer bed side, mm. */
	plateBed: number;
	/** Plain box («Обычная коробка»), inner size */
	box: BoxMasterParams;
}

export const BOX_GENERATOR_DEFAULTS: BoxGeneratorParams = {
	mode: 'gridfinity',
	pitch: 42,
	unitsX: 2,
	unitsY: 1,
	unitsZ: 5,
	lip: 'standard',
	base: 'standard',
	wall: 1,
	divider: 1,
	compX: 1,
	compY: 1,
	scoop: false,
	labelShelf: false,
	magnets: 'none',
	magnetD: 6.5,
	magnetH: 2.4,
	screws: 'none',
	heatSet: false,
	lid: false,
	plateX: 3,
	plateY: 3,
	plateMagnets: false,
	plateFit: false,
	drawerW: 400,
	drawerD: 300,
	plateSplit: false,
	plateBed: 220,
	box: {
		...BOX_MASTER_DEFAULTS,
		width: 120,
		depth: 80,
		height: 45,
		wall: 1.6,
		floor: 1.6,
		radius: 6,
		lid: 'none',
		rim: 6
	}
};

export const BOX_GENERATOR_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<BoxGeneratorParams>;
}[] = [
	{
		id: 'bin1',
		get label() {
			return m.t_box_generator_preset_bin1();
		},
		params: {
			mode: 'gridfinity',
			unitsX: 1,
			unitsY: 1,
			unitsZ: 3,
			compX: 1,
			compY: 1,
			scoop: true,
			labelShelf: false
		}
	},
	{
		id: 'bin2',
		get label() {
			return m.t_box_generator_preset_bin2();
		},
		params: {
			mode: 'gridfinity',
			unitsX: 2,
			unitsY: 1,
			unitsZ: 6,
			compX: 2,
			compY: 1,
			scoop: true,
			labelShelf: true
		}
	},
	{
		id: 'tray',
		get label() {
			return m.t_box_generator_preset_tray();
		},
		params: {
			mode: 'gridfinity',
			unitsX: 3,
			unitsY: 2,
			unitsZ: 2,
			compX: 3,
			compY: 2,
			scoop: false,
			labelShelf: false
		}
	},
	{
		id: 'plate',
		get label() {
			return m.t_box_generator_preset_plate();
		},
		params: { mode: 'baseplate', plateX: 4, plateY: 4 }
	},
	{
		id: 'box',
		get label() {
			return m.t_box_generator_preset_box();
		},
		params: { mode: 'box' }
	}
];

const ci = (v: number, lo: number, hi: number) => Math.round(c(v, lo, hi));
const pick = <T extends string>(v: T, options: readonly T[], fallback: T): T =>
	options.includes(v) ? v : fallback;

export function clampGenerator(p: BoxGeneratorParams): BoxGeneratorParams {
	const pitch = c(p.pitch, 30, 100);
	const wall = c(p.wall, 0.8, 3);
	const divider = c(p.divider, 0.4, 5);
	// Compartments at least 5 mm wide: more would leave a solid block.
	const most = (units: number) =>
		Math.max(1, Math.floor((units * pitch - 2 * CLEAR - 2 * wall + divider) / (5 + divider)));
	return {
		mode: pick(p.mode, ['gridfinity', 'baseplate', 'box'], 'gridfinity'),
		pitch: c(p.pitch, 30, 100),
		unitsX: ci(p.unitsX, 1, 10),
		unitsY: ci(p.unitsY, 1, 10),
		unitsZ: ci(p.unitsZ, 1, 20),
		lip: pick(p.lip, ['standard', 'thin', 'none'], 'standard'),
		base: pick(p.base, ['standard', 'flat'], 'standard'),
		wall: c(p.wall, 0.8, 3),
		divider: c(p.divider, 0.4, 5),
		compX: ci(p.compX, 1, Math.min(12, most(ci(p.unitsX, 1, 10)))),
		compY: ci(p.compY, 1, Math.min(12, most(ci(p.unitsY, 1, 10)))),
		scoop: !!p.scoop,
		labelShelf: !!p.labelShelf,
		magnets: pick(p.magnets, ['none', 'corners', 'all'], 'none'),
		magnetD: c(p.magnetD, 2, 12),
		magnetH: c(p.magnetH, 0.5, 4),
		screws: pick(p.screws, ['none', 'corners', 'all'], 'none'),
		heatSet: !!p.heatSet,
		lid: !!p.lid && p.lip !== 'none',
		plateX: ci(p.plateX, 1, 10),
		plateY: ci(p.plateY, 1, 10),
		plateMagnets: !!p.plateMagnets,
		plateFit: !!p.plateFit,
		drawerW: c(p.drawerW, c(p.pitch, 30, 100) + 2, 1200),
		drawerD: c(p.drawerD, c(p.pitch, 30, 100) + 2, 1200),
		plateSplit: !!p.plateSplit,
		plateBed: c(p.plateBed, 100, 500),
		box: clampBox(p.box)
	};
}

// ---------- Gridfinity ----------

const FN = 32;
const CLEAR = 0.25;
const R_OUT = 3.75;
const FOOT_H = 4.75;
const LIP_H = 4.4;
const LIP_IN = 2.6;
const LIP_BAND = 1.9;
const PLATE_H = 4.65;
/**
 * The lip and the baseplate end in a 45° face that would meet the outer wall
 * in a zero-width knife edge; they stop where that face is this far in, so
 * the top keeps a printable flat. The seat (the 45° faces) is unchanged.
 */
const KNIFE = 0.3;
const HOLE_OFFSET = 13;
/** Hole for an M3 heat-set insert (a common 5.7 mm brass insert), mm. */
const INSERT_D = 4;
const INSERT_H = 6;
/** Walls and dividers stay under the feet of a bin stacked on top. */
const STACK_CLEAR = 0.6;

/** The bin outline shrunk by `inset` (radius follows, never below 0.2 mm). */
function outline(w: number, d: number, inset: number, rOuter = R_OUT): Node {
	return rrect(w - 2 * inset, d - 2 * inset, Math.max(0.2, rOuter - inset), FN);
}

/** One foot of a bin, bottom on z = 0, top at FOOT_H (cell = pitch − 0.5). */
function foot(cell: number, top = FOOT_H): Node {
	const levels = [
		{ z: 0, shape: outline(cell, cell, 2.95) },
		{ z: 0.8, shape: outline(cell, cell, 2.15) },
		{ z: 2.6, shape: outline(cell, cell, 2.15) },
		{ z: FOOT_H, shape: outline(cell, cell, 0) }
	];
	if (top > FOOT_H) levels.push({ z: top, shape: outline(cell, cell, 0) });
	return loft(levels);
}

/** Centres of the grid cells, the bin centred on the origin. */
function cells(nx: number, ny: number, pitch: number): [number, number][] {
	const out: [number, number][] = [];
	for (let i = 0; i < nx; i++)
		for (let j = 0; j < ny; j++) out.push([(i - (nx - 1) / 2) * pitch, (j - (ny - 1) / 2) * pitch]);
	return out;
}

/** Magnet/screw spots: four per cell, or only the four outer corners. */
function holeSpots(nx: number, ny: number, pitch: number, where: HolePlace): [number, number][] {
	if (where === 'none') return [];
	const o = Math.min(HOLE_OFFSET, pitch / 2 - 6);
	if (where === 'corners') {
		const hx = ((nx - 1) / 2) * pitch + o;
		const hy = ((ny - 1) / 2) * pitch + o;
		return [
			[-hx, -hy],
			[hx, -hy],
			[-hx, hy],
			[hx, hy]
		];
	}
	return cells(nx, ny, pitch).flatMap(([x, y]) => [
		[x - o, y - o] as [number, number],
		[x + o, y - o] as [number, number],
		[x - o, y + o] as [number, number],
		[x + o, y + o] as [number, number]
	]);
}

/** Positions of the walls between n equal compartments over `span`. */
function splits(span: number, n: number, t: number): number[] {
	const cw = (span - (n - 1) * t) / n;
	return Array.from({ length: n - 1 }, (_, i) => -span / 2 + (i + 1) * cw + (i + 0.5) * t);
}

/** A profile drawn in the YZ plane (u → y, v → z), extruded along X. */
function alongX(x0: number, length: number, profile: Node): Node {
	return translate([x0, 0, 0], rotate([90, 0, 90], extrude(length, profile)));
}

export interface BinInfo {
	size: [number, number, number];
	/** Free space of one compartment: width, depth, height above the floor */
	compartment: [number, number, number];
	floorZ: number;
}

export function binInfo(input: BoxGeneratorParams): BinInfo {
	const p = clampGenerator(input);
	const w = p.unitsX * p.pitch - 2 * CLEAR;
	const d = p.unitsY * p.pitch - 2 * CLEAR;
	const H = p.unitsZ * 7;
	const floorZ = floorHeight(p);
	const top = dividerTop(p);
	const iw = w - 2 * p.wall;
	const id = d - 2 * p.wall;
	return {
		size: [w, d, H + (p.lip === 'none' ? 0 : LIP_H - KNIFE)],
		compartment: [
			(iw - (p.compX - 1) * p.divider) / p.compX,
			(id - (p.compY - 1) * p.divider) / p.compY,
			Math.max(0, top - floorZ)
		],
		floorZ
	};
}

/** Dividers end under the lip support and under the feet of a stacked bin. */
function dividerTop(p: BoxGeneratorParams): number {
	const H = p.unitsZ * 7;
	if (p.lip === 'none') return H;
	const supportFrom =
		p.lip === 'standard'
			? H - Math.max(0, LIP_IN - p.wall)
			: H + 0.7 - Math.max(0, LIP_BAND - p.wall);
	return Math.min(H - STACK_CLEAR, supportFrom - 0.2);
}

function floorHeight(p: BoxGeneratorParams): number {
	const holeDepth = Math.max(
		p.magnets !== 'none' ? p.magnetH : 0,
		p.screws !== 'none' ? (p.heatSet ? INSERT_H : 6) : 0
	);
	const solidBelow = p.base === 'standard' ? FOOT_H + 1.2 : 1.6;
	return Math.min(p.unitsZ * 7 - 2, Math.max(solidBelow, holeDepth + 0.8));
}

function bin(p: BoxGeneratorParams): Node {
	const pitch = p.pitch;
	const cell = pitch - 2 * CLEAR;
	const w = p.unitsX * pitch - 2 * CLEAR;
	const d = p.unitsY * pitch - 2 * CLEAR;
	const H = p.unitsZ * 7;
	const wall = p.wall;
	const floorZ = floorHeight(p);
	const lipOn = p.lip !== 'none';
	const topZ = H + (lipOn ? LIP_H - KNIFE : 0);
	const bodyFrom = p.base === 'standard' ? FOOT_H : 0;

	// Outer solid: the feet (or a flat plate) and the walls.
	const outer = union(
		p.base === 'standard'
			? union(...cells(p.unitsX, p.unitsY, pitch).map(([x, y]) => translate([x, y, 0], foot(cell))))
			: null,
		translate([0, 0, bodyFrom], extrude(topZ - bodyFrom, outline(w, d, 0)))
	);

	// The cavity: straight walls, then the lip support and the lip itself.
	const cavity: Node[] = [];
	const lift = (z: number, h: number, inset: number) =>
		translate([0, 0, z], extrude(h, outline(w, d, inset)));
	const ramp = (z0: number, i0: number, z1: number, i1: number) =>
		loft([
			{ z: z0, shape: outline(w, d, i0) },
			{ z: z1, shape: outline(w, d, i1) }
		]);
	// Above the top the lip's 45° face runs on, so the rim is cut clean.
	const lipTop = () => ramp(H + 2.5, LIP_BAND, topZ + 1, LIP_BAND - (topZ + 1 - (H + 2.5)));
	if (!lipOn) {
		cavity.push(lift(floorZ, H - floorZ + 1, wall));
	} else if (p.lip === 'standard') {
		const support = Math.max(0, LIP_IN - wall);
		cavity.push(
			lift(floorZ, H - support - floorZ + 0.01, wall),
			ramp(H - support, wall, H, LIP_IN),
			ramp(H, LIP_IN, H + 0.7, LIP_BAND),
			lift(H + 0.7, 1.8, LIP_BAND),
			lipTop()
		);
	} else {
		// Thin lip: the same seat for a stacked bin, without the step under it.
		const support = Math.max(0, LIP_BAND - wall);
		const z0 = H + 0.7 - support;
		cavity.push(
			lift(floorZ, z0 - floorZ + 0.01, wall),
			ramp(z0, wall, H + 0.7, LIP_BAND),
			lift(H + 0.7, 1.8, LIP_BAND),
			lipTop()
		);
	}

	// Magnets from below, screws (or heat-set inserts) deeper on the same spots.
	const holes: Node[] = [];
	for (const [x, y] of holeSpots(p.unitsX, p.unitsY, pitch, p.magnets))
		holes.push(
			translate([x, y, -0.01], cylinder(p.magnetH + 0.01, p.magnetD / 2, p.magnetD / 2, FN))
		);
	for (const [x, y] of holeSpots(p.unitsX, p.unitsY, pitch, p.screws)) {
		const [hd, hh] = p.heatSet ? [INSERT_D, INSERT_H] : [3, 6];
		holes.push(translate([x, y, -0.01], cylinder(hh + 0.01, hd / 2, hd / 2, FN)));
	}

	// Inside: dividers, scoops at the front of each row, label shelves at the back.
	const iw = w - 2 * wall;
	const id = d - 2 * wall;
	const divTop = dividerTop(p);
	const t = p.divider;
	const inner: Node[] = [];
	const dh = divTop - floorZ + 0.01;
	for (const x of splits(iw, p.compX, t))
		inner.push(translate([x - t / 2, -id / 2 - wall / 2, floorZ - 0.01], cube([t, id + wall, dh])));
	for (const y of splits(id, p.compY, t))
		inner.push(translate([-iw / 2 - wall / 2, y - t / 2, floorZ - 0.01], cube([iw + wall, t, dh])));
	const cd = (id - (p.compY - 1) * t) / p.compY;
	const rowFront = (j: number) => -id / 2 + j * (cd + t);
	const freeH = divTop - floorZ;
	if (p.scoop && freeH > 4) {
		const r = Math.min(cd * 0.4, freeH * 0.75, 20);
		for (let j = 0; j < p.compY; j++) {
			const y0 = rowFront(j);
			const profile = difference(
				translate(
					[y0 - 0.01, floorZ - 0.01],
					polygon([
						[0, 0],
						[r + 0.01, 0],
						[0, r + 0.01]
					])
				),
				translate([y0 + r, floorZ + r], circle(r, 64))
			);
			inner.push(alongX(-iw / 2 - 0.01, iw + 0.02, profile));
		}
	}
	if (p.labelShelf && freeH > 6) {
		// A ledge along the back of each row, 45° underneath: prints without
		// support. It sits a step below the divider tops (no shared faces).
		const st = 1.2;
		const top = divTop - 0.4;
		const sw = Math.min(12, cd * 0.45, freeH - st - 1.4);
		for (let j = 0; j < p.compY; j++) {
			const y1 = rowFront(j) + cd;
			inner.push(
				alongX(
					-iw / 2 - 0.01,
					iw + 0.02,
					polygon([
						[y1 - sw, top],
						[y1 + 0.01, top],
						[y1 + 0.01, top - st - sw],
						[y1 - sw, top - st]
					])
				)
			);
		}
	}

	return part('bin', difference(union(difference(outer, ...cavity), ...inner), ...holes));
}

/** The lid sits in the stacking lip like a bin on top; printed face down. */
function gridLid(p: BoxGeneratorParams): Node {
	const w = p.unitsX * p.pitch - 2 * CLEAR;
	const d = p.unitsY * p.pitch - 2 * CLEAR;
	const plate = 2;
	// The foot profile upside down, one plug over the whole bin, hollow.
	const plug = loft([
		{ z: plate, shape: outline(w, d, KNIFE) },
		{ z: plate + 2.15 - KNIFE, shape: outline(w, d, 2.15) },
		{ z: plate + 3.95 - KNIFE, shape: outline(w, d, 2.15) },
		{ z: plate + FOOT_H - KNIFE, shape: outline(w, d, 2.95) }
	]);
	return part(
		'lid',
		union(
			extrude(plate, outline(w, d, 0)),
			difference(plug, translate([0, 0, plate], extrude(FOOT_H + 1, outline(w, d, 2.95 + 1.6))))
		)
	);
}

/** A drawer is this much wider than its plate: 0,5 mm of play on each side. */
const DRAWER_PLAY = 1;

export interface PlateLayout {
	/** Cells across and deep. */
	nx: number;
	ny: number;
	/** Outer size of the whole plate, mm. */
	width: number;
	depth: number;
	/** Solid margin on each side round the cells, mm. */
	marginX: number;
	marginY: number;
	/** Cells in each piece, left to right and front to back. */
	piecesX: number[];
	piecesY: number[];
	/** Largest piece, mm. */
	largest: [number, number];
	/** Even single cells come out larger than the bed. */
	tooBig: boolean;
}

/**
 * Cells per piece along one side: the fewest pieces that fit the bed, as
 * even as they come, the smaller ones at the ends (they also carry the
 * margin).
 */
function chunks(n: number, margin: number, pitch: number, bed: number | null): number[] {
	const widthOf = (sizes: number[]) =>
		Math.max(
			...sizes.map(
				(s, i) => s * pitch + (i === 0 ? margin : 0) + (i === sizes.length - 1 ? margin : 0)
			)
		);
	if (!bed) return [n];
	for (let k = 1; k <= n; k++) {
		const small = Math.floor(n / k);
		const big = n % k;
		// The larger pieces in the middle.
		const order = [...Array(k).keys()].sort(
			(a, b) => Math.abs(a - (k - 1) / 2) - Math.abs(b - (k - 1) / 2) || a - b
		);
		const sizes = Array.from({ length: k }, () => small);
		for (let r = 0; r < big; r++) sizes[order[r]]++;
		if (widthOf(sizes) <= bed) return sizes;
	}
	return Array.from({ length: n }, () => 1);
}

export function plateLayout(input: BoxGeneratorParams): PlateLayout {
	const p = clampGenerator(input);
	const pitch = p.pitch;
	let nx = p.plateX;
	let ny = p.plateY;
	let width = nx * pitch;
	let depth = ny * pitch;
	if (p.plateFit) {
		width = p.drawerW - DRAWER_PLAY;
		depth = p.drawerD - DRAWER_PLAY;
		nx = Math.max(1, Math.floor(width / pitch));
		ny = Math.max(1, Math.floor(depth / pitch));
		width = Math.max(width, nx * pitch);
		depth = Math.max(depth, ny * pitch);
	}
	const marginX = (width - nx * pitch) / 2;
	const marginY = (depth - ny * pitch) / 2;
	const bed = p.plateSplit ? p.plateBed : null;
	const piecesX = chunks(nx, marginX, pitch, bed);
	const piecesY = chunks(ny, marginY, pitch, bed);
	const side = (sizes: number[], margin: number) =>
		Math.max(
			...sizes.map(
				(s, i) => s * pitch + (i === 0 ? margin : 0) + (i === sizes.length - 1 ? margin : 0)
			)
		);
	const largest: [number, number] = [side(piecesX, marginX), side(piecesY, marginY)];
	return {
		nx,
		ny,
		width,
		depth,
		marginX,
		marginY,
		piecesX,
		piecesY,
		largest,
		tooBig: !!bed && Math.max(...largest) > bed
	};
}

/** Pieces of a split plate lie this far apart. */
const PIECE_GAP = 10;

function baseplate(p: BoxGeneratorParams): Node {
	const pitch = p.pitch;
	const L = plateLayout(p);
	const w = L.width;
	const d = L.depth;
	const bottom = p.plateMagnets ? p.magnetH + 0.6 : 0;
	const top = bottom + PLATE_H - KNIFE;
	const cellShape = (inset: number) =>
		rrect(pitch - 2 * inset, pitch - 2 * inset, Math.max(0.2, 4 - inset), FN);
	// Without magnets the plate is a frame: the cells stay open below.
	const pocket = loft([
		...(p.plateMagnets ? [] : [{ z: -1, shape: cellShape(2.85) }]),
		{ z: bottom, shape: cellShape(2.85) },
		{ z: bottom + 0.7, shape: cellShape(2.15) },
		{ z: bottom + 2.5, shape: cellShape(2.15) },
		{ z: bottom + PLATE_H, shape: cellShape(0) },
		{ z: bottom + PLATE_H + 1, shape: cellShape(-1) }
	]);
	const pockets = cells(L.nx, L.ny, pitch).map(([x, y]) => translate([x, y, 0], pocket));
	const magnets = p.plateMagnets
		? holeSpots(L.nx, L.ny, pitch, 'all').map(([x, y]) =>
				translate(
					[x, y, bottom - p.magnetH],
					cylinder(p.magnetH + 0.01, p.magnetD / 2, p.magnetD / 2, FN)
				)
			)
		: [];
	const plate = difference(extrude(top, rrect(w, d, 4, FN)), ...pockets, ...magnets);
	if (L.piecesX.length === 1 && L.piecesY.length === 1) return part('baseplate', plate);
	// Cut along the cell walls; the pieces lie apart, as printed one by one.
	const edges = (sizes: number[], n: number, outer: number) => {
		const out = [-outer / 2 - 1];
		let c = 0;
		for (let i = 0; i < sizes.length - 1; i++) {
			c += sizes[i];
			out.push((c - n / 2) * pitch);
		}
		out.push(outer / 2 + 1);
		return out;
	};
	const ex = edges(L.piecesX, L.nx, w);
	const ey = edges(L.piecesY, L.ny, d);
	const kx = L.piecesX.length;
	const ky = L.piecesY.length;
	const pieces: Node[] = [];
	for (let i = 0; i < kx; i++)
		for (let j = 0; j < ky; j++) {
			const region = translate(
				[ex[i], ey[j], -1],
				cube([ex[i + 1] - ex[i], ey[j + 1] - ey[j], top + 2])
			);
			pieces.push(
				part(
					`baseplate_${i + 1}_${j + 1}`,
					translate(
						[(i - (kx - 1) / 2) * PIECE_GAP, (j - (ky - 1) / 2) * PIECE_GAP, 0],
						intersection(plate, region)
					)
				)
			);
		}
	return union(...pieces);
}

export function boxGeneratorModel(input: BoxGeneratorParams): Node {
	const p = clampGenerator(input);
	if (p.mode === 'baseplate') return baseplate(p);
	if (p.mode === 'box') {
		const s = boxSolids(p.box);
		if (!s.lid) return s.box;
		const total = s.boxSize[0] + 10 + s.lidSize[0];
		return union(
			translate([-total / 2 + s.boxSize[0] / 2, 0, 0], s.box),
			translate([total / 2 - s.lidSize[0] / 2, 0, 0], s.lid)
		);
	}
	const b = bin(p);
	if (!p.lid) return b;
	const w = p.unitsX * p.pitch - 2 * CLEAR;
	return union(translate([-(w / 2 + 5), 0, 0], b), translate([w / 2 + 5, 0, 0], gridLid(p)));
}

const mm = (v: number) => num(v, -1e4, 1e4);

export function boxGeneratorHeader(input: BoxGeneratorParams): string[] {
	const p = clampGenerator(input);
	if (p.mode === 'box') {
		const b = p.box;
		return [
			m.t_box_generator_header_box(),
			m.t_box_generator_header_box_size({
				width: mm(b.width),
				depth: mm(b.depth),
				height: mm(b.height),
				wall: mm(b.wall),
				floor: mm(b.floor)
			})
		];
	}
	if (p.mode === 'baseplate') {
		const L = plateLayout(p);
		const cells = { x: mm(L.nx), y: mm(L.ny), pitch: mm(p.pitch) };
		return [
			m.t_box_generator_header_plate(),
			p.plateMagnets
				? m.t_box_generator_header_plate_cells_magnets(cells)
				: m.t_box_generator_header_plate_cells(cells),
			...(p.plateFit
				? [
						m.t_box_generator_header_plate_drawer({
							drawerWidth: mm(p.drawerW),
							drawerDepth: mm(p.drawerD),
							width: mm(L.width),
							depth: mm(L.depth)
						})
					]
				: []),
			...(L.piecesX.length * L.piecesY.length > 1
				? [
						m.t_box_generator_header_plate_pieces({
							x: mm(L.piecesX.length),
							y: mm(L.piecesY.length),
							width: mm(L.largest[0]),
							depth: mm(L.largest[1])
						})
					]
				: [])
		];
	}
	return [
		m.t_box_generator_header_bin(),
		m.t_box_generator_header_bin_size({
			x: mm(p.unitsX),
			y: mm(p.unitsY),
			pitch: mm(p.pitch),
			units: mm(p.unitsZ)
		}),
		m.t_box_generator_header_bin_walls({ wall: mm(p.wall), x: mm(p.compX), y: mm(p.compY) })
	];
}

export function boxGeneratorScad(p: BoxGeneratorParams): string {
	return toScad(boxGeneratorModel(p), boxGeneratorHeader(p));
}
