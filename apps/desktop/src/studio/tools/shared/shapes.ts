/**
 * Built-in flat shapes for cutters and stencils: circles, hearts, stars,
 * a tree, a house… Each is a few counter-clockwise rings in unit size; they
 * are unioned with the «Positive» fill rule, so a clockwise ring cuts (the
 * crescent of the moon). fitRings() scales the result to the asked size.
 */
import type { Point, Ring } from './trace';
import * as tc from '$msg/tools/common';

const TAU = Math.PI * 2;

function arc(cx: number, cy: number, r: number, from: number, to: number, n: number): Ring {
	const out: Ring = [];
	for (let i = 0; i <= n; i++) {
		const a = from + ((to - from) * i) / n;
		out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return out;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, n = 96): Ring {
	return Array.from({ length: n }, (_, i): Point => {
		const a = (TAU * i) / n;
		return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
	});
}

const circle = (cx: number, cy: number, r: number) => ellipse(cx, cy, r, r);

/** A petal: an ellipse whose centre is `dist` from the origin at angle `a`, pointing outwards. */
function ellipseAt(dist: number, a: number, rx: number, ry: number): Ring {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return ellipse(0, 0, rx, ry, 48).map(([x, y]) => [
		dist * c + x * c - y * s,
		dist * s + x * s + y * c
	]);
}

/** Stadium between two centres (a «capsule»). */
function capsule(x1: number, y1: number, x2: number, y2: number, r: number): Ring {
	const t = Math.atan2(y2 - y1, x2 - x1);
	return [
		...arc(x2, y2, r, t - Math.PI / 2, t + Math.PI / 2, 16),
		...arc(x1, y1, r, t + Math.PI / 2, t + (Math.PI * 3) / 2, 16)
	];
}

function star(points: number, outer: number, inner: number): Ring {
	return Array.from({ length: points * 2 }, (_, i): Point => {
		const a = Math.PI / 2 + (Math.PI * i) / points;
		const r = i % 2 ? inner : outer;
		return [r * Math.cos(a), r * Math.sin(a)];
	});
}

function roundedRect(w: number, h: number, r: number): Ring {
	const x = w / 2 - r;
	const y = h / 2 - r;
	return [
		...arc(x, -y, r, -Math.PI / 2, 0, 8),
		...arc(x, y, r, 0, Math.PI / 2, 8),
		...arc(-x, y, r, Math.PI / 2, Math.PI, 8),
		...arc(-x, -y, r, Math.PI, (Math.PI * 3) / 2, 8)
	];
}

const rotate = (ring: Ring, deg: number): Ring => {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return ring.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};

const mirror = (ring: Ring): Ring => ring.map(([x, y]) => [-x, y] as Point).reverse();

function heart(): Ring {
	// The classic curve runs clockwise; reversed to count as a shape.
	return Array.from({ length: 120 }, (_, i): Point => {
		const t = (TAU * i) / 120;
		return [
			(16 * Math.sin(t) ** 3) / 17,
			(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17
		];
	}).reverse();
}

function leaf(): Ring[] {
	const c = 0.9;
	const a = Math.atan2(1, c);
	const r = Math.hypot(1, c);
	const lens = [...arc(-c, 0, r, -a, a, 40), ...arc(c, 0, r, Math.PI - a, Math.PI + a, 40)];
	return [rotate(lens, -35), rotate(capsule(0, -0.95, 0, -1.35, 0.07), -35)];
}

export interface ShapePreset {
	id: string;
	label: string;
	rings: () => Ring[];
}

export const SHAPES: readonly ShapePreset[] = [
	{
		id: 'circle',
		get label() {
			return tc.tc_shape_circle();
		},
		rings: () => [circle(0, 0, 1)]
	},
	{
		id: 'ellipse',
		get label() {
			return tc.tc_shape_ellipse();
		},
		rings: () => [ellipse(0, 0, 1, 0.7)]
	},
	{
		id: 'rounded-square',
		get label() {
			return tc.tc_shape_rounded_square();
		},
		rings: () => [roundedRect(2, 2, 0.25)]
	},
	{
		id: 'hexagon',
		get label() {
			return tc.tc_shape_hexagon();
		},
		rings: () => [star(3, 1, 1)]
	},
	{
		id: 'heart',
		get label() {
			return tc.tc_shape_heart();
		},
		rings: () => [heart()]
	},
	{
		id: 'star',
		get label() {
			return tc.tc_shape_star();
		},
		rings: () => [star(5, 1, 0.45)]
	},
	{
		id: 'daisy',
		get label() {
			return tc.tc_shape_daisy();
		},
		rings: () => [
			circle(0, 0, 0.42),
			...Array.from({ length: 8 }, (_, k) => ellipseAt(0.62, (k * TAU) / 8, 0.36, 0.2))
		]
	},
	{
		id: 'fir',
		get label() {
			return tc.tc_shape_fir();
		},
		rings: () => [
			[
				[-0.42, 0.42],
				[0.42, 0.42],
				[0, 1]
			],
			[
				[-0.64, -0.05],
				[0.64, -0.05],
				[0, 0.72]
			],
			[
				[-0.86, -0.5],
				[0.86, -0.5],
				[0, 0.32]
			],
			[
				[-0.14, -0.85],
				[0.14, -0.85],
				[0.14, -0.45],
				[-0.14, -0.45]
			]
		]
	},
	{
		id: 'house',
		get label() {
			return tc.tc_shape_house();
		},
		rings: () => [
			[
				[-0.7, -1],
				[0.7, -1],
				[0.7, 0.15],
				[-0.7, 0.15]
			],
			[
				[-0.95, 0.1],
				[0.95, 0.1],
				[0, 1]
			],
			[
				[0.4, 0.4],
				[0.62, 0.4],
				[0.62, 0.92],
				[0.4, 0.92]
			]
		]
	},
	{
		id: 'crescent',
		get label() {
			return tc.tc_shape_crescent();
		},
		rings: () => [circle(0, 0, 1), circle(0.48, 0.22, 0.85).reverse()]
	},
	{
		id: 'cloud',
		get label() {
			return tc.tc_shape_cloud();
		},
		rings: () => [
			circle(-0.55, -0.12, 0.42),
			circle(-0.08, 0.2, 0.55),
			circle(0.45, 0.04, 0.45),
			capsule(-0.62, -0.32, 0.72, -0.32, 0.24)
		]
	},
	{
		id: 'leaf',
		get label() {
			return tc.tc_shape_leaf();
		},
		rings: leaf
	},
	{
		id: 'bone',
		get label() {
			return tc.tc_shape_bone();
		},
		rings: () => [
			capsule(-0.7, 0, 0.7, 0, 0.2),
			circle(-0.75, 0.22, 0.26),
			circle(-0.75, -0.22, 0.26),
			circle(0.75, 0.22, 0.26),
			circle(0.75, -0.22, 0.26)
		]
	},
	{
		id: 'fish',
		get label() {
			return tc.tc_shape_fish();
		},
		rings: () => [
			ellipse(-0.15, 0, 0.75, 0.46),
			[
				[0.45, 0],
				[1, -0.45],
				[1, 0.45]
			]
		]
	},
	{
		id: 'cat',
		get label() {
			return tc.tc_shape_cat();
		},
		rings: () => {
			const ear: Ring = [
				[-0.78, 0.12],
				[-0.18, 0.62],
				[-0.66, 0.98]
			];
			return [ellipse(0, -0.1, 0.82, 0.72), ear, mirror(ear)];
		}
	},
	{
		id: 'gingerbread',
		get label() {
			return tc.tc_shape_gingerbread();
		},
		rings: () => [
			circle(0, 0.64, 0.3),
			capsule(0, 0.28, 0, -0.3, 0.34),
			capsule(-0.72, 0.16, 0.72, 0.16, 0.15),
			capsule(0, -0.3, -0.45, -0.95, 0.17),
			capsule(0, -0.3, 0.45, -0.95, 0.17)
		]
	},
	{
		id: 'gem',
		get label() {
			return tc.tc_shape_gem();
		},
		rings: () => [
			[
				[0, -0.95],
				[1, 0.35],
				[0.6, 0.75],
				[-0.6, 0.75],
				[-1, 0.35]
			]
		]
	},
	{
		id: 'arrow',
		get label() {
			return tc.tc_shape_arrow();
		},
		rings: () => [
			[
				[-1, -0.17],
				[0.2, -0.17],
				[0.2, -0.5],
				[1, 0],
				[0.2, 0.5],
				[0.2, 0.17],
				[-1, 0.17]
			]
		]
	}
];

export function shapeById(id: string): ShapePreset {
	return SHAPES.find((s) => s.id === id) ?? SHAPES[0];
}
