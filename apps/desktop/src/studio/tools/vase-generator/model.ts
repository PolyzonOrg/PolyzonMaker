/**
 * Parametric vase as a triangle mesh, built directly (no OpenSCAD): rings of
 * vertices up the height, each ring the cross-section scaled by the profile,
 * turned by the twist and bumped by the ribs. Two modes:
 *   - vase mode: one solid body (outer wall, bottom and top caps) for the
 *     slicer's spiral-vase mode, which prints only the outer wall and bottom;
 *   - walls: outer and inner surfaces joined by a flat or rounded rim, with a
 *     solid bottom or open (a lampshade, a sleeve).
 * Every surface shares its edge vertices with the next, so the mesh is
 * closed by construction.
 */
import type { Triangles } from '../stl';
import { MeshBuilder } from '../shared/mesh-builder';
import * as msg from '$msg/tools/vase-generator';
import {
	ellipseRadius,
	flowerRadius,
	heartRadius,
	polygonRadius,
	starRadius,
	type RadiusFn
} from '../shared/mesh-shapes';
import { clamp } from '../shared/math';

export type VaseSection = 'circle' | 'polygon' | 'star' | 'flower' | 'heart';
export type VaseRibs = 'none' | 'wave' | 'triangle' | 'square' | 'gear';
export type VaseRibSide = 'outside' | 'inside' | 'both';

export interface VaseParams {
	height: number;
	/** Diameters at 0, 25, 50, 75 and 100 % of the height, mm. */
	profile: number[];
	/** Smooth curve through the profile points (otherwise straight segments). */
	smooth: boolean;
	/** One solid body for spiral-vase printing. */
	vaseMode: boolean;
	wall: number;
	bottom: boolean;
	bottomThickness: number;
	roundRim: boolean;
	section: VaseSection;
	/** Ellipse: Y/X ratio. */
	ellipse: number;
	/** Polygon sides, star points or flower petals. */
	count: number;
	/** Star valleys and flower notches, % of the radius. */
	depth: number;
	/** Corner rounding of the section, %. */
	rounding: number;
	ribs: VaseRibs;
	ribCount: number;
	/** mm; negative cuts grooves. */
	ribDepth: number;
	ribSide: VaseRibSide;
	/** Degrees over the full height. */
	twist: number;
}

export const VASE_DEFAULTS: VaseParams = {
	height: 150,
	profile: [70, 92, 100, 84, 66],
	smooth: true,
	vaseMode: false,
	// Four lines of a 0.4 mm nozzle; the bottom a little thicker to stay flat.
	wall: 1.6,
	bottom: true,
	bottomThickness: 2.4,
	roundRim: false,
	section: 'circle',
	ellipse: 1,
	count: 5,
	depth: 25,
	rounding: 0,
	ribs: 'none',
	ribCount: 24,
	ribDepth: 2,
	ribSide: 'outside',
	twist: 0
};

export const VASE_PRESETS: { id: string; label: string; params: Partial<VaseParams> }[] = [
	{
		id: 'straight',
		get label() {
			return msg.t_vase_generator_preset_straight();
		},
		params: { profile: [80, 80, 80, 80, 80], section: 'circle', ribs: 'none', twist: 0 }
	},
	{
		id: 'waist',
		get label() {
			return msg.t_vase_generator_preset_waist();
		},
		params: { profile: [92, 74, 60, 74, 92] }
	},
	{
		id: 'belly',
		get label() {
			return msg.t_vase_generator_preset_belly();
		},
		params: { profile: [66, 108, 104, 64, 50] }
	},
	{
		id: 'stem',
		get label() {
			return msg.t_vase_generator_preset_stem();
		},
		params: { profile: [72, 32, 44, 86, 104] }
	},
	{
		id: 'twisted',
		get label() {
			return msg.t_vase_generator_preset_twisted();
		},
		params: {
			profile: [72, 88, 94, 84, 70],
			section: 'polygon',
			count: 7,
			rounding: 25,
			twist: 150,
			ribs: 'none'
		}
	},
	{
		id: 'ribbed',
		get label() {
			return msg.t_vase_generator_preset_ribbed();
		},
		params: {
			profile: [74, 90, 98, 88, 78],
			section: 'circle',
			ellipse: 1,
			ribs: 'wave',
			ribCount: 30,
			ribDepth: 2.5,
			ribSide: 'outside',
			twist: 0
		}
	}
];

