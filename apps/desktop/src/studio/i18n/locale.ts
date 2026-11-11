/**
 * The studio's languages — the same ten as polyzon.org (web/src/lib/i18n/locale.ts there),
 * so a visitor who moves between the catalog and the studio keeps their language.
 *
 * Duplicates `locales`/`baseLocale` of project.inlang/settings.json on purpose: this module
 * is read by places that must not depend on the compiled paraglide runtime (the inline
 * script of app.html, the sitemap, vite.config.ts). tests/i18n.test.ts compares the lists.
 *
 * The order is the order of the language picker (owner, 2026-10-23): English first, Russian
 * among the others, so the list looks foreign to nobody.
 */
export const LOCALES = ['en', 'es', 'de', 'fr', 'it', 'pt', 'ja', 'tr', 'ru', 'zh'] as const;

export type Locale = (typeof LOCALES)[number];

/** The language the studio was written in: no URL prefix, the fallback everywhere. */
export const BASE_LOCALE: Locale = 'ru';

/**
 * For the rest of the world: a visitor whose languages match none of ours, are not spoken
 * in the CIS and whose time zone gives no hint reads English. Also the hreflang x-default.
 */
export const INTERNATIONAL_LOCALE: Locale = 'en';

/**
 * Languages whose speakers get the Russian interface: the CIS and its neighbours, where
 * Russian is the common language. Duplicated literally in app.html.
 */
export const CIS_LANGUAGES = [
	'ru',
	'uk',
	'be',
	'kk',
	'ky',
	'uz',
	'tg',
	'tk',
	'hy',
	'az',
	'ka',
	'mo',
	'ab',
	'os',
	'tt',
	'ba',
	'cv',
	'sah'
] as const;

/**
 * Regional languages whose speakers read one of ours as a second mother tongue (Catalan →
 * Spanish, Swiss German → German, Cantonese → Chinese…). Duplicated literally in app.html.
 */
export const REGIONAL_LANGUAGES: Readonly<Record<string, Locale>> = {
	ca: 'es',
	gl: 'es',
	eu: 'es',
	ast: 'es',
	gsw: 'de',
	lb: 'de',
	br: 'fr',
	oc: 'fr',
	co: 'fr',
	wa: 'fr',
	sc: 'it',
	fur: 'it',
	lij: 'it',
	nap: 'it',
	scn: 'it',
	vec: 'it',
	yue: 'zh',
	wuu: 'zh',
	nan: 'zh',
	hak: 'zh'
};

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** `null`, not the base locale, for anything else: the caller decides what that means. */
export function parseLocale(value: unknown): Locale | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim().toLowerCase();
	return isLocale(normalized) ? normalized : null;
}

/**
 * `<html lang>`, `Content-Language` and `lang` attributes. Portuguese is Brazilian and
 * Chinese is Simplified: the tag picks the font (Japanese and Chinese draw the same
 * characters differently), hyphenation and the screen reader's voice.
 */
export function htmlLang(locale: Locale): string {
	return HTML_LANG[locale];
}

const HTML_LANG: Record<Locale, string> = {
	en: 'en',
	es: 'es',
	de: 'de',
	fr: 'fr',
	it: 'it',
	pt: 'pt-BR',
	ja: 'ja',
	tr: 'tr',
	ru: 'ru',
	zh: 'zh-Hans'
};

/** hreflang: language without a region (Spanish for all of Latin America), script for Chinese. */
export function hreflang(locale: Locale): string {
	return locale === 'zh' ? 'zh-Hans' : locale;
}

/** og:locale, Open Graph's `language_TERRITORY`. */
export function openGraphLocale(locale: Locale): string {
	return OG_LOCALE[locale];
}

const OG_LOCALE: Record<Locale, string> = {
	en: 'en_US',
	es: 'es_ES',
	de: 'de_DE',
	fr: 'fr_FR',
	it: 'it_IT',
	pt: 'pt_BR',
	ja: 'ja_JP',
	tr: 'tr_TR',
	ru: 'ru_RU',
	zh: 'zh_CN'
};

/** BCP 47 tag for `Intl` (numbers, dates, lists) and schema.org `inLanguage`. */
export function bcp47(locale: Locale): string {
	return BCP47[locale];
}

const BCP47: Record<Locale, string> = {
	en: 'en-US',
	es: 'es-ES',
	de: 'de-DE',
	fr: 'fr-FR',
	it: 'it-IT',
	pt: 'pt-BR',
	ja: 'ja-JP',
	tr: 'tr-TR',
	ru: 'ru-RU',
	zh: 'zh-CN'
};

/** The language's own name, for the picker (no flags, no English names). */
export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
	en: 'English',
	es: 'Español',
	de: 'Deutsch',
	fr: 'Français',
	it: 'Italiano',
	pt: 'Português (Brasil)',
	ja: '日本語',
	tr: 'Türkçe',
	ru: 'Русский', // i18n-ok: each language names itself
	zh: '简体中文'
};

