/**
 * The calculator page's own decisions, apart from the cost itself (model.ts):
 * a printer profile as it is saved, a project part's name and time, and the
 * form after a sliced file is read.
 */
import { splitTime, type CalcInput, type FilamentPrice, type UserPrinter } from './model';
import type { SlicedSummary } from './sliced-file';

const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));

/**
 * A printer profile from the dialog's draft: the name cut to 60 characters,
 * the numbers held to what a real printer has; an empty or zero field takes
 * the default (the price may be zero).
 */
export function cleanPrinter(
	draft: UserPrinter,
	id: string,
	defaults: Pick<CalcInput, 'watts' | 'lifeHours'>,
	defaultName: string
): UserPrinter {
	return {
		id,
		name: draft.name.trim().slice(0, 60) || defaultName,
		watts: clamp(draft.watts || defaults.watts, 1, 5000),
		price: clamp(draft.price || 0, 0, 10_000_000),
		lifeHours: clamp(draft.lifeHours || defaults.lifeHours, 1, 100_000),
		spoolId: draft.spoolId || null
	};
}

/** The list with `printer` in place of the one being edited, or added at the end. */
export function upsertPrinter(
	printers: readonly UserPrinter[],
	printer: UserPrinter,
	editingId: string | null
): UserPrinter[] {
	if (!editingId) return [...printers, printer];
	return printers.map((x) => (x.id === editingId ? printer : x));
}

/**
 * A project part's name: the sliced file's without its extension, otherwise
 * «Деталь N» (`fallback`), at most 60 characters.
 */
export function partName(fileName: string | null, fallback: () => string): string {
	const base = fileName?.replace(/(\.gcode)?\.(gcode|gco|gc|g|3mf|bgcode)$/i, '');
	return (base || fallback()).slice(0, 60);
}

/** The form's print time in whole seconds; an empty field counts as zero. */
export function printSeconds(hours: number, minutes: number): number {
	return Math.round(((hours || 0) * 60 + (minutes || 0)) * 60);
}

const tenth = (g: number) => Math.round(g * 10) / 10;

/**
 * What a sliced file puts into the form. What the file lacks is cleared, so
 * numbers of the previous file do not stay; a file of several filaments
 * brings each at `pricePerKg` to be priced one by one. The slicer's weight
 * already holds colour-change purge and the tower: no multicolour extras.
 */
export function formFromFile(
	s: Pick<SlicedSummary, 'grams' | 'timeSec' | 'filaments'>,
	pricePerKg: number
): Pick<CalcInput, 'weight' | 'hours' | 'minutes' | 'colors' | 'multicolor'> {
	const used = s.filaments.filter((x): x is typeof x & { grams: number } => Boolean(x.grams));
	const colors: FilamentPrice[] =
		used.length > 1
			? used.map((x) => ({
					grams: tenth(x.grams),
					pricePerKg,
					color: x.color,
					type: x.type
				}))
			: [];
	return {
		weight: s.grams ? tenth(s.grams) : 0,
		...(s.timeSec ? splitTime(s.timeSec) : { hours: 0, minutes: 0 }),
		colors,
		multicolor: false
	};
}
