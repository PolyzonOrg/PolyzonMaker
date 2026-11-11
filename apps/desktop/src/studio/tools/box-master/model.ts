/**
 * «Коробочка с крышкой»: a box with rounded corners, optional compartments
 * and a lid of one of three kinds — pressed in (a rim enters the box with a
 * clearance), snapped (the rim has a bead that clicks into a groove inside
 * the box wall), a cap over the outside of the walls, or a pencil-case lid that
 * slides along dovetail grooves in the side walls. A label on the lid is
 * engraved, or raised in a recessed field so it still prints face down. Both
 * parts print side by side without supports: the box on its floor, the lid
 * on its face (the label is mirrored to read right on the finished lid).
 * The box and lid geometry is shared with the box generator's plain box.
 */
import {
	difference,
	extrude,
	loft,
	mirror,
	part,
	rrect,
	text,
	translate,
	union,
	cube,
	cylinder,
	hull,
	rotate,
	sphere,
	toScad,
	type Node
} from '../csg/csg';
import { num } from '../scad-literals';
import * as m from '$msg/tools/box-master';

export type LidKind = 'none' | 'inset' | 'snap' | 'cap' | 'slide';
export type LabelStyle = 'engrave' | 'emboss';

export interface BoxMasterParams {
	/** Inner size, mm */
	width: number;
	depth: number;
	height: number;
	wall: number;
	floor: number;
	radius: number;
	lid: LidKind;
	/** Gap between the lid and the box wall, mm */
	clearance: number;
	/** How deep the lid rim enters the box (or the cap covers it), mm */
	rim: number;
	/** Compartments along the width and the depth */
	cols: number;
	rows: number;
	label: string;
	labelSize: number;
	labelStyle: LabelStyle;
	/** Rounded bottoms: every compartment its own scoop, easy to sweep out. */
	scoop: boolean;
	/** Radius of the rounded bottom, mm */
	scoopRadius: number;
}

export const BOX_MASTER_DEFAULTS: BoxMasterParams = {
	width: 80,
	depth: 60,
	height: 40,
	wall: 2,
	floor: 1.6,
	radius: 4,
	lid: 'inset',
	clearance: 0.25,
	rim: 6,
	cols: 1,
	rows: 1,
	label: '',
	labelSize: 8,
	labelStyle: 'engrave',
	scoop: false,
	scoopRadius: 8
};

export const BOX_MASTER_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<BoxMasterParams>;
}[] = [
	{
		id: 'small',
		get label() {
			return m.t_box_master_preset_small();
		},
		params: { width: 60, depth: 40, height: 25, cols: 1, rows: 1 }
	},
	{
		id: 'cards',
		get label() {
			return m.t_box_master_preset_cards();
		},
		params: { width: 92, depth: 57, height: 30, radius: 3, cols: 1, rows: 1, lid: 'cap' }
	},
	{
		id: 'pills',
		get label() {
			return m.t_box_master_preset_pills();
		},
		params: { width: 112, depth: 40, height: 20, radius: 4, cols: 7, rows: 1, lid: 'snap' }
	},
	{
		id: 'tools',
		get label() {
			return m.t_box_master_preset_tools();
		},
		params: { width: 160, depth: 60, height: 40, cols: 3, rows: 1, lid: 'inset' }
	},
	{
		id: 'tray',
		get label() {
			return m.t_box_master_preset_tray();
		},
		params: {
			width: 150,
			depth: 100,
			height: 25,
			radius: 4,
			cols: 4,
			rows: 3,
			lid: 'none',
			scoop: true,
			scoopRadius: 10
		}
	},
	{
		id: 'pencil-case',
		get label() {
			return m.t_box_master_preset_pencil_case();
		},
		params: {
			width: 190,
			depth: 45,
			height: 22,
			radius: 3,
			wall: 2.4,
			cols: 1,
			rows: 1,
			lid: 'slide'
		}
	}
];

