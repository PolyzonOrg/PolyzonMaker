import { currentLocale } from './current';

export type Params = Record<string, unknown>;
export type Options = { locale?: string };
type Words = string | Record<string, string>;

/** One message of src/studio/gen in the page's language, with a plural form when it has them. */
export function say(en: Words, ru: Words, p?: Params, o?: Options): string {
	const lang = o?.locale ?? currentLocale();
	const words = lang === 'ru' ? ru : en;
	const text = typeof words === 'string' ? words : (words[new Intl.PluralRules(lang).select(Number(p?.count ?? p?.cost))] ?? words.other);
	return p ? text.replace(/\{(\w+)\}/g, (hole, name: string) => (name in p ? String(p[name]) : hole)) : text;
}
