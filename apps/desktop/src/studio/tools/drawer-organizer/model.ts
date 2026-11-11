/**
 * «Вкладыш в ящик»: a tray with a grid of cells for the inside of a
 * drawer. Cells are cut out of one block (rounded inside corners, no seams);
 * columns and rows can be equal or in proportions. A tray larger than the
 * printer bed is split along the cell walls into pieces that stand side by
 * side in the drawer, each with its own walls and a small gap between them.
 * Options: a finger notch in the front wall, a scoop at the front of every
 * cell, labels engraved into the cell floors.
 */
import {
	circle,
	difference,
	extrude,
	hull,
	part,
	polygon,
	rotate,
	rrect,
	square,
	label as lettering,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '../scad-literals';
import * as m from '$msg/tools/drawer-organizer';
import { clamp as c } from '../shared/math';

export interface DrawerParams {
	/** Inner size of the drawer, mm */
	width: number;
	depth: number;
	height: number;
	/** Gap to the drawer walls on every side, mm */
	fit: number;
	wall: number;
	divider: number;
	floor: number;
	/** Outer corner radius and the radius of the cells' inside corners, mm */
	radius: number;
	cellRadius: number;
	cols: number;
	rows: number;
	/** Proportions instead of equal cells */
	proportional: boolean;
	colWeights: string;
	rowWeights: string;
	notch: boolean;
	scoop: boolean;
	labels: boolean;
	labelText: string;
	labelSize: number;
	/** Split into pieces that fit a square bed of this side */
	split: boolean;
	bed: number;
	/** Gap between neighbouring pieces in the drawer, mm */
	gap: number;
}

export const DRAWER_DEFAULTS: DrawerParams = {
	width: 260,
	depth: 180,
	height: 45,
	fit: 0.5,
	wall: 2,
	divider: 1.2,
	floor: 1.2,
	radius: 4,
	cellRadius: 3,
	cols: 4,
	rows: 2,
	proportional: false,
	colWeights: '2, 1, 1',
	rowWeights: '1, 2',
	notch: false,
	scoop: false,
	labels: false,
	labelText: '',
	labelSize: 8,
	split: true,
	bed: 220,
	gap: 0.4
};

export const DRAWER_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<DrawerParams>;
}[] = [
	{
		id: 'desk',
		get label() {
			return m.t_drawer_organizer_preset_desk();
		},
		params: { width: 260, depth: 180, height: 45, cols: 4, rows: 2, proportional: false }
	},
	{
		id: 'kitchen',
		get label() {
			return m.t_drawer_organizer_preset_kitchen();
		},
		params: {
			width: 380,
			depth: 420,
			height: 55,
			proportional: true,
			colWeights: '1, 1, 1, 1, 1.6',
			rowWeights: '1',
			scoop: true
		}
	},
	{
		id: 'parts',
		get label() {
			return m.t_drawer_organizer_preset_parts();
		},
		params: {
			width: 200,
			depth: 140,
			height: 30,
			cols: 6,
			rows: 4,
			proportional: false,
			scoop: true,
			divider: 1
		}
	},
	{
		id: 'narrow',
		get label() {
			return m.t_drawer_organizer_preset_narrow();
		},
		params: {
			width: 300,
			depth: 90,
			height: 40,
			cols: 3,
			rows: 1,
			proportional: false,
			notch: true
		}
	}
];

