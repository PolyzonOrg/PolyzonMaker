/**
 * The exact value typed into a tool's number field (NumberField), read the way
 * people write it: either decimal mark, a space between thousands, a unit after
 * the digits («20 мм»). `fixed` says why the field had to correct it — out of
 * range or off the step — so the field can say what it accepts instead of
 * silently showing another number.
 */
export function readNumber(
	raw: string,
	{ min, max, step }: { min: number; max: number; step: number }
): { value: number; fixed: 'range' | 'step' | null } | null {
	const digits = /^[-+]?\d+(?:[.,]\d+)?/.exec(raw.replace(/\s+/g, ''))?.[0];
	if (!digits) return null;
	const n = Number(digits.replace(',', '.'));
	if (n < min || n > max) return { value: n < min ? min : max, fixed: 'range' };
	const value = Math.min(max, Number((Math.round((n - min) / step) * step + min).toFixed(6)));
	return { value, fixed: Math.abs(value - n) < 1e-9 ? null : 'step' };
}
