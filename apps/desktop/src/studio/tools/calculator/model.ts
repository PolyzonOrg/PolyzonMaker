/**
 * «Себестоимость печати»: what one good print costs and what to sell it for.
 *
 *   plastic     = (part + colour-change purge + purge tower) g × ₽/kg ÷ 1000;
 *                 a multicolour file brings grams per filament, each at its own ₽/kg
 *   electricity = hours × average W ÷ 1000 × ₽/kWh
 *   wear        = hours × printer price ÷ service life in hours
 *   failures    = (plastic + electricity + wear) × p ÷ (1 − p): with a share p
 *                 of prints failing, a good one carries 1 ÷ (1 − p) runs
 *   total       = plastic + electricity + wear + failures + packaging + labour
 *   price       = total × (1 + markup %), rounded up to the chosen step
 *
 * In the visitor's own currency (shared/money), no exchange rates — the page computes
 * offline and fetches nothing.
 */
import type { Locale } from '$lib/i18n/locale';
import { localMoney, nice } from '../shared/money';
import * as m from '$msg/tools/calculator';

export interface PrinterPreset {
	id: string;
	name: string;
	/**
	 * Average draw while printing PLA after warm-up, W. Our estimate from the
	 * heater and power-supply figures in the makers' specifications (the bed
	 * holds 55–65 °C with the heater cycling); a plug-in meter gives the real one.
	 */
	watts: number;
}

export const PRINTER_PRESETS: readonly PrinterPreset[] = [
	{ id: 'ender3v2', name: 'Creality Ender-3 V2', watts: 110 },
	{ id: 'ender3v3se', name: 'Creality Ender-3 V3 SE', watts: 105 },
	{ id: 'k1c', name: 'Creality K1C', watts: 140 },
	{ id: 'mini', name: 'Prusa MINI+', watts: 50 },
	{ id: 'mk4s', name: 'Prusa MK4S', watts: 85 },
	{ id: 'coreone', name: 'Prusa CORE One', watts: 120 },
	{ id: 'a1mini', name: 'Bambu Lab A1 mini', watts: 65 },
	{ id: 'a1', name: 'Bambu Lab A1', watts: 100 },
	{ id: 'p1s', name: 'Bambu Lab P1S', watts: 125 },
	{ id: 'x1c', name: 'Bambu Lab X1 Carbon', watts: 135 },
	{ id: 'neptune4pro', name: 'Elegoo Neptune 4 Pro', watts: 120 },
	{ id: 'ad5m', name: 'Flashforge Adventurer 5M', watts: 115 },
	{
		id: 'voron350',
		get name() {
			return m.t_calculator_printer_voron_350();
		},
		watts: 250
	}
];

export interface UserPrinter {
	id: string;
	name: string;
	watts: number;
	/** What the printer cost, ₽. */
	price: number;
	/** Hours it is expected to print before it is replaced. */
	lifeHours: number;
	/** The spool loaded now: its ₽/kg goes into the calculation. */
	spoolId: string | null;
}

export interface CalcInput {
	/** Part weight from the slicer, g. */
	weight: number;
	pricePerKg: number;
	multicolor: boolean;
	colorChanges: number;
	/** Purged per colour change, g. */
	purgePerChange: number;
	/** Purge tower, g. */
	tower: number;
	hours: number;
	minutes: number;
	/** ₽ per kWh. */
	tariff: number;
	/** The printer: average W, price and service life. */
	watts: number;
	printerPrice: number;
	lifeHours: number;
	packaging: number;
	labour: number;
	/** Share of prints that fail, %. */
	failRate: number;
	markup: number;
	/** The selling price is rounded up to this many rubles (0 = not rounded). */
	roundTo: number;
	/**
	 * Filaments of a multicolour file, each at its own price; empty = all of
	 * the weight at pricePerKg. Grams beyond their sum go at pricePerKg too.
	 */
	colors: FilamentPrice[];
}

export interface FilamentPrice {
	grams: number;
	pricePerKg: number;
	/** #rrggbb from the slicer, if any */
	color: string | null;
	type: string | null;
}

/**
 * Starting values: a 1 kg PLA spool around 1600 ₽, a household tariff of
 * 6,5 ₽/kWh, a 45 000 ₽ printer that lasts 5000 hours of printing, 0,4 g of
 * PLA flushed per colour change (≈ 320 mm³), one print in twenty failing.
 */
export const CALC_DEFAULTS: CalcInput = {
	weight: 0,
	pricePerKg: 1600,
	multicolor: false,
	colorChanges: 0,
	purgePerChange: 0.4,
	tower: 0,
	hours: 0,
	minutes: 0,
	tariff: 6.5,
	watts: 120,
	printerPrice: 45000,
	lifeHours: 5000,
	packaging: 0,
	labour: 0,
	failRate: 5,
	markup: 80,
	roundTo: 10,
	colors: []
};

/** The «round up to» steps in the language's currency: 10, 50, 100 ₽ scaled and rounded. */
export function roundSteps(locale: Locale): number[] {
	if (locale === 'ru') return [10, 50, 100];
	const { perRub } = localMoney(locale);
	return [10, 50, 100].map((v) => nice(v * perRub));
}