/** Values from the form (or a shared link) pulled into the allowed ranges. */
export function clampVase(p: VaseParams): VaseParams {
	const profile = [0, 1, 2, 3, 4].map((i) => clamp(p.profile?.[i] ?? 80, 10, 300));
	const height = clamp(p.height, 20, 350);
	return {
		...p,
		height,
		profile,
		wall: clamp(p.wall, 0.8, 10),
		bottomThickness: clamp(p.bottomThickness, 0.8, Math.min(20, height - 2)),
		ellipse: clamp(p.ellipse, 0.3, 1),
		count: Math.round(clamp(p.count, 3, 16)),
		depth: clamp(p.depth, 10, 80),
		rounding: clamp(p.rounding, 0, 100),
		ribCount: Math.round(clamp(p.ribCount, 4, 72)),
		ribDepth: clamp(p.ribDepth, -5, 15),
		twist: clamp(p.twist, -360, 360)
	};
}

function sectionFn(p: VaseParams): RadiusFn {
	switch (p.section) {
		case 'polygon':
			return polygonRadius(p.count);
		case 'star':
			return starRadius(p.count, 1 - p.depth / 100);
		case 'flower':
			return flowerRadius(p.count, p.depth / 100);
		case 'heart':
			return heartRadius();
		default:
			return ellipseRadius(p.ellipse);
	}
}

/** Rib height 0…1 at a phase 0…1 within one rib. */
function ribShape(kind: VaseRibs, f: number): number {
	switch (kind) {
		case 'wave':
			return (1 - Math.cos(f * Math.PI * 2)) / 2;
		case 'triangle':
			return 1 - Math.abs(2 * f - 1);
		case 'square':
			return f < 0.5 ? 1 : 0;
		case 'gear':
			// A tooth with sloped flanks: up, flat, down, flat.
			if (f < 0.15) return f / 0.15;
			if (f < 0.5) return 1;
			if (f < 0.65) return (0.65 - f) / 0.15;
			return 0;
		default:
			return 0;
	}
}

/** Circular moving average, applied twice (close to a Gaussian). */
function smoothCircular(table: Float64Array, half: number): void {
	if (half < 1) return;
	const n = table.length;
	const tmp = new Float64Array(n);
	for (let pass = 0; pass < 2; pass++) {
		let sum = 0;
		for (let k = -half; k <= half; k++) sum += table[(k + n) % n];
		for (let j = 0; j < n; j++) {
			tmp[j] = sum / (2 * half + 1);
			sum += table[(j + half + 1) % n] - table[(j - half + n) % n];
		}
		table.set(tmp);
	}
}

