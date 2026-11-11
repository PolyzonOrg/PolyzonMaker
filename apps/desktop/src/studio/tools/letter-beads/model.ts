/**
 * Letter beads for bracelets and name strings: one bead per letter of the
 * text (spaces skipped), a hole across for the thread, the letter on the
 * top face — raised (a filament change at the bead's top makes it a second
 * colour) or engraved. Square, round, hexagonal or heart beads; the hole
 * runs along X at half height, a small bridge that prints without supports.
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
	type Node,
	type Vec2
} from '../csg/csg';
import { currentLocale, intlLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/letter-beads';
import { clamp as c } from '../shared/math';

export type BeadShape = 'square' | 'round' | 'hex' | 'heart';
export type BeadLetter = 'raised' | 'engraved';

export interface LetterBeadsParams {
	text: string;
	shape: BeadShape;
	/** Across the face, mm */
	size: number;
	thickness: number;
	/** Thread hole, mm */
	hole: number;
	letter: BeadLetter;
	upper: boolean;
	font: string;
	bold: boolean;
	sets: number;
}

export const LETTER_BEADS_DEFAULTS: LetterBeadsParams = {
	get text() {
		return m.t_letter_beads_sample_text();
	},
	shape: 'square',
	size: 10,
	thickness: 6,
	hole: 2,
	letter: 'raised',
	upper: true,
	font: 'Noto Sans',
	bold: true,
	sets: 1
};

export interface LetterBeadsPreset {
	id: string;
	label: string;
	params: Partial<LetterBeadsParams>;
}

export const LETTER_BEADS_PRESETS: readonly LetterBeadsPreset[] = [
	{
		id: 'bracelet',
		get label() {
			return m.t_letter_beads_preset_bracelet();
		},
		get params(): Partial<LetterBeadsParams> {
			return { text: m.t_letter_beads_preset_bracelet_text(), size: 8, thickness: 5, hole: 1.8 };
		}
	},
	{
		id: 'round',
		get label() {
			return m.t_letter_beads_preset_round();
		},
		get params(): Partial<LetterBeadsParams> {
			return { shape: 'round', text: m.t_letter_beads_preset_round_text() };
		}
	},
	{
		id: 'hearts',
		get label() {
			return m.t_letter_beads_preset_hearts();
		},
		get params(): Partial<LetterBeadsParams> {
			return { shape: 'heart', text: m.t_letter_beads_sample_text(), size: 12 };
		}
	},
	{
		id: 'big',
		get label() {
			return m.t_letter_beads_preset_kids();
		},
		get params(): Partial<LetterBeadsParams> {
			return {
				text: m.t_letter_beads_preset_kids_text(),
				size: 16,
				thickness: 9,
				hole: 4,
				letter: 'engraved'
			};
		}
	}
];

const SHAPES: readonly BeadShape[] = ['square', 'round', 'hex', 'heart'];

export function clampLetterBeads(p: LetterBeadsParams): LetterBeadsParams {
	const size = c(p.size, 6, 25);
	const thickness = c(p.thickness, 3, 15);
	return {
		text: String(p.text ?? '').slice(0, 60),
		shape: SHAPES.includes(p.shape) ? p.shape : 'square',
		size,
		thickness,
		// At least 1 mm of wall above and below the hole.
		hole: c(p.hole, 1, Math.max(1, Math.min(thickness - 2, size * 0.5))),
		letter: p.letter === 'engraved' ? 'engraved' : 'raised',
		upper: !!p.upper,
		font: p.font,
		bold: !!p.bold,
		sets: Math.round(c(p.sets, 1, 10))
	};
}

/** The beads' letters: spaces dropped, upper case if asked, at most 60. */
export function lettersOf(p: Pick<LetterBeadsParams, 'text' | 'upper'>): string[] {
	// The page language's rules: Turkish «i» becomes «İ».
	const text = p.upper ? p.text.toLocaleUpperCase(intlLocale()) : p.text;
	return [...text].filter((ch) => ch.trim());
}

const RELIEF = 0.6;

