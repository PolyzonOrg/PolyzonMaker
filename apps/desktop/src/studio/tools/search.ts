/**
 * The tools catalog search: finds the tool however the query is typed —
 * with typos (missed, extra, swapped or neighbouring keys, unstressed vowels,
 * voiced for voiceless), in the wrong keyboard layout («kbnjafybz»), in
 * translit («litofaniya»), run together («коробкаскрышкой») or broken apart
 * («кор обка»), inflected («коробочки», «шестерёнок») or by another word for
 * the same thing («шкатулка», «пенал», «бокс»). Pure: the catalog page builds
 * the index from the registry once.
 *
 * Each query word is scored against every word of a tool — title, search
 * keywords, description, section — exact, by stem (Snowball Russian), by
 * prefix (a word being typed), by a weighted Damerau–Levenshtein distance,
 * or through a synonym. The query is also tried in the other layout, in
 * translit, glued and split; the best reading wins.
 *
 * That is the Russian search. Other languages search the same texts in their
 * language (the messages) as written: folded (accents off, Turkish «ı» as «i»),
 * exact, by prefix and by the same distance, synonyms coming from each tool's
 * keywords, glued and split — no Russian stems, layouts, translit or synonym
 * families. Japanese and Chinese put no spaces between words, so there a query
 * also matches inside a longer run of the text, and a known word inside the query.
 */
import { currentLocale } from '$lib/i18n/current';
import type { Locale } from '$lib/i18n/locale';
import * as m from '$msg/tools/catalog';

export interface SearchDoc {
	slug: string;
	title: string;
	description: string;
	/** Section title: «Генераторы», «Работа с моделью», «Печать» */
	section: string;
	/** Other words people use for it, space-separated */
	keywords: string;
}

export interface SearchHit {
	slug: string;
	score: number;
}

export interface SearchResult {
	/** Best first; only confident ones, or the nearest few when nothing is */
	hits: SearchHit[];
	/** At least one hit is a confident match */
	confident: boolean;
	/** The query as it was understood, when that differs from what was typed */
	understood: string | null;
}

// ---------- Text ----------

// i18n-ok-begin: Russian letters the search folds and matches in queries, never shown

/** Latin letters that look Cyrillic, inside a Cyrillic word («киккō» typed with a Latin «o»). */
const LOOKALIKE: Record<string, string> = {
	a: 'а',
	c: 'с',
	e: 'е',
	k: 'к',
	m: 'м',
	o: 'о',
	p: 'р',
	x: 'х',
	y: 'у'
};

/**
 * Lower case, «ё» as «е», accents off, «10×15» → «10 15», separators → spaces.
 * Outside Russian also Turkish «ı» as «i» (people type either) and «ß» as «ss».
 */
export function fold(text: string, locale: Locale = 'ru'): string {
	let lower = text.toLowerCase();
	if (locale !== 'ru') lower = lower.replace(/ı/g, 'i').replace(/ß/g, 'ss');
	return (
		lower
			.normalize('NFD')
			// Accents off — but not the breve of «й» (U+0306 after «и»).
			.replace(/(?<!и)̆|[̀-̅̇-ͯ]/g, '')
			.normalize('NFC')
			.replace(/ё/g, 'е')
			.replace(/(\d)\s*[xх×*]\s*(?=\d)/g, '$1 ')
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim()
			.split(' ')
			.map((w) => (/[а-я]/.test(w) ? w.replace(/[acekmopxy]/g, (c) => LOOKALIKE[c]) : w))
			.join(' ')
	);
}

// i18n-ok-end

/** Japanese and Chinese letters: one of them can be a whole word («箱», a box). */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const spaceless = (locale: Locale) => locale === 'ja' || locale === 'zh';

/** Words of a text; with `compounds`, «g-code» also gives «gcode». */
export function words(text: string, compounds = false, locale: Locale = 'ru'): string[] {
	const out: string[] = [];
	for (const part of text.toLowerCase().split(/\s+/)) {
		const pieces = fold(part, locale).split(' ').filter(Boolean);
		out.push(...pieces);
		if (compounds && pieces.length > 1) out.push(pieces.join(''));
	}
	const cjk = spaceless(locale);
	return out.filter((w) => w.length > 1 || /\d/.test(w) || (cjk && CJK.test(w)));
}

// ---------- Russian stemmer (Snowball) ----------

// i18n-ok-begin: the Russian stemmer's suffixes, never shown