/** Diameter at height fraction t through the five profile points. */
export function profileDiameter(profile: readonly number[], smooth: boolean, t: number): number {
	const n = profile.length - 1;
	const x = Math.min(n, Math.max(0, t * n));
	const k = Math.min(n - 1, Math.floor(x));
	const s = x - k;
	const at = (i: number) => profile[Math.min(n, Math.max(0, i))];
	if (!smooth) return at(k) + (at(k + 1) - at(k)) * s;
	// Uniform Catmull-Rom, end points repeated.
	const p0 = at(k - 1);
	const p1 = at(k);
	const p2 = at(k + 1);
	const p3 = at(k + 2);
	const v =
		0.5 *
		(2 * p1 +
			(-p0 + p2) * s +
			(2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s +
			(-p0 + 3 * p1 - 3 * p2 + p3) * s * s * s);
	return Math.max(5, v);
}

export function vaseMesh(input: VaseParams): Triangles {
	const p = clampVase(input);
	const H = p.height;
	const ribs = p.ribs !== 'none' && p.ribDepth !== 0;
	const maxD = Math.max(...p.profile) + (ribs ? 2 * Math.max(0, p.ribDepth) : 0);

	// Angular samples: about 1.2 mm apart on the widest ring, a whole number per rib.
	let M = Math.round(clamp(Math.ceil((Math.PI * maxD) / 1.2), 128, 768));
	if (ribs) M = Math.min(1536, Math.ceil(Math.max(M, p.ribCount * 12) / p.ribCount) * p.ribCount);
	// Rows about 1.5 mm apart, denser for a strong twist; at most ~600k triangles.
	const rows = Math.round(
		clamp(Math.ceil(Math.max(H / 1.5, Math.abs(p.twist) / 2)), 24, Math.floor(150000 / M))
	);

	// Cross-section and ribs as tables over the angle, smoothed together.
	const shape = sectionFn(p);
	const S = new Float64Array(M);
	const R = new Float64Array(M);
	for (let j = 0; j < M; j++) {
		const a = (j / M) * Math.PI * 2;
		S[j] = shape(a);
		R[j] = ribs
			? p.ribDepth * ribShape(p.ribs, (j * p.ribCount) / M - Math.floor((j * p.ribCount) / M))
			: 0;
	}
	const half = Math.round(((p.rounding / 100) * M) / 24);
	smoothCircular(S, half);
	smoothCircular(R, half);
	// Inner wall: the radial offset grows where the edge runs slanted to the
	// radius, so the wall keeps roughly its thickness along the normal.
	const G = new Float64Array(M);
	const dA = (Math.PI * 2) / M;
	for (let j = 0; j < M; j++) {
		const ds = (S[(j + 1) % M] - S[(j - 1 + M) % M]) / (2 * dA);
		const cos = S[j] / Math.hypot(S[j], ds);
		G[j] = 1 / Math.max(cos, 0.5);
	}
	const lookup = (table: Float64Array, f: number) => {
		const x = ((f % M) + M) % M;
		const i0 = Math.floor(x);
		const s = x - i0;
		return table[i0 % M] * (1 - s) + table[(i0 + 1) % M] * s;
	};

	const twist = (p.twist * Math.PI) / 180;
	const ribsOut = ribs && (p.vaseMode || p.ribSide !== 'inside');
	const ribsIn = ribs && !p.vaseMode && p.ribSide !== 'outside';
	const radii = (z: number, j: number) => {
		const t = z / H;
		const f = j - (twist * t * M) / (Math.PI * 2);
		const base = (profileDiameter(p.profile, p.smooth, t) / 2) * lookup(S, f);
		const rib = lookup(R, f);
		let outer = Math.max(0.9, base + (ribsOut ? rib : 0));
		const wall = p.wall * lookup(G, f);
		let inner = base - wall - (ribsIn ? rib : 0);
		// A groove (a negative rib) never thins the wall: the other side follows it.
		if (outer - inner < wall) {
			if (ribsOut) inner = outer - wall;
			else outer = inner + wall;
		}
		inner = Math.max(0.5, Math.min(inner, outer - 0.4));
		return { outer, inner };
	};

	const m = new MeshBuilder();
	const cos = new Float64Array(M);
	const sin = new Float64Array(M);
	for (let j = 0; j < M; j++) {
		cos[j] = Math.cos(j * dA);
		sin[j] = Math.sin(j * dA);
	}
	const ring = (z: number, side: 'outer' | 'inner') => {
		const out: number[] = new Array<number>(M);
		for (let j = 0; j < M; j++) {
			const r = radii(z, j)[side];
			out[j] = m.vertex(r * cos[j], r * sin[j], z);
		}
		return out;
	};

	const rimRadius = p.wall / 2;
	const zTop = !p.vaseMode && p.roundRim ? H - rimRadius : H;
	const outerRings: number[][] = [];
	for (let k = 0; k <= rows; k++) outerRings.push(ring((zTop * k) / rows, 'outer'));

	if (p.vaseMode) {
		for (let k = 0; k < rows; k++) m.band(outerRings[k], outerRings[k + 1]);
		m.fan(m.vertex(0, 0, 0), outerRings[0], true);
		m.fan(m.vertex(0, 0, H), outerRings[rows]);
		return m.toTriangles();
	}

	const zBottom = p.bottom ? p.bottomThickness : 0;
	const innerRings: number[][] = [];
	for (let k = 0; k <= rows; k++) {
		innerRings.push(ring(zBottom + ((zTop - zBottom) * k) / rows, 'inner'));
	}

	// The wall's cross-section as one path: up the outside, over the rim, down
	// the inside. Consecutive rings on it make bands that face out.
	const path: number[][] = [...outerRings];
	if (p.roundRim) {
		const steps = 6;
		for (let a = 1; a < steps; a++) {
			const alpha = (Math.PI * a) / steps;
			const arc: number[] = new Array<number>(M);
			for (let j = 0; j < M; j++) {
				const { outer, inner } = radii(zTop, j);
				const mid = (outer + inner) / 2;
				const r = mid + Math.cos(alpha) * (outer - mid);
				arc[j] = m.vertex(r * cos[j], r * sin[j], zTop + rimRadius * Math.sin(alpha));
			}
			path.push(arc);
		}
	}
	for (let k = rows; k >= 0; k--) path.push(innerRings[k]);
	for (let k = 0; k + 1 < path.length; k++) m.band(path[k], path[k + 1]);

	if (p.bottom) {
		m.fan(m.vertex(0, 0, 0), outerRings[0], true);
		m.fan(m.vertex(0, 0, zBottom), innerRings[0]);
	} else {
		m.band(innerRings[0], outerRings[0]);
	}
	return m.toTriangles();
}

/** File name with the height and the widest diameter: vase-h150-d100.stl. */
export function vaseFileName(p: VaseParams): string {
	const c = clampVase(p);
	return `vase-h${Math.round(c.height)}-d${Math.round(Math.max(...c.profile))}.stl`;
}
