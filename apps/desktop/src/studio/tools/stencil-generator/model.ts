/**
 * Stencil: a sheet with the drawing cut through it. The closed counters of
 * letters and shapes (О, Р, 8, a ring…) would drop out of the sheet, so each
 * one gets a tie: a bar left uncut, from inside the counter up (and, if
 * asked, down) across that letter only. The reverse stencil keeps the
 * drawing and opens the background: a frame plus the drawing, tied to the
 * frame by the same bars.
 *
 * Everything is 2D (manifold CrossSection) and extruded once at the end.
 */
import type { CrossSection } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import type { Weight } from '../shared/glyphs';
import { DEFAULT_FONT } from '../shared/fonts';
import {
	fitSection,
	glyphSection,
	interiorPoint,
	offset,
	rect,
	ringsOf,
	slab,
	toSection,
	trianglesOf,
	unionSections,
	type Kit
} from '../shared/section';
import {
	ringArea,
	ringsBounds,
	TRACE_DEFAULTS,
	type Ring,
	type TraceOptions
} from '../shared/trace';
import type { Triangles } from '../stl';
import * as msg from '$msg/tools/stencil-generator';

export type StencilSource = 'text' | 'shape' | 'svg' | 'image';
export type PlateShape = 'rect' | 'circle' | 'oval';
/** Ties per closed counter: none, one going up, one up and one down. */
export type TieMode = 'none' | 'top' | 'both';

export interface StencilParams {
	source: StencilSource;
	text: string;
	line2: string;
	weight: Weight;
	/** Font family (shared/fonts.ts); one not opened this visit falls back to Noto Sans. */
	font: string;
	/** Capital letter height, mm (text). */
	letterHeight: number;
	shape: string;
	/** Larger side of the drawing, mm (shape, SVG, picture). */
	size: number;
	trace: TraceOptions;
	/** Drop picture specks smaller than this, mm. */
	minDetail: number;
	thickness: number;
	/** Sheet beyond the drawing, mm. */
	margin: number;
	plate: PlateShape;
	radius: number;
	bridges: TieMode;
	bridgeWidth: number;
	negative: boolean;
	frame: number;
	mirror: boolean;
	hangers: boolean;
	hangerDiameter: number;
}

/** min, max, step of every number in the form. */
export const STENCIL_LIMITS = {
	letterHeight: [8, 250, 1],
	size: [15, 300, 1],
	thickness: [0.4, 5, 0.1],
	margin: [3, 40, 1],
	radius: [0, 25, 0.5],
	bridgeWidth: [0.6, 8, 0.1],
	frame: [3, 30, 0.5],
	hangerDiameter: [2, 12, 0.5]
} as const;

/**
 * 1.2 mm is six 0.2 mm layers: stiff enough to hold flat under a brush,
 * thin enough for paint to reach the edge. A 1.5 mm tie is about four
 * extrusion widths of a 0.4 mm nozzle and barely shows in the paint.
 */
export const STENCIL_DEFAULTS: StencilParams = {
	source: 'text',
	text: '40',
	line2: '',
	weight: 'bold',
	font: DEFAULT_FONT,
	letterHeight: 50,
	shape: 'heart',
	size: 80,
	trace: { ...TRACE_DEFAULTS },
	minDetail: 1,
	thickness: 1.2,
	margin: 10,
	plate: 'rect',
	radius: 4,
	bridges: 'top',
	bridgeWidth: 1.5,
	negative: false,
	frame: 8,
	mirror: false,
	hangers: false,
	hangerDiameter: 5
};

