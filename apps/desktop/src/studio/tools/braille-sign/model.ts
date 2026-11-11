/**
 * «Таблички со шрифтом Брайля»: a tactile sign — the words in raised letters
 * for those who see a little, and under each line the same in Braille, the
 * dots and their spacing of the standard font of ГОСТ Р 56832-2020: dots
 * 1,5 mm across and 0,6 mm high, 2,7 mm apart in a cell, cells 6,6 mm
 * apart, words 13,2 mm, lines 10,8 mm. Russian Braille for Cyrillic, the
 * international letters for Latin plus the page language's own (ACCENTED),
 * digits after the number sign.
 */
import {
	cylinder,
	difference,
	extrude,
	label,
	part,
	rrect,
	sphere,
	toScad,
	translate,
	union,
	intersection,
	cube,
	type Node
} from '../csg/csg';
import { currentLocale, num } from '$lib/i18n/current';
import { bcp47, type Locale } from '$lib/i18n/locale';
import * as m from '$msg/tools/braille-sign';
import { clamp } from '../shared/math';

/** Dots 1–6 of each character (1–3 down the left, 4–6 down the right). */
// i18n-ok-begin: Russian Braille, the letters a sign is written in, never shown
const CYRILLIC: Record<string, string> = {
	а: '1',
	б: '12',
	в: '2456',
	г: '1245',
	д: '145',
	е: '15',
	ё: '16',
	ж: '245',
	з: '1356',
	и: '24',
	й: '12346',
	к: '13',
	л: '123',
	м: '134',
	н: '1345',
	о: '135',
	п: '1234',
	р: '1235',
	с: '234',
	т: '2345',
	у: '136',
	ф: '124',
	х: '125',
	ц: '14',
	ч: '12345',
	ш: '156',
	щ: '1346',
	ъ: '12356',
	ы: '2346',
	ь: '23456',
	э: '246',
	ю: '1256',
	я: '1246'
}; // i18n-ok-end

const LATIN: Record<string, string> = {
	a: '1',
	b: '12',
	c: '14',
	d: '145',
	e: '15',
	f: '124',
	g: '1245',
	h: '125',
	i: '24',
	j: '245',
	k: '13',
	l: '123',
	m: '134',
	n: '1345',
	o: '135',
	p: '1234',
	q: '12345',
	r: '1235',
	s: '234',
	t: '2345',
	u: '136',
	v: '1236',
	w: '2456',
	x: '1346',
	y: '13456',
	z: '1356'
};

/**
 * The letters a language adds to a–z, in its own Braille: é is 123456 in French but 2346 in
 * Spanish, so the page language picks the table.
 */
const ACCENTED: Partial<Record<Locale, Record<string, string>>> = {
	es: { á: '12356', é: '2346', í: '34', ó: '346', ú: '23456', ü: '1256', ñ: '12456' },
	pt: {
		á: '12356',
		é: '123456',
		í: '34',
		ó: '346',
		ú: '23456',
		à: '1246',
		â: '16',
		ê: '126',
		ô: '1456',
		ã: '345',
		õ: '246',
		ç: '12346',
		ü: '1256'
	},
	fr: {
		à: '12356',
		â: '16',
		ç: '12346',
		è: '2346',
		é: '123456',
		ê: '126',
		ë: '1246',
		î: '146',
		ï: '12456',
		ô: '1456',
		œ: '246',
		ù: '23456',
		û: '156',
		ü: '1256'
	},
	it: { à: '12356', è: '2346', é: '123456', ì: '34', ò: '346', ù: '23456' },
	de: { ä: '345', ö: '246', ü: '1256', ß: '2346' },
	tr: { ç: '16', ğ: '126', ı: '35', ö: '246', ş: '146', ü: '1256' }
};

/** Digits 1…0 are the letters a…j after the number sign. */
const DIGITS: Record<string, string> = {
	'1': '1',
	'2': '12',
	'3': '14',
	'4': '145',
	'5': '15',
	'6': '124',
	'7': '1245',
	'8': '125',
	'9': '24',
	'0': '245'
};
const NUMBER = '3456';
/** Letter sign: what follows is a letter, not a digit. */
const LETTER = '56';

const PUNCTUATION: Record<string, string> = {
	'.': '256',
	',': '2',
	'?': '26',
	'!': '235',
	':': '25',
	';': '23',
	'-': '36',
	'(': '126',
	')': '345',
	'"': '236',
	'№': '1345'
};

