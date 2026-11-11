/**
 * Flat parts with relief — plates, tags, keychains, QR signs — described as
 * stacked 2D layers and turned into a solid with manifold-3d (milliseconds),
 * into per-colour parts and an SVG drawing.
 *
 * Why not one OpenSCAD program: the browser OpenSCAD (2022.03, CGAL) needs
 * 15–40 s to union a plate with a QR code or a line of text. Here OpenSCAD
 * only draws the glyphs (see text-outline.ts, one extrusion, ~3 s, cached),
 * everything else is 2D outlines and booleans in manifold. So there is no
 * «В OpenSCAD» for these tools: the outlines would go out as point lists.
 *
 * Coordinates: mm, the part centred on the origin, z = 0 on the bed.
 * Regions are polygon lists as CrossSection.toPolygons() gives them
 * (outer contours counter-clockwise, holes clockwise).
 */
import type { CrossSection, Manifold, ManifoldToplevel, SimplePolygon } from 'manifold-3d';
import { str } from '../scad-literals';
import { fromManifold } from '../solid';
import { writeStl } from '../stl';
import { darkRects, type QrCode } from './qr';
import { write3mf } from './threemf';
import { zipStore } from './zip';
import { num } from '$lib/i18n/current';
import * as tc from '$msg/tools/common';

export type Region = SimplePolygon[];

/**
 * - body: the base, printed in the first colour;
 * - relief: raised on top (second colour);
 * - engrave: cut into the top (the cavity can print as a separate inlay);
 * - cut: through holes, magnet pockets, recesses — removed from everything.
 */
export type LayerKind = 'body' | 'relief' | 'engrave' | 'cut';

/** A countersink or a round pocket: a cone frustum from z0 (r0) to z1 (r1). */
export interface Cone {
	x: number;
	y: number;
	r0: number;
	r1: number;
}

export interface Layer {
	kind: LayerKind;
	/** The printed part it belongs to: «base», «text», «qr», «frame»… */
	part: string;
	region: Region;
	z0: number;
	z1: number;
	/** Instead of a region: cones (countersinks). */
	cones?: Cone[];
}

/** Nominal glyph size the outlines are drawn at; layouts scale from it. */
export const TEXT_SIZE = 10;
/** Curve segments per glyph contour piece (OpenSCAD $fn for text). */
export const TEXT_FN = 16;
export const TEXT_FONT = 'Noto Sans';

// ---------- WASM objects: everything made in a build is freed at its end ----------

type Deletable = { delete(): void };

export class Scope {
	private items: Deletable[] = [];
	constructor(readonly wasm: ManifoldToplevel) {}
	/** Keep an object until free(). */
	t<T extends Deletable>(item: T): T {
		this.items.push(item);
		return item;
	}
	cs(region: Region | SimplePolygon): CrossSection {
		return this.t(new this.wasm.CrossSection(region, 'Positive'));
	}
	free(): void {
		for (const item of this.items) {
			try {
				item.delete();
			} catch {
				/* already freed */
			}
		}
		this.items = [];
	}
}

export function withScope<R>(wasm: ManifoldToplevel, fn: (s: Scope) => R): R {
	const scope = new Scope(wasm);
	try {
		return fn(scope);
	} finally {
		scope.free();
	}
}

// ---------- 2D helpers ----------

export function rect(x0: number, y0: number, x1: number, y1: number): SimplePolygon {
	return [
		[x0, y0],
		[x1, y0],
		[x1, y1],
		[x0, y1]
	];
}

export function circle(
	x: number,
	y: number,
	r: number,
	segments = circleSegments(r)
): SimplePolygon {
	const out: SimplePolygon = [];
	for (let i = 0; i < segments; i++) {
		const a = (i / segments) * Math.PI * 2;
		out.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
	}
	return out;
}

/** About 0.25 mm per segment, 24–96 segments. */
export function circleSegments(r: number): number {
	return Math.max(24, Math.min(96, Math.round((Math.PI * 2 * r) / 0.6 / 4) * 4));
}

/** Convex hull of points (monotone chain), counter-clockwise. */
export function convexHull(points: readonly [number, number][]): SimplePolygon {
	const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (pts.length < 3) return pts;
	const turn = (o: [number, number], a: [number, number], b: [number, number]) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const half = (list: [number, number][]) => {
		const out: [number, number][] = [];
		for (const p of list) {
			while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
			out.push(p);
		}
		return out.slice(0, -1);
	};
	return [...half(pts), ...half([...pts].reverse())];
}

/**
 * Outline as polygons, without the near-duplicate points offsets leave
 * behind (they turn into sliver triangles where a relief meets the top).
 */