export const STENCIL_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<StencilParams>;
}[] = [
	{
		id: 'house-number',
		get label() {
			return msg.t_stencil_generator_preset_house_number();
		},
		params: { source: 'text', text: '17', line2: '', letterHeight: 120, margin: 15, bridges: 'top' }
	},
	{
		id: 'crate',
		get label() {
			return msg.t_stencil_generator_preset_crate();
		},
		get params(): Partial<StencilParams> {
			return {
				source: 'text',
				text: msg.t_stencil_generator_sample_crate_line1(),
				line2: msg.t_stencil_generator_sample_crate_line2(),
				letterHeight: 30,
				bridges: 'both',
				hangers: true
			};
		}
	},
	{
		id: 'round',
		get label() {
			return msg.t_stencil_generator_preset_round();
		},
		params: { source: 'shape', shape: 'heart', size: 60, plate: 'circle', bridges: 'none' }
	},
	{
		id: 'mask',
		get label() {
			return msg.t_stencil_generator_preset_mask();
		},
		get params(): Partial<StencilParams> {
			return {
				source: 'text',
				text: msg.t_stencil_generator_sample_mask(),
				line2: '',
				letterHeight: 50,
				negative: true,
				bridges: 'both'
			};
		}
	}
];

export interface StencilResult {
	tris: Triangles;
	/** Contours of the finished sheet (outer edge and every cut), mm. */
	sheet: Ring[];
	/** Width × height × thickness of the sheet, mm. */
	plate: [number, number, number];
	islands: number;
	bridges: number;
}

/** Plate around the drawing's bounds: rectangle, circle or ellipse. */
function plateSection(
	kit: Kit,
	drawing: CrossSection,
	rings: Ring[],
	p: StencilParams,
	extra: number
) {
	const b = drawing.bounds();
	const [x0, y0] = b.min;
	const [x1, y1] = b.max;
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	const m = p.margin + extra;
	if (p.plate === 'rect') {
		const w = x1 - x0 + 2 * m;
		const h = y1 - y0 + 2 * m;
		const r = Math.max(0, Math.min(p.radius, w / 2 - 0.1, h / 2 - 0.1));
		const core = rect(kit, cx - w / 2 + r, cy - h / 2 + r, cx + w / 2 - r, cy + h / 2 - r);
		return r > 0 ? offset(kit, core, r) : core;
	}
	// Circle / ellipse just around every point of the drawing.
	const a = Math.max((x1 - x0) / 2, 1e-3);
	const c = Math.max((y1 - y0) / 2, 1e-3);
	let k = 0;
	for (const r of rings)
		for (const [x, y] of r)
			k = Math.max(
				k,
				p.plate === 'circle' ? Math.hypot(x - cx, y - cy) : Math.hypot((x - cx) / a, (y - cy) / c)
			);
	const unit = kit.keep(kit.wasm.CrossSection.circle(1, 96));
	const [sx, sy] = p.plate === 'circle' ? [k + m, k + m] : [k * a + m, k * c + m];
	return kit.keep(kit.keep(unit.scale([sx, sy])).translate([cx, cy]));
}

/** Two holes near the top corners (or the top of a round sheet). */
function hangerHoles(kit: Kit, plate: CrossSection, p: StencilParams) {
	const b = plate.bounds();
	const d = p.hangerDiameter;
	const s = Math.max(p.margin / 2, d / 2 + 1.5, p.plate === 'rect' ? p.radius * 0.35 + d / 2 : 0);
	const cx = (b.min[0] + b.max[0]) / 2;
	const cy = (b.min[1] + b.max[1]) / 2;
	const a = (b.max[0] - b.min[0]) / 2;
	const c = (b.max[1] - b.min[1]) / 2;
	const centres: [number, number][] =
		p.plate === 'rect'
			? [
					[b.min[0] + s, b.max[1] - s],
					[b.max[0] - s, b.max[1] - s]
				]
			: [52, 128].map((deg) => {
					const t = (deg * Math.PI) / 180;
					return [cx + (a - s) * Math.cos(t), cy + (c - s) * Math.sin(t)] as [number, number];
				});
	const hole = kit.keep(kit.wasm.CrossSection.circle(d / 2, 32));
	return unionSections(
		kit,
		centres.map((at) => kit.keep(hole.translate(at)))
	);
}

/**
 * The stencil from a drawing (mm, any position). Islands are the holes of
 * the drawing's pieces; a bridge is a bar from inside the hole up (and
 * down) across that piece only, so other letters are not touched.
 */
