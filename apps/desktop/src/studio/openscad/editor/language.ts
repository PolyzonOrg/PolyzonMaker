import type { EditorState } from '@codemirror/state';
import { LanguageSupport, StreamLanguage, foldService } from '@codemirror/language';
import { scadParser, type ScadState } from './tokenizer';

export const scadLanguage = StreamLanguage.define<ScadState>(scadParser);

/** Folding scans forward from the fold line; a 64 KB source is the server-side cap. */
const MAX_FOLD_SCAN = 100_000;

/** Where a string that opens at `i` ends: its closing quote, the end of its line, or the text. */
function stringEnd(text: string, i: number): number {
	for (let j = i + 1; j < text.length; j++) {
		if (text[j] === '\\') j++;
		else if (text[j] === '"' || text[j] === '\n') return j;
	}
	return text.length;
}

/** A `{ … }` block that opens on the fold line and closes on a later one, as a fold. */
function braceFold(text: string, open: number, lineLength: number): FoldRange | 'closed' | null {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const skip = skipped(text, i);
		if (skip === null) return null;
		if (skip !== i) {
			i = skip;
			continue;
		}
		if (text[i] === '{') depth++;
		else if (text[i] === '}' && --depth === 0)
			return i > lineLength ? { from: open + 1, to: i } : 'closed';
	}
	return null;
}

/**
 * Where scanning goes on after a string or a comment that starts at `i`
 * (`i` itself when there is none there); null when a comment never ends.
 */
function skipped(text: string, i: number): number | null {
	const pair = text.slice(i, i + 2);
	if (text[i] === '"') return stringEnd(text, i);
	if (pair === '//') {
		const newline = text.indexOf('\n', i);
		return newline < 0 ? null : newline - 1;
	}
	if (pair === '/*') {
		const end = text.indexOf('*/', i + 2);
		return end < 0 ? null : end + 1;
	}
	return i;
}

type FoldRange = { from: number; to: number };

/**
 * The stream parser produces a flat tree, so `foldNodeProp` has nothing to
 * walk; an indentation folder would misfold hanging statements such as
 * `translate(…)⏎    cube();`. This folds `{ … }` blocks and multi-line block
 * comments that open on the given line.
 */
function foldRange(state: EditorState, lineStart: number, lineEnd: number): FoldRange | null {
	const text = state.doc.sliceString(
		lineStart,
		Math.min(state.doc.length, lineStart + MAX_FOLD_SCAN)
	);
	const lineLength = lineEnd - lineStart;
	for (let i = 0; i < lineLength; i++) {
		if (text.startsWith('/*', i)) {
			const end = text.indexOf('*/', i + 2);
			if (end < 0) return null;
			if (end > lineLength) return { from: lineStart + i + 2, to: lineStart + end };
		}
		if (text[i] === '{') {
			const fold = braceFold(text, i, lineLength);
			if (fold !== 'closed')
				return fold && { from: lineStart + fold.from, to: lineStart + fold.to };
		}
		const skip = skipped(text, i);
		if (skip === null) return null;
		i = skip;
	}
	return null;
}

export const scadFoldService = foldService.of(foldRange);

export function scad(): LanguageSupport {
	return new LanguageSupport(scadLanguage, [scadFoldService]);
}
