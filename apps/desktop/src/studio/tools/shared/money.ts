import type { Locale } from '$lib/i18n/locale';

/**
 * The money of the print calculators: what a person types in (a spool's price, the
 * electricity tariff, the printer's price) is in their own currency, so each language gets
 * its country's currency and defaults that look like its prices — not rubles converted.
 * Nothing is converted at runtime: the numbers are only starting values the person edits.
 */
export interface LocalMoney {
	/** ISO 4217, for Intl. */
	code: string;
	/** As it is written next to a number. */
	symbol: string;
	/** A spool of PLA, per kg. */
	filamentKg: number;
	/** Household electricity, per kWh. */
	kwh: number;
	/**
	 * Roughly how many of this currency a ruble is worth, for the other ruble defaults of a
	 * tool (a printer's price, packaging, rounding steps). Round the result with `nice`.
	 */
	perRub: number;
}

const MONEY: Record<Locale, LocalMoney> = {
	ru: { code: 'RUB', symbol: '₽', filamentKg: 1500, kwh: 6, perRub: 1 },
	en: { code: 'USD', symbol: '$', filamentKg: 20, kwh: 0.17, perRub: 1 / 82 },
	es: { code: 'EUR', symbol: '€', filamentKg: 20, kwh: 0.2, perRub: 1 / 95 },
	de: { code: 'EUR', symbol: '€', filamentKg: 22, kwh: 0.38, perRub: 1 / 95 },
	fr: { code: 'EUR', symbol: '€', filamentKg: 22, kwh: 0.25, perRub: 1 / 95 },
	it: { code: 'EUR', symbol: '€', filamentKg: 22, kwh: 0.3, perRub: 1 / 95 },
	pt: { code: 'BRL', symbol: 'R$', filamentKg: 110, kwh: 0.85, perRub: 1 / 15 },
	ja: { code: 'JPY', symbol: '¥', filamentKg: 3000, kwh: 31, perRub: 1.85 },
	tr: { code: 'TRY', symbol: '₺', filamentKg: 700, kwh: 3, perRub: 0.49 },
	zh: { code: 'CNY', symbol: '¥', filamentKg: 80, kwh: 0.56, perRub: 0.088 }
};

export function localMoney(locale: Locale): LocalMoney {
	return MONEY[locale];
}

/** A round starting value: 1, 2 or 5 times a power of ten, nearest to `n`. */
export function nice(n: number): number {
	if (!(n > 0)) return 0;
	const power = 10 ** Math.floor(Math.log10(n));
	const step = [1, 2, 5, 10].reduce((best, k) =>
		Math.abs(k * power - n) < Math.abs(best * power - n) ? k : best
	);
	return step * power;
}