export const LID_OPTIONS: readonly { value: LidKind; label: string }[] = [
	{
		value: 'inset',
		get label() {
			return m.t_box_master_lid_inset();
		}
	},
	{
		value: 'snap',
		get label() {
			return m.t_box_master_lid_snap();
		}
	},
	{
		value: 'cap',
		get label() {
			return m.t_box_master_lid_cap();
		}
	},
	{
		value: 'slide',
		get label() {
			return m.t_box_master_lid_slide();
		}
	},
	{
		value: 'none',
		get label() {
			return m.t_box_master_lid_none();
		}
	}
];

/** Every form value within what prints and fits together. */
export function clampBox(p: BoxMasterParams): BoxMasterParams {
	const c = (v: number, lo: number, hi: number) =>
		Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
	const width = c(p.width, 10, 300);
	const depth = c(p.depth, 10, 300);
	const height = c(p.height, 5, 200);
	// The sliding lid's grooves need 1,6 mm of wall.
	const wall = c(p.wall, p.lid === 'slide' ? 1.6 : 0.8, 6);
	return {
		width,
		depth,
		height,
		wall,
		floor: c(p.floor, 0.8, 6),
		radius: c(p.radius, 0, Math.min(width, depth) / 2),
		lid: (['none', 'inset', 'snap', 'cap', 'slide'] as const).includes(p.lid) ? p.lid : 'inset',
		clearance: c(p.clearance, 0, 1),
		// The rim cannot be deeper than the box.
		rim: c(p.rim, 2, Math.min(20, height - 1)),
		cols: Math.round(c(p.cols, 1, 12)),
		rows: Math.round(c(p.rows, 1, 12)),
		label: (p.label ?? '').trim().slice(0, 40),
		labelSize: c(p.labelSize, 3, 40),
		labelStyle: p.labelStyle === 'emboss' ? 'emboss' : 'engrave',
		scoop: !!p.scoop,
		scoopRadius: c(p.scoopRadius, 2, 30)
	};
}

const FN = 48;
/** Bead of the snap lid and the groove it clicks into, mm. */
const BEAD = 0.5;
const GROOVE = 0.6;
/** Engraving depth and the raised label's field depth, mm. */
const RELIEF = 0.6;

const rounded = (w: number, d: number, r: number) => rrect(w, d, Math.max(0, r), FN);

export interface BoxSolids {
	box: Node;
	lid: Node | null;
	/** Outer size of each part, for placing them side by side. */
	boxSize: [number, number];
	lidSize: [number, number];
}

/**
 * The box (floor on z = 0) and its lid (face on z = 0), both centred on the
 * origin. Inner size W×D×H; outer = inner + 2·wall (the cap lid is wider).
 */
