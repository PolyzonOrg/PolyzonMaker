/**
 * Bookmarks: a thin strip with a rounded, pointed or straight top, a hole
 * for a tassel, a raised border and a name or a quote along it (read from
 * the bottom up, as on a book's spine). Thin enough to bend a little;
 * raised parts stand proud for a second colour.
 */
import {
	circle,
	difference,
	extrude,
	intersection,
	label,
	offset,
	polygon,
	rotate,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/bookmark';
import { clamp as c } from '../shared/math';

export type BookmarkTop = 'round' | 'point' | 'flat';

export interface BookmarkParams {
	text: string;
	/** A smaller second line, may be empty */
	line: string;
	width: number;
	length: number;
	top: BookmarkTop;
	thickness: number;
	relief: number;
	border: boolean;
	hole: boolean;
	font: string;
	bold: boolean;
	count: number;
}

export const BOOKMARK_DEFAULTS: BookmarkParams = {
	get text() {
		return m.t_bookmark_default_text();
	},
	line: '',
	width: 32,
	length: 150,
	top: 'round',
	thickness: 1.4,
	relief: 0.8,
	border: true,
	hole: true,
	font: 'PT Serif',
	bold: true,
	count: 1
};

export interface BookmarkPreset {
	id: string;
	label: string;
	params: Partial<BookmarkParams>;
}

export const BOOKMARK_PRESETS: readonly BookmarkPreset[] = [
	{
		id: 'name',
		get label() {
			return m.t_bookmark_preset_name();
		},
		params: {
			get text() {
				return m.t_bookmark_preset_name_text();
			},
			font: 'Lobster',
			line: ''
		}
	},
	{
		id: 'quote',
		get label() {
			return m.t_bookmark_preset_quote();
		},
		params: {
			get text() {
				return m.t_bookmark_preset_quote_text();
			},
			get line() {
				return m.t_bookmark_preset_quote_line();
			},
			length: 170
		}
	},
	{
		id: 'school',
		get label() {
			return m.t_bookmark_preset_school();
		},
		params: {
			get text() {
				return m.t_bookmark_preset_school_text();
			},
			top: 'point',
			font: 'Comfortaa',
			count: 3
		}
	},
	{
		id: 'mini',
		get label() {
			return m.t_bookmark_preset_mini();
		},
		params: {
			get text() {
				return m.t_bookmark_preset_mini_text();
			},
			width: 22,
			length: 100,
			top: 'flat',
			hole: false
		}
	}
];

export function clampBookmark(p: BookmarkParams): BookmarkParams {
	return {
		text: String(p.text ?? '').slice(0, 40),
		line: String(p.line ?? '').slice(0, 40),
		width: c(p.width, 15, 60),
		length: c(p.length, 60, 220),
		top: p.top === 'point' || p.top === 'flat' ? p.top : 'round',
		thickness: c(p.thickness, 0.8, 3),
		relief: c(p.relief, 0.4, 2),
		border: !!p.border,
		hole: !!p.hole,
		font: p.font,
		bold: !!p.bold,
		count: Math.round(c(p.count, 1, 8))
	};
}

const BORDER = 1.4;

/** The outline, bottom at y = 0, centred on x = 0. */
function outline(p: BookmarkParams): Node {
	const w = p.width;
	const L = p.length;
	const r = Math.min(3, w * 0.12);
	if (p.top === 'round') {
		return union(
			translate([0, (L - w / 2) / 2], rrect(w, L - w / 2, r)),
			translate([0, L - w / 2], circle(w / 2, 96))
		);
	}
	if (p.top === 'point') {
		const body = L - w * 0.45;
		return union(
			translate([0, body / 2], rrect(w, body, r)),
			offset(
				r,
				24,
				offset(
					-r,
					24,
					polygon([
						[-w / 2, body - r - 0.5],
						[w / 2, body - r - 0.5],
						[0, L]
					])
				)
			)
		);
	}
	return translate([0, L / 2], rrect(w, L, r));
}

function bookmark(p: BookmarkParams): { base: Node; raised: Node } {
	const shape = outline(p);
	const holeY = p.length - (p.top === 'flat' ? 7 : p.top === 'point' ? p.width * 0.5 : p.width / 2);
	// The text runs along the strip, from the bottom up, below the hole.
	const room = holeY - (p.hole ? 6 : 0) - 8;
	const two = !!p.line.trim();
	const across = p.width - 2 * BORDER - 5;
	const main = label(p.text.trim(), across * (two ? 0.52 : 0.68), {
		font: p.font,
		bold: p.bold,
		valign: 'center',
		fit: room
	});
	const second =
		two &&
		label(p.line.trim(), across * 0.24, {
			font: p.font,
			bold: p.bold,
			valign: 'center',
			fit: room * 0.8
		});
	// Turned to read from the bottom up, the letters' tops point to −x: the second
	// line (an author under a quote) goes on the +x side, below the main one.
	const turn = (n: Node, dx: number) => translate([dx, 4 + room / 2], rotate([0, 0, 90], n));
	const text = union(turn(main, two ? -across * 0.18 : 0), second && turn(second, across * 0.34));
	const inside = offset(-BORDER - 0.8, 24, shape);
	const raised = union(
		intersection(text, inside),
		p.border && difference(shape, offset(-BORDER, 24, shape)),
		p.hole && translate([0, holeY], difference(circle(4.6, 48), circle(2.6, 48)))
	);
	const cut = (n: Node) =>
		p.hole
			? difference(
					n,
					translate([0, holeY, -1], extrude(p.thickness + p.relief + 2, circle(2.6, 48)))
				)
			: n;
	return {
		base: cut(extrude(p.thickness, shape)),
		raised: cut(translate([0, 0, p.thickness - 0.01], extrude(p.relief + 0.01, raised)))
	};
}

function laidOut(p: BookmarkParams): { base: Node; raised: Node } {
	const one = bookmark(p);
	const place = (n: Node) =>
		union(...Array.from({ length: p.count }, (_, i) => translate([i * (p.width + 6), 0, 0], n)));
	return { base: place(one.base), raised: place(one.raised) };
}

export function bookmarkModel(input: BookmarkParams): Node {
	const { base, raised } = laidOut(clampBookmark(input));
	return union(base, raised);
}

/** The two colours, for a 3MF of parts. */
export function bookmarkColours(input: BookmarkParams): { name: string; node: Node }[] {
	const { base, raised } = laidOut(clampBookmark(input));
	return [
		{ name: m.t_bookmark_part_bookmark(), node: base },
		{ name: m.t_bookmark_part_raised(), node: raised }
	];
}

const mm = (v: number) => num(v, 4);

export function bookmarkSummary(input: BookmarkParams): string {
	const p = clampBookmark(input);
	return m.t_bookmark_summary({
		width: mm(p.width),
		length: mm(p.length),
		thickness: mm(p.thickness + p.relief),
		change: mm(p.thickness)
	});
}

export function bookmarkHeader(input: BookmarkParams): string[] {
	const p = clampBookmark(input);
	return [
		m.t_bookmark_header_title(),
		m.t_bookmark_header_text({ text: p.text, line: p.line }),
		bookmarkSummary(p)
	];
}

export function bookmarkScad(p: BookmarkParams): string {
	return toScad(bookmarkModel(p), bookmarkHeader(p));
}