/** The language's English name, for instructions to a language model («answer in German»). */
export const LOCALE_ENGLISH_NAME: Record<Locale, string> = {
	en: 'English',
	es: 'Spanish',
	de: 'German',
	fr: 'French',
	it: 'Italian',
	pt: 'Brazilian Portuguese',
	ja: 'Japanese',
	tr: 'Turkish',
	ru: 'Russian',
	zh: 'Simplified Chinese'
};

/**
 * Digit grouping without Intl: Node and browsers disagree on it (CLDR versions, narrow or
 * plain no-break space), and server-rendered text must match the hydrated one.
 */
const DIGIT_GROUP: Record<Locale, string> = {
	en: ',',
	es: '.',
	de: '.',
	fr: '\u202F',
	it: '.',
	pt: '.',
	ja: ',',
	tr: '.',
	ru: '\u00A0',
	zh: ','
};

const DECIMAL: Record<Locale, string> = {
	en: '.',
	es: ',',
	de: ',',
	fr: ',',
	it: ',',
	pt: ',',
	ja: '.',
	tr: ',',
	ru: ',',
	zh: '.'
};

/** The decimal mark alone, for an editable field where digit grouping would not parse back. */
export function decimalMark(locale: Locale): string {
	return DECIMAL[locale];
}

/**
 * A number the way the language writes it: «12 345,5» / «12,345.5» / «12.345,5». Same
 * text on the server and in the browser. `digits` caps the fraction; trailing zeros go.
 * Spanish leaves four-digit numbers ungrouped (RAE: «1500», «15 000»).
 */
export function formatNumber(n: number, locale: Locale, digits = 2): string {
	if (!Number.isFinite(n)) return String(n);
	const sign = n < 0 ? '-' : '';
	const fixed = Math.abs(n).toFixed(digits);
	const [whole, frac = ''] = fixed.split('.');
	const trimmed = frac.replace(/0+$/u, '');
	const grouped =
		locale === 'es' && whole.length <= 4
			? whole
			: whole.replace(/\B(?=(\d{3})+(?!\d))/gu, DIGIT_GROUP[locale]);
	return sign + grouped + (trimmed ? DECIMAL[locale] + trimmed : '');
}

/**
 * No space between sentences and words glued in markup (a sentence and the link after it):
 * Japanese and Chinese write them together.
 */
export function sentenceGap(locale: Locale): string {
	return locale === 'ja' || locale === 'zh' ? '' : ' ';
}

/** The mark that ends a sentence built in code: «.», Japanese and Chinese «。». */
export function fullStop(locale: Locale): string {
	return locale === 'ja' || locale === 'zh' ? '。' : '.';
}

/** What separates the items of a short list inside a sentence: «, », Japanese and Chinese «、». */
export function listSeparator(locale: Locale): string {
	return locale === 'ja' || locale === 'zh' ? '、' : ', ';
}

/** Items of a short list inside a sentence: «a, b, c», «a、b、c». */
export function listJoin(items: readonly string[], locale: Locale): string {
	return items.join(listSeparator(locale));
}

/** Quotation marks of the language, for a name or a quote inside a sentence. */
export function quote(text: string, locale: Locale): string {
	const [open, close] = QUOTES[locale];
	return `${open}${text}${close}`;
}

const QUOTES: Record<Locale, readonly [string, string]> = {
	en: ['“', '”'],
	es: ['«', '»'],
	de: ['„', '“'],
	fr: ['«\u202F', '\u202F»'],
	it: ['«', '»'],
	pt: ['“', '”'],
	ja: ['「', '」'],
	tr: ['“', '”'],
	ru: ['«', '»'],
	zh: ['“', '”']
};

/**
 * Tokens are paid for only through ЮKassa in rubles, which foreign cards cannot pass, so
 * packs, prices and top-up prompts exist only in Russian (owner, 2026-10-24). Everyone keeps
 * the sign-up bonus, the free daily assistant budget and the free tools. Payments from
 * abroad → add languages here.
 */
export function sellsTokens(locale: Locale): boolean {
	return locale === BASE_LOCALE;
}

/**
 * Inviting friends pays a share of what they buy and of their Plus months — both exist only
 * in Russian, so the program is offered only there.
 */
export function showsReferral(locale: Locale): boolean {
	return sellsTokens(locale);
}

/**
 * The Telegram channel and the VK community speak Russian (DESIGN_CODE §13): the
 * footer's link and «Токены за подписку» are shown in Russian only.
 */
export function showsChannels(locale: Locale): boolean {
	return locale === BASE_LOCALE;
}

/**
 * Polyzon Plus is paid from Russia only (polyzon.org shows it in Russian alone, owner
 * 2026-10-24); the studio follows.
 */
export function showsPlus(locale: Locale): boolean {
	return locale === BASE_LOCALE;
}

/**
 * «Карточка товара» is built for Russian marketplaces (Wildberries, Ozon, Яндекс Маркет,
 * Авито, Мегамаркет): hidden in other languages until each gets marketplaces of its own
 * (owner, 2026-10-24).
 */
export function showsMarket(locale: Locale): boolean {
	return locale === BASE_LOCALE;
}
