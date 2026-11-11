/**
 * Wall storage: a hook, a shelf, a cup, a rack for screwdrivers — on an
 * IKEA SKÅDIS pegboard, on a French cleat rail, or on two screws. Plus the
 * cleat rail itself.
 *
 * SKÅDIS, as measured by the community (IKEA publishes no drawing): vertical
 * slots 5 × 15 mm on a 40 × 40 mm grid with a second grid shifted 20 mm,
 * a 5 mm board. A tab goes through a slot and drops: a leg behind the board
 * holds it; a peg 40 mm lower, in the same column, keeps it from swinging.
 *
 * Everything is a side profile (u — out from the wall, v — up) extruded
 * along the wall. It lies as it prints: on its side, so the layers run
 * along the hook and the tabs, which then do not snap off.
 */
import {
	cylinder,
	difference,
	extrude,
	hull,
	offset,
	part,
	polygon,
	rotate,
	square,
	toScad,
	translate,
	union,
	circle,
	type Node,
	type Vec2
} from '../csg/csg';
import { currentLocale, intlLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/wall-organizer';
import { clamp as c } from '../shared/math';

export type WallMount = 'skadis' | 'cleat' | 'screws';
export type WallItem = 'hook' | 'shelf' | 'cup' | 'rack' | 'rail' | 'panel';

export interface WallParams {
	mount: WallMount;
	item: WallItem;
	/** Along the wall, mm */
	width: number;
	plateHeight: number;
	thickness: number;
	/** Hook: reach from the wall, the rise of its end, the arm's thickness */
	reach: number;
	lip: number;
	arm: number;
	/** Shelf, cup, rack: how far out; the cup's height; the shelf's lip */
	depth: number;
	cupHeight: number;
	shelfLip: number;
	/** Rack: number and diameter of the holes */
	holes: number;
	holeDiameter: number;
	/** French cleat: board thickness and rail height */
	cleat: number;
	railHeight: number;
	screw: number;
	head: number;
}

export const WALL_DEFAULTS: WallParams = {
	mount: 'skadis',
	item: 'hook',
	width: 24,
	plateHeight: 60,
	thickness: 4,
	reach: 35,
	lip: 14,
	arm: 7,
	depth: 50,
	cupHeight: 45,
	shelfLip: 8,
	holes: 5,
	holeDiameter: 9,
	cleat: 12,
	railHeight: 40,
	screw: 4,
	head: 8
};

export interface WallPreset {
	id: string;
	label: string;
	params: Partial<WallParams>;
}

export const WALL_PRESETS: readonly WallPreset[] = [
	{
		id: 'skadis-hook',
		get label() {
			return m.t_wall_organizer_preset_skadis_hook();
		},
		params: { mount: 'skadis', item: 'hook', width: 24 }
	},
	{
		id: 'skadis-cup',
		get label() {
			return m.t_wall_organizer_preset_skadis_cup();
		},
		params: { mount: 'skadis', item: 'cup', width: 84, depth: 45, cupHeight: 50 }
	},
	{
		id: 'skadis-rack',
		get label() {
			return m.t_wall_organizer_preset_skadis_rack();
		},
		params: { mount: 'skadis', item: 'rack', width: 124, holes: 8, holeDiameter: 9, depth: 30 }
	},
	{
		id: 'skadis-panel',
		get label() {
			return m.t_wall_organizer_preset_skadis_panel();
		},
		params: { mount: 'skadis', item: 'panel', width: 200, plateHeight: 200 }
	},
	{
		id: 'rail',
		get label() {
			return m.t_wall_organizer_preset_rail();
		},
		params: { mount: 'cleat', item: 'rail', width: 200, railHeight: 40 }
	},
	{
		id: 'cleat-shelf',
		get label() {
			return m.t_wall_organizer_preset_cleat_shelf();
		},
		params: { mount: 'cleat', item: 'shelf', width: 120, depth: 80, plateHeight: 70 }
	},
	{
		id: 'screw-hook',
		get label() {
			return m.t_wall_organizer_preset_screw_hook();
		},
		params: { mount: 'screws', item: 'hook', width: 20, plateHeight: 70 }
	}
];

/** SKÅDIS geometry: the slot, the grid, the board. */
export const SKADIS = { slotWidth: 5, slotHeight: 15, pitch: 40, board: 5 } as const;
const TAB = { width: 4.4, stem: 4, leg: 6, behind: 3, play: 0.4 } as const;

export function clampWall(p: WallParams): WallParams {
	const mounts: WallMount[] = ['skadis', 'cleat', 'screws'];
	const items: WallItem[] = ['hook', 'shelf', 'cup', 'rack', 'rail', 'panel'];
	const mount = mounts.includes(p.mount) ? p.mount : 'skadis';
	let item = items.includes(p.item) ? p.item : 'hook';
	if (item === 'rail' && mount !== 'cleat') item = 'hook';
	if (item === 'panel' && mount !== 'skadis') item = 'hook';
	const thickness = c(p.thickness, 2.4, 10);
	const screw = c(p.screw, 2.5, 6);
	// A SKÅDIS plate carries the tab and the peg 40 mm below it.
	const minPlate = mount === 'skadis' ? SKADIS.pitch + 14 : 24;
	// A panel holds at least a couple of slots.
	const minWidth = item === 'panel' ? PANEL_MIN : TAB.width + 4;
	const cleat = c(p.cleat, 6, 25);
	return {
		mount,
		item,
		width: c(p.width, minWidth, 400),
		plateHeight: c(p.plateHeight, item === 'panel' ? PANEL_MIN : minPlate, 300),
		thickness,
		reach: c(p.reach, 10, 120),
		lip: c(p.lip, 0, 60),
		arm: c(p.arm, 4, 16),
		depth: c(p.depth, 15, 200),
		cupHeight: c(p.cupHeight, 10, 250),
		shelfLip: c(p.shelfLip, 0, 40),
		holes: Math.round(c(p.holes, 1, 30)),
		holeDiameter: c(p.holeDiameter, 3, 40),
		cleat,
		railHeight: c(p.railHeight, 2 * cleat + 6, 200),
		screw,
		head: c(p.head, screw + 1, 14)
	};
}

/** Centres of the SKÅDIS tabs along the width: one column per 40 mm. */
export function tabColumns(p: WallParams): number[] {
	const n = Math.max(1, Math.floor((p.width - TAB.width - 4) / SKADIS.pitch) + 1);
	return Array.from({ length: n }, (_, i) => p.width / 2 + (i - (n - 1) / 2) * SKADIS.pitch);
}

// ---------- side profiles (u out from the wall, v up; the back at u = 0) ----------

function plateProfile(p: WallParams): Node {
	return translate([p.thickness / 2, p.plateHeight / 2], square(p.thickness, p.plateHeight));
}

/** A J hook from the foot of the plate: an arm out, a round bend, the end up. */
function hookProfile(p: WallParams): Node {
	const a = p.arm;
	const y = a / 2;
	const bend = Math.max(a, p.lip / 1.34);
	const cx = Math.max(p.reach, p.thickness + a + 2 * bend) - bend - a / 2;
	const arc = (from: number, to: number) =>
		polygon([
			...Array.from({ length: Math.ceil((to - from) / 5) + 1 }, (_, i): Vec2 => {
				const t = ((from + Math.min(to - from, i * 5)) * Math.PI) / 180;
				return [cx + (bend + a / 2) * Math.cos(t), y + bend + (bend + a / 2) * Math.sin(t)];
			}),
			...Array.from({ length: Math.ceil((to - from) / 5) + 1 }, (_, i): Vec2 => {
				const t = ((to - Math.min(to - from, i * 5)) * Math.PI) / 180;
				return [cx + (bend - a / 2) * Math.cos(t), y + bend + (bend - a / 2) * Math.sin(t)];
			})
		]);
	const end = (20 * Math.PI) / 180;
	return union(
		hull(translate([p.thickness, y], circle(a / 2, 32)), translate([cx, y], circle(a / 2, 32))),
		arc(-90, 20),
		translate([cx + bend * Math.cos(end), y + bend + bend * Math.sin(end)], circle(a / 2, 32))
	);
}

/** A shelf at the foot of the plate, a lip at its front. */
function shelfProfile(p: WallParams): Node {
	const t = p.thickness;
	return union(
		translate([p.depth / 2, t / 2], square(p.depth, t)),
		translate([p.depth - t / 2, (t + p.shelfLip) / 2], square(t, t + p.shelfLip))
	);
}

/** The triangular cheek at each end of a shelf: it carries the load into the plate. */
function cheekProfile(p: WallParams): Node {
	const t = p.thickness;
	const up = Math.min(p.plateHeight, p.depth);
	return polygon([
		[t / 2, t / 2],
		[Math.max(t, p.depth - t), t / 2],
		[t / 2, up]
	]);
}

/** A cup: floor and front wall; the ends are closed by plates of the full profile. */
function cupProfile(p: WallParams): Node {
	const t = p.thickness;
	const h = Math.min(p.cupHeight, p.plateHeight);
	return union(
		translate([p.depth / 2, t / 2], square(p.depth, t)),
		translate([p.depth - t / 2, h / 2], square(t, h))
	);
}

/** The cleat on the back of an item: its 45° underside hooks over the rail. */
function cleatProfile(p: WallParams): Node {
	const T = p.cleat;
	const top = p.plateHeight;
	const hc = Math.min(8, top / 4);
	return polygon([
		[-T, top - hc - T],
		[0.01, top - hc],
		[0.01, top],
		[-T, top]
	]);
}

/** The rail on the wall: its top slopes down towards the wall. */
function railProfile(p: WallParams): Node {
	const T = p.cleat;
	const H = p.railHeight;
	return polygon([
		[0, 0],
		[T, 0],
		[T, H],
		[0, H - T]
	]);
}

// ---------- 3D: profiles extruded along the wall (z in print) ----------

const along = (w: number, profile: Node, at = 0) => translate([0, 0, at], extrude(w, profile));

/** SKÅDIS: a tab through the board with a leg behind it, and a straight peg 40 mm lower. */
function skadisTabs(p: WallParams): Node[] {
	const top = p.plateHeight - 4;
	const stem = (v: number, legs: boolean) => {
		const back = SKADIS.board + TAB.play;
		const pieces: Node[] = [
			translate([-back / 2 + 0.01, v - TAB.stem / 2], square(back + 0.02, TAB.stem))
		];
		if (legs)
			pieces.push(
				translate(
					[-back - TAB.behind / 2, v - TAB.stem / 2 - TAB.leg / 2 + TAB.stem / 2],
					square(TAB.behind, TAB.stem + TAB.leg)
				)
			);
		return offset(0.4, 12, offset(-0.4, 12, union(...pieces)));
	};
	return tabColumns(p).flatMap((x) => [
		along(TAB.width, stem(top - TAB.stem / 2, true), x - TAB.width / 2),
		along(TAB.width, stem(top - TAB.stem / 2 - SKADIS.pitch, false), x - TAB.width / 2)
	]);
}

/** As many rack holes as fit the width at the asked diameter, with 2 mm between them. */
function rackHoles(p: WallParams): number {
	return Math.max(
		1,
		Math.min(p.holes, Math.floor((p.width - 2 * p.thickness) / (p.holeDiameter + 2)))
	);
}

/** Two countersunk screw holes through the plate, along u (the wall's normal). */
function screwHoles(p: WallParams, height: number): Node[] {
	const t = p.thickness;
	const ys = [height - p.head / 2 - 4, Math.min(height - p.head - 10, height * 0.35)].filter(
		(y) => y > p.head / 2 + 2
	);
	const sink = (p.head - p.screw) / 2;
	const zs = p.width > 60 ? [p.width * 0.2, p.width * 0.8] : [p.width / 2];
	return zs.flatMap((z) =>
		ys.map((y) =>
			translate(
				[0, y, z],
				rotate(
					[0, 90, 0],
					union(
						translate([0, 0, -1], cylinder(t + 2, p.screw / 2, p.screw / 2, 24)),
						translate([0, 0, t - sink], cylinder(sink + 0.01, p.screw / 2, p.head / 2, 24))
					)
				)
			)
		)
	);
}

function rail(p: WallParams): Node {
	const T = p.cleat;
	const n = Math.max(2, Math.floor(p.width / 150) + 1);
	const holes = Array.from({ length: n }, (_, i) => {
		const z = 15 + ((p.width - 30) * i) / (n - 1);
		const y = (p.railHeight - T) / 2;
		const sink = (p.head - p.screw) / 2;
		return translate(
			[0, y, z],
			rotate(
				[0, 90, 0],
				union(
					translate([0, 0, -1], cylinder(T + 2, p.screw / 2, p.screw / 2, 24)),
					translate([0, 0, T - sink], cylinder(sink + 0.01, p.screw / 2, p.head / 2, 24))
				)
			)
		);
	});
	return difference(along(p.width, railProfile(p)), ...holes);
}

function item(p: WallParams): Node {
	const W = p.width;
	const t = p.thickness;
	const plate = along(W, plateProfile(p));
	switch (p.item) {
		case 'shelf':
			return union(
				plate,
				along(W, shelfProfile(p)),
				along(t, cheekProfile(p)),
				along(t, cheekProfile(p), W - t)
			);
		case 'cup': {
			const h = Math.min(p.cupHeight, p.plateHeight);
			const end = translate([p.depth / 2, h / 2], square(p.depth, h));
			return union(plate, along(W, cupProfile(p)), along(t, end), along(t, end, W - t));
		}
		case 'rack': {
			const shelf = along(W, translate([p.depth / 2, 3], square(p.depth, 6)));
			const n = rackHoles(p);
			const room = (W - 2 * t) / n;
			const d = Math.min(p.holeDiameter, room - 2, p.depth - t - 4);
			const holes = Array.from({ length: n }, (_, i) =>
				translate(
					[t + (p.depth - t) / 2, -1, t + room * (i + 0.5)],
					rotate([-90, 0, 0], cylinder(8, d / 2, d / 2, 32))
				)
			);
			return union(
				difference(union(plate, shelf), ...holes),
				along(t, cheekProfile(p)),
				along(t, cheekProfile(p), W - t)
			);
		}
		default:
			return union(
				plate,
				along(Math.min(W, p.arm * 2.5), hookProfile(p), (W - Math.min(W, p.arm * 2.5)) / 2)
			);
	}
}

/** Slots of a SKÅDIS board inside a panel: the 40 mm grid and the one shifted 20 mm. */
export function panelSlots(p: WallParams): [number, number][] {
	// 16 mm from the edges: the standoffs at the corners stay clear of every slot.
	const margin = 16;
	const spots: [number, number][] = [];
	for (const shift of [0, SKADIS.pitch / 2])
		for (
			let y = margin + SKADIS.slotHeight / 2 + shift;
			y <= p.plateHeight - margin - SKADIS.slotHeight / 2;
			y += SKADIS.pitch
		)
			for (
				let x = margin + SKADIS.slotWidth / 2 + shift;
				x <= p.width - margin - SKADIS.slotWidth / 2;
				x += SKADIS.pitch
			)
				spots.push([x, y]);
	return spots;
}

/** Standoffs behind a panel leave this much room for the tabs' legs, mm. */
export const PANEL_STANDOFF = 12;
/** The smallest panel side, mm: room for two rows of slots. */
export const PANEL_MIN = 80;

/**
 * A SKÅDIS-compatible panel: 5 mm, the slots, standoffs on the back with
 * screw holes. Printed face down (the face on the bed), standoffs up.
 */
function panel(p: WallParams): Node {
	const T = SKADIS.board;
	const W = p.width;
	const H = p.plateHeight;
	const slot = hull(
		translate([0, -SKADIS.slotHeight / 2 + SKADIS.slotWidth / 2], circle(SKADIS.slotWidth / 2, 24)),
		translate([0, SKADIS.slotHeight / 2 - SKADIS.slotWidth / 2], circle(SKADIS.slotWidth / 2, 24))
	);
	const board = extrude(T, translate([W / 2, H / 2], square(W, H)));
	const slots = panelSlots(p).map(([x, y]) => translate([x, y, -1], extrude(T + 2, slot)));
	// Standoffs at the corners and every ~120 mm along the edges, clear of the slots.
	const xs = [
		8,
		...Array.from(
			{ length: Math.max(0, Math.floor(W / 120) - 1) },
			(_, i) => ((i + 1) * W) / Math.floor(W / 120)
		),
		W - 8
	];
	const ys = [8, H - 8];
	const posts: Node[] = [];
	const holes: Node[] = [];
	for (const x of xs)
		for (const y of ys) {
			posts.push(translate([x, y, T - 0.01], cylinder(PANEL_STANDOFF + 0.01, 6, 6, 32)));
			holes.push(
				translate([x, y, -1], cylinder(T + PANEL_STANDOFF + 2, p.screw / 2, p.screw / 2, 24)),
				// The screw head sinks into the face (on the bed): countersunk.
				translate(
					[x, y, -0.01],
					cylinder((p.head - p.screw) / 2 + 0.01, p.head / 2, p.screw / 2, 24)
				)
			);
		}
	return difference(union(board, ...posts), ...slots, ...holes);
}

export function wallModel(input: WallParams): Node {
	const p = clampWall(input);
	if (p.item === 'rail') return part('rail', rail(p));
	if (p.item === 'panel') return part('panel', panel(p));
	const body = item(p);
	if (p.mount === 'skadis') return part('item', union(body, ...skadisTabs(p)));
	if (p.mount === 'cleat') return part('item', union(body, along(p.width, cleatProfile(p))));
	return part('item', difference(body, ...screwHoles(p, p.plateHeight)));
}

const mm = (v: number) => num(Math.max(0, v), 4);

function itemWord(item: WallItem): string {
	switch (item) {
		case 'shelf':
			return m.t_wall_organizer_item_shelf();
		case 'cup':
			return m.t_wall_organizer_item_cup();
		case 'rack':
			return m.t_wall_organizer_item_rack();
		case 'rail':
			return m.t_wall_organizer_item_rail();
		case 'panel':
			return m.t_wall_organizer_item_panel();
		default:
			return m.t_wall_organizer_item_hook();
	}
}

function mountWord(mount: WallMount): string {
	switch (mount) {
		case 'cleat':
			return m.t_wall_organizer_mount_cleat();
		case 'screws':
			return m.t_wall_organizer_mount_screws();
		default:
			return m.t_wall_organizer_mount_skadis();
	}
}

export function wallSummary(input: WallParams): string {
	const p = clampWall(input);
	if (p.item === 'panel') {
		const slots = panelSlots(p).length;
		return m.t_wall_organizer_summary_panel({
			count: slots,
			n: num(slots),
			width: mm(p.width),
			height: mm(p.plateHeight),
			standoff: num(PANEL_STANDOFF)
		});
	}
	if (p.item === 'rail')
		return m.t_wall_organizer_summary_rail({ width: mm(p.width), height: mm(p.railHeight) });
	const word = itemWord(p.item);
	const what = m.t_wall_organizer_what({
		item: `${word.charAt(0).toLocaleUpperCase(intlLocale())}${word.slice(1)}`,
		mount: mountWord(p.mount)
	});
	if (p.mount === 'skadis') {
		const n = tabColumns(p).length;
		return n === 1
			? m.t_wall_organizer_summary_skadis_one({ what })
			: m.t_wall_organizer_summary_skadis({ count: n, n: num(n), what });
	}
	if (p.mount === 'cleat') return m.t_wall_organizer_summary_cleat({ what, cleat: mm(p.cleat) });
	const holes = screwHoles(p, p.plateHeight).length;
	const screws = m.t_wall_organizer_summary_screws({ count: holes, n: num(holes), what });
	if (p.item !== 'rack') return screws;
	const sockets = rackHoles(p);
	const rack = m.t_wall_organizer_summary_rack({
		count: sockets,
		n: num(sockets),
		size: mm(
			Math.min(p.holeDiameter, (p.width - 2 * p.thickness) / sockets - 2, p.depth - p.thickness - 4)
		)
	});
	return `${screws}${sentenceGap(currentLocale())}${rack}`;
}

export function wallHeader(input: WallParams): string[] {
	const p = clampWall(input);
	return [
		m.t_wall_organizer_header_title({ item: itemWord(p.item), mount: mountWord(p.mount) }),
		wallSummary(p),
		m.t_wall_organizer_header_print()
	];
}

export function wallScad(p: WallParams): string {
	return toScad(wallModel(p), wallHeader(p));
}