/** A line in Braille: one entry per cell (its dots), null for a space. */
export function toBraille(text: string, locale: Locale = currentLocale()): (string | null)[] {
	const out: (string | null)[] = [];
	const accented = ACCENTED[locale] ?? {};
	let inNumber = false;
	// Turkish lowers I to ı, not i.
	for (const raw of text.toLocaleLowerCase(bcp47(locale))) {
		if (/\s/.test(raw)) {
			out.push(null);
			inNumber = false;
			continue;
		}
		if (raw in DIGITS) {
			if (!inNumber) out.push(NUMBER);
			inNumber = true;
			out.push(DIGITS[raw]);
			continue;
		}
		const cell = CYRILLIC[raw] ?? LATIN[raw] ?? accented[raw] ?? PUNCTUATION[raw];
		if (!cell) continue;
		// Right after a number a letter shaped like a digit would read as one: the letter sign first.
		if (inNumber && Object.values(DIGITS).includes(cell) && !(raw in PUNCTUATION)) out.push(LETTER);
		out.push(cell);
		inNumber = false;
	}
	// No spaces at the ends, never two in a row.
	return out.filter((c, i, a) => c !== null || (i > 0 && i < a.length - 1 && a[i - 1] !== null));
}

/** ГОСТ Р 56832-2020, standard font, mm. */
export const BRAILLE = {
	dot: 1.5,
	height: 0.6,
	dotPitch: 2.7,
	cellPitch: 6.6,
	wordPitch: 13.2,
	linePitch: 10.8
} as const;

export interface BrailleSignParams {
	/** Up to three lines */
	text: string;
	/** Capital height of the raised letters, mm */
	cap: number;
	/** Plate width (grows to fit the Braille), mm */
	width: number;
	thickness: number;
	/** Raised letters' height, mm */
	relief: number;
	radius: number;
	holes: boolean;
	font: string;
}

export const BRAILLE_SIGN_DEFAULTS: BrailleSignParams = {
	get text() {
		return m.t_braille_sign_sample_room();
	},
	cap: 18,
	width: 150,
	thickness: 3,
	relief: 1,
	radius: 4,
	holes: false,
	font: 'Noto Sans'
};

export const BRAILLE_SIGN_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<BrailleSignParams>;
}[] = [
	{
		id: 'room',
		get label() {
			return m.t_braille_sign_preset_room();
		},
		params: {
			get text() {
				return m.t_braille_sign_sample_room();
			}
		}
	},
	{
		id: 'wc',
		get label() {
			return m.t_braille_sign_preset_wc();
		},
		params: {
			get text() {
				return m.t_braille_sign_sample_wc();
			},
			width: 120
		}
	},
	{
		id: 'exit',
		get label() {
			return m.t_braille_sign_preset_exit();
		},
		params: {
			get text() {
				return m.t_braille_sign_sample_exit();
			},
			width: 120,
			cap: 22
		}
	},
	{
		id: 'two',
		get label() {
			return m.t_braille_sign_preset_two_lines();
		},
		params: {
			get text() {
				return m.t_braille_sign_sample_two_lines();
			},
			width: 180,
			cap: 15
		}
	}
];

export function clampBrailleSign(p: BrailleSignParams): BrailleSignParams {
	const lines = (p.text ?? '')
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.slice(0, 3);
	return {
		text: lines.join('\n'),
		cap: clamp(p.cap, 8, 50),
		width: clamp(p.width, 40, 300),
		thickness: clamp(p.thickness, 1.6, 8),
		relief: clamp(p.relief, 0.6, 2),
		radius: clamp(p.radius, 0, 20),
		holes: !!p.holes,
		font: p.font || 'Noto Sans'
	};
}

const MARGIN = 10;
/** From the letters' baseline down to the first Braille dots' row, mm. */
const GAP_BELOW_TEXT = 6;

export interface BrailleSignLayout {
	lines: string[];
	cells: (string | null)[][];
	width: number;
	height: number;
	/** Each line's letters baseline and its Braille top row (dot 1), from the top edge down, mm */
	baselines: number[];
	brailleTops: number[];
	dots: number;
}

/** Width of a line of cells: spaces count a word's gap. */
function cellsWidth(cells: (string | null)[]): number {
	if (!cells.length) return 0;
	let w = 0;
	for (let i = 0; i < cells.length; i++)
		w += cells[i] === null ? BRAILLE.wordPitch - BRAILLE.cellPitch : BRAILLE.cellPitch;
	return w - BRAILLE.cellPitch + BRAILLE.dotPitch;
}