export function clampDrawer(p: DrawerParams): DrawerParams {
	const height = c(p.height, 10, 150);
	return {
		width: c(p.width, 30, 800),
		depth: c(p.depth, 30, 800),
		height,
		fit: c(p.fit, 0, 3),
		wall: c(p.wall, 0.8, 4),
		divider: c(p.divider, 0.6, 4),
		floor: c(p.floor, 0.6, 4),
		radius: c(p.radius, 0, 20),
		cellRadius: c(p.cellRadius, 0, 15),
		cols: Math.round(c(p.cols, 1, 12)),
		rows: Math.round(c(p.rows, 1, 12)),
		proportional: !!p.proportional,
		colWeights: String(p.colWeights ?? '').slice(0, 80),
		rowWeights: String(p.rowWeights ?? '').slice(0, 80),
		notch: !!p.notch,
		scoop: !!p.scoop,
		labels: !!p.labels,
		labelText: String(p.labelText ?? '').slice(0, 400),
		labelSize: c(p.labelSize, 3, 20),
		split: !!p.split,
		bed: c(p.bed, 100, 500),
		// Pieces that touch would print as one block: at least a hair between them.
		gap: c(p.gap, 0.2, 2)
	};
}

/** «1, 2, 1» → [1, 2, 1]; up to 12 positive numbers, at least one. */
export function parseWeights(textValue: string): number[] {
	const list = textValue
		.split(/[;,\s，；、]+/)
		.map((s) => Number(s.replace(',', '.')))
		.filter((n) => Number.isFinite(n) && n > 0)
		.slice(0, 12)
		.map((n) => Math.min(100, n));
	return list.length ? list : [1];
}

/** Labels for the cells, front-left first, row by row (full-width separators of a CJK keyboard count too). */
export function parseLabels(textValue: string): string[] {
	return textValue.split(/[,;\n，；、]/).map((s) => s.trim().slice(0, 24));
}

/** Contiguous groups of `sizes` (k of them) with the smallest largest sum. */
function partition(sizes: number[], k: number): number[][] {
	const n = sizes.length;
	const prefix = [0];
	for (const s of sizes) prefix.push(prefix[prefix.length - 1] + s);
	const sum = (a: number, b: number) => prefix[b] - prefix[a];
	// best[j][i]: smallest largest group for the first i items in j groups.
	const best = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
	const cut = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
	best[0][0] = 0;
	for (let j = 1; j <= k; j++)
		for (let i = j; i <= n; i++)
			for (let m = j - 1; m < i; m++) {
				const v = Math.max(best[j - 1][m], sum(m, i));
				if (v < best[j][i]) {
					best[j][i] = v;
					cut[j][i] = m;
				}
			}
	const groups: number[][] = [];
	let i = n;
	for (let j = k; j >= 1; j--) {
		const m = cut[j][i];
		groups.unshift(Array.from({ length: i - m }, (_, t) => m + t));
		i = m;
	}
	return groups;
}

interface Axis {
	/** Inner size of every cell along this axis */
	cells: number[];
	/** Cell indices of each piece */
	groups: number[][];
	/** Outer size of each piece */
	pieces: number[];
	/** Start of each piece (from the drawer's low edge, after the fit gap) */
	starts: number[];
	/** Some piece is still larger than the bed */
	tooLarge: boolean;
}

/**
 * Cells and pieces along one axis. Each split replaces one divider by two
 * walls and the gap between the pieces; the fewest pieces that fit the bed.
 */
function layoutAxis(span: number, weights: number[], p: DrawerParams, bed: number): Axis {
	const n = weights.length;
	const total = weights.reduce((a, b) => a + b, 0);
	const maxK = p.split ? n : 1;
	let chosen: Axis | null = null;
	for (let k = 1; k <= maxK; k++) {
		const free = span - 2 * p.wall * k - (n - k) * p.divider - (k - 1) * p.gap;
		const cells = weights.map((w) => Math.max(1, (w / total) * free));
		const groups = partition(
			cells.map((cw) => cw + p.divider),
			k
		);
		const pieces = groups.map(
			(g) => 2 * p.wall + g.reduce((a, i) => a + cells[i], 0) + (g.length - 1) * p.divider
		);
		const starts: number[] = [];
		let at = 0;
		for (const w of pieces) {
			starts.push(at);
			at += w + p.gap;
		}
		const tooLarge = pieces.some((w) => w > bed + 1e-6);
		chosen = { cells, groups, pieces, starts, tooLarge };
		if (!tooLarge) break;
	}
	return chosen as Axis;
}

