/**
 * The CSG tree (csg.ts) → a manifold-3d solid. Pure: the caller passes the
 * loaded WASM (the worker in the browser, the package directly in tests) and
 * the glyph outlines of the tree's texts (run.ts compiles them with
 * OpenSCAD). Objects are not freed: every build runs in a fresh worker.
 */
// Types only: run.ts imports textFrame from here on the page, without the WASM.
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { growApart } from '../shared/bold';
import { BOLD_GROW } from '../shared/fonts';
import { capKey, CAP_RATIO, dimOf, GLYPH_SIZE, textKey, textSpacing, type Node } from './csg';

/** Text key → outline of the glyphs at GLYPH_SIZE: outer rings CCW, holes CW. */
export type Glyphs = Record<string, [number, number][][]>;

type TextNode = Extract<Node, { k: 'text' }>;

/** Where a text lands, mm: its outline's box after scaling (and bolding). */
export interface TextBox {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	/** Capital height as drawn */
	cap: number;
}

function ringBox(rings: readonly (readonly [number, number])[][]) {
	let x0 = Infinity,
		x1 = -Infinity,
		y0 = Infinity,
		y1 = -Infinity;
	for (const ring of rings)
		for (const [x, y] of ring) {
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
			y0 = Math.min(y0, y);
			y1 = Math.max(y1, y);
		}
	return { x0, x1, y0, y1 };
}

/**
 * How a text node is drawn: its glyph rings, the scale and the outline growth
 * (bold) — the same for the solid (evaluate) and for a layout measured before
 * the build (run.ts measureTexts). Null when the text has no glyphs.
 */
export function textFrame(
	n: TextNode,
	glyphs: Glyphs
): { rings: [number, number][][]; k: number; grow: number; box: TextBox } | null {
	const rings = glyphs[textKey(n.text, n.halign, n.valign, n.font, textSpacing(n))];
	if (!rings?.length) return null;
	const b = ringBox(rings);
	if (!n.cap) {
		const k = n.size / GLYPH_SIZE;
		const box = { x0: b.x0 * k, x1: b.x1 * k, y0: b.y0 * k, y1: b.y1 * k, cap: n.size * CAP_RATIO };
		return { rings, k, grow: 0, box };
	}
	const ref = glyphs[capKey(n.font)];
	const refBox = ref?.length ? ringBox(ref) : null;
	const cap = refBox ? refBox.y1 - refBox.y0 : GLYPH_SIZE * CAP_RATIO;
	let k = n.cap / cap;
	const width = b.x1 - b.x0;
	// `fill`: exactly `fit` wide, unless the capitals would outgrow `cap`.
	if (n.fit && (n.fill || width * k > n.fit)) k = Math.min(k, n.fit / width);
	const grow = n.bold ? cap * k * BOLD_GROW : 0;
	const box = {
		x0: b.x0 * k - grow,
		x1: b.x1 * k + grow,
		y0: b.y0 * k - grow,
		y1: b.y1 * k + grow,
		cap: cap * k
	};
	return { rings, k, grow, box };
}

