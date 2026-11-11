/**
 * «Надпись на модели»: raised or cut-in text on any side of an uploaded
 * model, following its surface — flat, curved like a vase, stepped. The text
 * is a prism along the side's axis; it is kept only in a skin of the model:
 *
 * - raised: the prism ∩ the model moved out by the height — the letters
 *   stand that far proud of every point of the surface under them;
 * - cut in: the prism ∩ (the model − the model moved in by the depth) —
 *   only the outer skin is cut, however the surface curves.
 *
 * The prism reaches no deeper than a part of the model behind the nearest
 * point under the text, so the far wall of a cup stays clean. Pure geometry
 * on manifold objects; the worker and the tests feed it.
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import { Bin } from '../booleans/kit';
import { extrude, label, rotate, translate, union, type Node, type Vec3 } from '../csg/csg';
import { evaluate, type Glyphs } from '../csg/evaluate';
import * as m from '$msg/tools/model-text';
import { clamp } from '../shared/math';

export type TextSide = 'top' | 'front' | 'back' | 'left' | 'right' | 'bottom';
export type TextStyle = 'raised' | 'engraved';

export interface ModelTextParams {
	/** Up to three lines */
	text: string;
	font: string;
	/** Capital height, mm */
	cap: number;
	side: TextSide;
	/** From the side's centre: to the right and up as you look at it, mm */
	across: number;
	up: number;
	/** Turned counter-clockwise as you look at it, degrees */
	angle: number;
	style: TextStyle;
	/** Height of raised letters or depth of the cut, mm */
	depth: number;
}

export const MODEL_TEXT_DEFAULTS: ModelTextParams = {
	text: 'Polyzon',
	font: 'Noto Sans',
	cap: 8,
	side: 'front',
	across: 0,
	up: 0,
	angle: 0,
	style: 'raised',
	depth: 1
};

