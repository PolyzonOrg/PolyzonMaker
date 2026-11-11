/**
 * A small CSG tree for the parametric generators (boxes, Gridfinity, trays,
 * bricks, hooks, drill jigs). The tool's model builds the tree from its form;
 * the same tree is
 *  - evaluated by manifold-3d in a worker (`evaluate.ts`, `run.ts`) — the
 *    studio's OpenSCAD runs CGAL, which needs 10–60 s for a 2×2 Gridfinity
 *    bin, Manifold well under a second;
 *  - printed as an OpenSCAD program (`toScad`) for «В OpenSCAD», with the
 *    same primitives, segment counts and order, so the editor renders the
 *    same part.
 * Every number and string reaches the program only through scad-literals.
 * Pure: no DOM, no WASM.
 */
import { num, str, vec } from '../scad-literals';
import { BOLD_GROW, boldSpacing } from '../shared/fonts';

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'center' | 'baseline' | 'bottom';

export type Node =
	// 2D
	| { k: 'square'; size: Vec2; center: boolean }
	| { k: 'circle'; r: number; fn: number }
	| { k: 'polygon'; points: Vec2[] }
	/**
	 * `size` is OpenSCAD's text size. With `cap` the evaluator sizes by the
	 * capital height instead (measured on «H» in `font`), and shrinks a line
	 * wider than `fit` mm; `bold` grows the outline by 3 % of the capital.
	 */
	| {
			k: 'text';
			text: string;
			size: number;
			halign: HAlign;
			valign: VAlign;
			font?: string;
			cap?: number;
			fit?: number;
			/** Grow to `fit` wide as well; `cap` is then the largest capital. */
			fill?: boolean;
			bold?: boolean;
	  }
	| { k: 'offset'; r: number; round: boolean; fn: number; c: Node[] }
	// 3D
	/** `twist`: degrees the top turns counter-clockwise (seen from above) over `slices` steps. */
	| { k: 'extrude'; h: number; scale: number; twist?: number; slices?: number; c: Node[] }
	/** `angle`: degrees swept counter-clockwise from +X; 360 when left out. */
	| { k: 'revolve'; fn: number; angle?: number; c: Node[] }
	| { k: 'cube'; size: Vec3; center: boolean }
	| { k: 'cylinder'; h: number; r1: number; r2: number; fn: number; center: boolean }
	| { k: 'sphere'; r: number; fn: number }
	/** Flat convex shapes c[i] at heights z[i], joined by straight walls. */
	| { k: 'loft'; z: number[]; c: Node[] }
	// Either, decided by the children
	| { k: 'union' | 'difference' | 'intersection' | 'hull'; c: Node[] }
	| { k: 'translate' | 'rotate' | 'mirror' | 'scale'; v: Vec3; c: Node[] }
	/** A named part: printed as an OpenSCAD module, evaluated as a union. */
	| { k: 'module'; name: string; c: Node[] };

/** Children may be left out with `cond && node`. */
export type Child = Node | null | undefined | false;
const kids = (c: Child[]): Node[] => c.filter((n): n is Node => !!n);

/** Text is compiled at this size (see run.ts) and scaled. */
export const GLYPH_SIZE = 10;

// ---------- 2D ----------

export const square = (w: number, d: number, center = true): Node => ({
	k: 'square',
	size: [w, d],
	center
});
export const circle = (r: number, fn = 32): Node => ({ k: 'circle', r, fn });
export const polygon = (points: Vec2[]): Node => ({
	k: 'polygon',
	points: points.map(([x, y]) => [x, y] as Vec2)
});
export const text = (
	value: string,
	size: number,
	halign: HAlign = 'center',
	valign: VAlign = 'center'
): Node => ({ k: 'text', text: value, size, halign, valign });

/** Capital height ÷ OpenSCAD text size, about the same for most fonts. */
export const CAP_RATIO = 0.72;