export function regionOf(cs: CrossSection): Region {
	const clean = cs.simplify(0.002);
	try {
		return clean.toPolygons();
	} finally {
		clean.delete();
	}
}

export function regionArea(s: Scope, region: Region): number {
	return region.length ? s.cs(region).area() : 0;
}

/** Whether `inner` lies within `outer` (up to a hair). */
export function inside(s: Scope, outer: CrossSection, inner: CrossSection | Region): boolean {
	const piece = s.t((Array.isArray(inner) ? s.cs(inner) : inner).subtract(outer));
	return piece.area() < 1e-4;
}

/**
 * The biggest scale k ∈ [0, 1] for which `make(k)` still fits `allowed`
 * (binary search; the shape must grow with k).
 */
export function largestFit(
	s: Scope,
	allowed: CrossSection,
	make: (k: number) => Region,
	steps = 14
): number {
	if (inside(s, allowed, make(1))) return 1;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < steps; i++) {
		const mid = (lo + hi) / 2;
		if (inside(s, allowed, make(mid))) lo = mid;
		else hi = mid;
	}
	return lo;
}

export interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export function boundsOf(region: Region): Box | null {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const poly of region) {
		for (const [x, y] of poly) {
			if (x < x0) x0 = x;
			if (y < y0) y0 = y;
			if (x > x1) x1 = x;
			if (y > y1) y1 = y;
		}
	}
	return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

export function transformRegion(region: Region, scale: number, dx: number, dy: number): Region {
	return region.map((poly) =>
		poly.map(([x, y]) => [x * scale + dx, y * scale + dy] as [number, number])
	);
}

// ---------- QR code as a region ----------

export type ModuleShape = 'square' | 'dot' | 'diamond';

export interface QrRegionOptions {
	/** Bottom-left corner of the code including the quiet zone. */
	x: number;
	y: number;
	/** Module side, mm. */
	module: number;
	/** Light border, modules. */
	quiet: number;
	shape?: ModuleShape;
	/** Share of the module the shape fills, 0.4–1. */
	fill?: number;
	/** The light modules and the border become the region (for a light colour on top). */
	invert?: boolean;
}

/** Side of the code with its quiet zone, mm. */
export function qrSide(qr: QrCode, module: number, quiet: number): number {
	return (qr.size + 2 * quiet) * module;
}

/**
 * The dark modules (or, inverted, everything light) as one region. Finder
 * patterns stay solid squares whatever the module shape: scanners look for
 * them first. Touching squares overlap by a hair so diagonal neighbours
 * weld into one solid instead of meeting at a single edge.
 */
export function qrRegion(s: Scope, qr: QrCode, o: QrRegionOptions): Region {
	const { module: m, quiet: q } = o;
	const shape = o.shape ?? 'square';
	const fill = Math.min(1, Math.max(0.4, o.fill ?? 1));
	const n = qr.size;
	const X = (col: number) => o.x + (col + q) * m;
	const Y = (row: number) => o.y + (n - row + q) * m; // top edge of a row
	const eps = 0.004;
	const inFinder = (x: number, y: number) =>
		(x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);

	const solid = qr.modules.map((row, y) =>
		row.map((dark, x) => dark && (shape === 'square' && fill >= 1 ? true : inFinder(x, y)))
	);
	const polys: SimplePolygon[] = darkRects(solid).map(([x, y, w, h]) =>
		rect(X(x) - eps, Y(y + h) - eps, X(x + w) + eps, Y(y) + eps)
	);
	if (!(shape === 'square' && fill >= 1)) {
		const r = (m * fill) / 2;
		qr.modules.forEach((row, y) =>
			row.forEach((dark, x) => {
				if (!dark || inFinder(x, y)) return;
				const cx = X(x) + m / 2;
				const cy = Y(y) - m / 2;
				if (shape === 'dot') polys.push(circle(cx, cy, r, 16));
				else if (shape === 'diamond')
					polys.push([
						[cx + r, cy],
						[cx, cy + r],
						[cx - r, cy],
						[cx, cy - r]
					]);
				else polys.push(rect(cx - r, cy - r, cx + r, cy + r));
			})
		);
	}
	const dark = s.cs(polys);
	if (!o.invert) return regionOf(dark);
	const side = qrSide(qr, m, q);
	const square = s.cs(rect(o.x, o.y, o.x + side, o.y + side));
	return regionOf(s.t(square.subtract(dark)));
}

// ---------- Text block layout ----------

/** Glyph outlines at TEXT_SIZE, baseline at y = 0, starting at x ≈ 0. */
export interface TextShapes {
	/** Height of a capital letter at TEXT_SIZE, mm. */
	cap: number;
	lines: Record<string, Region>;
}

