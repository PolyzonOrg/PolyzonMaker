/**
 * «Пазлы»: a jigsaw plate — rows × columns of pieces with knobs, printed
 * already assembled with a gap between the pieces — an engraved line of
 * text across it if wanted, and a tray to keep it in.
 *
 * Every inner edge is drawn once: straight, then a narrow neck and a round
 * head, its side, place and size varied by a seed so no two pieces are
 * alike; the two pieces on either side share it, one forward, one back.
 * Each piece is then shrunk by half the gap.
 */
import {
	cube,
	difference,
	extrude,
	label,
	offset,
	part,
	polygon,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/jigsaw';
import { clamp, seededRandom as random } from '../shared/math';

export interface JigsawParams {
	width: number;
	height: number;
	cols: number;
	rows: number;
	thickness: number;
	/** Gap between the pieces, mm */
	gap: number;
	/** Knob size, % of a piece's shorter side */
	knob: number;
	seed: number;
	text: string;
	font: string;
	tray: boolean;
}

export const JIGSAW_DEFAULTS: JigsawParams = {
	width: 120,
	height: 90,
	cols: 4,
	rows: 3,
	thickness: 4,
	gap: 0.3,
	knob: 24,
	seed: 1,
	text: '',
	font: 'Noto Sans',
	tray: false
};

export const JIGSAW_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<JigsawParams>;
}[] = [
	{
		id: 'kids',
		get label() {
			return m.t_jigsaw_preset_kids();
		},
		params: { width: 120, height: 80, cols: 3, rows: 2, thickness: 6, knob: 25, tray: true }
	},
	{
		id: 'gift',
		get label() {
			return m.t_jigsaw_preset_gift();
		},
		get params() {
			return { width: 140, height: 100, cols: 5, rows: 4, text: m.t_jigsaw_preset_gift_text() };
		}
	},
	{
		id: 'card',
		get label() {
			return m.t_jigsaw_preset_card();
		},
		params: { width: 150, height: 100, cols: 5, rows: 4, thickness: 3 }
	}
];

export function clampJigsaw(p: JigsawParams): JigsawParams {
	const width = clamp(p.width, 30, 300);
	const height = clamp(p.height, 30, 300);
	// Pieces no smaller than 12 mm.
	return {
		width,
		height,
		cols: Math.round(clamp(p.cols, 2, Math.min(15, Math.floor(width / 12)))),
		rows: Math.round(clamp(p.rows, 2, Math.min(15, Math.floor(height / 12)))),
		thickness: clamp(p.thickness, 1.6, 15),
		gap: clamp(p.gap, 0.2, 1),
		// Larger knobs on two sides of a piece could meet inside it.
		knob: clamp(p.knob, 15, 25),
		seed: Math.round(clamp(p.seed, 1, 9999)),
		text: (p.text ?? '').slice(0, 40),
		font: p.font || 'Noto Sans',
		tray: !!p.tray
	};
}

type Pt = [number, number];

/**
 * An edge from a to b with a knob of size `s` (share of the edge) to the
 * left of the way (side = 1) or the right (−1), centred at `at`.
 */
function knobEdge(a: Pt, b: Pt, side: number, s: number, at: number): Pt[] {
	const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
	const ux = (b[0] - a[0]) / L;
	const uy = (b[1] - a[1]) / L;
	const px = -uy * side;
	const py = ux * side;
	const map = (t: number, h: number): Pt => [
		a[0] + ux * t * L + px * h * L,
		a[1] + uy * t * L + py * h * L
	];
	// Neck half as wide as the head, the head a circle above it.
	const r = s * 0.55;
	const n = r * 0.5;
	const cy = s * 0.85;
	const yN = cy - Math.sqrt(r * r - n * n);
	const aL = Math.atan2(-Math.sqrt(r * r - n * n), -n);
	const aR = Math.atan2(-Math.sqrt(r * r - n * n), n) - Math.PI * 2;
	const pts: Pt[] = [map(0, 0), map(at - n, 0), map(at - n, yN)];
	const steps = 24;
	for (let k = 1; k < steps; k++) {
		const ang = aL + ((aR - aL) * k) / steps;
		pts.push(map(at + r * Math.cos(ang), cy + r * Math.sin(ang)));
	}
	pts.push(map(at + n, yN), map(at + n, 0), map(1, 0));
	return pts;
}

export interface JigsawLayout {
	cw: number;
	ch: number;
	/** Each piece's outline, before the gap */
	pieces: Pt[][];
}