const VOWELS = 'аеиоуыэюя';
const isVowel = (c: string) => VOWELS.includes(c);

const PERFECTIVE_1 = ['вшись', 'вши', 'в'];
const PERFECTIVE_2 = ['ившись', 'ывшись', 'ивши', 'ывши', 'ив', 'ыв'];
const REFLEXIVE = ['ся', 'сь'];
const ADJECTIVE =
	'ими ыми его ого ему ому ее ие ые ое ей ий ый ой ем им ым ом их ых ую юю ая яя ою ею'.split(' ');
const PARTICIPLE_1 = ['ем', 'нн', 'вш', 'ющ', 'щ'];
const PARTICIPLE_2 = ['ивш', 'ывш', 'ующ'];
const VERB_1 = 'ете йте ешь нно ла на ли ем ло но ет ют ны ть й л н'.split(' ');
const VERB_2 =
	'ейте уйте ила ыла ена ите или ыли ило ыло ено ует уют ены ить ыть ишь ей уй ил ыл им ым ен ят ит ыт ую ю'.split(
		' '
	);
const NOUN =
	'иями ями ами ией иям ием иях ев ов ие ье еи ии ей ой ий ям ем ам ом ах ях ию ью ия ья а е и й о у ы ь ю я'.split(
		' '
	);

const byLength = (list: string[]) => [...list].sort((a, b) => b.length - a.length);
const SORTED = {
	p1: byLength(PERFECTIVE_1),
	p2: byLength(PERFECTIVE_2),
	adj: byLength(ADJECTIVE),
	part1: byLength(PARTICIPLE_1),
	part2: byLength(PARTICIPLE_2),
	v1: byLength(VERB_1),
	v2: byLength(VERB_2),
	noun: byLength(NOUN)
};

/** A suffix of `list` at the end of `rv` (group 1: only after «а» or «я»). */
function suffixOf(rv: string, list: string[], afterAYa = false): string | null {
	for (const s of list) {
		if (!rv.endsWith(s)) continue;
		if (afterAYa) {
			const before = rv[rv.length - s.length - 1];
			if (before !== 'а' && before !== 'я') continue;
		}
		return s;
	}
	return null;
}

/** Snowball's Russian stemmer: «коробочками» → «коробочк», «шестерёнок» → «шестеренок». */
export function stemRu(word: string): string {
	if (!/^[а-я]+$/.test(word) || word.length < 3) return word;
	let start = -1;
	for (let i = 0; i < word.length; i++)
		if (isVowel(word[i])) {
			start = i + 1;
			break;
		}
	if (start < 0 || start >= word.length) return word;
	const head = word.slice(0, start);
	let rv = word.slice(start);
	// R2 (in RV terms) for «ость»: after the second vowel–consonant pair.
	const r2 = (() => {
		let i = 0;
		let seen = 0;
		const w = word;
		while (i < w.length) {
			if (i > 0 && !isVowel(w[i]) && isVowel(w[i - 1])) {
				seen++;
				if (seen === 2) return i + 1;
			}
			i++;
		}
		return w.length;
	})();

	const cut = (s: string) => (rv = rv.slice(0, rv.length - s.length));
	const g = suffixOf(rv, SORTED.p1, true) ?? suffixOf(rv, SORTED.p2);
	if (g) cut(g);
	else {
		const refl = suffixOf(rv, REFLEXIVE);
		if (refl) cut(refl);
		const adj = suffixOf(rv, SORTED.adj);
		if (adj) {
			cut(adj);
			const part = suffixOf(rv, SORTED.part1, true) ?? suffixOf(rv, SORTED.part2);
			if (part) cut(part);
		} else {
			const verb = suffixOf(rv, SORTED.v1, true) ?? suffixOf(rv, SORTED.v2);
			if (verb) cut(verb);
			else {
				const noun = suffixOf(rv, SORTED.noun);
				if (noun) cut(noun);
			}
		}
	}
	if (rv.endsWith('и')) cut('и');
	// Derivational «ость» only inside R2.
	for (const s of ['ость', 'ост'])
		if (rv.endsWith(s) && head.length + rv.length - s.length >= r2) {
			cut(s);
			break;
		}
	if (rv.endsWith('ейше')) cut('ейше');
	else if (rv.endsWith('ейш')) cut('ейш');
	if (rv.endsWith('нн')) rv = rv.slice(0, -1);
	else if (rv.endsWith('ь')) cut('ь');
	return head + rv;
}