export interface TextLine {
	text: string;
	/** Wanted height of capitals, mm (shrinks to fit). */
	cap: number;
}

export interface TextBlock {
	region: Region;
	/** Cap height of each line after fitting, mm. */
	caps: number[];
	box: Box | null;
}

/**
 * Lines centred in a box, one above the other; a line wider than the box
 * shrinks alone, a block taller than the box shrinks as a whole.
 */
export function layoutText(
	shapes: TextShapes,
	lines: readonly TextLine[],
	box: Box,
	align: 'center' | 'left' = 'center'
): TextBlock {
	const items = lines
		.map((l) => ({ ...l, region: shapes.lines[l.text.trim()] }))
		.filter((l) => l.text.trim() && l.region?.length);
	if (!items.length || box.x1 <= box.x0 || box.y1 <= box.y0) {
		return { region: [], caps: [], box: null };
	}
	const boxW = box.x1 - box.x0;
	const boxH = box.y1 - box.y0;
	const measured = items.map((l) => {
		const b = boundsOf(l.region) as Box;
		let k = l.cap / shapes.cap; // TEXT_SIZE units → mm
		if ((b.x1 - b.x0) * k > boxW) k = boxW / (b.x1 - b.x0);
		return { ...l, b, k };
	});
	// Vertical extent of a line: capitals, plus descenders if it has them.
	const extent = (l: (typeof measured)[number]) => ({
		top: Math.max(l.b.y1, shapes.cap) * l.k,
		bottom: Math.min(l.b.y0, 0) * l.k
	});
	const gapOf = (l: (typeof measured)[number]) => shapes.cap * l.k * 0.45;
	const total = () =>
		measured.reduce((sum, l, i) => sum + extent(l).top - extent(l).bottom + (i ? gapOf(l) : 0), 0);
	const h = total();
	if (h > boxH) {
		const f = boxH / h;
		for (const l of measured) l.k *= f;
	}
	let y = (box.y0 + box.y1) / 2 + total() / 2;
	const region: Region = [];
	measured.forEach((l, i) => {
		if (i) y -= gapOf(l);
		const e = extent(l);
		const baseline = y - e.top;
		y = baseline + e.bottom;
		const width = (l.b.x1 - l.b.x0) * l.k;
		const left = align === 'center' ? (box.x0 + box.x1) / 2 - width / 2 : box.x0;
		const x = left - l.b.x0 * l.k;
		region.push(...transformRegion(l.region, l.k, x, baseline));
	});
	return {
		region,
		caps: measured.map((l) => shapes.cap * l.k),
		box: boundsOf(region)
	};
}

// ---------- Glyph outlines from OpenSCAD ----------

const TEXT_BAND = 50;
const scadNum = (v: number) => String(Number(v.toFixed(3)));

/**
 * One program that draws every line (and a reference capital) as a single
 * extrusion — a single object, so OpenSCAD skips CGAL entirely. Lines sit
 * in bands TEXT_BAND mm apart and are told apart by height afterwards.
 */
export function textOutlineScad(texts: readonly string[], font = TEXT_FONT, spacing = 1): string {
	const face = str(font, 120);
	const step = spacing !== 1 ? `, spacing = ${scadNum(spacing)}` : '';
	const lines = texts.map(
		(t, i) =>
			`\ttranslate([0, ${-TEXT_BAND * (i + 1)}]) text(${str(t, 120)}, size = ${TEXT_SIZE}, font = ${face}${step});`
	);
	return `$fn = ${TEXT_FN};
union() {
	text("Н", size = ${TEXT_SIZE}, font = ${face}); // i18n-ok: the capital the font is measured by
${lines.join('\n')}
}
`;
}

/** The compiled outline (textOutlineScad) → each line's region. */
export function textShapesFromRings(
	s: Scope,
	rings: SimplePolygon[],
	texts: readonly string[]
): TextShapes {
	const all = s.t(new s.wasm.CrossSection(rings, 'NonZero'));
	const band = (i: number) => {
		const y = -TEXT_BAND * i;
		const piece = s.t(all.intersect(s.cs(rect(-1e4, y - TEXT_BAND / 2, 1e4, y + TEXT_BAND / 2))));
		return transformRegion(regionOf(piece), 1, 0, -y);
	};
	const ref = boundsOf(band(0));
	const lines: Record<string, Region> = {};
	texts.forEach((t, i) => (lines[t] = band(i + 1)));
	return { cap: ref ? ref.y1 - ref.y0 : TEXT_SIZE, lines };
}

// ---------- Solids ----------

