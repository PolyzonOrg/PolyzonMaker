/**
 * «Игральные кубики»: the polyhedral set — d4, d6, d8, d10, d12 and d20 —
 * with engraved numbers (a d6 with pips or numbers). Opposite faces add up
 * to one more than the sides, as on store dice; 6 and 9 get a dot so they
 * read the right way up. A die lies on a face: every other face leans out
 * at most 27° past upright (35° on the d10), so it prints without supports.
 *
 * Faces are found from the vertices: every plane through three of them that
 * has all the others on one side; the numbers are turned onto each face by
 * the Euler angles of the face's own frame.
 */
import {
	cube,
	difference,
	extrude,
	intersection,
	label,
	part,
	rotate,
	sphere,
	toScad,
	translate,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/dice';
import { clamp } from '../shared/math';

export type DieKind = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';
export type D6Face = 'pips' | 'numbers';

export interface DiceParams {
	kind: DieKind;
	/** Across the die, between opposite faces (d4: its height), mm */
	size: number;
	/** How deep the numbers are cut, mm */
	depth: number;
	d6: D6Face;
	font: string;
}

export const DICE_DEFAULTS: DiceParams = {
	kind: 'd20',
	size: 22,
	depth: 0.8,
	d6: 'pips',
	font: 'Noto Sans'
};

export const DICE_PRESETS: readonly { id: string; label: string; params: Partial<DiceParams> }[] = [
	{ id: 'd4', label: 'd4', params: { kind: 'd4', size: 20 } },
	{ id: 'd6', label: 'd6', params: { kind: 'd6', size: 16 } },
	{ id: 'd8', label: 'd8', params: { kind: 'd8', size: 18 } },
	{ id: 'd10', label: 'd10', params: { kind: 'd10', size: 18 } },
	{ id: 'd12', label: 'd12', params: { kind: 'd12', size: 20 } },
	{ id: 'd20', label: 'd20', params: { kind: 'd20', size: 22 } }
];

export function clampDice(p: DiceParams): DiceParams {
	return {
		kind: (['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const).includes(p.kind) ? p.kind : 'd20',
		size: clamp(p.size, 10, 60),
		depth: clamp(p.depth, 0.3, 2),
		d6: p.d6 === 'numbers' ? 'numbers' : 'pips',
		font: p.font || 'Noto Sans'
	};
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];
const unit = (a: V): V => mul(a, 1 / (Math.hypot(...a) || 1));

const PHI = (1 + Math.sqrt(5)) / 2;

/** Vertices of each die, any scale (scaled to the size later). */
function vertices(kind: DieKind): V[] {
	switch (kind) {
		case 'd4':
			return [
				[1, 1, 1],
				[1, -1, -1],
				[-1, 1, -1],
				[-1, -1, 1]
			];
		case 'd6': {
			const out: V[] = [];
			for (const x of [-1, 1])
				for (const y of [-1, 1]) for (const z of [-1, 1]) out.push([x, y, z]);
			return out;
		}
		case 'd8':
			return [
				[1, 0, 0],
				[-1, 0, 0],
				[0, 1, 0],
				[0, -1, 0],
				[0, 0, 1],
				[0, 0, -1]
			];
		case 'd10': {
			// Pentagonal trapezohedron: two apexes and a zigzag ring; the apex
			// height that makes every kite flat is z0·(1 + cos36°)/(1 − cos36°).
			const z0 = 0.105;
			const c = Math.cos(Math.PI / 5);
			const h = (z0 * (1 + c)) / (1 - c);
			const out: V[] = [
				[0, 0, h],
				[0, 0, -h]
			];
			for (let k = 0; k < 10; k++) {
				const a = (k * Math.PI) / 5;
				out.push([Math.cos(a), Math.sin(a), k % 2 ? -z0 : z0]);
			}
			return out;
		}
		case 'd12': {
			const out: V[] = [];
			for (const x of [-1, 1])
				for (const y of [-1, 1]) for (const z of [-1, 1]) out.push([x, y, z]);
			const a = 1 / PHI;
			for (const s of [-1, 1])
				for (const t of [-1, 1]) {
					out.push([0, s * a, t * PHI], [s * a, t * PHI, 0], [s * PHI, 0, t * a]);
				}
			return out;
		}
		case 'd20': {
			const out: V[] = [];
			for (const s of [-1, 1])
				for (const t of [-1, 1]) out.push([0, s, t * PHI], [s, t * PHI, 0], [t * PHI, 0, s]);
			return out;
		}
	}
}

export interface Face {
	/** Outward unit normal, centre, distance from the die's centre */
	normal: V;
	centre: V;
	distance: number;
	/** The face's corners, in order round it */
	corners: V[];
	/** Radius of the largest circle inside the face (about) */
	inner: number;
}

/** The planar faces of a convex polyhedron with these vertices. */
export function facesOf(points: readonly V[]): Face[] {
	const faces: Face[] = [];
	const seen = new Set<string>();
	const n = points.length;
	const middle = mul(points.reduce(add, [0, 0, 0] as V), 1 / n);
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++)
			for (let k = j + 1; k < n; k++) {
				let nrm = cross(sub(points[j], points[i]), sub(points[k], points[i]));
				if (Math.hypot(...nrm) < 1e-9) continue;
				nrm = unit(nrm);
				let d = dot(nrm, points[i]);
				// Outward: away from the middle of the die.
				if (dot(nrm, middle) > d) {
					nrm = mul(nrm, -1);
					d = -d;
				}
				if (points.some((q) => dot(nrm, q) > d + 1e-4)) continue;
				const on = points.filter((q) => Math.abs(dot(nrm, q) - d) < 1e-4);
				const key = on
					.map((q) => points.indexOf(q))
					.sort((a, b) => a - b)
					.join(',');
				if (seen.has(key)) continue;
				seen.add(key);
				const centre = mul(on.reduce(add, [0, 0, 0] as V), 1 / on.length);
				// Corners in order round the centre.
				const u = unit(sub(on[0], centre));
				const w = cross(nrm, u);
				const corners = [...on].sort((a, b) => {
					const pa = sub(a, centre);
					const pb = sub(b, centre);
					return Math.atan2(dot(pa, w), dot(pa, u)) - Math.atan2(dot(pb, w), dot(pb, u));
				});
				let inner = Infinity;
				for (let m = 0; m < corners.length; m++) {
					const a = corners[m];
					const b = corners[(m + 1) % corners.length];
					const edge = unit(sub(b, a));
					const toC = sub(centre, a);
					const along = mul(edge, dot(toC, edge));
					inner = Math.min(inner, Math.hypot(...sub(toC, along)));
				}
				faces.push({ normal: nrm, centre, distance: d, corners, inner });
			}
	return faces;
}

/** Euler angles (OpenSCAD's rotate) of the frame x → u, y → v, z → n. */
function euler(u: V, v: V, n: V): V {
	// R = [u v n] as columns; R = Rz(c)·Ry(b)·Rx(a).
	const r20 = u[2];
	const r21 = v[2];
	const r22 = n[2];
	const r10 = u[1];
	const r00 = u[0];
	const b = Math.asin(Math.max(-1, Math.min(1, -r20)));
	const a = Math.atan2(r21, r22);
	const c = Math.atan2(r10, r00);
	const deg = 180 / Math.PI;
	return [a * deg, b * deg, c * deg];
}

export interface DieLayout {
	/** The die's corners, lying on its first face (z = 0 there) */
	points: V[];
	faces: Face[];
	/** The number on each face (d4: the number of each corner) */
	values: number[];
}

/** Turn and lift the corners so the first face lies on the bed. */
function layDown(points: V[]): V[] {
	const f = facesOf(points)[0];
	const n = f.normal;
	const helper: V = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
	const u = unit(cross(helper, n));
	const v = cross(n, u);
	// u → x, v → −y, n → −z: a proper rotation, the face down.
	return points.map((q) => [dot(u, q), -dot(v, q), f.distance - dot(n, q)] as V);
}

export function dieLayout(input: DiceParams): DieLayout {
	const p = clampDice(input);
	const raw = vertices(p.kind);
	const inr = facesOf(raw)[0].distance;
	// Opposite faces this far apart (d4: base to tip, four times the inner radius).
	const scale = p.kind === 'd4' ? p.size / (inr * 4) : p.size / (2 * inr);
	const points = layDown(raw.map((q) => mul(q, scale)));
	const faces = facesOf(points.map((q) => sub(q, [0, 0, 0])));
	const N = faces.length;
	const values = new Array<number>(p.kind === 'd4' ? points.length : N).fill(0);
	if (p.kind === 'd4') values.forEach((_, i) => (values[i] = i + 1));
	else {
		// Opposite faces: 1…N/2 on one, N+1−k on the other (the d10 counts 0–9).
		let k = 1;
		const done = new Set<number>();
		faces.forEach((f, i) => {
			if (done.has(i)) return;
			const j = faces.findIndex(
				(g, m) => !done.has(m) && m !== i && dot(g.normal, f.normal) < -0.999
			);
			done.add(i);
			values[i] = k;
			if (j >= 0) {
				done.add(j);
				values[j] = N + 1 - k;
			}
			k++;
		});
		// A d10 counts 0–9, opposite faces adding up to 9.
		if (p.kind === 'd10') for (let i = 0; i < N; i++) values[i] -= 1;
	}
	return { points, faces, values };
}

/** Standard pips of a d6 face, in units of the face's half side. */
const PIPS: Record<number, [number, number][]> = {
	1: [[0, 0]],
	2: [
		[-0.5, -0.5],
		[0.5, 0.5]
	],
	3: [
		[-0.5, -0.5],
		[0, 0],
		[0.5, 0.5]
	],
	4: [
		[-0.5, -0.5],
		[0.5, -0.5],
		[-0.5, 0.5],
		[0.5, 0.5]
	],
	5: [
		[-0.5, -0.5],
		[0.5, -0.5],
		[0, 0],
		[-0.5, 0.5],
		[0.5, 0.5]
	],
	6: [
		[-0.5, -0.5],
		[0.5, -0.5],
		[-0.5, 0],
		[0.5, 0],
		[-0.5, 0.5],
		[0.5, 0.5]
	]
};

/** 6 and 9 carry a dot, so they read the right way up. */
const glyph = (n: number) => (n === 6 || n === 9 ? `${n}.` : String(n));

/** Everything on the inner side of a face's plane, as far as the die reaches. */
function halfSpace(f: Face, reach: number): Node {
	const n = f.normal;
	const helper: V = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
	const u = unit(cross(helper, n));
	const v = cross(n, u);
	return translate(
		mul(n, f.distance),
		rotate(euler(u, v, n), translate([0, 0, -reach / 2], cube([reach, reach, reach], true)))
	);
}

export function diceModel(input: DiceParams): Node {
	const p = clampDice(input);
	const L = dieLayout(p);
	const pts = L.points;
	const centre = mul(pts.reduce(add, [0, 0, 0] as V), 1 / pts.length);
	// The faces' planes cut exactly: a hull of points would leave specks at the corners.
	let body: Node = intersection(...L.faces.map((f) => halfSpace(f, p.size * 4)));
	// A d6 has its edges and corners rounded: the cube within a sphere.
	if (p.kind === 'd6')
		body = intersection(body, translate(centre, sphere((p.size / 2) * 1.42, 96)));
	const cuts: Node[] = [];
	L.faces.forEach((f, i) => {
		const n = f.normal;
		if (p.kind === 'd6' && p.d6 === 'pips') {
			const up = unit(sub(f.corners[0], f.centre));
			const right = unit(cross(up, n));
			const diag = Math.hypot(...sub(f.corners[0], f.centre));
			// A dimple 0.17 × the size across and `depth` deep: a sphere through its rim and bottom.
			const a = p.size * 0.08;
			const d = p.depth;
			const r = (a * a + d * d) / (2 * d);
			for (const [x, y] of PIPS[L.values[i]]) {
				// Along the face's sides: half the side is the corner's distance over √2.
				const half = diag / Math.SQRT2;
				const side = unit(add(up, right));
				const other = unit(sub(up, right));
				const at = add(add(f.centre, mul(side, x * half * 1.05)), mul(other, y * half * 1.05));
				cuts.push(translate(add(at, mul(n, r - d)), sphere(r, 32)));
			}
			return;
		}
		const marks: { at: V; up: V; text: string; cap: number }[] = [];
		if (p.kind === 'd4') {
			// Each corner's number near it, read from that corner.
			for (const corner of f.corners) {
				const vi = pts.findIndex((q) => Math.hypot(...sub(q, corner)) < 1e-6);
				marks.push({
					at: add(corner, mul(sub(f.centre, corner), 0.55)),
					up: unit(sub(corner, f.centre)),
					text: String(L.values[vi]),
					cap: f.inner * 0.5
				});
			}
		} else {
			const v = L.values[i];
			const text = glyph(v);
			// Kites read toward their far corner, the others toward their first one.
			const toward =
				p.kind === 'd10'
					? f.corners.reduce((a, b) =>
							Math.hypot(...sub(a, f.centre)) > Math.hypot(...sub(b, f.centre)) ? a : b
						)
					: f.corners[0];
			const digits = text.replace('.', '').length;
			marks.push({
				at: p.kind === 'd10' ? add(f.centre, mul(sub(toward, f.centre), 0.15)) : f.centre,
				up: unit(sub(toward, f.centre)),
				text,
				cap: f.inner * (digits > 1 ? 0.7 : 0.9)
			});
		}
		for (const m of marks) {
			const right = unit(cross(m.up, n));
			cuts.push(
				translate(
					sub(m.at, mul(n, p.depth)),
					rotate(
						euler(right, m.up, n),
						extrude(
							p.depth + 1,
							label(m.text, m.cap, { font: p.font, bold: true, valign: 'center' })
						)
					)
				)
			);
		}
	});
	return part(p.kind, difference(body, ...cuts));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function diceSummary(input: DiceParams): string {
	const p = clampDice(input);
	const values = { kind: p.kind, size: mm(p.size), depth: mm(p.depth) };
	if (p.kind === 'd4') return m.t_dice_summary_d4(values);
	return p.kind === 'd6' && p.d6 === 'pips'
		? m.t_dice_summary_pips(values)
		: m.t_dice_summary_numbers(values);
}

export function diceHeader(input: DiceParams): string[] {
	return [m.t_dice_header_title(), diceSummary(input), m.t_dice_header_print()];
}

export function diceScad(p: DiceParams): string {
	return toScad(diceModel(p), diceHeader(p));
}