export interface LabelOptions {
	font?: string;
	/** Widest the line may be, mm: a longer one shrinks to it. */
	fit?: number;
	/** Grow a shorter line to exactly `fit` wide too (`cap` is then the largest capital). */
	fill?: boolean;
	bold?: boolean;
	halign?: HAlign;
	valign?: VAlign;
}

/**
 * A line of text sized by its capital height in mm, as the form fields say
 * («Высота букв»), in any font of shared/fonts.ts.
 */
export const label = (value: string, cap: number, o: LabelOptions = {}): Node => ({
	k: 'text',
	text: value,
	size: cap / CAP_RATIO,
	halign: o.halign ?? 'center',
	valign: o.valign ?? 'baseline',
	cap,
	...(o.font && o.font !== 'Noto Sans' ? { font: o.font } : {}),
	...(o.fit ? { fit: o.fit } : {}),
	...(o.fit && o.fill ? { fill: true } : {}),
	...(o.bold ? { bold: true } : {})
});
const offsetBy = (r: number, round: boolean, fn: number, c: Child[]): Node => ({
	k: 'offset',
	r,
	round,
	fn,
	c: kids(c)
});
/** Rounded offset (OpenSCAD `offset(r)`); negative shrinks. */
export const offset = (r: number, fn: number, ...c: Child[]): Node => offsetBy(r, true, fn, c);
/** Sharp offset (OpenSCAD `offset(delta)`). */
export const inset = (delta: number, ...c: Child[]): Node => offsetBy(delta, false, 0, c);

/** Rectangle centred on the origin with rounded corners (r ≤ half side). */
export function rrect(w: number, d: number, r: number, fn = 32): Node {
	const rr = Math.max(0, Math.min(r, w / 2 - 0.01, d / 2 - 0.01));
	if (rr < 0.05) return square(w, d);
	return offset(rr, fn, square(w - 2 * rr, d - 2 * rr));
}

// ---------- 3D ----------

export const extrude = (h: number, ...c: Child[]): Node => taperExtrude(h, 1, ...c);
/** Extruded while shrinking (or growing) towards the origin: the top is `scale` × the bottom. */
export const taperExtrude = (h: number, scale: number, ...c: Child[]): Node => ({
	k: 'extrude',
	h,
	scale,
	c: kids(c)
});
/**
 * Extruded while turning: threads, helical teeth. Positive `twist` turns the
 * top counter-clockwise seen from above (a right-hand helix).
 */
export const twistExtrude = (h: number, twist: number, slices: number, ...c: Child[]): Node => ({
	k: 'extrude',
	h,
	scale: 1,
	twist,
	slices: Math.max(1, Math.round(slices)),
	c: kids(c)
});
export const revolve = (fn: number, ...c: Child[]): Node => ({ k: 'revolve', fn, c: kids(c) });
/** Part of a revolution: an elbow, a bend. */
export const revolveArc = (fn: number, angle: number, ...c: Child[]): Node => ({
	k: 'revolve',
	fn,
	angle,
	c: kids(c)
});
export const cube = (size: Vec3, center = false): Node => ({ k: 'cube', size, center });
export const cylinder = (h: number, r1: number, r2 = r1, fn = 32, center = false): Node => ({
	k: 'cylinder',
	h,
	r1,
	r2,
	fn,
	center
});
export const sphere = (r: number, fn = 32): Node => ({ k: 'sphere', r, fn });

// ---------- Either ----------

const combine =
	(k: 'union' | 'difference' | 'intersection' | 'hull') =>
	(...c: Child[]): Node => ({ k, c: kids(c) });
export const union = combine('union');
export const difference = combine('difference');
export const intersection = combine('intersection');
export const hull = combine('hull');
const v3 = (v: readonly number[]): Vec3 => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
/** Moves, turns or mirrors its children by a vector (missing axes are 0). */
const along =
	(k: 'translate' | 'rotate' | 'mirror') =>
	(v: readonly number[], ...c: Child[]): Node => ({ k, v: v3(v), c: kids(c) });
