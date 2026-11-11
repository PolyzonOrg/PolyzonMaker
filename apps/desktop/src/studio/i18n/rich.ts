import { bcp47, type Locale } from './locale';

/**
 * Messages with markup inside (a link, <strong>, <code>): the sentence is translated whole
 * and the insertions are placeholders, filled here with markers ⟦name⟧. <Rich> cuts the text
 * at the markers and renders the snippets of the same name there — the translation decides
 * word order and punctuation around the insertion (the same helper as polyzon.org).
 *
 *   <Rich text={m.legal_read_terms(slots('link'))}>{#snippet link()}<a href=…>…</a>{/snippet}</Rich>
 */
export function slots<const N extends string>(...names: N[]): Record<N, string> {
	return Object.fromEntries(names.map((name) => [name, `⟦${name}⟧`])) as Record<N, string>;
}

/** An enumeration of insertions by the language's rules: «a, b и c», «a, b, and c», «a、b、c». */
export function listSlots(count: number, locale: Locale): string {
	return new Intl.ListFormat(bcp47(locale), { type: 'conjunction' }).format(
		Array.from({ length: count }, (_, i) => `⟦item${i}⟧`)
	);
}

/** Text into pieces: even — text, odd — names of insertions. */
export function splitRich(text: string): string[] {
	return text.split(/⟦([A-Za-z0-9_]+)⟧/u);
}