/** Stem of any word: Russian by Snowball, English without a plural «s». */
export function stem(word: string): string {
	return /[а-я]/.test(word) ? stemRu(word) : stemPlural(word);
}

// i18n-ok-end

/** A Latin word without a plural «s»: «gears» → «gear», «cajas» → «caja». */
function stemPlural(word: string): string {
	if (/^[a-z]{4,}$/.test(word)) return word.replace(/(ies)$/, 'y').replace(/(?<![su])s$/, '');
	return word;
}

// ---------- Keyboard and translit ----------

// i18n-ok-begin: the Russian keyboard, translit and sound-alikes, matched in queries

const EN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU_KEYS = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const EN_TO_RU = new Map([...EN_KEYS].map((c, i) => [c, RU_KEYS[i]]));
EN_TO_RU.set('{', 'х').set('}', 'ъ').set(':', 'ж').set('"', 'э').set('<', 'б').set('>', 'ю');
const RU_TO_EN = new Map([...RU_KEYS].map((c, i) => [c, EN_KEYS[i]]));

/** Typed with the other layout on: «rjhj,rf» → «коробка», «пкшв» → «grid». */
export function swapLayout(text: string): string {
	const lower = text.toLowerCase();
	const latin = (lower.match(/[a-z]/g) ?? []).length;
	const cyrillic = (lower.match(/[а-яё]/g) ?? []).length;
	const map = latin >= cyrillic ? EN_TO_RU : RU_TO_EN;
	return [...lower].map((c) => map.get(c) ?? c).join('');
}

const TRANSLIT: [string, string][] =
	"shch=щ sch=щ yo=е jo=е yu=ю ju=ю ya=я ja=я ye=е zh=ж kh=х ts=ц tz=ц ch=ч sh=ш ck=к ph=ф iya=ия iyu=ию iye=ие iy=ий yy=ый a=а b=б c=к d=д e=е f=ф g=г h=х i=и j=й k=к l=л m=м n=н o=о p=п q=к r=р s=с t=т u=у v=в w=в x=кс y=ы z=з '=ь"
		.split(' ')
		.map((pair) => pair.split('=') as [string, string]);

/** Russian typed in Latin letters: «litofaniya» → «литофания», «shesternya» → «шестерня». */
export function translit(text: string): string {
	let out = '';
	const s = text.toLowerCase();
	for (let i = 0; i < s.length; ) {
		const hit = TRANSLIT.find(([lat]) => s.startsWith(lat, i));
		if (hit) {
			out += hit[1];
			i += hit[0].length;
		} else out += s[i++];
	}
	return out;
}

// ---------- Distance ----------

const ROWS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
/** Letters people swap by ear: unstressed vowels, voiced and voiceless pairs. */
const SOUNDS = 'оа еи ея иы еэ шщ ьъ зс бп дт вф гк жш ий ую ckq sz iy ae ei ou'.split(' ');
// i18n-ok-end
const CHEAP = new Map<string, number>();
function cheap(a: string, b: string, cost: number) {
	for (const k of [a + b, b + a]) CHEAP.set(k, Math.min(cost, CHEAP.get(k) ?? 1));
}
for (const group of SOUNDS)
	for (const a of group) for (const b of group) if (a !== b) cheap(a, b, 0.5);
// Neighbouring keys: on the same row, and above and below.
for (let r = 0; r < ROWS.length; r++) {
	const row = ROWS[r];
	const below = r % 3 < 2 ? ROWS[r + 1] : '';
	for (let i = 0; i < row.length; i++) {
		if (row[i + 1]) cheap(row[i], row[i + 1], 0.6);
		for (const j of [i - 1, i]) if (below[j]) cheap(row[i], below[j], 0.6);
	}
}

/**
 * Damerau–Levenshtein with typing in mind: a neighbouring key or a sound-alike
 * letter costs half, a doubled letter typed or missed half, a swap 0.6.
 */
/** The pair's cost by char codes, built once from CHEAP (faster than strings per cell). */
const PAIR = new Map<number, number>();
for (const [k, v] of CHEAP) PAIR.set(k.charCodeAt(0) * 65536 + k.charCodeAt(1), v);

// Rows reused between calls: this runs thousands of times per keystroke.
let rowA = new Float32Array(64);
let rowB = new Float32Array(64);
let rowC = new Float32Array(64);

