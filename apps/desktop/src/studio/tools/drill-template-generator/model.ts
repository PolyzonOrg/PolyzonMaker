/**
 * «Шаблоны сверления»: a drilling jig — a plate with guide holes at the
 * right distances, laid on the part and held against its edge by a stop.
 * Hole layouts: furniture handles (centre distance), shelf pins in the 32 mm
 * system, Ø35 hinge cups, a grid (brackets, signs) or any list of points.
 *
 * The plate is as thick as the guide should be long. It prints upside down:
 * the top face (marks, labels) on the bed, the face that lies on the part up
 * with weight-saving pockets around the hole bosses, the stop rising from it
 * — no supports. The layout also exports as a 1:1 SVG to print on paper.
 *
 * Coordinates of the layout: x along the reference edge, y away from it
 * (the edge is y = 0); with a corner stop x = 0 is the end of the part.
 */
import {
	circle,
	cube,
	cylinder,
	difference,
	extrude,
	part,
	polygon,
	rotate,
	square,
	text,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '../scad-literals';
import { currentLocale } from '$lib/i18n/current';
import { decimalMark } from '$lib/i18n/locale';
import * as m from '$msg/tools/drill-template-generator';
import { clamp as c } from '../shared/math';

export type DrillKind = 'handle' | 'shelf' | 'hinge' | 'grid' | 'custom';
export type StopKind = 'none' | 'edge' | 'corner';

export interface DrillParams {
	kind: DrillKind;
	/** Drill bit diameter, mm (the hinge cup is always 35) */
	hole: number;
	/** Handle: distance between the two screws, mm */
	centers: number;
	/** Distance from the reference edge to the (first) hole line, mm */
	edge: number;
	/** With a corner stop: from the end of the part to the first hole, mm */
	start: number;
	/** Shelf pins: holes in the row and their pitch */
	count: number;
	pitch: number;
	/** Hinge: pilot holes for the cup's screws */
	hingeScrews: boolean;
	/** Grid */
	cols: number;
	rows: number;
	stepX: number;
	stepY: number;
	/** Any holes: «x, y; x, y» from the reference corner */
	points: string;
	/** Plate thickness = guide length, mm */
	thickness: number;
	stop: StopKind;
	stopDepth: number;
	lighten: boolean;
	marks: boolean;
	labels: boolean;
}

export const DRILL_KIND_DEFAULTS: Record<DrillKind, Partial<DrillParams>> = {
	handle: { hole: 5, edge: 30, start: 40 },
	shelf: { hole: 5, edge: 37, start: 64, count: 5, pitch: 32 },
	hinge: { hole: 35, edge: 22.5, start: 100 },
	grid: { hole: 6, edge: 20, start: 30, cols: 1, rows: 2, stepX: 64, stepY: 60 },
	custom: { hole: 5, edge: 0, start: 0 }
};

export const DRILL_DEFAULTS: DrillParams = {
	kind: 'handle',
	hole: 5,
	centers: 96,
	edge: 30,
	start: 40,
	count: 5,
	pitch: 32,
	hingeScrews: true,
	cols: 1,
	rows: 2,
	stepX: 64,
	stepY: 60,
	points: '0, 20; 50, 20; 25, 60',
	thickness: 8,
	stop: 'edge',
	stopDepth: 8,
	lighten: true,
	marks: true,
	labels: true
};

/** Centre distances of furniture handles, mm (a 32 mm series). */
export const HANDLE_CENTERS = [64, 96, 128, 160, 192, 224, 256, 320] as const;

export const DRILL_PRESETS: readonly { id: string; label: string; params: Partial<DrillParams> }[] =
	[
		{
			id: 'h96',
			get label() {
				return m.t_drill_template_generator_preset_h96();
			},
			params: { kind: 'handle', ...DRILL_KIND_DEFAULTS.handle, centers: 96, stop: 'edge' }
		},
		{
			id: 'h160',
			get label() {
				return m.t_drill_template_generator_preset_h160();
			},
			params: { kind: 'handle', ...DRILL_KIND_DEFAULTS.handle, centers: 160, stop: 'edge' }
		},
		{
			id: 'shelf',
			get label() {
				return m.t_drill_template_generator_preset_shelf();
			},
			params: { kind: 'shelf', ...DRILL_KIND_DEFAULTS.shelf, stop: 'corner', thickness: 12 }
		},
		{
			id: 'hinge',
			get label() {
				return m.t_drill_template_generator_preset_hinge();
			},
			params: { kind: 'hinge', ...DRILL_KIND_DEFAULTS.hinge, stop: 'corner', thickness: 10 }
		},
		{
			id: 'bracket',
			get label() {
				return m.t_drill_template_generator_preset_bracket();
			},
			params: { kind: 'grid', ...DRILL_KIND_DEFAULTS.grid, stop: 'none' }
		}
	];

export function clampDrill(p: DrillParams): DrillParams {
	const kind = (['handle', 'shelf', 'hinge', 'grid', 'custom'] as const).includes(p.kind)
		? p.kind
		: 'handle';
	return {
		kind,
		hole: c(p.hole, 1, 40),
		centers: c(p.centers, 16, 640),
		edge: c(p.edge, 0, 300),
		start: c(p.start, 0, 1000),
		count: Math.round(c(p.count, 1, 30)),
		pitch: c(p.pitch, 8, 200),
		hingeScrews: !!p.hingeScrews,
		cols: Math.round(c(p.cols, 1, 12)),
		rows: Math.round(c(p.rows, 1, 12)),
		stepX: c(p.stepX, 5, 500),
		stepY: c(p.stepY, 5, 500),
		points: String(p.points ?? '').slice(0, 400),
		thickness: c(p.thickness, 3, 30),
		stop: (['none', 'edge', 'corner'] as const).includes(p.stop) ? p.stop : 'edge',
		stopDepth: c(p.stopDepth, 3, 30),
		lighten: !!p.lighten,
		marks: !!p.marks,
		labels: !!p.labels
	};
}

/**
 * «0, 20; 50, 20» → [[0, 20], [50, 20]]: pairs split by «;» or a new line,
 * x and y by a comma or a space; «25,5 60» reads a decimal comma. At most 40.
 */
export function parsePoints(value: string): [number, number][] {
	return value
		.split(/[;\n；]+/)
		.map((pair) => {
			const t = pair.trim().replace(/[，、]/g, ',');
			const parts = /^-?[\d.]+\s*,\s*-?[\d.]+$/.test(t)
				? t.split(',')
				: t.replace(/(\d),(\d)/g, '$1.$2').split(/[\s,]+/);
			return parts.map(Number);
		})
		.filter((xy) => xy.length >= 2 && Number.isFinite(xy[0]) && Number.isFinite(xy[1]))
		.slice(0, 40)
		.map(([x, y]) => [c(x, -1000, 1000), c(y, -1000, 1000)]);
}

export interface Hole {
	x: number;
	y: number;
	/** Bit diameter, mm */
	d: number;
}

/** The holes in layout coordinates; patterns without a corner stop are centred on x = 0. */
export function drillHoles(input: DrillParams): Hole[] {
	const p = clampDrill(input);
	const corner = p.stop === 'corner';
	const row = (n: number, step: number, y: number, d: number): Hole[] => {
		const x0 = corner ? p.start : (-(n - 1) * step) / 2;
		return Array.from({ length: n }, (_, i) => ({ x: x0 + i * step, y, d }));
	};
	switch (p.kind) {
		case 'handle':
			return row(2, p.centers, p.edge, p.hole);
		case 'shelf':
			return row(p.count, p.pitch, p.edge, p.hole);
		case 'hinge': {
			// Cup Ø35 at `edge` from the door edge; its two screws 45 mm apart,
			// 9.5 mm further in (the usual screw-on cup).
			const x = corner ? p.start : 0;
			const holes: Hole[] = [{ x, y: p.edge, d: 35 }];
			if (p.hingeScrews)
				holes.push(
					{ x: x - 22.5, y: p.edge + 9.5, d: 2.5 },
					{ x: x + 22.5, y: p.edge + 9.5, d: 2.5 }
				);
			return holes;
		}
		case 'grid': {
			const holes: Hole[] = [];
			for (let j = 0; j < p.rows; j++)
				holes.push(...row(p.cols, p.stepX, p.edge + j * p.stepY, p.hole));
			return holes;
		}
		case 'custom': {
			const pts = parsePoints(p.points);
			return (pts.length ? pts : [[0, 20] as [number, number]]).map(([x, y]) => ({
				x,
				y,
				d: p.hole
			}));
		}
	}
}

/** Drill bit clearance in the printed hole, mm (FDM holes come out small). */
export const HOLE_CLEARANCE = 0.2;
const STOP_T = 3;
const SKIN = 2;
const RIM = 3;
const MARK_W = 0.8;
const ENGRAVE = 0.6;
const FN = 48;

export interface DrillLayout {
	holes: Hole[];
	/** Plate rectangle [x0, y0, x1, y1] in layout coordinates */
	plate: [number, number, number, number];
	/** Centre line across the edge (x) and the first hole line (y) */
	center: [number, number];
	/** Label lines engraved on the top face */
	labels: { text: string; x: number; y: number }[];
	/** Holes closer than 1 mm wall to each other */
	crowded: boolean;
}

const boss = (h: Hole) => (h.d + HOLE_CLEARANCE) / 2 + 3;
// Engraved and drawn 1:1: the language's decimal mark, no digit grouping.
const fmt = (v: number) =>
	String(Math.round(v * 10) / 10).replace('.', decimalMark(currentLocale()));

export function drillLayout(input: DrillParams): DrillLayout {
	const p = clampDrill(input);
	const holes = drillHoles(p);
	const margin = 8;
	const xs0 = holes.map((h) => h.x - boss(h));
	const xs1 = holes.map((h) => h.x + boss(h));
	const ys0 = holes.map((h) => h.y - boss(h));
	const ys1 = holes.map((h) => h.y + boss(h));
	const x0 = p.stop === 'corner' ? 0 : Math.min(...xs0) - margin;
	const y0 = p.stop === 'none' ? Math.min(...ys0) - margin : Math.min(0, Math.min(...ys0) - margin);
	const x1 = Math.max(...xs1) + margin;
	const y1 = Math.max(...ys1) + margin + (p.labels ? 7 : 0);
	const big = holes.reduce((a, h) => (h.d > a.d ? h : a), holes[0]);
	const center: [number, number] = [
		p.kind === 'hinge'
			? big.x
			: (Math.min(...holes.map((h) => h.x)) + Math.max(...holes.map((h) => h.x))) / 2,
		holes[0].y
	];
	let crowded = false;
	for (let i = 0; i < holes.length; i++)
		for (let j = i + 1; j < holes.length; j++) {
			const gapMm =
				Math.hypot(holes[i].x - holes[j].x, holes[i].y - holes[j].y) -
				(holes[i].d + holes[j].d) / 2 -
				HOLE_CLEARANCE;
			if (gapMm < 1) crowded = true;
		}
	const labelY = Math.max(...ys1) + 4;
	const text1: string =
		p.kind === 'handle'
			? m.t_drill_template_generator_label_handle({ centers: fmt(p.centers) })
			: p.kind === 'shelf'
				? m.t_drill_template_generator_label_shelf({ pitch: fmt(p.pitch), hole: fmt(p.hole) })
				: p.kind === 'hinge'
					? m.t_drill_template_generator_label_hinge({ edge: fmt(p.edge) })
					: p.kind === 'grid'
						? `${fmt(p.stepX)} × ${fmt(p.stepY)}, Ø${fmt(p.hole)}`
						: `Ø${fmt(p.hole)}`;
	const text2: string =
		p.stop !== 'none' && p.kind !== 'hinge'
			? m.t_drill_template_generator_label_edge({ distance: fmt(holes[0].y) })
			: '';
	const labels = p.labels
		? [
				{ text: text1, x: center[0], y: labelY },
				...(text2 ? [{ text: text2, x: center[0], y: labelY + 6.5 }] : [])
			]
		: [];
	return {
		holes,
		plate: [x0, y0, x1, y1 + (text2 && p.labels ? 6.5 : 0)],
		center,
		labels,
		crowded
	};
}

/** The jig in use: contact face on z = 0, top at z = thickness, stop below. */
function jig(p: DrillParams, L: DrillLayout): Node {
	const [x0, y0, x1, y1] = L.plate;
	const T = p.thickness;
	const w = x1 - x0;
	const d = y1 - y0;
	const body: Node[] = [translate([x0, y0, 0], cube([w, d, T]))];
	if (p.stop === 'edge' || p.stop === 'corner')
		body.push(translate([x0, -STOP_T, -p.stopDepth], cube([w, STOP_T + 0.01, T + p.stopDepth])));
	if (p.stop === 'corner')
		body.push(
			translate(
				[-STOP_T, -STOP_T, -p.stopDepth],
				cube([STOP_T + 0.01, y1 + STOP_T, T + p.stopDepth])
			)
		);

	const cuts: Node[] = [];
	for (const h of L.holes) {
		const r = (h.d + HOLE_CLEARANCE) / 2;
		cuts.push(translate([h.x, h.y, -1], cylinder(T + 2, r, r, FN)));
		// A 45° lead-in at the top guides the tip of the bit.
		const lead = Math.min(1, r * 0.3);
		cuts.push(translate([h.x, h.y, T - lead], cylinder(lead + 0.01, r, r + lead + 0.01, FN)));
	}

	// Pockets in the contact face: rim, bosses around the holes and ribs stay.
	if (p.lighten && T >= SKIN + 2) {
		const ribs: Node[] = [];
		for (let x = x0 + 40; x < x1 - 20; x += 40)
			ribs.push(translate([x - 1, y0], square(2, d, false)));
		// A hole near the edge pushes the plate past the stop: the pockets still
		// start beyond the stop, which stays joined to the plate along its length.
		const py0 = p.stop === 'none' ? y0 + RIM : Math.max(y0 + RIM, RIM);
		const area = difference(
			translate([x0 + RIM, py0], square(w - 2 * RIM, y1 - RIM - py0, false)),
			...L.holes.map((h) => translate([h.x, h.y], circle(boss(h), FN))),
			...ribs
		);
		cuts.push(translate([0, 0, -1], extrude(T - SKIN + 1, area)));
	}

	if (p.marks) {
		const [cx, cy] = L.center;
		// Engraved centre lines on the top face.
		cuts.push(
			translate([x0 + 2, cy - MARK_W / 2, T - ENGRAVE], cube([w - 4, MARK_W, 1])),
			translate([cx - MARK_W / 2, y0 + 2, T - ENGRAVE], cube([MARK_W, d - 4, 1]))
		);
		// V-notches through the plate (and the stop) where the lines meet the edges.
		const notch = (x: number, y: number, angle: number) =>
			translate(
				[x, y, -p.stopDepth - 1],
				rotate(
					[0, 0, angle],
					extrude(
						T + p.stopDepth + 2,
						polygon([
							[-2, 0],
							[2, 0],
							[0, 2.5]
						])
					)
				)
			);
		cuts.push(notch(cx, y1 + 0.01, 180));
		cuts.push(notch(cx, Math.min(y0, p.stop === 'none' ? y0 : -STOP_T) - 0.01, 0));
		if (p.stop !== 'corner') cuts.push(notch(x0 - 0.01, cy, -90));
		cuts.push(notch(x1 + 0.01, cy, 90));
	}

	for (const l of L.labels)
		cuts.push(translate([l.x, l.y, T - ENGRAVE], extrude(1, text(l.text, 4.5))));

	return difference(union(...body), ...cuts);
}

/** Upside down for printing: top face on the bed, the stop pointing up. */
export function drillModel(input: DrillParams): Node {
	const p = clampDrill(input);
	const L = drillLayout(p);
	const [x0, y0, x1, y1] = L.plate;
	return translate(
		[(x0 + x1) / 2, -(y0 + y1) / 2, p.thickness],
		part('jig', rotate([0, 180, 0], jig(p, L)))
	);
}

const mm = (v: number) => num(v, -1e4, 1e4);

export function drillHeader(input: DrillParams): string[] {
	const p = clampDrill(input);
	const L = drillLayout(p);
	return [
		m.t_drill_template_generator_scad_title(),
		m.t_drill_template_generator_scad_holes({
			count: mm(L.holes.length),
			hole: mm(p.hole),
			clearance: String(HOLE_CLEARANCE),
			thickness: mm(p.thickness)
		}),
		m.t_drill_template_generator_scad_print()
	];
}

export function drillScad(p: DrillParams): string {
	return toScad(drillModel(p), drillHeader(p));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f2 = (v: number) => String(Math.round(v * 100) / 100);

/**
 * The layout 1:1 as SVG (sizes in mm), seen from the top of the jig: plate,
 * stop (dashed), holes with cross-hairs, centre lines, the hole coordinates
 * and a 50 mm bar to check the print scale.
 */
export function drillSvg(input: DrillParams): string {
	const p = clampDrill(input);
	const L = drillLayout(p);
	const [x0, y0, x1, y1] = L.plate;
	const pad = 12;
	const left = Math.min(x0, p.stop === 'corner' ? -STOP_T : x0) - pad;
	const right = x1 + pad;
	const bottom = Math.min(y0, p.stop === 'none' ? y0 : -STOP_T) - pad - 14;
	const top = y1 + pad;
	const W = right - left;
	const H = top - bottom;
	// SVG y grows down: flip around the layout's y.
	const X = (x: number) => f2(x - left);
	const Y = (y: number) => f2(top - y);
	const out: string[] = [];
	out.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${f2(W)}mm" height="${f2(H)}mm" viewBox="0 0 ${f2(W)} ${f2(H)}" font-family="Arial, Helvetica, sans-serif">`,
		`<rect x="0" y="0" width="${f2(W)}" height="${f2(H)}" fill="#fff"/>`,
		`<rect x="${X(x0)}" y="${Y(y1)}" width="${f2(x1 - x0)}" height="${f2(y1 - y0)}" fill="none" stroke="#000" stroke-width="0.3"/>`
	);
	if (p.stop !== 'none')
		out.push(
			`<rect x="${X(x0)}" y="${Y(0)}" width="${f2(x1 - x0)}" height="${STOP_T}" fill="none" stroke="#000" stroke-width="0.2" stroke-dasharray="1.5 1"/>`
		);
	if (p.stop === 'corner')
		out.push(
			`<rect x="${X(-STOP_T)}" y="${Y(y1)}" width="${STOP_T}" height="${f2(y1 + STOP_T)}" fill="none" stroke="#000" stroke-width="0.2" stroke-dasharray="1.5 1"/>`
		);
	const [cx, cy] = L.center;
	out.push(
		`<line x1="${X(x0 - 4)}" y1="${Y(cy)}" x2="${X(x1 + 4)}" y2="${Y(cy)}" stroke="#000" stroke-width="0.15" stroke-dasharray="4 1 1 1"/>`,
		`<line x1="${X(cx)}" y1="${Y(y1 + 4)}" x2="${X(cx)}" y2="${Y(Math.min(y0, 0) - 4)}" stroke="#000" stroke-width="0.15" stroke-dasharray="4 1 1 1"/>`
	);
	for (const h of L.holes) {
		const r = h.d / 2;
		out.push(
			`<circle cx="${X(h.x)}" cy="${Y(h.y)}" r="${f2(r)}" fill="none" stroke="#000" stroke-width="0.25"/>`,
			`<line x1="${X(h.x - r - 2)}" y1="${Y(h.y)}" x2="${X(h.x + r + 2)}" y2="${Y(h.y)}" stroke="#000" stroke-width="0.15"/>`,
			`<line x1="${X(h.x)}" y1="${Y(h.y - r - 2)}" x2="${X(h.x)}" y2="${Y(h.y + r + 2)}" stroke="#000" stroke-width="0.15"/>`,
			`<text x="${X(h.x + r + 1)}" y="${Y(h.y + r + 1)}" font-size="2.5">${esc(`${fmt(h.x)}; ${fmt(h.y)}`)}</text>`
		);
	}
	for (const l of L.labels)
		out.push(
			`<text x="${X(l.x)}" y="${Y(l.y)}" font-size="3.5" text-anchor="middle" dominant-baseline="middle">${esc(l.text)}</text>`
		);
	// Scale check: 50 mm.
	const sy = bottom + 6;
	out.push(
		`<line x1="${X(left + pad)}" y1="${Y(sy)}" x2="${X(left + pad + 50)}" y2="${Y(sy)}" stroke="#000" stroke-width="0.4"/>`,
		`<text x="${X(left + pad + 52)}" y="${Y(sy)}" font-size="3" dominant-baseline="middle">${esc(m.t_drill_template_generator_svg_scale())}</text>`,
		'</svg>'
	);
	return out.join('\n');
}