export const translate = along('translate');
export const rotate = along('rotate');
export const mirror = along('mirror');
export const scale = (v: readonly number[], ...c: Child[]): Node => ({
	k: 'scale',
	v: [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1],
	c: kids(c)
});
export const part = (name: string, ...c: Child[]): Node => ({ k: 'module', name, c: kids(c) });

/** OpenSCAD has no hull of flat shapes: they become slabs this thin. */
const SLAB = 0.01;

/**
 * A solid whose cross-section changes linearly between levels — the
 * chamfered Gridfinity feet, lips, bevels. Each level's shape must be convex
 * and z ascending; each pair of neighbouring levels is joined by their hull.
 */
export function loft(levels: readonly { z: number; shape: Node }[]): Node {
	return { k: 'loft', z: levels.map((l) => l.z), c: levels.map((l) => l.shape) };
}

// ---------- Inspection ----------

const TWO_D = new Set(['square', 'circle', 'polygon', 'text', 'offset']);

/** 2 or 3 for a node; null for an empty group. */
export function dimOf(n: Node): 2 | 3 | null {
	if (TWO_D.has(n.k)) return 2;
	if ('c' in n && !['extrude', 'revolve', 'loft'].includes(n.k)) {
		for (const child of n.c) {
			const d = dimOf(child);
			if (d) return d;
		}
		return null;
	}
	return 3;
}

export interface TextRequest {
	key: string;
	text: string;
	halign: HAlign;
	valign: VAlign;
	font?: string;
	/** OpenSCAD's `spacing`, when not 1 (see textSpacing). */
	spacing?: number;
}

export const textKey = (t: string, h: HAlign, v: VAlign, font?: string, spacing = 1) =>
	(font ? `${font}|${h}|${v}|${t}` : `${h}|${v}|${t}`) + (spacing !== 1 ? `|${spacing}` : '');

/** The step a text is set with: a bold one is grown, so it is set wider. */
export const textSpacing = (n: Extract<Node, { k: 'text' }>): number =>
	n.bold && n.cap ? boldSpacing(BOLD_GROW, n.font) : 1;
/** The reference capital of a font: its height is the font's capital height. */
export const capKey = (font?: string) => textKey('H', 'left', 'baseline', font);

/** Every distinct text in the tree: compiled once, at GLYPH_SIZE. */
export function collectTexts(root: Node): TextRequest[] {
	const out = new Map<string, TextRequest>();
	const walk = (n: Node) => {
		if (n.k === 'text') {
			if (n.text.trim()) {
				const spacing = textSpacing(n);
				const key = textKey(n.text, n.halign, n.valign, n.font, spacing);
				out.set(key, {
					key,
					text: n.text,
					halign: n.halign,
					valign: n.valign,
					font: n.font,
					...(spacing !== 1 ? { spacing } : {})
				});
				if (n.cap) {
					const ref = capKey(n.font);
					out.set(ref, { key: ref, text: 'H', halign: 'left', valign: 'baseline', font: n.font });
				}
			}
		} else if ('c' in n) n.c.forEach(walk);
	};
	walk(root);
	return [...out.values()];
}

// ---------- OpenSCAD ----------

const N = (x: number) => num(x, -1e6, 1e6);
const fnArg = (fn: number) => `$fn = ${num(Math.round(fn), 3, 512)}`;

/**
 * The tree as an OpenSCAD program. Named parts become modules; `header`
 * lines become the comment at the top (what the parameters were).
 */