export function distance(a: string, b: string, limit = Infinity): number {
	const n = a.length;
	const m = b.length;
	if (Math.abs(n - m) * 0.5 > limit) return Infinity;
	if (m + 1 > rowA.length) {
		rowA = new Float32Array(m + 1);
		rowB = new Float32Array(m + 1);
		rowC = new Float32Array(m + 1);
	}
	let prev2 = rowA;
	let prev = rowB;
	let cur = rowC;
	for (let j = 0; j <= m; j++) prev[j] = j;
	for (let i = 1; i <= n; i++) {
		const x = a.charCodeAt(i - 1);
		// An extra letter next to the same one («коррробка») costs half.
		const del = x === a.charCodeAt(i - 2) || x === a.charCodeAt(i) ? 0.5 : 1;
		cur[0] = i;
		let best = cur[0];
		for (let j = 1; j <= m; j++) {
			const y = b.charCodeAt(j - 1);
			const sub = x === y ? 0 : (PAIR.get(x * 65536 + y) ?? 1);
			// So does a missed one of a double («вана» for «ванна»).
			const ins = y === b.charCodeAt(j - 2) || y === b.charCodeAt(j) ? 0.5 : 1;
			let v = prev[j - 1] + sub;
			if (prev[j] + del < v) v = prev[j] + del;
			if (cur[j - 1] + ins < v) v = cur[j - 1] + ins;
			if (
				i > 1 &&
				j > 1 &&
				x === b.charCodeAt(j - 2) &&
				a.charCodeAt(i - 2) === y &&
				prev2[j - 2] + 0.6 < v
			)
				v = prev2[j - 2] + 0.6;
			cur[j] = v;
			if (v < best) best = v;
		}
		if (best > limit) return Infinity;
		const t = prev2;
		prev2 = prev;
		prev = cur;
		cur = t;
	}
	return prev[m];
}

/** Letters of a word as bits (Cyrillic and Latin share them: a collision only lets more through). */
export function letterMask(word: string): number {
	let mask = 0;
	for (let i = 0; i < word.length; i++) {
		const c = word.charCodeAt(i);
		const k = c >= 0x430 && c <= 0x44f ? c - 0x430 : c >= 97 && c <= 122 ? c - 97 : -1;
		if (k >= 0) mask |= 1 << k;
	}
	return mask;
}

const bits = (x: number) => {
	let n = 0;
	for (; x; n++) x &= x - 1;
	return n;
};

/** How much of a word may be wrong. */
function allowance(len: number): number {
	return len <= 2 ? 0 : len <= 3 ? 0.5 : len <= 5 ? 1.1 : len <= 8 ? 2.1 : 3.1;
}

// ---------- Index ----------

interface Term {
	word: string;
	stem: string;
	/** The stem without a fleeting vowel: «брелок» and «брелки» both «брелк» */
	loose: string;
	/** Its letters as bits (see letterMask) */
	mask: number;
	/** Where it comes from: 1 title … 0.3 section */
	weight: number;
}

interface Entry {
	slug: string;
	order: number;
	terms: Term[];
	title: string;
	/** Keywords and description as plain words, for a whole phrase found in them */
	keywords: string;
	description: string;
}

const FIELD = { title: 1, keywords: 0.85, description: 0.6, section: 0.35 } as const;

// i18n-ok-begin: Russian letters and synonyms (other languages put theirs in the keywords)

/** A vowel that drops in other forms: «брелок» — «брелки», «коробок» — «коробка». */
const fleeting = (s: string) => s.replace(/[ое]([бвгджзйклмнпрстфхцчшщ])$/, '$1');