function face(shape: BeadShape, s: number): Node {
	switch (shape) {
		case 'round':
			return circle(s / 2, 48);
		case 'hex':
			return polygon(
				Array.from({ length: 6 }, (_, i): Vec2 => {
					const a = (i * Math.PI) / 3;
					return [(s / Math.sqrt(3)) * Math.cos(a), (s / Math.sqrt(3)) * Math.sin(a)];
				})
			);
		case 'heart': {
			const pts: Vec2[] = [];
			for (let i = 0; i < 72; i++) {
				const t = (i / 72) * 2 * Math.PI;
				pts.push([
					16 * Math.sin(t) ** 3,
					13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
				]);
			}
			const k = s / 32;
			return polygon(pts.map(([x, y]): Vec2 => [x * k, (y + 2.5) * k]));
		}
		default:
			return rrect(s, s, Math.min(2, s * 0.15));
	}
}

function bead(p: LetterBeadsParams, ch: string): { base: Node; raised: Node | null } {
	const s = p.size;
	const outline = face(p.shape, s);
	const body = extrude(p.thickness, outline);
	// A heart's letter is smaller and a little low, clear of the notch.
	const heart = p.shape === 'heart';
	const glyph = intersection(
		translate(
			[0, heart ? -s * 0.03 : 0],
			label(ch, s * (heart ? 0.36 : 0.55), {
				font: p.font,
				bold: p.bold,
				fit: s * (heart ? 0.5 : 0.7),
				valign: 'center'
			})
		),
		// Never past the edge of the face.
		offset(-0.8, 24, outline)
	);
	const hole = translate(
		[-s, 0, p.thickness / 2],
		rotate([0, 90, 0], extrude(2 * s, circle(p.hole / 2, 24)))
	);
	if (p.letter === 'engraved')
		return {
			base: difference(
				body,
				hole,
				translate([0, 0, p.thickness - RELIEF], extrude(RELIEF + 1, glyph))
			),
			raised: null
		};
	return {
		base: difference(body, hole),
		raised: translate([0, 0, p.thickness - 0.01], extrude(RELIEF + 0.01, glyph))
	};
}

function laidOut(input: LetterBeadsParams): { base: Node; raised: Node | null } {
	const p = clampLetterBeads(input);
	const letters = lettersOf(p);
	const all = Array.from({ length: p.sets }, () => letters).flat();
	const list = all.length ? all : [''];
	const cols = Math.max(1, Math.min(10, Math.ceil(Math.sqrt(list.length * 1.6))));
	const pitch = p.size + 3;
	const beads = list.map((ch, i) => {
		const at = [(i % cols) * pitch, -Math.floor(i / cols) * pitch, 0];
		const b = bead(p, ch);
		return { base: translate(at, b.base), raised: b.raised && translate(at, b.raised) };
	});
	return {
		base: union(...beads.map((b) => b.base)),
		raised: p.letter === 'raised' ? union(...beads.map((b) => b.raised)) : null
	};
}

export function letterBeadsModel(input: LetterBeadsParams): Node {
	const { base, raised } = laidOut(input);
	return union(base, raised);
}

/** The colours, for a 3MF of parts: beads and raised letters. */
export function letterBeadsColours(input: LetterBeadsParams): { name: string; node: Node }[] {
	const { base, raised } = laidOut(input);
	return raised
		? [
				{ name: m.t_letter_beads_part_beads(), node: base },
				{ name: m.t_letter_beads_part_letters(), node: raised }
			]
		: [{ name: m.t_letter_beads_part_beads(), node: base }];
}

const mm = (v: number) => num(v, 4);

export function letterBeadsSummary(input: LetterBeadsParams): string {
	const p = clampLetterBeads(input);
	const n = lettersOf(p).length * p.sets;
	const text = m.t_letter_beads_summary({
		count: n,
		n: num(n),
		size: mm(p.size),
		hole: mm(p.hole)
	});
	if (p.letter !== 'raised') return text;
	const colour = m.t_letter_beads_summary_colour({ height: mm(p.thickness) });
	return text + sentenceGap(currentLocale()) + colour;
}

export function letterBeadsHeader(input: LetterBeadsParams): string[] {
	const p = clampLetterBeads(input);
	return [
		m.t_letter_beads_scad_title(),
		m.t_letter_beads_scad_letters({ letters: lettersOf(p).join(' ') }),
		letterBeadsSummary(p)
	];
}

export function letterBeadsScad(p: LetterBeadsParams): string {
	return toScad(letterBeadsModel(p), letterBeadsHeader(p));
}