export function toScad(root: Node, header: readonly string[] = []): string {
	/** module body (with a placeholder name) → its name; names in use */
	const bodies = new Map<string, string>();
	const modules = new Map<string, string>();

	function block(c: Node[], pad: string): string {
		if (c.length === 1) return ' ' + emit(c[0], pad).trimStart();
		return ` {\n${c.map((n) => emit(n, pad + '\t')).join('')}${pad}}\n`;
	}

	function emit(n: Node, pad: string): string {
		switch (n.k) {
			case 'square':
				return `${pad}square(${vec([n.size[0], n.size[1]])}, center = ${n.center});\n`;
			case 'circle':
				return `${pad}circle(r = ${N(n.r)}, ${fnArg(n.fn)});\n`;
			case 'polygon':
				return `${pad}polygon(${vec(n.points.map(([x, y]) => [x, y]))});\n`;
			case 'text': {
				const spacing = textSpacing(n);
				const line = `text(${str(n.text, 80)}, size = ${N(n.size)}, font = ${str(n.font ?? 'Noto Sans', 80)}, halign = "${n.halign}", valign = "${n.valign}"${spacing !== 1 ? `, spacing = ${N(spacing)}` : ''});`;
				// OpenSCAD cannot measure text: a line that likely overflows is resized to `fit`.
				const long = n.fit && n.text.length * 0.62 * n.size > n.fit;
				const sized = long ? `resize([${N(n.fit ?? 0)}, 0], auto = true) ${line}` : line;
				const bold =
					n.bold && n.cap ? `offset(r = ${N(n.cap * BOLD_GROW)}, $fn = 16) ${sized}` : sized;
				return `${pad}${bold}\n`;
			}
			case 'offset':
				return `${pad}offset(${n.round ? `r = ${N(n.r)}, ${fnArg(n.fn)}` : `delta = ${N(n.r)}`})${block(n.c, pad)}`;
			case 'extrude':
				// OpenSCAD twists clockwise for a positive value, the opposite of ours.
				return `${pad}linear_extrude(height = ${N(n.h)}${n.scale !== 1 ? `, scale = ${N(n.scale)}` : ''}${n.twist ? `, twist = ${N(-n.twist)}, slices = ${n.slices ?? 1}` : ''})${block(n.c, pad)}`;
			case 'revolve':
				return `${pad}rotate_extrude(${n.angle !== undefined && n.angle < 360 ? `angle = ${N(n.angle)}, ` : ''}${fnArg(n.fn)})${block(n.c, pad)}`;
			case 'cube':
				return `${pad}cube(${vec([...n.size])}, center = ${n.center});\n`;
			case 'cylinder':
				return `${pad}cylinder(h = ${N(n.h)}, r1 = ${N(n.r1)}, r2 = ${N(n.r2)}, ${fnArg(n.fn)}${n.center ? ', center = true' : ''});\n`;
			case 'sphere':
				return `${pad}sphere(r = ${N(n.r)}, ${fnArg(n.fn)});\n`;
			case 'loft': {
				// One hull per pair of neighbouring levels, as evaluate() does.
				const hulls = n.c
					.slice(1)
					.map((shape, i) =>
						hull(
							translate([0, 0, n.z[i]], extrude(SLAB, n.c[i])),
							translate([0, 0, n.z[i + 1] - SLAB], extrude(SLAB, shape))
						)
					);
				return emit(hulls.length === 1 ? hulls[0] : union(...hulls), pad);
			}
			case 'translate':
			case 'rotate':
			case 'mirror':
			case 'scale':
				return `${pad}${n.k}(${vec([...n.v])})${block(n.c, pad)}`;
			case 'module': {
				const base = n.name.replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'part';
				const body = `() {\n${n.c.map((c) => emit(c, '\t')).join('')}}\n`;
				let name = bodies.get(base + body);
				if (!name) {
					// The same name with another body (e.g. two different lids) gets a suffix.
					name = base;
					for (let k = 2; modules.has(name); k++) name = `${base}_${k}`;
					bodies.set(base + body, name);
					modules.set(name, `module ${name}${body}`);
				}
				return `${pad}${name}();\n`;
			}
			default:
				if (n.c.length === 0) return '';
				return `${pad}${n.k}() {\n${n.c.map((c) => emit(c, pad + '\t')).join('')}${pad}}\n`;
		}
	}

	const main = emit(root, '');
	const head = header.map((l) => `// ${l.replace(/[\r\n]+/g, ' ')}`).join('\n');
	return `${head}${head ? '\n' : ''}\n${[...modules.values()].join('\n')}${modules.size ? '\n' : ''}${main}`;
}
