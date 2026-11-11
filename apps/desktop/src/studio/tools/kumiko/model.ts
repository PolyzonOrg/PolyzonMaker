/**
 * «Кумико»: a flat Japanese lattice in a frame — for a coaster, a picture on
 * the wall or a lamp's side. The patterns are drawn on a triangle grid as
 * the woodworkers lay them out: asanoha (hemp leaf: each triangle split to
 * its centre), kikkō (tortoise shell: hexagons), mitsukude (plain triangles)
 * and hishi (diamonds). Thin strips of a few nozzle widths,
 * lower than the frame, as the wooden ones sit.
 */
import {
	circle,
	difference,
	extrude,
	intersection,
	offset,
	part,
	polygon,
	rrect,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/kumiko';
import { clamp } from '../shared/math';

export type KumikoPattern = 'asanoha' | 'kikko' | 'mitsukude' | 'hishi';
export type KumikoShape = 'square' | 'rect' | 'hexagon' | 'circle';

export interface KumikoParams {
	pattern: KumikoPattern;
	shape: KumikoShape;
	/** Width; the height of a rectangle; a hexagon and a circle use the width across */
	width: number;
	height: number;
	/** Side of the grid's triangle, mm */
	cell: number;
	/** Strip width, mm */
	strip: number;
	frame: number;
	thickness: number;
	/** The lattice's height, mm (≤ the frame's) */
	lattice: number;
}

export const KUMIKO_DEFAULTS: KumikoParams = {
	pattern: 'asanoha',
	shape: 'square',
	width: 100,
	height: 140,
	cell: 24,
	strip: 1.2,
	frame: 6,
	thickness: 4,
	lattice: 3
};

export const KUMIKO_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<KumikoParams>;
}[] = [
	{
		id: 'coaster',
		get label() {
			return m.t_kumiko_preset_coaster();
		},
		params: { shape: 'circle', width: 100, cell: 20 }
	},
	{
		id: 'kikko',
		get label() {
			return m.t_kumiko_preset_kikko_hexagon();
		},
		params: { pattern: 'kikko', shape: 'hexagon', width: 120, cell: 18 }
	},
	{
		id: 'panel',
		get label() {
			return m.t_kumiko_preset_lamp();
		},
		params: { shape: 'rect', width: 100, height: 160, cell: 26, thickness: 3, lattice: 3 }
	},
	{
		id: 'wall',
		get label() {
			return m.t_kumiko_preset_wall();
		},
		params: { pattern: 'kikko', width: 180, cell: 30, frame: 10, thickness: 6, lattice: 4 }
	}
];

const PATTERNS: readonly KumikoPattern[] = ['asanoha', 'kikko', 'mitsukude', 'hishi'];

export function clampKumiko(p: KumikoParams): KumikoParams {
	const thickness = clamp(p.thickness, 1.6, 12);
	const shape = (['square', 'rect', 'hexagon', 'circle'] as const).includes(p.shape)
		? p.shape
		: 'square';
	const width = clamp(p.width, 40, 250);
	const height = clamp(p.height, 40, 250);
	const across =
		shape === 'rect' ? Math.min(width, height) : shape === 'hexagon' ? width * 0.866 : width;
	return {
		pattern: PATTERNS.includes(p.pattern) ? p.pattern : 'asanoha',
		shape,
		width,
		height,
		cell: clamp(p.cell, 8, 60),
		strip: clamp(p.strip, 0.8, 4),
		// A frame wider than the panel left no lattice (and a zero cell hung the page):
		// at least 12 mm stays open inside.
		frame: clamp(p.frame, 2, Math.min(30, across / 2 - 6)),
		thickness,
		lattice: clamp(p.lattice, 1, thickness)
	};
}

type Seg = [Vec2, Vec2];

/** Panel outline and its size across x and y. */
function outlineOf(p: KumikoParams): { shape: Node; w: number; h: number } {
	switch (p.shape) {
		case 'circle':
			return { shape: circle(p.width / 2, 128), w: p.width, h: p.width };
		case 'hexagon': {
			// Flat top and bottom; the width is corner to corner.
			const r = p.width / 2;
			const pts = Array.from(
				{ length: 6 },
				(_, i): Vec2 => [r * Math.cos((i * Math.PI) / 3), r * Math.sin((i * Math.PI) / 3)]
			);
			return { shape: polygon(pts), w: p.width, h: p.width * (Math.sqrt(3) / 2) };
		}
		case 'rect':
			return { shape: rrect(p.width, p.height, 2, 24), w: p.width, h: p.height };
		case 'square':
			return { shape: rrect(p.width, p.width, 2, 24), w: p.width, h: p.width };
	}
}

/**
 * The pattern's lines over a w × h area round the centre, on a triangle
 * grid of side s with a vertex at the centre (so the panel is symmetric).
 */
/**
 * The grid's side, near the one asked for, that puts the inside's top and
 * bottom edges half way between two rows: no strip runs along the frame.
 */
export function kumikoCell(input: KumikoParams): number {
	const p = clampKumiko(input);
	const half = outlineOf(p).h / 2 - p.frame;
	const row = (p.cell * Math.sqrt(3)) / 2;
	const rows = Math.max(1, Math.round(half / row - 0.5));
	return ((half / (rows + 0.5)) * 2) / Math.sqrt(3);
}