export interface DrawerLayout {
	/** Outer size of the whole organizer (drawer minus the fit gap) */
	outer: [number, number];
	x: Axis;
	y: Axis;
	pieceCount: number;
	cellCount: number;
	/** Smallest cell, mm */
	minCell: [number, number];
	/** Height of the cells above the floor, mm */
	depthInside: number;
}

export function drawerLayout(input: DrawerParams): DrawerLayout {
	const p = clampDrawer(input);
	const W = p.width - 2 * p.fit;
	const D = p.depth - 2 * p.fit;
	const colW = p.proportional ? parseWeights(p.colWeights) : new Array<number>(p.cols).fill(1);
	const rowW = p.proportional ? parseWeights(p.rowWeights) : new Array<number>(p.rows).fill(1);
	const x = layoutAxis(W, colW, p, p.bed);
	const y = layoutAxis(D, rowW, p, p.bed);
	return {
		outer: [W, D],
		x,
		y,
		pieceCount: x.groups.length * y.groups.length,
		cellCount: x.cells.length * y.cells.length,
		minCell: [Math.min(...x.cells), Math.min(...y.cells)],
		depthInside: p.height - p.floor
	};
}

const FN = 32;
const ENGRAVE = 0.6;

/** One piece: its cells cut from a block, origin at the piece's low corner. */
function piece(p: DrawerParams, L: DrawerLayout, gx: number, gy: number, labels: string[]): Node {
	const cols = L.x.groups[gx];
	const rows = L.y.groups[gy];
	const pw = L.x.pieces[gx];
	const pd = L.y.pieces[gy];
	const H = p.height;
	const cuts: Node[] = [];
	const adds: Node[] = [];
	const engraved: Node[] = [];
	const depth = Math.min(ENGRAVE, p.floor / 2);
	let y = p.wall;
	for (const j of rows) {
		const cd = L.y.cells[j];
		let x = p.wall;
		for (const i of cols) {
			const cw = L.x.cells[i];
			const cx = x + cw / 2;
			const cy = y + cd / 2;
			const r = Math.min(p.cellRadius, cw / 2 - 0.05, cd / 2 - 0.05);
			cuts.push(translate([cx, cy, p.floor], extrude(H, rrect(cw, cd, r, FN))));
			if (p.scoop) {
				// A quarter-round fillet at the front of the cell, along its width.
				const rs = Math.min((H - p.floor) * 0.6, cd * 0.4, 20);
				if (rs > 2) {
					const profile = difference(
						polygon([
							[0, 0],
							[rs, 0],
							[0, rs]
						]),
						translate([rs, rs], circle(rs, 64))
					);
					adds.push(
						translate(
							[x - 0.01, y - 0.01, p.floor - 0.01],
							rotate([90, 0, 90], extrude(cw + 0.02, profile))
						)
					);
				}
			}
			const name = p.labels ? labels[j * L.x.cells.length + i] : '';
			if (name) {
				// «Высота букв» is the capital's; a long name shrinks to 0.8 of the cell.
				const cap = Math.min(p.labelSize, cd * 0.45);
				const room = cw * 0.8;
				if (Math.min(cap, room / Math.max(1, name.length * 0.86)) >= 1.8)
					engraved.push(
						translate(
							[cx, p.scoop ? cy + cd * 0.15 : cy, p.floor - depth],
							extrude(depth + 0.01, lettering(name, cap, { fit: room, valign: 'center' }))
						)
					);
			}
			x += cw + p.divider;
		}
		y += cd + p.divider;
	}

	// Finger notches in the front wall of the front pieces, one per column.
	if (p.notch && gy === 0) {
		let x = p.wall;
		for (const i of cols) {
			const cw = L.x.cells[i];
			const nw = Math.min(30, cw * 0.5);
			const nd = Math.min((H - p.floor) * 0.5, nw * 1.2);
			if (nw > 6) {
				const u = hull(
					translate([0, H - nd + nw / 2], circle(nw / 2, FN)),
					translate([0, H + 1], square(nw, 2))
				);
				cuts.push(
					translate([x + cw / 2, p.wall + 0.01, 0], rotate([90, 0, 0], extrude(p.wall + 0.02, u)))
				);
			}
			x += cw + p.divider;
		}
	}

	const block = translate([pw / 2, pd / 2, 0], extrude(H, rrect(pw, pd, p.radius, FN)));
	const body = adds.length
		? union(difference(block, ...cuts), ...adds)
		: difference(block, ...cuts);
	return engraved.length ? difference(body, ...engraved) : body;
}

