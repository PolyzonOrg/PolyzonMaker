/**
 * A block with sockets for standard things: batteries (IEC 60086 sizes),
 * 1/4″ hex bits (ISO 1173), coin cells, SD and microSD cards, or any round
 * or square item by its size. Sockets in a grid, a chamfer at each mouth so
 * the item finds its way in, a finger scoop along the front optional.
 * Prints as it stands, sockets up — no supports.
 */
import {
	cylinder,
	difference,
	extrude,
	loft,
	polygon,
	rrect,
	square,
	taperExtrude,
	toScad,
	translate,
	union,
	type Node,
	type Vec2
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/item-holder';
import { clamp as c } from '../shared/math';

export type ItemKind =
	| 'aa'
	| 'aaa'
	| 'c'
	| 'd'
	| '18650'
	| '9v'
	| 'cr2032'
	| 'bit'
	| 'sd'
	| 'microsd'
	| 'round'
	| 'square';

export interface ItemHolderParams {
	item: ItemKind;
	/** Round: diameter; square: side, mm (custom items) */
	size: number;
	/** Height of a custom item, mm */
	length: number;
	cols: number;
	rows: number;
	/** How deep the sockets are, % of the item's height */
	depth: number;
	clearance: number;
	wall: number;
	floor: number;
}

/** The item's footprint and height, mm: round (d), hex across flats, or a box. */
export interface ItemShape {
	label: string;
	kind: 'round' | 'hex' | 'box';
	a: number;
	b: number;
	height: number;
}

export const ITEMS: Record<Exclude<ItemKind, 'round' | 'square'>, ItemShape> = {
	aa: { label: 'AA', kind: 'round', a: 14.5, b: 14.5, height: 50.5 },
	aaa: { label: 'AAA', kind: 'round', a: 10.5, b: 10.5, height: 44.5 },
	c: { label: 'C', kind: 'round', a: 26.2, b: 26.2, height: 50 },
	d: { label: 'D', kind: 'round', a: 34.2, b: 34.2, height: 61.5 },
	'18650': { label: '18650', kind: 'round', a: 18.6, b: 18.6, height: 65 },
	'9v': {
		get label() {
			return m.t_item_holder_item_9v();
		},
		kind: 'box',
		a: 26.5,
		b: 17.5,
		height: 48.5
	},
	cr2032: { label: 'CR2032', kind: 'box', a: 20, b: 3.2, height: 20 },
	bit: {
		get label() {
			return m.t_item_holder_item_bit();
		},
		kind: 'hex',
		a: 6.35,
		b: 6.35,
		height: 25
	},
	sd: { label: 'SD', kind: 'box', a: 24, b: 2.1, height: 32 },
	microsd: { label: 'microSD', kind: 'box', a: 11, b: 1, height: 15 }
};

export const ITEM_HOLDER_DEFAULTS: ItemHolderParams = {
	item: 'aa',
	size: 12,
	length: 60,
	cols: 6,
	rows: 2,
	depth: 50,
	clearance: 0.4,
	wall: 1.6,
	floor: 1.6
};

export interface ItemHolderPreset {
	id: string;
	label: string;
	params: Partial<ItemHolderParams>;
}

export const ITEM_HOLDER_PRESETS: readonly ItemHolderPreset[] = [
	{
		id: 'aa',
		get label() {
			return m.t_item_holder_preset_aa();
		},
		params: { item: 'aa', cols: 6, rows: 2 }
	},
	{
		id: 'aaa',
		get label() {
			return m.t_item_holder_preset_aaa();
		},
		params: { item: 'aaa', cols: 8, rows: 2 }
	},
	{
		id: 'mix',
		get label() {
			return m.t_item_holder_preset_18650();
		},
		params: { item: '18650', cols: 4, rows: 2 }
	},
	{
		id: 'bits',
		get label() {
			return m.t_item_holder_preset_bits();
		},
		params: { item: 'bit', cols: 10, rows: 3, depth: 50, clearance: 0.3 }
	},
	{
		id: 'coins',
		get label() {
			return m.t_item_holder_preset_coins();
		},
		params: { item: 'cr2032', cols: 6, rows: 1, depth: 60 }
	},
	{
		id: 'sd',
		get label() {
			return m.t_item_holder_preset_sd();
		},
		params: { item: 'sd', cols: 8, rows: 1, depth: 60 }
	},
	{
		id: 'markers',
		get label() {
			return m.t_item_holder_preset_markers();
		},
		params: { item: 'round', size: 16, length: 130, cols: 5, rows: 2, depth: 30 }
	}
];

const KINDS: readonly ItemKind[] = [
	'aa',
	'aaa',
	'c',
	'd',
	'18650',
	'9v',
	'cr2032',
	'bit',
	'sd',
	'microsd',
	'round',
	'square'
];

export function clampItemHolder(p: ItemHolderParams): ItemHolderParams {
	return {
		item: KINDS.includes(p.item) ? p.item : 'aa',
		size: c(p.size, 2, 60),
		length: c(p.length, 5, 200),
		cols: Math.round(c(p.cols, 1, 20)),
		rows: Math.round(c(p.rows, 1, 10)),
		depth: c(p.depth, 15, 90),
		clearance: c(p.clearance, 0, 1.5),
		wall: c(p.wall, 1.2, 6),
		floor: c(p.floor, 1, 6)
	};
}

export function shapeOf(p: ItemHolderParams): ItemShape {
	if (p.item === 'round')
		return {
			label: m.t_item_holder_round_label({ size: mm(p.size) }),
			kind: 'round',
			a: p.size,
			b: p.size,
			height: p.length
		};
	if (p.item === 'square')
		return {
			label: m.t_item_holder_square_label({ size: mm(p.size) }),
			kind: 'box',
			a: p.size,
			b: p.size,
			height: p.length
		};
	return ITEMS[p.item];
}

export interface ItemHolderLayout {
	/** Socket footprint, mm (across x and y) */
	cell: [number, number];
	pitch: [number, number];
	depth: number;
	block: [number, number, number];
}

export function itemHolderLayout(input: ItemHolderParams): ItemHolderLayout {
	const p = clampItemHolder(input);
	const s = shapeOf(p);
	// Flat items (cards, coin cells) stand side by side like books: thin side along the row.
	const flat = s.kind === 'box' ? [Math.min(s.a, s.b), Math.max(s.a, s.b)] : null;
	const w = (s.kind === 'hex' ? s.a / Math.cos(Math.PI / 6) : (flat?.[0] ?? s.a)) + p.clearance;
	const d = (s.kind === 'hex' ? s.a : (flat?.[1] ?? s.b)) + p.clearance;
	const pitch: [number, number] = [w + p.wall, d + p.wall];
	const depth = Math.max(3, (s.height * p.depth) / 100);
	return {
		cell: [w, d],
		pitch,
		depth,
		block: [p.cols * pitch[0] + p.wall, p.rows * pitch[1] + p.wall, depth + p.floor]
	};
}

function socket(s: ItemShape, p: ItemHolderParams, L: ItemHolderLayout, top: number): Node {
	const [w, d] = L.cell;
	const ch = Math.min(1, p.wall * 0.5);
	const deep = L.depth + 1;
	if (s.kind === 'round') {
		const r = w / 2;
		return union(
			translate([0, 0, top - L.depth], cylinder(deep, r, r, 64)),
			translate([0, 0, top - ch], cylinder(ch + 0.01, r, r + ch, 64))
		);
	}
	if (s.kind === 'hex') {
		const r = w / 2;
		const hex = (rr: number) =>
			polygon(
				Array.from(
					{ length: 6 },
					(_, i): Vec2 => [rr * Math.cos((i * Math.PI) / 3), rr * Math.sin((i * Math.PI) / 3)]
				)
			);
		// The mouth widens like the round one: a straight step met its
		// neighbours' corners exactly, in edges a slicer reports as broken.
		return union(
			translate([0, 0, top - L.depth], extrude(deep, hex(r))),
			translate([0, 0, top - ch], taperExtrude(ch + 0.01, (r + ch) / r, hex(r)))
		);
	}
	return union(
		translate([0, 0, top - L.depth], extrude(deep, square(w, d))),
		loft([
			{ z: top - ch, shape: square(w, d) },
			{ z: top + 0.01, shape: rrect(w + 2 * ch, d + 2 * ch, ch, 16) }
		])
	);
}

export function itemHolderModel(input: ItemHolderParams): Node {
	const p = clampItemHolder(input);
	const L = itemHolderLayout(p);
	const s = shapeOf(p);
	const [W, D, H] = L.block;
	const block = extrude(H, rrect(W, D, Math.min(4, p.wall * 2), 32));
	const sockets: Node[] = [];
	for (let i = 0; i < p.cols; i++)
		for (let j = 0; j < p.rows; j++)
			sockets.push(
				translate(
					[
						-W / 2 + p.wall + L.cell[0] / 2 + i * L.pitch[0],
						-D / 2 + p.wall + L.cell[1] / 2 + j * L.pitch[1],
						0
					],
					socket(s, p, L, H)
				)
			);
	return difference(block, ...sockets);
}

function mm(v: number): string {
	return num(Math.round(v * 10) / 10, 1);
}

/** «под биту», «под крону»: the labels that change after «под». */
function itemAfterFor(p: ItemHolderParams, s: ItemShape): string {
	if (p.item === 'bit') return m.t_item_holder_item_bit_for();
	if (p.item === '9v') return m.t_item_holder_item_9v_for();
	return s.label;
}

export function itemHolderSummary(input: ItemHolderParams): string {
	const p = clampItemHolder(input);
	const L = itemHolderLayout(p);
	const s = shapeOf(p);
	const [W, D, H] = L.block;
	const sockets = p.cols * p.rows;
	return m.t_item_holder_summary({
		count: sockets,
		n: num(sockets),
		item: itemAfterFor(p, s),
		depth: mm(L.depth),
		w: mm(W),
		d: mm(D),
		h: mm(H)
	});
}

export function itemHolderHeader(input: ItemHolderParams): string[] {
	const p = clampItemHolder(input);
	return [m.t_item_holder_header_title(), itemHolderSummary(p)];
}

export function itemHolderScad(p: ItemHolderParams): string {
	return toScad(itemHolderModel(p), itemHolderHeader(p));
}
