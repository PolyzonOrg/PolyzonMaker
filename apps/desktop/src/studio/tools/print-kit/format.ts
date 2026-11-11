/**
 * Numbers for the print tools in the page's language: its decimal mark, its
 * currency, grams, hours. One place, so the calculator, the spools and the
 * G-code viewer agree on «1 234,5 г» and «2 ч 35 мин».
 */
import { currentLocale, num as localNum } from '$lib/i18n/current';
import { localMoney } from '$lib/tools/shared/money';
import * as m from '$msg/tools/print-kit';

/** 1234.567 → «1 234,57» (up to `digits` decimals, no trailing zeros). */
export function num(value: number, digits = 1): string {
	return localNum(Number.isFinite(value) ? value : 0, digits);
}

/**
 * A price in the visitor's own currency (src/lib/tools/shared/money.ts): what a person
 * types into the print tools is in their money. 1234.5 → «1 234,5 ₽» in Russian.
 */
export function money(value: number): string {
	return m.t_print_kit_money({ amount: num(value, 2), symbol: localMoney(currentLocale()).symbol });
}

/** The old name of `money`: rubles in Russian, the visitor's currency elsewhere. */
export const rub = money;

/** Grams; a kilogram and more reads as kg. */
export function grams(value: number): string {
	return Math.abs(value) >= 1000
		? m.t_print_kit_kilograms({ n: num(value / 1000, 2) })
		: m.t_print_kit_grams({ n: num(value, 1) });
}

/** Seconds → «2 ч 35 мин», «45 мин», «30 с». */
export function duration(sec: number): string {
	const s = Math.max(0, Math.round(sec));
	const h = Math.floor(s / 3600);
	const min = Math.floor((s % 3600) / 60);
	if (h) return min ? m.t_print_kit_hours_minutes({ h, m: min }) : m.t_print_kit_hours({ h });
	if (min) return m.t_print_kit_minutes({ m: min });
	return m.t_print_kit_seconds({ s });
}

/** «12,5» / «12.5» / « 12 » → 12.5; anything else → null. */
export function parseNumber(raw: string): number | null {
	const t = raw.trim().replace(/\s/g, '').replace(',', '.');
	if (!t) return null;
	const n = Number(t);
	return Number.isFinite(n) ? n : null;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

/** A short id for records kept in the browser. */
export function newId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** localStorage that may be missing (SSR) or blocked (private mode). */
export function readStored<T>(key: string): T | null {
	try {
		const raw = globalThis.localStorage?.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

export function writeStored(key: string, value: unknown): void {
	try {
		globalThis.localStorage?.setItem(key, JSON.stringify(value));
	} catch {
		/* storage full or blocked: the page keeps working for this visit */
	}
}