/** All pieces where they stand in the drawer, the whole centred on the origin. */
export function drawerModel(input: DrawerParams): Node {
	const p = clampDrawer(input);
	const L = drawerLayout(p);
	const labels = parseLabels(p.labelText);
	const pieces: Node[] = [];
	L.y.groups.forEach((_, gy) =>
		L.x.groups.forEach((__, gx) => {
			const at = [L.x.starts[gx] - L.outer[0] / 2, L.y.starts[gy] - L.outer[1] / 2, 0];
			const name = L.pieceCount > 1 ? `piece_${gy * L.x.groups.length + gx + 1}` : 'tray';
			pieces.push(translate(at, part(name, piece(p, L, gx, gy, labels))));
		})
	);
	return pieces.length === 1 ? pieces[0] : union(...pieces);
}

/** Footprints of the pieces in drawerModel() coordinates: [x0, y0, x1, y1]. */
export function pieceRects(input: DrawerParams): [number, number, number, number][] {
	const L = drawerLayout(input);
	const out: [number, number, number, number][] = [];
	L.y.groups.forEach((_, gy) =>
		L.x.groups.forEach((__, gx) => {
			const x0 = L.x.starts[gx] - L.outer[0] / 2;
			const y0 = L.y.starts[gy] - L.outer[1] / 2;
			out.push([x0, y0, x0 + L.x.pieces[gx], y0 + L.y.pieces[gy]]);
		})
	);
	return out;
}

/** The STL triangles of one piece (by footprint) out of the whole model. */
export function trianglesInRect(
	tris: Float32Array,
	rect: [number, number, number, number]
): Float32Array {
	const out: number[] = [];
	for (let t = 0; t + 8 < tris.length; t += 9) {
		const cx = (tris[t] + tris[t + 3] + tris[t + 6]) / 3;
		const cy = (tris[t + 1] + tris[t + 4] + tris[t + 7]) / 3;
		if (
			cx >= rect[0] - 0.01 &&
			cx <= rect[2] + 0.01 &&
			cy >= rect[1] - 0.01 &&
			cy <= rect[3] + 0.01
		)
			for (let k = 0; k < 9; k++) out.push(tris[t + k]);
	}
	return new Float32Array(out);
}

const mm = (v: number) => num(v, -1e4, 1e4);

export function drawerHeader(input: DrawerParams): string[] {
	const p = clampDrawer(input);
	const L = drawerLayout(p);
	return [
		m.t_drawer_organizer_scad_title(),
		m.t_drawer_organizer_scad_drawer({
			width: mm(p.width),
			depth: mm(p.depth),
			height: mm(p.height),
			fit: mm(p.fit)
		}),
		m.t_drawer_organizer_scad_cells({
			cols: mm(L.x.cells.length),
			rows: mm(L.y.cells.length),
			pieces: mm(L.pieceCount),
			wall: mm(p.wall),
			divider: mm(p.divider)
		})
	];
}

export function drawerScad(p: DrawerParams): string {
	return toScad(drawerModel(p), drawerHeader(p));
}