/** The starting values in the language's currency; Russian keeps CALC_DEFAULTS as they are. */
export function calcDefaults(locale: Locale): CalcInput {
	if (locale === 'ru') return { ...CALC_DEFAULTS, colors: [] };
	const money = localMoney(locale);
	return {
		...CALC_DEFAULTS,
		pricePerKg: money.filamentKg,
		tariff: money.kwh,
		printerPrice: nice(CALC_DEFAULTS.printerPrice * money.perRub),
		roundTo: roundSteps(locale)[0],
		colors: []
	};
}

export interface CalcResult {
	/** All plastic that goes through the nozzle, g. */
	plasticGrams: number;
	purgeGrams: number;
	plastic: number;
	kwh: number;
	electricity: number;
	/** ₽ per hour of printing. */
	wearPerHour: number;
	wear: number;
	failures: number;
	packaging: number;
	labour: number;
	total: number;
	price: number;
	profit: number;
}

const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
const money = (v: number) => Math.round(v * 100) / 100;

/** ₽ per printing hour from the printer's price and service life. */
export function wearPerHour(price: number, lifeHours: number): number {
	return lifeHours > 0 ? pos(price) / lifeHours : 0;
}

export function calculate(p: CalcInput): CalcResult {
	const purgeGrams = p.multicolor ? pos(p.colorChanges) * pos(p.purgePerChange) + pos(p.tower) : 0;
	const plasticGrams = pos(p.weight) + purgeGrams;
	const hours = pos(p.hours) + pos(p.minutes) / 60;
	const byColor = (p.colors ?? []).reduce(
		(sum, c) => ({ g: sum.g + pos(c.grams), cost: sum.cost + pos(c.grams) * pos(c.pricePerKg) }),
		{ g: 0, cost: 0 }
	);
	// The file's colours never weigh more than the part: a weight typed (or brought) since
	// keeps their shares, not their old grams.
	const k = byColor.g > plasticGrams ? (byColor.g > 0 ? plasticGrams / byColor.g : 0) : 1;
	const plastic =
		(byColor.cost * k + Math.max(0, plasticGrams - byColor.g * k) * pos(p.pricePerKg)) / 1000;
	const kwh = (hours * pos(p.watts)) / 1000;
	const electricity = kwh * pos(p.tariff);
	const perHour = wearPerHour(p.printerPrice, p.lifeHours);
	const wear = hours * perHour;
	const share = Math.min(0.9, pos(p.failRate) / 100);
	const failures = ((plastic + electricity + wear) * share) / (1 - share);
	const packaging = pos(p.packaging);
	const labour = pos(p.labour);
	const total = plastic + electricity + wear + failures + packaging + labour;
	const raw = total * (1 + pos(p.markup) / 100);
	const step = pos(p.roundTo);
	const price = step > 0 && raw > 0 ? Math.ceil(raw / step - 1e-9) * step : raw;
	return {
		plasticGrams: Math.round(plasticGrams * 10) / 10,
		purgeGrams: Math.round(purgeGrams * 10) / 10,
		plastic: money(plastic),
		kwh: Math.round(kwh * 1000) / 1000,
		electricity: money(electricity),
		wearPerHour: money(perHour),
		wear: money(wear),
		failures: money(failures),
		packaging: money(packaging),
		labour: money(labour),
		total: money(total),
		price: money(price),
		profit: money(price - total)
	};
}

/** Seconds → the form's hours and minutes. */
export function splitTime(sec: number): { hours: number; minutes: number } {
	const total = Math.max(0, Math.round(sec / 60));
	return { hours: Math.floor(total / 60), minutes: total % 60 };
}

// ---------- a project of several parts ----------

/** A part added to the project: its numbers as they were when it was added. */
export interface ProjectItem {
	id: string;
	name: string;
	/** The printer profile it was counted for ('' = the figures without one). */
	printer: string;
	grams: number;
	seconds: number;
	total: number;
	price: number;
}

export function projectTotals(
	items: readonly ProjectItem[]
): Pick<ProjectItem, 'grams' | 'seconds' | 'total' | 'price'> {
	return items.reduce(
		(sum, x) => ({
			grams: sum.grams + x.grams,
			seconds: sum.seconds + x.seconds,
			total: money(sum.total + x.total),
			price: money(sum.price + x.price)
		}),
		{ grams: 0, seconds: 0, total: 0, price: 0 }
	);
}

/**
 * The text for the client: each part at its selling price, and the sum.
 * No cost and no markup — only what the client pays.
 */
export function clientQuote(
	items: readonly ProjectItem[],
	fmt: { rub: (v: number) => string; grams: (v: number) => string; duration: (s: number) => string }
): string {
	const lines = items.map((x, i) =>
		m.t_calculator_quote_line({
			n: i + 1,
			name: x.name,
			grams: fmt.grams(x.grams),
			duration: fmt.duration(x.seconds),
			price: fmt.rub(x.price)
		})
	);
	return [
		m.t_calculator_quote_title(),
		...lines,
		m.t_calculator_quote_total({ price: fmt.rub(projectTotals(items).price) })
	].join('\n');
}