export function jigsawLayout(input: JigsawParams): JigsawLayout {
	const p = clampJigsaw(input);
	const cw = p.width / p.cols;
	const ch = p.height / p.rows;
	// Every knob the same size in millimetres, whichever way its edge runs.
	const knob = (p.knob / 100) * Math.min(cw, ch);
	const rnd = random(p.seed);
	const x = (i: number) => i * cw - p.width / 2;
	const y = (j: number) => j * ch - p.height / 2;
	const edge = (a: Pt, b: Pt) => {
		const side = rnd() < 0.5 ? 1 : -1;
		const size = (knob / Math.hypot(b[0] - a[0], b[1] - a[1])) * (0.92 + rnd() * 0.16);
		const at = 0.5 + (rnd() - 0.5) * 0.06;
		return knobEdge(a, b, side, size, at);
	};
	// Horizontal inner edges (between rows j−1 and j), left to right; vertical ones bottom to top.
	const hEdges: Pt[][][] = [];
	for (let j = 1; j < p.rows; j++) {
		const row: Pt[][] = [];
		for (let i = 0; i < p.cols; i++) row.push(edge([x(i), y(j)], [x(i + 1), y(j)]));
		hEdges[j] = row;
	}
	const vEdges: Pt[][][] = [];
	for (let i = 1; i < p.cols; i++) {
		const col: Pt[][] = [];
		for (let j = 0; j < p.rows; j++) col.push(edge([x(i), y(j)], [x(i), y(j + 1)]));
		vEdges[i] = col;
	}
	const pieces: Pt[][] = [];
	for (let j = 0; j < p.rows; j++)
		for (let i = 0; i < p.cols; i++) {
			// Counter-clockwise: bottom, right, top (backwards), left (backwards); each edge drops its last point.
			const bottom = j === 0 ? [[x(i), y(0)] as Pt] : hEdges[j][i].slice(0, -1);
			const right = i === p.cols - 1 ? [[x(i + 1), y(j)] as Pt] : vEdges[i + 1][j].slice(0, -1);
			const top =
				j === p.rows - 1
					? [[x(i + 1), y(j + 1)] as Pt]
					: [...hEdges[j + 1][i]].reverse().slice(0, -1);
			const left = i === 0 ? [[x(i), y(j + 1)] as Pt] : [...vEdges[i][j]].reverse().slice(0, -1);
			pieces.push([...bottom, ...right, ...top, ...left]);
		}
	return { cw, ch, pieces };
}

export function jigsawModel(input: JigsawParams): Node {
	const p = clampJigsaw(input);
	const L = jigsawLayout(p);
	const pieces = L.pieces.map((pts) => offset(-p.gap / 2, 16, polygon(pts)));
	let plate: Node = extrude(p.thickness, union(...pieces));
	if (p.text.trim()) {
		const cap = Math.min(p.height * 0.18, 18);
		plate = difference(
			plate,
			translate(
				[0, 0, p.thickness - 0.6],
				extrude(
					1,
					label(p.text.trim(), cap, {
						font: p.font,
						bold: true,
						fit: p.width - 12,
						valign: 'center'
					})
				)
			)
		);
	}
	const out: Node[] = [part('puzzle', plate)];
	if (p.tray) {
		// A tray as deep as most of a piece, a little roomier than the puzzle.
		const wall = 3;
		const floor = 1.6;
		const room = 0.6;
		const w = p.width + 2 * room;
		const h = p.height + 2 * room;
		const depth = Math.max(1.5, p.thickness - 1.5);
		const tray = difference(
			extrude(floor + depth, rrect(w + 2 * wall, h + 2 * wall, 4, 32)),
			translate([0, 0, floor], extrude(depth + 1, rrect(w, h, 1, 16))),
			// A notch to lift the puzzle out.
			translate([-12, h / 2 - 1, floor], cube([24, wall + 2, depth + 1]))
		);
		out.push(part('tray', translate([0, -(p.height / 2 + h / 2 + wall + 10), 0], tray)));
	}
	return union(...out);
}

const mm = (v: number) => num(Math.round(v * 10) / 10);

export function jigsawSummary(input: JigsawParams): string {
	const p = clampJigsaw(input);
	const L = jigsawLayout(p);
	const pieces = p.cols * p.rows;
	return m.t_jigsaw_summary({
		pieces: m.t_jigsaw_pieces({ count: pieces, n: num(pieces) }),
		w: mm(L.cw),
		h: mm(L.ch),
		width: mm(p.width),
		height: mm(p.height),
		gap: mm(p.gap)
	});
}

export function jigsawTexts(input: JigsawParams): Node[] {
	const p = clampJigsaw(input);
	return p.text.trim()
		? [
				label(p.text.trim(), Math.min(p.height * 0.18, 18), {
					font: p.font,
					bold: true,
					fit: p.width - 12
				})
			]
		: [];
}

export function jigsawHeader(input: JigsawParams): string[] {
	return [m.t_jigsaw_header_title(), jigsawSummary(input)];
}

export function jigsawScad(p: JigsawParams): string {
	return toScad(jigsawModel(p), jigsawHeader(p));
}