/** Word families: any word of a group finds the others (as a synonym, a little lower). */
const SYNONYMS: string[][] = [
	'коробка короб коробочка шкатулка бокс box контейнер кейс футляр пенал',
	'органайзер хранение storage organizer',
	'надпись текст буква шрифт слово имя именной гравировка name text font lettering label',
	'фото фотография картинка изображение рисунок картина png jpg jpeg image picture photo svg',
	'табличка вывеска знак шильдик шильда бирка sign plate tag',
	'держатель подставка холдер holder stand док',
	'крепление крепеж кронштейн уголок mount bracket',
	'винт болт шуруп саморез метиз screw bolt шпилька',
	'гайка nut барашек',
	'резьба резьбовой thread метрическая',
	'шестерня шестеренка зубчатый шестерёнка gear редуктор передача',
	'провод кабель шнур проводка cable wire',
	'свет светильник лампа подсветка ночник абажур фонарь светодиод led lamp light торшер люстра',
	'подарок сувенир gift презент',
	'ребенок детский дети школа класс kids',
	'игрушка toy фиджет антистресс игра game',
	'калибровка настройка тест проверка калибровочный calibration test tuning',
	'пластик филамент нить пруток катушка filament spool petg pla abs tpu',
	'ремонт починка починить исправить fix repair восстановить',
	'модель stl файл сетка mesh obj 3mf glb',
	'разрезать разделить порезать разрез split cut часть',
	'цвет цветной многоцветный разноцветный двухцветный color colour ams mmu',
	'новогодний новый елка елочный рождество рождественский christmas xmas',
	'печенье пряник тесто выпечка формочка cookie',
	'цветок растение горшок кашпо вазон planter pot',
	'кружка чашка стакан mug cup',
	'ключ ключи брелок брелочек keychain keyring',
	'телефон смартфон айфон планшет phone iphone tablet',
	'стена настенный wall повесить вешать',
	'стоимость цена себестоимость расход сколько стоит деньги cost price',
	'вес масса граммы грамм weight',
	'принтер printer бамбу bambu эндер ender prusa пруса клиппер klipper марлин marlin',
	'слайсер slicer orca cura кура орка',
	'дырка отверстие дыра hole',
	'магнит magnet магнитный',
	'кухня кухонный kitchen готовка',
	'ванная ванна санузел bathroom',
	'мебель шкаф комод тумба furniture',
	'электроника плата arduino ардуино raspberry распберри малинка esp32 electronics',
	'сеть интернет lan ethernet rj45 патч роутер',
	'трубка труба шланг pipe hose tube',
	'колесо колесико ролик wheel',
	'ручка рукоятка хват handle knob',
	'крышка колпачок заглушка lid cap',
	'вентилятор кулер fan вентиляция обдув',
	'лего lego конструктор'
].map((group) => group.split(' '));

// i18n-ok-end

export interface ToolSearch {
	(query: string): SearchResult;
}

/**
 * A word of a message that names a tool: one alone scores its match plus 0.08
 * for being found, so from about 1 the word (in some form) is in the tool's
 * title — «табличку» in «Таблички», «hook» in «Hooks» (0.99). A keyword (0.93)
 * or a near spelling is too loose here: «перчатка» came close to «Штамп».
 */
const NAMED = 0.95;

/**
 * The tool a chat message asks for, or null: «такую же табличку с фразой …»
 * → the nameplate generator. A message is not a query — it names the thing
 * among other words — so each word is asked on its own, and only a word in a
 * tool's title counts. `titleOf` gives the title of a tool that may be
 * offered (undefined for the rest); of several, the shortest title is the
 * thing itself — «Таблички», not «Таблички со шрифтом Брайля»; «Signs», not
 * «QR code sign».
 */
export function toolInText(
	search: ToolSearch,
	text: string,
	titleOf: (slug: string) => string | undefined
): string | null {
	let best: { slug: string; score: number; words: number } | null = null;
	for (const word of new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])) {
		for (const { slug, score } of search(word).hits) {
			const title = titleOf(slug);
			if (title === undefined || score < NAMED || !titleWord(word, title)) continue;
			const words = title.split(/\s+/).length;
			if (!best || words < best.words || (words === best.words && score > best.score))
				best = { slug, score, words };
		}
	}
	return best?.slug ?? null;
}

/**
 * The word is a word of the title in some form («брелок» — «Брелки»), not the
 * start of a longer one: «по фото» is how a request is given, not «Фоторамки».
 */
function titleWord(word: string, title: string): boolean {
	return title
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.some((w) => w.startsWith(word.slice(0, 4)) && w.length <= word.length + 3);
}

interface Reading {
	text: string;
	/** A small discount for readings further from what was typed */
	trust: number;
	/** Typed as is (not another layout, translit, glued or split) */
	asTyped: boolean;
}

interface WordMatch {
	/** Similarity to each index word that matches at all */
	sim: Map<string, number>;
	/** Synonym stems that also count */
	family: Set<string>;
	/** The index word it is most like, and whether that is a correction */
	pick: string;
	corrected: boolean;
}

/** Confident: this or higher. Below it, the nearest few are offered as «похоже на». */
const CONFIDENT = 0.52;
const NEAR = 0.3;

/**
 * The search over `docs` written in `locale` (the language being rendered by default):
 * build it per language, never once for every visitor.
 */
