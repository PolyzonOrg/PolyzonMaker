/**
 * Values written into generated OpenSCAD programs. User input never reaches
 * a program as code: numbers are clamped and finite, text is a quoted string
 * literal. Pure — shared by the tools and the tests.
 */

/** A finite number within [min, max], printed the way OpenSCAD reads it. */
export function num(value: number, min: number, max: number): string {
	const n = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
	return String(Number(n.toFixed(4)));
}

/** A string literal: quotes and backslashes escaped, control characters dropped. */
export function str(value: string, maxLength = 200): string {
	const clean = value
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.slice(0, maxLength)
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"');
	return `"${clean}"`;
}

export function bool(value: boolean): string {
	return value ? 'true' : 'false';
}

/** A list of points/numbers as an OpenSCAD vector literal. */
export function vec(values: readonly (number | readonly number[])[]): string {
	return `[${values
		.map((v) => (Array.isArray(v) ? vec(v as number[]) : String(Number((v as number).toFixed(4)))))
		.join(',')}]`;
}
