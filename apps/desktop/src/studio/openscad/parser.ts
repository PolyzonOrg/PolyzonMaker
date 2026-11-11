// Minimal OpenSCAD Customizer parser.
// Recognises top-level `name = value;` followed (on same line OR previous line)
// by a comment that describes constraints. Supported forms:
//   width = 30;                                  → number
//   width = 30; // [10:1:50]                     → range slider (min:step:max)
//   width = 30; // [10:50]                       → range (min:max)
//   enabled = true;                              → boolean
//   mode = "round"; // ["round","square"]        → dropdown (strings)
//   teeth = 12; // [8, 12, 16, 24]               → dropdown (numbers)
//   label = "Hello";                             → text
// Group headers (`/* [Section] */` or `// [Section]`) become `group`, and a
// plain comment on the line directly above an assignment becomes its human
// `label` — the same conventions OpenSCAD's own Customizer uses.
//
// Returns the list and a function to substitute values back into the source.

export type ParamKind = 'number' | 'range' | 'bool' | 'enumString' | 'enumNumber' | 'string';

export interface ScadParam {
	name: string;
	/** Human description from the comment above the assignment, if any. */
	label?: string;
	/** Customizer tab/group the parameter belongs to, if any. */
	group?: string;
	kind: ParamKind;
	value: string | number | boolean;
	defaultValue: string | number | boolean;
	min?: number;
	max?: number;
	step?: number;
	options?: Array<string | number>;
	lineStart: number; // 0-based index of source text where the assignment starts
	lineEnd: number; // index just past the assignment end
}

// The value starts at its first non-blank character: the blanks after «=» are
// \s*'s alone, so a line without «;» fails in one pass instead of O(n²).
const ASSIGN_RE = /^([ \t]*)([A-Za-z_][\w]*)\s*=\s*([^;\s][^;]*);(.*)$/;
const GROUP_RE = /^\s*(?:\/\*\s*\[([^\]]+)\]\s*\*\/|\/\/\s*\[([^\]]+)\])\s*$/;
const LABEL_RE = /^\s*\/\/\s*(?!\[)(.+?)\s*$/;

function parseRangeAnnotation(s: string): { min: number; max: number; step?: number } | null {
	const m = /\[\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?::\s*(-?\d+(?:\.\d+)?))?\s*\]/.exec(
		s
	);
	if (!m) return null;
	const a = parseFloat(m[1]);
	const b = parseFloat(m[2]);
	const c = m[3] !== undefined ? parseFloat(m[3]) : undefined;
	// Two forms: [min:max] OR [min:step:max]
	if (c === undefined) return { min: a, max: b };
	return { min: a, max: c, step: b };
}

function parseEnumAnnotation(s: string): Array<string | number> | null {
	const m = /\[\s*([^\]]+)\s*\]/.exec(s);
	if (!m) return null;
	const parts = m[1]
		.split(',')
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length < 2) return null;
	// All numeric → enumNumber. Otherwise strip quotes → enumString.
	const allNum = parts.every((p) => /^-?\d+(?:\.\d+)?$/.test(p));
	if (allNum) return parts.map(Number);
	return parts.map((p) => p.replace(/^["']|["']$/g, ''));
}

export function parseParams(source: string): ScadParam[] {
	const params: ScadParam[] = [];
	const lines = source.split('\n');
	let cursor = 0;
	let group: string | undefined;
	let pendingLabel: string | undefined;
	for (const raw of lines) {
		const lineStart = cursor;
		const lineEnd = cursor + raw.length + 1; // include newline
		cursor = lineEnd;
		// Code from Windows ends lines with CR LF: `.` stops at the CR and nothing matched.
		const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

		const g = GROUP_RE.exec(line);
		if (g) {
			// `/* [Name] */` fills the first group, `// [Name]` the second; neither is ever empty.
			group = (g[1] || g[2]).trim();
			pendingLabel = undefined;
			continue;
		}
		const l = LABEL_RE.exec(line);
		if (l) {
			pendingLabel = l[1];
			continue;
		}
		const m = ASSIGN_RE.exec(line);
		if (!m) {
			if (line.trim()) pendingLabel = undefined;
			continue;
		}
		const label = pendingLabel;
		pendingLabel = undefined;
		const [, , name, rawValue, tail] = m;
		const valueText = rawValue.trim();
		const annotation = tail.trim().replace(/^\/\//, '').trim();

		let kind: ParamKind = 'number';
		let value: string | number | boolean;
		let min: number | undefined;
		let max: number | undefined;
		let step: number | undefined;
		let options: Array<string | number> | undefined;

		if (/^(true|false)$/.test(valueText)) {
			kind = 'bool';
			value = valueText === 'true';
		} else if (/^-?\d+(?:\.\d+)?$/.test(valueText)) {
			value = parseFloat(valueText);
			if (annotation) {
				const r = parseRangeAnnotation(annotation);
				if (r) {
					kind = 'range';
					min = r.min;
					max = r.max;
					step = r.step;
				} else {
					const en = parseEnumAnnotation(annotation);
					if (en && en.every((x) => typeof x === 'number')) {
						kind = 'enumNumber';
						options = en;
					}
				}
			}
		} else if (/^".*"$/.test(valueText) || /^'.*'$/.test(valueText)) {
			value = valueText.slice(1, -1);
			if (annotation) {
				const en = parseEnumAnnotation(annotation);
				if (en) {
					kind = 'enumString';
					options = en.map(String);
				} else {
					kind = 'string';
				}
			} else {
				kind = 'string';
			}
		} else {
			// non-trivial expression — skip (we can't safely roundtrip)
			continue;
		}

		params.push({
			name,
			label,
			group,
			kind,
			value,
			defaultValue: value,
			min,
			max,
			step,
			options,
			lineStart,
			lineEnd
		});
	}
	return params;
}

function formatValue(p: ScadParam): string {
	if (p.kind === 'bool') return p.value ? 'true' : 'false';
	if (p.kind === 'string' || p.kind === 'enumString') return JSON.stringify(String(p.value));
	return String(p.value);
}

/**
 * Substitute current parameter values back into the source.
 * For each param, we replace its assignment line with a new one preserving
 * the original trailing comment (Customizer annotation).
 */
export function applyParams(source: string, params: ScadParam[]): string {
	if (params.length === 0) return source;
	const lines = source.split('\n');
	let cursor = 0;
	return lines
		.map((line) => {
			const lineStart = cursor;
			cursor += line.length + 1;
			const p = params.find((x) => x.lineStart === lineStart);
			if (!p) return line;
			const cr = line.endsWith('\r') ? '\r' : '';
			const m = ASSIGN_RE.exec(cr ? line.slice(0, -1) : line);
			if (!m) return line;
			const indent = m[1];
			const tail = m[4]; // includes leading whitespace + comment
			return `${indent}${p.name} = ${formatValue(p)};${tail}${cr}`;
		})
		.join('\n');
}