export function createToolSearch(
	docs: readonly SearchDoc[],
	locale: Locale = currentLocale()
): ToolSearch {
	const ru = locale === 'ru';
	const cjk = spaceless(locale);
	const wordsOf = (text: string, compounds = false) => words(text, compounds, locale);
	const stemOf = ru ? stem : stemPlural;
	const stop = new Set(
		m
			.tcat_search_stop_words({}, { locale })
			.split(/\s+/)
			.map((w) => fold(w, locale))
	);
	const isStopword = (w: string) => stop.has(w);
	const plain = (text: string) =>
		wordsOf(text)
			.filter((w) => !isStopword(w))
			.join(' ');

	const entries: Entry[] = docs.map((d, order) => {
		// One term per spelling, the heaviest kept.
		const seen = new Map<string, Term>();
		const add = (text: string, weight: number) => {
			for (const word of wordsOf(text, true)) {
				if (isStopword(word)) continue;
				const was = seen.get(word);
				if (!was || was.weight < weight) {
					const st = stemOf(word);
					seen.set(word, { word, stem: st, loose: fleeting(st), weight, mask: letterMask(word) });
				}
			}
		};
		add(d.title, FIELD.title);
		add(d.keywords, FIELD.keywords);
		add(d.description, FIELD.description);
		add(d.section, FIELD.section);
		return {
			slug: d.slug,
			order,
			terms: [...seen.values()],
			title: fold(d.title, locale),
			keywords: plain(d.keywords),
			description: plain(d.description)
		};
	});

	const vocabulary = new Map<string, Term>();
	for (const e of entries)
		for (const t of e.terms) if (!vocabulary.has(t.word)) vocabulary.set(t.word, t);
	const vocabWords = [...vocabulary.keys()];
	const vocabTerms = [...vocabulary.values()];
	const stems = new Set([...vocabulary.values()].map((t) => t.stem));

	// Other languages have their synonyms in the keywords of each tool.
	const synonyms = ru ? SYNONYMS : [];
	const familyWords = synonyms.map((group) => new Set(group.flatMap((w) => wordsOf(w))));
	const groupsOf = new Map<string, number[]>();
	const familyStems = synonyms.map((group, gi) => {
		const set = new Set<string>();
		for (const w of group)
			for (const piece of wordsOf(w)) {
				const s = stemOf(piece);
				set.add(s);
				const list = groupsOf.get(s) ?? [];
				if (!list.includes(gi)) list.push(gi);
				groupsOf.set(s, list);
			}
		return set;
	});

	/** How well query word `q` matches index word `t`, 0…1, regardless of field. */
	function similarity(q: string, qs: string, qmask: number, t: Term, real: boolean): number {
		if (q === t.word) return 1;
		// A short stem joins words that only look related («тест» — «тесто»): less sure.
		if (qs === t.stem && qs.length >= 3) return qs.length >= 5 ? 0.95 : real ? 0.7 : 0.85;
		if (qs.length >= 4 && fleeting(qs) === t.loose) return 0.93;
		if (q.length >= 2 && t.word.startsWith(q))
			return Math.max(0.78, 0.9 - 0.02 * (t.word.length - q.length));
		// Japanese and Chinese run words together: the query inside a longer run of the
		// text, or a known word inside the query («歯車を作りたい»); the more of it, the surer.
		if (cjk && CJK.test(q)) {
			if (t.word.includes(q)) return 0.7 + (0.2 * q.length) / t.word.length;
			if ((t.word.length >= 2 || CJK.test(t.word)) && q.includes(t.word))
				return 0.6 + (0.3 * t.word.length) / q.length;
		}
		// Numbers and sizes only as typed: «608» is not «625».
		if (/\d/.test(q) || /\d/.test(t.word)) return 0;
		if (qs.length >= 4 && t.stem.startsWith(qs)) return 0.85;
		if (t.stem.length >= 4 && qs.startsWith(t.stem)) return 0.8;
		const room = allowance(q.length);
		if (room === 0) return 0;
		// Every letter of the query the word lacks needs an edit of at least a half.
		if (bits(qmask & ~t.mask) * 0.5 > room + 0.5) return 0;
		let best = 0;
		// Stems are compared with the stem's own allowance: «магн(ит)» is not «мерн(ые)».
		const stemRoom = allowance(qs.length);
		const d = Math.min(
			distance(q, t.word, room),
			qs.length >= 4 && t.stem.length >= 4 ? distance(qs, t.stem, stemRoom) : Infinity
		);
		if (d <= room) best = 0.86 - 0.13 * d;
		// A word still being typed, with a typo in it: the start of the index word.
		if (q.length >= 4 && t.word.length > q.length + 1) {
			const dp = distance(q, t.word.slice(0, q.length), room);
			if (dp <= room) best = Math.max(best, 0.74 - 0.13 * dp);
		}
		// A real word typed («свет») is rarely a typo of another real word («цвет»).
		return real ? best * 0.75 : best;
	}

	// The same query word comes back on every keystroke and in every reading.
	const cache = new Map<string, WordMatch>();
	function match(q: string, strict: boolean): WordMatch {
		const key = (strict ? '!' : '') + q;
		const cached = cache.get(key);
		if (cached) return cached;
		const qs = stemOf(q);
		const qmask = letterMask(q);
		const real = strict || vocabulary.has(q) || (qs.length >= 4 && stems.has(qs));
		const sim = new Map<string, number>();
		let top = 0;
		let pick = q;
		for (const t of vocabTerms) {
			const s = similarity(q, qs, qmask, t, real);
			if (s <= 0) continue;
			sim.set(t.word, s);
			// On a tie, the spelling nearest to what was typed («литофания», not «литофании»).
			if (s > top || (s === top && distance(q, t.word) < distance(q, pick)))
				[top, pick] = [s, t.word];
		}
		// Synonyms of the word itself, and of what it surely is (a typo of a known word).
		const groups = new Set(groupsOf.get(qs) ?? []);
		if (top >= 0.7) for (const g of groupsOf.get(stemOf(pick)) ?? []) groups.add(g);
		const family = new Set<string>();
		for (const g of groups) for (const s of familyStems[g]) family.add(s);
		for (const g of groups) for (const w of familyWords[g]) family.add(' ' + w);
		// A word found inside another (Japanese, Chinese) is what was typed, not a correction.
		const plain =
			pick === q ||
			pick.startsWith(q) ||
			stemOf(pick) === qs ||
			top >= 0.95 ||
			(cjk && (pick.includes(q) || q.includes(pick)));
		const result: WordMatch = {
			sim,
			family,
			pick: top >= 0.5 ? pick : q,
			corrected: top >= 0.5 && !plain
		};
		if (cache.size > 2000) cache.clear();
		cache.set(key, result);
		return result;
	}

	const known = (piece: string) =>
		isStopword(piece) || vocabulary.has(piece) || (piece.length >= 4 && stems.has(stemOf(piece)));
	const begins = (piece: string) => vocabWords.some((w) => w.startsWith(piece));

	/** A run-together word cut into known words: «коробкаскрышкой» → «коробка с крышкой». */
	function segment(word: string): string[] | null {
		if (word.length < 8 || vocabulary.has(word) || /\d/.test(word)) return null;
		const best: (string[] | null)[] = new Array<string[] | null>(word.length + 1).fill(null);
		best[0] = [];
		for (let i = 1; i <= word.length; i++)
			for (let j = Math.max(0, i - 18); j < i; j++) {
				const prev = best[j];
				if (!prev) continue;
				const piece = word.slice(j, i);
				// The last piece may be a word still being typed.
				const ok = known(piece) || (i === word.length && piece.length >= 3 && begins(piece));
				const now = best[i];
				if (ok && (!now || now.length > prev.length + 1)) best[i] = [...prev, piece];
			}
		const found = best[word.length];
		return found && found.length > 1 ? found : null;
	}

	function readings(query: string): Reading[] {
		const raw = fold(query, locale);
		const list: Reading[] = [{ text: raw, trust: 1, asTyped: true }];
		// The Russian keyboard and Russian in Latin letters: Russian only.
		if (ru) {
			const swapped = fold(swapLayout(query));
			if (swapped && swapped !== raw) list.push({ text: swapped, trust: 0.97, asTyped: false });
			if (/[a-z]/.test(raw)) {
				const cyr = fold(translit(raw));
				if (cyr !== raw) list.push({ text: cyr, trust: 0.95, asTyped: false });
			}
		}
		// A word broken apart by a stray space: the whole query glued.
		const parts = raw.split(' ');
		const fragment = parts.some((w) => w.length <= 5 && !isStopword(w) && !known(w));
		if (parts.length > 1 && parts.length <= 4 && fragment)
			list.push({ text: parts.join(''), trust: 0.93, asTyped: false });
		for (const r of [...list]) {
			const split = r.text
				.split(' ')
				.map((w) => segment(w)?.join(' ') ?? w)
				.join(' ');
			if (split !== r.text) list.push({ text: split, trust: r.trust * 0.97, asTyped: false });
		}
		return list.filter((r, i) => r.text && list.findIndex((x) => x.text === r.text) === i);
	}

	interface Scored {
		scores: Float32Array;
		matches: { q: string; m: WordMatch }[];
	}

	/** `strict`: a reading already corrected (another layout, translit): no second guess. */
	function score(text: string, strict: boolean): Scored {
		const all = wordsOf(text);
		const meaningful = all.filter((w) => !isStopword(w));
		const query = meaningful.length ? meaningful : all;
		const scores = new Float32Array(entries.length);
		const matches = query.map((q) => ({ q, m: match(q, strict) }));
		if (!matches.length) return { scores, matches };
		const phrase = query.join(' ');
		entries.forEach((e, k) => {
			let sum = 0;
			let top = 0;
			let found = 0;
			for (const { m } of matches) {
				let best = 0;
				for (const t of e.terms) {
					let s = m.sim.get(t.word) ?? 0;
					// A synonym by its stem; a short stem only as the very word.
					if ((t.stem.length >= 5 && m.family.has(t.stem)) || m.family.has(' ' + t.word))
						s = Math.max(s, 0.72);
					s *= t.weight;
					if (s > best) best = s;
				}
				if (best < 0.3) best = 0;
				if (best >= 0.45) found++;
				sum += best;
				if (best > top) top = best;
			}
			// Every word counts, but one stray word («зелёная», «мне») does not sink a match.
			let s = 0.65 * (sum / matches.length) + 0.35 * top;
			if (found === matches.length) s += 0.08;
			if (e.title.startsWith(phrase)) s += 0.12;
			else if (e.title.includes(phrase)) s += 0.06;
			else if (matches.length > 1 && e.keywords.includes(phrase)) s += 0.06;
			else if (matches.length > 1 && e.description.includes(phrase)) s += 0.04;
			scores[k] = s;
		});
		return { scores, matches };
	}

	return function search(query: string): SearchResult {
		const all = readings(query);
		const raw = all[0]?.text ?? '';
		if (!raw) return { hits: [], confident: false, understood: null };
		// One letter: the tools whose name starts with it. One Japanese or Chinese
		// character can be a word («箱»): that is searched like one.
		if (raw.length === 1 && !(cjk && CJK.test(raw))) {
			const hits = entries
				.filter((e) => e.title.startsWith(raw))
				.map((e) => ({ slug: e.slug, score: 0.6 }));
			return { hits, confident: hits.length > 0, understood: null };
		}
		const best = new Float32Array(entries.length);
		let winner: (Scored & { reading: Reading; top: number }) | null = null;
		for (const reading of all) {
			const scored = score(reading.text, !reading.asTyped && reading.trust < 0.96);
			let top = 0;
			for (let k = 0; k < scored.scores.length; k++) {
				const v = scored.scores[k] * reading.trust;
				if (v > best[k]) best[k] = v;
				if (v > top) top = v;
			}
			if (!winner || top > winner.top + 1e-6) winner = { ...scored, reading, top };
		}
		const ranked = entries
			.map((e, k) => ({ slug: e.slug, score: best[k], order: e.order }))
			.sort((a, b) => b.score - a.score || a.order - b.order);
		const confident = ranked[0].score >= CONFIDENT;
		// Close behind the best only: a strong match should not drown in weak ones.
		const hits = confident
			? ranked.filter((h) => h.score >= Math.max(CONFIDENT, ranked[0].score * 0.6))
			: ranked.filter((h) => h.score >= NEAR).slice(0, 5);
		let understood: string | null = null;
		if (winner && hits.length) {
			// A correction is shown only where it found something: a word of the best tool.
			const best = entries.find((e) => e.slug === ranked[0].slug);
			const used = new Set(best?.terms.map((t) => t.word));
			const shown = winner.matches.map(({ q, m }) =>
				m.corrected && used.has(m.pick) ? m.pick : q
			);
			const fixed = shown.some((w, i) => w !== winner.matches[i].q);
			if (fixed || !winner.reading.asTyped) understood = shown.join(' ');
			const typed = wordsOf(raw)
				.filter((w) => !isStopword(w))
				.join(' ');
			if (understood === typed) understood = null;
		}
		return {
			hits: hits.map(({ slug, score }) => ({ slug, score: Math.round(score * 1000) / 1000 })),
			confident,
			understood
		};
	};
}