/** The solid of the tree, or null when nothing is left. */
export function evaluate(wasm: ManifoldToplevel, root: Node, glyphs: Glyphs = {}): Manifold | null {
	const { Manifold: M, CrossSection: CS } = wasm;
	const empty2 = () => CS.square([0, 0]);

	function two(n: Node): CrossSection {
		switch (n.k) {
			case 'square':
				return CS.square([n.size[0], n.size[1]], n.center);
			case 'circle':
				return CS.circle(n.r, Math.max(3, Math.round(n.fn)));
			case 'polygon':
				return new CS([n.points.map(([x, y]) => [x, y] as [number, number])], 'NonZero');
			case 'text': {
				const frame = textFrame(n, glyphs);
				if (!frame) return empty2();
				const scaled = new CS(frame.rings, 'NonZero').scale(frame.k);
				return frame.grow ? growApart(scaled, frame.grow, frame.grow, 'Round', 16) : scaled;
			}
			case 'offset':
				return union2(n.c).offset(n.r, n.round ? 'Round' : 'Miter', 2, Math.max(4, n.fn));
			case 'union':
			case 'module':
				return union2(n.c);
			case 'difference': {
				const [first, ...rest] = n.c.filter((c) => dimOf(c) === 2);
				if (!first) return empty2();
				return rest.length ? two(first).subtract(union2(rest)) : two(first);
			}
			case 'intersection': {
				const parts = n.c.filter((c) => dimOf(c) === 2).map(two);
				return parts.length ? CS.intersection(parts) : empty2();
			}
			case 'hull': {
				// The hull of nothing is nothing (manifold throws on it): a text with no glyphs yet, say.
				const parts = n.c
					.filter((c) => dimOf(c) === 2)
					.map(two)
					.filter((cs) => !cs.isEmpty());
				return parts.length ? CS.hull(parts) : empty2();
			}
			case 'translate':
				return union2(n.c).translate([n.v[0], n.v[1]]);
			case 'rotate':
				return union2(n.c).rotate(n.v[2]);
			case 'mirror':
				return union2(n.c).mirror([n.v[0], n.v[1]]);
			case 'scale':
				return union2(n.c).scale([n.v[0], n.v[1]]);
			default:
				return empty2();
		}
	}

	function union2(c: Node[]): CrossSection {
		const parts = c.filter((n) => dimOf(n) === 2).map(two);
		if (parts.length === 0) return empty2();
		return parts.length === 1 ? parts[0] : CS.union(parts);
	}

	// Empty pieces are null: manifold marks an empty extrusion as invalid,
	// and an invalid operand turns a whole boolean into nothing.
	type Solid = Manifold | null;
	const live = (m: Manifold): Solid => (m.isEmpty() ? null : m);

	function three(n: Node): Solid {
		switch (n.k) {
			case 'extrude': {
				const cs = union2(n.c);
				if (n.h <= 0 || cs.isEmpty()) return null;
				if (n.twist) return live(cs.extrude(n.h, n.slices ?? 1, n.twist, [n.scale, n.scale]));
				return live(n.scale === 1 ? cs.extrude(n.h) : cs.extrude(n.h, 0, 0, [n.scale, n.scale]));
			}
			case 'revolve': {
				const cs = union2(n.c);
				const fn = Math.max(3, Math.round(n.fn));
				if (cs.isEmpty()) return null;
				return live(
					n.angle !== undefined && n.angle < 360 ? cs.revolve(fn, n.angle) : cs.revolve(fn)
				);
			}
			case 'cube':
				if (n.size.some((v) => v <= 0)) return null;
				return M.cube([n.size[0], n.size[1], n.size[2]], n.center);
			case 'cylinder': {
				const fn = Math.max(3, Math.round(n.fn));
				if (n.h <= 0 || (n.r1 <= 0 && n.r2 <= 0)) return null;
				if (n.r1 > 0) return M.cylinder(n.h, n.r1, Math.max(0, n.r2), fn, n.center);
				// A cone standing on its tip: build it upright and flip it.
				const cone = M.cylinder(n.h, n.r2, 0, fn, false).mirror([0, 0, 1]).translate([0, 0, n.h]);
				return n.center ? cone.translate([0, 0, -n.h / 2]) : cone;
			}
			case 'sphere':
				return n.r > 0 ? M.sphere(n.r, Math.max(4, Math.round(n.fn))) : null;
			case 'loft': {
				// One hull per pair of neighbouring levels: a stepped profile
				// (chamfer, straight, chamfer) is not convex as a whole.
				const levels = n.c.map((shape, i) =>
					two(shape)
						.toPolygons()
						.flatMap((poly) => poly.map(([x, y]) => [x, y, n.z[i]] as [number, number, number]))
				);
				const pieces: Manifold[] = [];
				for (let i = 0; i + 1 < levels.length; i++) {
					const points = [...levels[i], ...levels[i + 1]];
					if (points.length >= 4 && n.z[i + 1] > n.z[i]) pieces.push(M.hull(points));
				}
				return join(pieces);
			}
			case 'union':
			case 'module':
				return union3(n.c);
			case 'difference': {
				const [first, ...rest] = n.c.filter((c) => dimOf(c) === 3);
				const base = first ? three(first) : null;
				if (!base) return null;
				const cut = union3(rest);
				return cut ? live(base.subtract(cut)) : base;
			}
			case 'intersection': {
				const parts = n.c.filter((c) => dimOf(c) === 3).map(three);
				if (parts.length === 0 || parts.some((m) => !m)) return null;
				return live(M.intersection(parts as Manifold[]));
			}
			case 'hull': {
				const parts = n.c
					.filter((c) => dimOf(c) === 3)
					.map(three)
					.filter((m): m is Manifold => !!m);
				return parts.length ? live(M.hull(parts)) : null;
			}
			case 'translate':
				return union3(n.c)?.translate([n.v[0], n.v[1], n.v[2]]) ?? null;
			case 'rotate':
				return union3(n.c)?.rotate([n.v[0], n.v[1], n.v[2]]) ?? null;
			case 'mirror':
				return union3(n.c)?.mirror([n.v[0], n.v[1], n.v[2]]) ?? null;
			case 'scale':
				return union3(n.c)?.scale([n.v[0], n.v[1], n.v[2]]) ?? null;
			default:
				return null;
		}
	}

	function join(parts: Manifold[]): Solid {
		if (parts.length === 0) return null;
		return parts.length === 1 ? parts[0] : live(M.union(parts));
	}

	function union3(c: Node[]): Solid {
		return join(
			c
				.filter((n) => dimOf(n) === 3)
				.map(three)
				.filter((m): m is Manifold => !!m)
		);
	}

	return dimOf(root) === 3 ? three(root) : null;
}

/** A solid → STL triangle soup (positions only). */
export { fromManifold as trianglesOf } from '../solid';
