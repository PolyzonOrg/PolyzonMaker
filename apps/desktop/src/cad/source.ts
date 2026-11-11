/**
 * What the window does to a program: it only ever changes the text, so a person, an agent and the undo
 * key all stay on the same thing. Lines the window owns stand at the top: place(), paint(), drop().
 */

const quoted = (name: string) => `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The line `word('name', …)` replaced, or added at the top; removed when `line` is empty. */
function line(code: string, word: string, name: string, text: string): string {
	const found = new RegExp(`^${word}\\(${escaped(quoted(name))}[^\\n]*\\n?`, 'm');
	if (found.test(code)) return code.replace(found, text ? `${text}\n` : '');
	return text ? `${text}\n${code}` : code;
}

const trimmed = (v: number) => String(+v.toFixed(2));

/** Sets the place of a part: moves in mm, turns in degrees. All zero takes the line away. */
export function setPlace(code: string, name: string, place: number[]): string {
	const values = [...place];
	while (values.length && !values[values.length - 1]) values.pop();
	return line(code, 'place', name, values.length ? `place(${quoted(name)}, ${values.map(trimmed).join(', ')})` : '');
}

export function setPaint(code: string, name: string, color: string): string {
	return line(code, 'paint', name, `paint(${quoted(name)}, '${color}')`);
}

export function dropPart(code: string, name: string): string {
	return line(code, 'drop', name, `drop(${quoted(name)})`);
}

/** Where a place() line has put this part so far. */
export function placeOf(code: string, name: string): number[] {
	const found = code.match(new RegExp(`^place\\(${escaped(quoted(name))},?([^)\\n]*)\\)`, 'm'));
	const values = found?.[1].split(',').map(Number).filter(Number.isFinite) ?? [];
	return Array.from({ length: 6 }, (_, i) => values[i] ?? 0);
}

/** The default of a param() in the text takes this value. */
export function setParam(code: string, name: string, value: number): string {
	return code.replace(new RegExp(`(\\bparam\\(\\s*['"\`]${escaped(name)}['"\`]\\s*,\\s*)-?[\\d.]+`), `$1${trimmed(value)}`);
}

/** Adds a line that makes a new part, under a name no part has yet. */
export function addPart(code: string, word: string, taken: string[], make: string): string {
	let n = 1;
	while (taken.includes(`${word} ${n}`)) n++;
	const text = `part('${word} ${n}', ${make})`;
	const last = code.match(/^return\b[^\n]*$/m);
	if (last?.index === undefined) return `${code.trimEnd()}\n${text}\n`;
	return `${code.slice(0, last.index)}${text}\n${code.slice(last.index)}`;
}

/** The names of models a program takes from the library. */
export function modelsIn(code: string): string[] {
	return [...new Set([...code.matchAll(/\bmodel\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]))];
}

/** The names of other programs a program uses. */
export function usesIn(code: string): string[] {
	return [...new Set([...code.matchAll(/\buse\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]))];
}

/** Text changes an agent sends instead of the whole program: each `find` has to be there exactly once. */
export function applyEdits(code: string, edits: Array<{ find: string; put: string }>): string {
	return edits.reduce((text, { find, put }) => {
		const at = text.indexOf(find);
		if (at < 0) throw new Error(`Not in the program: ${find.slice(0, 80)}`);
		if (text.indexOf(find, at + 1) >= 0) throw new Error(`More than once in the program: ${find.slice(0, 80)}`);
		return text.slice(0, at) + put + text.slice(at + find.length);
	}, code);
}