function layerSolid(s: Scope, layer: Layer): Manifold | null {
	const h = layer.z1 - layer.z0;
	if (h <= 0) return null;
	if (layer.cones?.length) {
		// Turned by half a segment: its edges never meet those of a hole drilled at the same spot.
		const parts = layer.cones.map((c) => {
			const n = circleSegments(Math.max(c.r0, c.r1)) + 2;
			const cone = s.t(s.wasm.Manifold.cylinder(h, c.r0, c.r1, n));
			return s.t(s.t(cone.rotate([0, 0, 180 / n])).translate([c.x, c.y, layer.z0]));
		});
		return s.t(s.wasm.Manifold.union(parts));
	}
	if (!layer.region.length) return null;
	return s.t(s.t(s.cs(layer.region).extrude(h)).translate([0, 0, layer.z0]));
}

function unionOf(s: Scope, layers: readonly Layer[]): Manifold | null {
	const solids = layers.map((l) => layerSolid(s, l)).filter((m): m is Manifold => !!m);
	if (!solids.length) return null;
	return solids.length === 1 ? solids[0] : s.t(s.wasm.Manifold.union(solids));
}

function minus(s: Scope, a: Manifold | null, b: Manifold | null): Manifold | null {
	if (!a) return null;
	return b ? s.t(a.subtract(b)) : a;
}

/** The finished part: (body ∪ relief) − (engravings ∪ cuts). */
export function solidOf(s: Scope, layers: readonly Layer[]): Manifold | null {
	const add = unionOf(
		s,
		layers.filter((l) => l.kind === 'body' || l.kind === 'relief')
	);
	const sub = unionOf(
		s,
		layers.filter((l) => l.kind === 'engrave' || l.kind === 'cut')
	);
	return minus(s, add, sub);
}

/**
 * One solid per printed part, already in place, for multi-material
 * printing: the base with its cavities, then each relief part and each
 * engraved part as the inlay that fills its cavity.
 */
export function partSolids(
	s: Scope,
	layers: readonly Layer[]
): { part: string; solid: Manifold }[] {
	const cuts = unionOf(
		s,
		layers.filter((l) => l.kind === 'cut')
	);
	const cavities = unionOf(
		s,
		layers.filter((l) => l.kind === 'engrave')
	);
	const out: { part: string; solid: Manifold }[] = [];
	const base = minus(
		s,
		minus(
			s,
			unionOf(
				s,
				layers.filter((l) => l.kind === 'body')
			),
			cavities
		),
		cuts
	);
	if (base && !base.isEmpty()) out.push({ part: 'base', solid: base });
	const parts = [
		...new Set(layers.filter((l) => l.kind === 'relief' || l.kind === 'engrave').map((l) => l.part))
	];
	const top = bodyTop(layers);
	for (const part of parts) {
		// An inlay fills its cavity flush with the top.
		const own = layers
			.filter((l) => l.part === part && (l.kind === 'relief' || l.kind === 'engrave'))
			.map((l) => (l.kind === 'engrave' ? { ...l, z1: Math.min(l.z1, top) } : l));
		const solid = minus(s, unionOf(s, own), cuts);
		if (solid && !solid.isEmpty() && solid.volume() > 1e-3) out.push({ part, solid });
	}
	return out;
}

/** Height of the base top: where the second colour starts for raised parts. */
export function bodyTop(layers: readonly Layer[]): number {
	return Math.max(0, ...layers.filter((l) => l.kind === 'body').map((l) => l.z1));
}

/** A manifold as a triangle soup (what writeStl takes). */
export const meshTriangles = fromManifold;

/** File name part and the name in the memo, per printed part, in the page's language. */
const PART_NAMES: Record<string, () => [string, string]> = {
	base: () => [tc.tc_part_base_filename(), tc.tc_part_base()],
	text: () => [tc.tc_part_text_filename(), tc.tc_part_text()],
	caption: () => [tc.tc_part_caption_filename(), tc.tc_part_caption()],
	qr: () => [tc.tc_part_qr_filename(), tc.tc_part_qr()],
	frame: () => [tc.tc_part_frame_filename(), tc.tc_part_frame()],
	logo: () => [tc.tc_part_logo_filename(), tc.tc_part_logo()]
};

/** How many separately printable parts the layers make. */
export function partCount(layers: readonly Layer[]): number {
	const marks = new Set(
		layers.filter((l) => l.kind === 'relief' || l.kind === 'engrave').map((l) => l.part)
	);
	return marks.size + 1;
}

/**
 * A ZIP with one STL per part, already aligned, and a memo in the page's
 * language on how to load them as one multi-part model.
 */