export const TEXT_SIDES: readonly TextSide[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

export function clampModelText(p: ModelTextParams): ModelTextParams {
	return {
		text: (p.text ?? '')
			.split('\n')
			.map((l) => l.trim().slice(0, 40))
			.filter(Boolean)
			.slice(0, 3)
			.join('\n'),
		font: p.font || 'Noto Sans',
		cap: clamp(p.cap, 2, 60),
		side: TEXT_SIDES.includes(p.side) ? p.side : 'front',
		across: clamp(p.across, -1000, 1000),
		up: clamp(p.up, -1000, 1000),
		angle: clamp(p.angle, -180, 180),
		style: p.style === 'engraved' ? 'engraved' : 'raised',
		depth: clamp(p.depth, 0.2, 5)
	};
}

export interface Box {
	min: Vec3;
	max: Vec3;
}

/**
 * Each side: the axis across it, which way is out, and the turn that lays
 * the text's own frame (x right, y up, z towards you) onto it.
 */
const SIDES: Record<TextSide, { axis: 0 | 1 | 2; out: 1 | -1; turn: Vec3; u: Vec3; v: Vec3 }> = {
	top: { axis: 2, out: 1, turn: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] },
	bottom: { axis: 2, out: -1, turn: [0, 180, 0], u: [-1, 0, 0], v: [0, 1, 0] },
	front: { axis: 1, out: -1, turn: [90, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
	back: { axis: 1, out: 1, turn: [90, 0, 180], u: [-1, 0, 0], v: [0, 0, 1] },
	right: { axis: 0, out: 1, turn: [90, 0, 90], u: [0, 1, 0], v: [0, 0, 1] },
	left: { axis: 0, out: -1, turn: [90, 0, -90], u: [0, -1, 0], v: [0, 0, 1] }
};

/** The side's centre on the model's box. */
function faceCentre(side: TextSide, box: Box): Vec3 {
	const s = SIDES[side];
	const c = [0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2) as [number, number, number];
	c[s.axis] = s.out > 0 ? box.max[s.axis] : box.min[s.axis];
	return c;
}

/** The side's width and height as you look at it, mm. */
export function sideSize(side: TextSide, box: Box): [number, number] {
	const s = SIDES[side];
	const span = (d: Vec3) =>
		Math.abs(d[0]) * (box.max[0] - box.min[0]) +
		Math.abs(d[1]) * (box.max[1] - box.min[1]) +
		Math.abs(d[2]) * (box.max[2] - box.min[2]);
	return [span(s.u), span(s.v)];
}

/**
 * A clicked point of the model → the side it is on (the box's nearest one,
 * relative to its size) and the text's place on that side.
 */
export function placeAt(point: Vec3, box: Box): Pick<ModelTextParams, 'side' | 'across' | 'up'> {
	let best: TextSide = 'front';
	let gap = Infinity;
	for (const side of TEXT_SIDES) {
		const s = SIDES[side];
		const edge = s.out > 0 ? box.max[s.axis] : box.min[s.axis];
		const size = Math.max(1e-6, box.max[s.axis] - box.min[s.axis]);
		const d = Math.abs(edge - point[s.axis]) / size;
		if (d < gap) [best, gap] = [side, d];
	}
	const s = SIDES[best];
	const c = faceCentre(best, box);
	const rel = [0, 1, 2].map((k) => point[k] - c[k]);
	const dot = (a: Vec3) => a[0] * rel[0] + a[1] * rel[1] + a[2] * rel[2];
	return { side: best, across: Math.round(dot(s.u) * 10) / 10, up: Math.round(dot(s.v) * 10) / 10 };
}

/** The lines, centred one under another (for the glyphs and for the prism). */
export function modelTextLabels(input: ModelTextParams): Node[] {
	const p = clampModelText(input);
	const lines = p.text ? p.text.split('\n') : [];
	const pitch = p.cap * 1.5;
	return lines.map((line, i) =>
		translate(
			[0, ((lines.length - 1) / 2 - i) * pitch - p.cap / 2],
			label(line, p.cap, { font: p.font, bold: true, valign: 'baseline' })
		)
	);
}

/**
 * The text's prism on its side, from `from` to `to` mm along the outward
 * axis (negative: into the model) measured from the model's box.
 */
export function textPrism(input: ModelTextParams, box: Box, from: number, to: number): Node {
	const p = clampModelText(input);
	const s = SIDES[p.side];
	return translate(
		faceCentre(p.side, box),
		rotate(
			s.turn,
			translate(
				[p.across, p.up, from],
				rotate([0, 0, p.angle], extrude(to - from, union(...modelTextLabels(p))))
			)
		)
	);
}

export interface TextResult {
	/** The model with the text */
	whole: Manifold;
	/** Raised letters alone (for a second colour); null when cut in */
	letters: Manifold | null;
}

/**
 * The text put onto `model`. Throws a ToolError when it misses the model.
 * `glyphs`: the outlines of `modelTextLabels(p)` (see csg/run.ts).
 */
export function applyText(
	wasm: ManifoldToplevel,
	model: Manifold,
	input: ModelTextParams,
	glyphs: Glyphs
): TextResult {
	const p = clampModelText(input);
	const s = SIDES[p.side];
	const b = model.boundingBox();
	const box: Box = { min: [...b.min] as Vec3, max: [...b.max] as Vec3 };
	const extent = box.max[s.axis] - box.min[s.axis];
	const bin = new Bin();
	// ponytail: evaluate() keeps its own intermediates (a few KB of text per build); free them there if the worker ever grows.
	const solid = (n: Node) => {
		const m = evaluate(wasm, n, glyphs);
		return m ? bin.add(m) : null;
	};
	const probe = solid(textPrism(p, box, -extent - 1, 1));
	if (!probe) {
		bin.free();
		throw new ToolError(m.t_model_text_no_text());
	}
	// How deep the nearest point under the text lies below the box's side.
	const hit = bin.add(probe.intersect(model));
	if (hit.isEmpty()) {
		bin.free();
		throw new ToolError(m.t_model_text_misses());
	}
	const hb = hit.boundingBox();
	const face = s.out > 0 ? box.max[s.axis] : box.min[s.axis];
	const near = s.out > 0 ? face - hb.max[s.axis] : hb.min[s.axis] - face;
	const reach = Math.min(extent + 1, near + Math.max(0.35 * extent, 3 * p.depth));
	const out: [number, number, number] = [0, 0, 0];
	out[s.axis] = s.out * p.depth;
	const back: Vec3 = [-out[0], -out[1], -out[2]];
	if (p.style === 'raised') {
		const prism = solid(textPrism(p, box, -reach, p.depth + 1))!;
		const raised = bin.add(prism.intersect(bin.add(model.translate(out))));
		const letters = bin.add(raised.subtract(model));
		const whole = bin.add(model.add(raised));
		bin.free(whole, letters);
		return { whole, letters };
	}
	const prism = solid(textPrism(p, box, -reach, 1))!;
	// The skin the depth deep, only where the prism is (much less to cut than the whole model).
	const pb = prism.boundingBox();
	const lo: [number, number, number] = [...pb.min];
	const hi: [number, number, number] = [...pb.max];
	if (s.out > 0) lo[s.axis] -= p.depth + 1;
	else hi[s.axis] += p.depth + 1;
	const cube = bin.add(wasm.Manifold.cube([hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]));
	const near3 = bin.add(model.intersect(bin.add(cube.translate(lo))));
	const skin = bin.add(near3.subtract(bin.add(near3.translate(back))));
	const whole = bin.add(model.subtract(bin.add(prism.intersect(skin))));
	bin.free(whole);
	return { whole, letters: null };
}