export function kumikoLines(pattern: KumikoPattern, s: number, w: number, h: number): Seg[] {
	const rh = (s * Math.sqrt(3)) / 2;
	const nx = Math.ceil(w / s / 2) + 2;
	const ny = Math.ceil(h / rh / 2) + 2;
	const vertex = (i: number, j: number): Vec2 => [(i + (j & 1 ? 0.5 : 0)) * s, j * rh];
	const out: Seg[] = [];
	const hex = s / Math.sqrt(3);
	for (let j = -ny; j < ny; j++)
		for (let i = -nx; i < nx; i++) {
			const a = vertex(i, j);
			const b = vertex(i + 1, j);
			const odd = j & 1;
			const up = vertex(i + odd, j + 1);
			const down = vertex(i + odd, j - 1);
			if (pattern === 'kikko') {
				// A hexagon round every vertex, its corners at the triangles' centres;
				// three edges each, the neighbours draw the rest.
				for (let k = 0; k < 3; k++) {
					const t1 = Math.PI / 6 + (k * Math.PI) / 3;
					const t2 = t1 + Math.PI / 3;
					out.push([
						[a[0] + hex * Math.cos(t1), a[1] + hex * Math.sin(t1)],
						[a[0] + hex * Math.cos(t2), a[1] + hex * Math.sin(t2)]
					]);
				}
				continue;
			}
			// The grid: level lines (not in hishi) and the two slanted ones.
			if (pattern !== 'hishi') out.push([a, b]);
			out.push([a, up], [b, up]);
			if (pattern === 'asanoha')
				// The two triangles on this edge, pointing up and down: each corner to the centre.
				for (const apex of [up, down]) {
					const c: Vec2 = [(a[0] + b[0] + apex[0]) / 3, (a[1] + b[1] + apex[1]) / 3];
					out.push([a, c], [b, c], [apex, c]);
				}
		}
	// Keep what reaches the area.
	return out.filter(
		([u, v]) =>
			Math.max(u[0], v[0]) > -w / 2 - s &&
			Math.min(u[0], v[0]) < w / 2 + s &&
			Math.max(u[1], v[1]) > -h / 2 - s &&
			Math.min(u[1], v[1]) < h / 2 + s
	);
}

/** A strip w wide along a segment, its ends squared off a little past the points. */
function strip([u, v]: Seg, w: number): Node {
	const dx = v[0] - u[0];
	const dy = v[1] - u[1];
	const len = Math.hypot(dx, dy) || 1;
	const [tx, ty] = [dx / len, dy / len];
	const [nx, ny] = [(-ty * w) / 2, (tx * w) / 2];
	const e = w / 2;
	const a: Vec2 = [u[0] - tx * e, u[1] - ty * e];
	const b: Vec2 = [v[0] + tx * e, v[1] + ty * e];
	return polygon([
		[a[0] + nx, a[1] + ny],
		[b[0] + nx, b[1] + ny],
		[b[0] - nx, b[1] - ny],
		[a[0] - nx, a[1] - ny]
	]);
}

export function kumikoModel(input: KumikoParams): Node {
	const p = clampKumiko(input);
	const o = outlineOf(p);
	const lines = kumikoLines(p.pattern, kumikoCell(p), o.w, o.h);
	const inner = offset(-p.frame, 48, o.shape);
	// Into the frame a little, so every strip is held at its end.
	const reach = offset(-p.frame + Math.min(1, p.frame / 2), 48, o.shape);
	return part(
		'kumiko',
		union(
			difference(
				extrude(p.thickness, o.shape),
				translate([0, 0, -1], extrude(p.thickness + 2, inner))
			),
			extrude(p.lattice, intersection(reach, union(...lines.map((l) => strip(l, p.strip)))))
		)
	);
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

function patternWord(pattern: KumikoPattern): string {
	switch (pattern) {
		case 'asanoha':
			return m.t_kumiko_word_asanoha();
		case 'kikko':
			return m.t_kumiko_word_kikko();
		case 'mitsukude':
			return m.t_kumiko_word_mitsukude();
		case 'hishi':
			return m.t_kumiko_word_hishi();
	}
}

export function kumikoSummary(input: KumikoParams): string {
	const p = clampKumiko(input);
	const o = outlineOf(p);
	const n = kumikoLines(p.pattern, kumikoCell(p), o.w, o.h).length;
	const size = p.shape === 'circle' ? `⌀ ${mm(o.w)}` : `${mm(o.w)} × ${mm(o.h)}`;
	return m.t_kumiko_summary({
		pattern: patternWord(p.pattern),
		size,
		cell: mm(kumikoCell(p)),
		count: n,
		n: num(n),
		strip: mm(p.strip)
	});
}

export function kumikoHeader(input: KumikoParams): string[] {
	return [m.t_kumiko_scad_title(), kumikoSummary(input)];
}

export function kumikoScad(p: KumikoParams): string {
	return toScad(kumikoModel(p), kumikoHeader(p));
}