export function partsZip(
	s: Scope,
	layers: readonly Layer[],
	name: string,
	colorChange: number | null
): Uint8Array {
	const files = partSolids(s, layers).map((p) => {
		const [file, title] = PART_NAMES[p.part]?.() ?? [p.part, p.part];
		return {
			name: `${name}-${file}.stl`,
			title,
			data: writeStl(meshTriangles(p.solid), `Polyzon Studio ${file}`)
		};
	});
	const memo = [
		tc.tc_memo_title(),
		'',
		...files.map((f) => `${f.name} — ${f.title}`),
		'',
		tc.tc_memo_load(),
		...(colorChange !== null ? ['', tc.tc_memo_single_nozzle({ height: num(colorChange) })] : [])
	];
	return zipStore([
		...files.map((f) => ({ name: f.name, data: f.data })),
		{ name: `${tc.tc_memo_filename()}.txt`, data: memo.join('\r\n') + '\r\n' }
	]);
}

/** The same parts as one 3MF model, a part per colour (shared/threemf.ts). */
export function parts3mf(s: Scope, layers: readonly Layer[], name: string): Uint8Array {
	const parts = partSolids(s, layers).map((p) => {
		const title = PART_NAMES[p.part]?.()[1] ?? p.part;
		return { name: title[0].toUpperCase() + title.slice(1), tris: meshTriangles(p.solid) };
	});
	return write3mf(parts, name);
}

// ---------- Files ----------

// prettier-ignore — i18n-ok-begin: a transliteration table for file names, never shown
const TRANSLIT: Record<string, string> = {
	а: 'a',
	б: 'b',
	в: 'v',
	г: 'g',
	д: 'd',
	е: 'e',
	ё: 'e',
	ж: 'zh',
	з: 'z',
	и: 'i',
	й: 'y',
	к: 'k',
	л: 'l',
	м: 'm',
	н: 'n',
	о: 'o',
	п: 'p',
	р: 'r',
	с: 's',
	т: 't',
	у: 'u',
	ф: 'f',
	х: 'h',
	ц: 'ts',
	ч: 'ch',
	ш: 'sh',
	щ: 'sch',
	ъ: '',
	ы: 'y',
	ь: '',
	э: 'e',
	ю: 'yu',
	я: 'ya'
}; // i18n-ok-end

/** «Склад 7» → «sklad-7»: a short latin file name part. */
export function fileSlug(text: string, fallback = 'model'): string {
	const slug = [...text.toLowerCase()]
		.map((ch) => TRANSLIT[ch] ?? ch)
		.join('')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32)
		.replace(/-+$/, '');
	return slug || fallback;
}

// ---------- SVG drawing (top view) ----------

const svgNum = (v: number) => String(Number(v.toFixed(3)));

function pathOf(region: Region): string {
	return region
		.filter((p) => p.length > 2)
		.map((p) => `M${p.map(([x, y]) => `${svgNum(x)} ${svgNum(-y)}`).join('L')}Z`)
		.join('');
}

/**
 * The outline to cut (base minus through holes) as a stroke, the relief and
 * engraved areas filled black — for a laser, a plotter or a drawing.
 */
export function layersToSvg(s: Scope, layers: readonly Layer[]): string {
	const top = bodyTop(layers);
	const bodies = layers.filter((l) => l.kind === 'body' && l.z0 <= 0 && l.region.length);
	let outline = s.cs(bodies.flatMap((l) => l.region));
	const holes = layers.filter(
		(l) => l.kind === 'cut' && l.z0 <= 0 && l.z1 >= top && l.region.length
	);
	if (holes.length) outline = s.t(outline.subtract(s.cs(holes.flatMap((l) => l.region))));
	const marks = layers.filter(
		(l) => (l.kind === 'relief' || l.kind === 'engrave') && l.region.length
	);
	let ink = s.cs(marks.flatMap((l) => l.region));
	ink = s.t(ink.intersect(outline));
	const outlineRegion = regionOf(outline);
	const b = boundsOf(outlineRegion) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
	const pad = 1;
	const w = b.x1 - b.x0 + 2 * pad;
	const h = b.y1 - b.y0 + 2 * pad;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgNum(w)}mm" height="${svgNum(h)}mm" viewBox="${svgNum(
		b.x0 - pad
	)} ${svgNum(-b.y1 - pad)} ${svgNum(w)} ${svgNum(h)}">
<path d="${pathOf(outlineRegion)}" fill="none" stroke="#000" stroke-width="0.2" fill-rule="evenodd"/>
<path d="${pathOf(regionOf(ink))}" fill="#000" fill-rule="evenodd"/>
</svg>
`;
}
