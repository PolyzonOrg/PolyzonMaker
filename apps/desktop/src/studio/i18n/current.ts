import { bcp47, formatNumber, type Locale } from './locale';

/** The page's language; a worker has it in its name (see worker.ts). */
export function currentLocale(): Locale {
	const tag = typeof document === 'undefined' ? self.name.split('@')[1] : document.documentElement.lang;
	return tag === 'ru' ? 'ru' : 'en';
}

export function num(n: number, digits = 2): string {
	return formatNumber(n, currentLocale(), digits);
}

export function intlLocale(): string {
	return bcp47(currentLocale());
}

/** Studio's links carry the language; here there is one window and no addresses to translate. */
export const lhref = (href: string): string => href;