export function boxSolids(input: BoxMasterParams): BoxSolids {
	const p = clampBox(input);
	const { width: W, depth: D, height: H, wall, floor: fl, radius: r, clearance: gap, rim } = p;
	const ow = W + 2 * wall;
	const od = D + 2 * wall;
	const oz = H + fl;

	// The sliding lid: as thick as the floor (2 mm at least), in grooves cut
	// a 45° (or steeper) dovetail into the side walls, leaving 0,8 mm of wall.
	const slideT = Math.max(2, fl);
	const slideG = Math.max(0.6, Math.min(slideT, wall - 0.8));
	const zSlide = oz - slideT;
	// Dividers stop under the rim of a lid that enters the box.
	const rimInside = p.lid === 'inset' || p.lid === 'snap';
	const divTop = rimInside ? oz - rim - 0.5 : p.lid === 'slide' ? zSlide - 0.5 : oz;
	const dividers: Node[] = [];
	const t = wall;
	for (let i = 1; i < p.cols; i++) {
		const x = -W / 2 + (i * (W - (p.cols - 1) * t)) / p.cols + (i - 0.5) * t;
		dividers.push(translate([x - t / 2, -D / 2 - 0.01, 0], cube([t, D + 0.02, divTop])));
	}
	for (let j = 1; j < p.rows; j++) {
		const y = -D / 2 + (j * (D - (p.rows - 1) * t)) / p.rows + (j - 0.5) * t;
		dividers.push(translate([-W / 2 - 0.01, y - t / 2, 0], cube([W + 0.02, t, divTop])));
	}

	// The groove of the snap lid: a 45° ring cut into the inner wall.
	const zg = oz - rim / 2;
	const groove =
		p.lid === 'snap'
			? loft([
					{ z: zg - GROOVE, shape: rounded(W, D, r) },
					{ z: zg, shape: rounded(W + 2 * GROOVE, D + 2 * GROOVE, r + GROOVE) },
					{ z: zg + GROOVE, shape: rounded(W, D, r) }
				])
			: null;

	// The slide: the dovetail along the width, out through the open end wall.
	const slide =
		p.lid === 'slide'
			? [
					// From the closed end's groove out past the open end; through the top.
					translate(
						[(wall + 2 - slideG) / 2, 0, 0],
						loft([
							{ z: zSlide, shape: rrect(W + wall + slideG + 2, D + 2 * slideG, 0, 4) },
							{ z: oz, shape: rrect(W + wall + slideG + 2, D, 0, 4) },
							{ z: oz + 1, shape: rrect(W + wall + slideG + 2, D, 0, 4) }
						])
					)
				]
			: [];

	// Rounded bottoms: each compartment carved on its own — the hull of a
	// sphere in every lower corner and the compartment's outline at the top —
	// so the walls between them stay; above the dividers' top one cavity.
	// A hair inside the outer walls: where one cavity runs on above the dividers,
	// its walls and the compartments' would otherwise coincide and leave a seam.
	const cw = (W - 0.02 - (p.cols - 1) * t) / p.cols;
	const cd = (D - 0.02 - (p.rows - 1) * t) / p.rows;
	const R = p.scoop ? Math.min(p.scoopRadius, cw / 2 - 0.01, cd / 2 - 0.01, H - 0.5) : 0;
	const cavities: Node[] = [];
	if (R > 0) {
		for (let i = 0; i < p.cols; i++)
			for (let j = 0; j < p.rows; j++) {
				const cx = -W / 2 + 0.01 + cw / 2 + i * (cw + t);
				const cy = -D / 2 + 0.01 + cd / 2 + j * (cd + t);
				const ex = cw / 2 - R;
				const ey = cd / 2 - R;
				cavities.push(
					hull(
						...[
							[-ex, -ey],
							[ex, -ey],
							[-ex, ey],
							[ex, ey]
						].map(([x, y]) => translate([cx + x, cy + y, fl + R], sphere(R, FN))),
						translate([cx, cy, oz], extrude(1, rounded(cw, cd, R)))
					)
				);
			}
		if (divTop < oz)
			cavities.push(translate([0, 0, divTop], extrude(oz - divTop + 1, rounded(W, D, r))));
	}

	const box = part(
		'box',
		difference(
			extrude(oz, rounded(ow, od, r + wall)),
			...(R > 0 ? cavities : [translate([0, 0, fl], extrude(H + 1, rounded(W, D, r)))]),
			groove,
			...slide
		),
		...(R > 0 ? [] : dividers)
	);

	if (p.lid === 'none') return { box, lid: null, boxSize: [ow, od], lidSize: [0, 0] };

	const lt = fl;
	let lidBody: Node;
	let lidW = ow;
	let lidD = od;
	if (p.lid === 'slide') {
		// Wide face on the bed, the narrow one up: from the closed end's groove
		// to the open end's outer face; a finger notch at the open end.
		lidW = W + wall + slideG - gap;
		lidD = D + 2 * slideG - 2 * gap;
		const notch = translate(
			[lidW / 2 - 7, 0, slideT + 3.2],
			rotate([90, 0, 0], cylinder(D * 0.6, 4, 4, FN, true))
		);
		lidBody = difference(
			loft([
				{ z: 0, shape: rrect(lidW, lidD, 0, 4) },
				{ z: slideT, shape: rrect(lidW, lidD - 2 * slideG, 0, 4) }
			]),
			notch
		);
	} else if (p.lid === 'cap') {
		// A skirt over the outside of the box walls.
		const sw = ow + 2 * gap;
		const sd = od + 2 * gap;
		lidW = sw + 2 * wall;
		lidD = sd + 2 * wall;
		lidBody = difference(
			extrude(lt + rim, rounded(lidW, lidD, r + 2 * wall + gap)),
			translate([0, 0, lt], extrude(rim + 1, rounded(sw, sd, r + wall + gap)))
		);
	} else {
		const rw = W - 2 * gap;
		const rd = D - 2 * gap;
		const rr = r - gap;
		const zb = lt + rim / 2;
		const bead =
			p.lid === 'snap'
				? loft([
						{ z: zb - BEAD, shape: rounded(rw, rd, rr) },
						{ z: zb, shape: rounded(rw + 2 * BEAD, rd + 2 * BEAD, rr + BEAD) },
						{ z: zb + BEAD, shape: rounded(rw, rd, rr) }
					])
				: null;
		lidBody = union(
			extrude(lt, rounded(ow, od, r + wall)),
			difference(
				union(translate([0, 0, lt - 0.01], extrude(rim + 0.01, rounded(rw, rd, rr))), bead),
				translate(
					[0, 0, lt - 1],
					extrude(rim + 2, rounded(rw - 2 * wall, rd - 2 * wall, rr - wall))
				)
			)
		);
	}

	// The label is on the face that lies on the bed: mirrored, cut 0.6 mm in.
	// The sliding lid shows its top: the label reads as is, cut or raised there.
	let lid = lidBody;
	if (p.label && p.lid === 'slide') {
		const letters = translate([-6, 0, 0], text(p.label, p.labelSize));
		lid =
			p.labelStyle === 'engrave'
				? difference(lidBody, translate([0, 0, slideT - RELIEF], extrude(RELIEF + 1, letters)))
				: union(lidBody, translate([0, 0, slideT - 0.01], extrude(RELIEF + 0.01, letters)));
	} else if (p.label) {
		const letters = mirror([1, 0, 0], text(p.label, p.labelSize));
		if (p.labelStyle === 'engrave') {
			lid = difference(lidBody, translate([0, 0, -0.01], extrude(RELIEF + 0.01, letters)));
		} else {
			// Letters stay at the face level, the field around them is recessed.
			const fw = Math.min(lidW - 2 * wall - 4, p.label.length * p.labelSize * 0.7 + 8);
			const fd = Math.min(lidD - 2 * wall - 4, p.labelSize * 1.6 + 4);
			const field = difference(rounded(Math.max(4, fw), Math.max(4, fd), 2), letters);
			lid = difference(lidBody, translate([0, 0, -0.01], extrude(RELIEF + 0.01, field)));
		}
	}
	return { box, lid: part('lid', lid), boxSize: [ow, od], lidSize: [lidW, lidD] };
}