export function brailleSignLayout(input: BrailleSignParams): BrailleSignLayout {
	const p = clampBrailleSign(input);
	const lines = p.text ? p.text.split('\n') : [];
	const cells = lines.map((line) => toBraille(line));
	const width = Math.max(p.width, ...cells.map((c) => cellsWidth(c) + 2 * MARGIN));
	const baselines: number[] = [];
	const brailleTops: number[] = [];
	let y = MARGIN;
	for (let i = 0; i < lines.length; i++) {
		y += p.cap;
		baselines.push(y);
		y += GAP_BELOW_TEXT;
		brailleTops.push(y);
		y += 2 * BRAILLE.dotPitch + (i < lines.length - 1 ? BRAILLE.linePitch : 0);
	}
	const height = Math.max(40, y + MARGIN + BRAILLE.dot / 2);
	const dots = cells.flat().reduce((s, c) => s + (c ? c.length : 0), 0);
	return { lines, cells, width, height, baselines, brailleTops, dots };
}

/** A Braille dot: a spherical cap 1,5 mm across and 0,6 mm high on the face at z. */
function dot(x: number, y: number, z: number): Node {
	const a = BRAILLE.dot / 2;
	const h = BRAILLE.height;
	const R = (a * a + h * h) / (2 * h);
	// The sphere's cap above the face only.
	return intersection(
		translate([x, y, z + h - R], sphere(R, 24)),
		translate([x - a - 0.1, y - a - 0.1, z - 0.01], cube([2 * a + 0.2, 2 * a + 0.2, h + 0.02]))
	);
}

export function brailleSignModel(input: BrailleSignParams): Node {
	const p = clampBrailleSign(input);
	const L = brailleSignLayout(p);
	const T = p.thickness;
	const top = L.height / 2;
	const plate: Node = extrude(T, rrect(L.width, L.height, p.radius, 48));
	// Screw holes with a 90° countersink, cut after the letters and dots so a
	// long line never covers them; the letters keep clear of them as well.
	const sink = Math.min(2, T - 0.4);
	const holes = p.holes
		? [-1, 1].flatMap((s) => [
				translate([s * (L.width / 2 - 7), 0, -1], cylinder(T + p.relief + 2, 2.2, 2.2, 24)),
				translate([s * (L.width / 2 - 7), 0, T - sink], cylinder(sink + 0.1, 2.2, 2.3 + sink, 24))
			])
		: [];
	const room = L.width - (p.holes ? 2 * (7 + 4.2 + 1) : 2 * MARGIN);
	const raised: Node[] = [];
	L.lines.forEach((line, i) => {
		raised.push(
			translate(
				[0, top - L.baselines[i], T - 0.01],
				extrude(
					p.relief + 0.01,
					label(line, p.cap, {
						font: p.font,
						bold: true,
						fit: room,
						valign: 'baseline'
					})
				)
			)
		);
		// The Braille line centred under its letters.
		const cells = L.cells[i];
		const w = cellsWidth(cells);
		let x = -w / 2;
		const y0 = top - L.brailleTops[i];
		for (const c of cells) {
			if (c === null) {
				x += BRAILLE.wordPitch - BRAILLE.cellPitch;
				continue;
			}
			for (const d of c) {
				const n = Number(d);
				const col = n > 3 ? 1 : 0;
				const row = (n - 1) % 3;
				raised.push(dot(x + col * BRAILLE.dotPitch, y0 - row * BRAILLE.dotPitch, T));
			}
			x += BRAILLE.cellPitch;
		}
	});
	return part('sign', difference(union(plate, ...raised), ...holes));
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function brailleSignSummary(input: BrailleSignParams): string {
	const p = clampBrailleSign(input);
	const L = brailleSignLayout(p);
	return m.t_braille_sign_summary({
		width: mm(L.width),
		height: mm(L.height),
		count: L.dots,
		n: num(L.dots)
	});
}

export function brailleSignTexts(input: BrailleSignParams): Node[] {
	const p = clampBrailleSign(input);
	const L = brailleSignLayout(p);
	return L.lines.map((line) =>
		label(line, p.cap, { font: p.font, bold: true, fit: L.width - 2 * MARGIN, valign: 'baseline' })
	);
}

export function brailleSignHeader(input: BrailleSignParams): string[] {
	const p = clampBrailleSign(input);
	return [m.t_braille_sign_scad_title(), brailleSignSummary(p), m.t_braille_sign_scad_dots()];
}

export function brailleSignScad(p: BrailleSignParams): string {
	return toScad(brailleSignModel(p), brailleSignHeader(p));
}