export function buildStencil(kit: Kit, drawingIn: CrossSection, p: StencilParams): StencilResult {
	let drawing = drawingIn;
	if (p.mirror) drawing = kit.keep(drawing.mirror([1, 0]));
	if (drawing.isEmpty() || drawing.area() < 1)
		throw new ToolError(msg.t_stencil_generator_empty_drawing());
	const rings = ringsOf(drawing);
	const bw = p.bridgeWidth;
	const perIsland = p.bridges === 'both' ? 2 : p.bridges === 'top' ? 1 : 0;
	const pieces = drawing.decompose().map((c) => kit.keep(c));
	let islands = 0;
	let bridges = 0;
	let sheet: CrossSection;
	let plate: CrossSection;

	if (!p.negative) {
		plate = plateSection(kit, drawing, rings, p, 0);
		const cutBridges: CrossSection[] = [];
		for (const piece of pieces) {
			const holes = ringsOf(piece).filter((r) => ringArea(r) < 0);
			if (!holes.length) continue;
			islands += holes.length;
			if (!perIsland) continue;
			const pb = piece.bounds();
			const bars: CrossSection[] = [];
			for (const hole of holes) {
				const at = interiorPoint([hole]);
				if (!at) continue;
				bars.push(rect(kit, at[0] - bw / 2, at[1], at[0] + bw / 2, pb.max[1] + 1));
				if (perIsland === 2)
					bars.push(rect(kit, at[0] - bw / 2, pb.min[1] - 1, at[0] + bw / 2, at[1]));
				bridges += perIsland;
			}
			if (bars.length) cutBridges.push(kit.keep(unionSections(kit, bars).intersect(piece)));
		}
		const cut = cutBridges.length
			? kit.keep(drawing.subtract(unionSections(kit, cutBridges)))
			: drawing;
		sheet = kit.keep(plate.subtract(cut));
	} else {
		plate = plateSection(kit, drawing, rings, p, p.frame);
		const frame = kit.keep(plate.subtract(offset(kit, plate, -p.frame)));
		const pb = plate.bounds();
		const bars: CrossSection[] = [];
		islands = pieces.length;
		if (perIsland)
			for (const piece of pieces) {
				const at = interiorPoint(ringsOf(piece));
				if (!at) continue;
				bars.push(rect(kit, at[0] - bw / 2, at[1], at[0] + bw / 2, pb.max[1] - p.frame / 2));
				if (perIsland === 2)
					bars.push(rect(kit, at[0] - bw / 2, pb.min[1] + p.frame / 2, at[0] + bw / 2, at[1]));
				bridges += perIsland;
			}
		sheet = kit.keep(unionSections(kit, [frame, drawing, ...bars]).intersect(plate));
	}

	if (p.hangers) sheet = kit.keep(sheet.subtract(hangerHoles(kit, plate, p)));
	if (sheet.isEmpty()) throw new ToolError(msg.t_stencil_generator_empty_drawing());
	const solid = slab(kit, sheet, 0, p.thickness);
	const sheetRings = ringsOf(sheet);
	const box = ringsBounds(sheetRings);
	return {
		tris: trianglesOf(solid),
		sheet: sheetRings,
		plate: [box.maxX - box.minX, box.maxY - box.minY, p.thickness],
		islands,
		bridges
	};
}

/** What the page sends to the worker: the drawing's rings and how to read them. */
export interface StencilJob {
	p: StencilParams;
	rings: Ring[];
	/** glyphs: text at GLYPH_SIZE; shape: built-in, union of rings; outline: mm, even-odd. */
	kind: 'glyphs' | 'shape' | 'outline';
}

export function runStencil(kit: Kit, { p, rings, kind }: StencilJob): StencilResult {
	const drawing =
		kind === 'glyphs'
			? glyphSection(kit, rings, p.letterHeight, p.weight)
			: kind === 'shape'
				? fitSection(kit, toSection(kit, rings, 'Positive'), p.size)
				: toSection(kit, rings);
	return buildStencil(kit, drawing, p);
}