/** Box and lid side by side, 10 mm apart, centred as a pair. */
export function boxMasterModel(p: BoxMasterParams): Node {
	const s = boxSolids(p);
	if (!s.lid) return s.box;
	const gapX = 10;
	const total = s.boxSize[0] + gapX + s.lidSize[0];
	return union(
		translate([-total / 2 + s.boxSize[0] / 2, 0, 0], s.box),
		translate([total / 2 - s.lidSize[0] / 2, 0, 0], s.lid)
	);
}

const LID_WORDS: Record<LidKind, () => string> = {
	none: m.t_box_master_scad_lid_none,
	inset: m.t_box_master_scad_lid_inset,
	snap: m.t_box_master_scad_lid_snap,
	cap: m.t_box_master_scad_lid_cap,
	slide: m.t_box_master_scad_lid_slide
};

const mm = (v: number) => num(v, 0, 1e4);

export function boxMasterHeader(input: BoxMasterParams): string[] {
	const p = clampBox(input);
	return [
		m.t_box_master_scad_title(),
		m.t_box_master_scad_size({
			width: mm(p.width),
			depth: mm(p.depth),
			height: mm(p.height),
			wall: mm(p.wall),
			floor: mm(p.floor),
			lid: LID_WORDS[p.lid]()
		}),
		m.t_box_master_scad_compartments({
			cols: mm(p.cols),
			rows: mm(p.rows),
			clearance: mm(p.clearance),
			rim: mm(p.rim)
		})
	];
}

/** The same box as an OpenSCAD program, for «В OpenSCAD». */
export function boxMasterScad(p: BoxMasterParams): string {
	return toScad(boxMasterModel(p), boxMasterHeader(p));
}
