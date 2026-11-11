/**
 * OpenSCAD stream tokenizer for CodeMirror's `StreamLanguage`.
 *
 * Pure module: the only runtime import is `@lezer/highlight` (tags), so the
 * unit tests can drive it with a `StringStream` under node. It mirrors what
 * `$lib/openscad/parser.ts` understands as Customizer syntax: a trailing
 * `// [10:1:100]` after code is an annotation, a line holding only a bracketed
 * block comment or `// [Group]` is a group header.
 */
import { tags as t, type Tag } from '@lezer/highlight';
import type { IndentContext, StreamParser, StringStream } from '@codemirror/language';

export const CONTROL_KEYWORDS = new Set(['if', 'else', 'for', 'intersection_for', 'let', 'each']);
export const DEFINITION_KEYWORDS = new Set(['module', 'function']);
export const MODULE_KEYWORDS = new Set(['include', 'use']);
/** Their `(` opens a binding list (`for (i = …)`), not a call. */
const BINDING_KEYWORDS = new Set(['for', 'intersection_for', 'let']);
export const BOOL_ATOMS = new Set(['true', 'false']);
export const CONSTANTS = new Set(['PI']);

export const BUILTIN_MODULES = new Set([
	// 3D primitives
	'cube',
	'sphere',
	'cylinder',
	'polyhedron',
	'import',
	'surface',
	// 2D primitives
	'square',
	'circle',
	'polygon',
	'text',
	// transformations
	'translate',
	'rotate',
	'scale',
	'mirror',
	'multmatrix',
	'color',
	'offset',
	'resize',
	// booleans and combinators
	'union',
	'difference',
	'intersection',
	'hull',
	'minkowski',
	'render',
	// extrusion and projection
	'linear_extrude',
	'rotate_extrude',
	'projection',
	'roof',
	// language-level modules
	'children',
	'echo',
	'assert',
	'parent_module'
]);

export const BUILTIN_FUNCTIONS = new Set([
	'abs',
	'sign',
	'sin',
	'cos',
	'tan',
	'acos',
	'asin',
	'atan',
	'atan2',
	'floor',
	'round',
	'ceil',
	'ln',
	'log',
	'pow',
	'sqrt',
	'exp',
	'rands',
	'min',
	'max',
	'norm',
	'cross',
	'concat',
	'lookup',
	'len',
	'str',
	'chr',
	'ord',
	'search',
	'version',
	'version_num',
	'is_undef',
	'is_list',
	'is_num',
	'is_bool',
	'is_string',
	'is_function',
	'textmetrics',
	'fontmetrics'
]);

export const SPECIAL_VARIABLES = [
	'$fn',
	'$fa',
	'$fs',
	'$t',
	'$vpr',
	'$vpt',
	'$vpd',
	'$vpf',
	'$children',
	'$preview',
	'$parent_modules'
];

const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z_]\w*/;
const SPECIAL_RE = /^\$[A-Za-z_]\w*/;
const INCLUDE_PATH_RE = /^<[^>\n]*>/;
const OPERATOR_RE = /^(?:<=|>=|==|!=|&&|\|\||[-+*/%^<>=!?:.])/;
const NON_ASCII_RE = /^[-￿]+/;
/** `// [10:1:100]`, `// [a, b]`, `// [Группа]` — the bracketed form parser.ts reads. */
const ANNOTATION_RE = /^\s*\[[^\]]+\]\s*$/;
/** Rest of a line after `/*` when the whole line is a one-line group header. */
const GROUP_BLOCK_RE = /^\s*\[[^\]]+\]\s*\*\/\s*$/;
const MODIFIER_NEXT_RE = /[A-Za-z_$#!%*{]/;

type Bracket = '(' | '[' | '{';
type Last =
	| 'none'
	| 'word'
	| 'else'
	| 'number'
	| 'string'
	| 'operator'
	| 'modifier'
	| '('
	| ')'
	| '['
	| ']'
	| '{'
	| '}'
	| ';'
	| ','
	| '.';

interface Ctx {
	type: Bracket;
	/** binding = `for/let` parens, params = a module/function parameter list. */
	kind: 'block' | 'call' | 'binding' | 'params' | 'vector';
	/** Indentation of the line that opened the bracket. */
	indented: number;
	/** Column of the first content character after the bracket (for alignment). */
	column: number;
	/** The bracket is followed by content on the same line (not just a comment). */
	align: boolean;
}

export interface ScadState {
	inBlockComment: boolean;
	stack: Ctx[];
	/** Indentation of the current line. */
	indented: number;
	/** No significant token or comment seen on this line yet. */
	sol: boolean;
	last: Last;
	pendingDef: boolean;
	afterDefName: boolean;
	pendingBinding: boolean;
	pendingPath: boolean;
	expectParam: boolean;
	/** A statement is in progress at the current block level (not closed by `;`/`{`). */
	stmtState: 'none' | 'open';
	stmtIndent: number;
	/** `=` seen at block level inside the current statement. */
	inAssignment: boolean;
}

function startState(): ScadState {
	return {
		inBlockComment: false,
		stack: [],
		indented: 0,
		sol: true,
		last: 'none',
		pendingDef: false,
		afterDefName: false,
		pendingBinding: false,
		pendingPath: false,
		expectParam: false,
		stmtState: 'none',
		stmtIndent: 0,
		inAssignment: false
	};
}

function top(state: ScadState): Ctx | undefined {
	return state.stack[state.stack.length - 1];
}

function atBlockLevel(state: ScadState): boolean {
	const ctx = top(state);
	return !ctx || ctx.type === '{';
}

/** Record a significant (non-comment) token. */
function significant(state: ScadState, kind: Last): void {
	state.pendingDef = false;
	state.afterDefName = false;
	state.pendingBinding = false;
	state.pendingPath = false;
	if (state.stmtState === 'none' && atBlockLevel(state)) {
		state.stmtState = 'open';
		state.stmtIndent = state.indented;
	}
	state.last = kind;
}

function endStatement(state: ScadState): void {
	state.stmtState = 'none';
	state.inAssignment = false;
}

function isBuiltin(word: string): boolean {
	return BUILTIN_MODULES.has(word) || BUILTIN_FUNCTIONS.has(word);
}

function bracketToken(ch: string): string {
	return ch === '(' || ch === ')' ? 'paren' : ch === '[' || ch === ']' ? 'squareBracket' : 'brace';
}

/** `#` is unambiguous; `! % *` are modifiers only where an object can start. */
function isModifierPosition(state: ScadState, ch: string, next: string): boolean {
	if (ch === '#') return true;
	if (!MODIFIER_NEXT_RE.test(next)) return false;
	if (state.stmtState === 'none') return true;
	const afterObject = state.last === ')' || state.last === 'else' || state.last === 'modifier';
	return afterObject && !state.inAssignment && atBlockLevel(state);
}

function readBlockComment(stream: StringStream, state: ScadState): string {
	while (!stream.eol()) {
		if (stream.match('*/')) {
			state.inBlockComment = false;
			break;
		}
		stream.next();
	}
	return 'comment';
}

function readString(stream: StringStream): void {
	// Opening quote already consumed. An unterminated string ends at end of line,
	// like OpenSCAD's own lexer — no state carries over.
	let escaped = false;
	while (!stream.eol()) {
		const c = stream.next();
		if (escaped) escaped = false;
		else if (c === '\\') escaped = true;
		else if (c === '"') break;
	}
}

function classifyWord(word: string, stream: StringStream, state: ScadState): string {
	const after = stream.string.slice(stream.pos);
	const ctx = top(state);
	const wasParam = state.expectParam;
	state.expectParam = false;
	if (state.pendingDef) {
		significant(state, 'word');
		state.afterDefName = true;
		return 'moduleDef';
	}
	if (DEFINITION_KEYWORDS.has(word)) {
		significant(state, 'word');
		state.pendingDef = true;
		return 'definitionKeyword';
	}
	if (MODULE_KEYWORDS.has(word)) {
		significant(state, 'word');
		state.pendingPath = true;
		return 'moduleKeyword';
	}
	if (CONTROL_KEYWORDS.has(word)) {
		significant(state, word === 'else' ? 'else' : 'word');
		if (BINDING_KEYWORDS.has(word)) state.pendingBinding = true;
		return 'controlKeyword';
	}
	if (BOOL_ATOMS.has(word)) {
		significant(state, 'word');
		return 'bool';
	}
	if (word === 'undef') {
		significant(state, 'word');
		return 'null';
	}
	const afterDot = state.last === '.';
	significant(state, 'word');
	if (afterDot) return 'propertyName';
	if (/^\s*\(/.test(after)) return isBuiltin(word) ? 'builtinCall' : 'call';
	if (/^\s*=(?!=)/.test(after)) {
		return ctx && ctx.type === '(' && ctx.kind === 'call' ? 'propertyName' : 'variableDef';
	}
	if (wasParam && ctx?.kind === 'params') return 'variableDef';
	if (CONSTANTS.has(word)) return 'constant';
	if (isBuiltin(word)) return 'builtinCall';
	return 'variableName';
}

function token(stream: StringStream, state: ScadState): string | null {
	if (stream.sol()) {
		state.indented = stream.indentation();
		state.sol = true;
	}
	if (state.inBlockComment) return readBlockComment(stream, state);
	if (stream.eatSpace()) return null;

	const sol = state.sol;
	state.sol = false;

	if (stream.match('//')) {
		const rest = stream.string.slice(stream.pos);
		stream.skipToEnd();
		if (ANNOTATION_RE.test(rest)) return sol ? 'docComment' : 'annotation';
		return 'comment';
	}
	if (stream.match('/*')) {
		if (sol && GROUP_BLOCK_RE.test(stream.string.slice(stream.pos))) {
			stream.skipToEnd();
			return 'docComment';
		}
		state.inBlockComment = true;
		return readBlockComment(stream, state);
	}

	if (state.pendingPath && stream.match(INCLUDE_PATH_RE)) {
		significant(state, 'string');
		return 'includePath';
	}

	const ch = stream.peek() ?? '';
	if (ch === '"') {
		stream.next();
		readString(stream);
		significant(state, 'string');
		return 'string';
	}
	if (/\d/.test(ch) || (ch === '.' && /\d/.test(stream.string.charAt(stream.pos + 1)))) {
		stream.match(NUMBER_RE);
		significant(state, 'number');
		return 'number';
	}
	if (ch === '$') {
		if (stream.match(SPECIAL_RE)) {
			significant(state, 'word');
			return 'special';
		}
		stream.next();
		significant(state, 'operator');
		return 'invalid';
	}
	if (/[A-Za-z_]/.test(ch)) {
		stream.match(IDENT_RE);
		return classifyWord(stream.current(), stream, state);
	}
	if (
		(ch === '#' || ch === '!' || ch === '%' || ch === '*') &&
		isModifierPosition(state, ch, stream.string.charAt(stream.pos + 1))
	) {
		stream.next();
		significant(state, 'modifier');
		return 'modifier';
	}
	if (ch === '(' || ch === '[' || ch === '{') {
		stream.next();
		const kind: Ctx['kind'] =
			ch === '['
				? 'vector'
				: ch === '{'
					? 'block'
					: state.pendingDef || state.afterDefName
						? 'params'
						: state.pendingBinding
							? 'binding'
							: 'call';
		const rest = stream.string.slice(stream.pos);
		const leading = /^[ \t]*/.exec(rest)?.[0].length ?? 0;
		const align = /^[ \t]*[^\s/]/.test(rest);
		// column() is the token start, i.e. the bracket itself; content starts after it.
		const column = stream.column() + 1 + leading;
		significant(state, ch);
		if (ch === '{') endStatement(state);
		if (kind === 'params') state.expectParam = true;
		state.stack.push({ type: ch, kind, indented: state.indented, column, align });
		return bracketToken(ch);
	}
	if (ch === ')' || ch === ']' || ch === '}') {
		stream.next();
		const opener: Bracket = ch === ')' ? '(' : ch === ']' ? '[' : '{';
		const ctx = top(state);
		// Unbalanced input must not corrupt outer contexts.
		if (ctx && ctx.type === opener) state.stack.pop();
		state.expectParam = false;
		significant(state, ch);
		if (ch === '}') endStatement(state);
		return bracketToken(ch);
	}
	if (ch === ';') {
		stream.next();
		const block = atBlockLevel(state);
		state.expectParam = false;
		significant(state, ';');
		if (block) endStatement(state);
		return 'punctuation';
	}
	if (ch === ',') {
		stream.next();
		significant(state, ',');
		if (top(state)?.kind === 'params') state.expectParam = true;
		return 'separator';
	}
	if (stream.match(OPERATOR_RE)) {
		const text = stream.current();
		significant(state, text === '.' ? '.' : 'operator');
		if (text === '=' && atBlockLevel(state)) state.inAssignment = true;
		return 'operator';
	}
	if (stream.match(NON_ASCII_RE)) {
		significant(state, 'word');
		return 'invalid';
	}
	stream.next();
	return null;
}

function indent(state: ScadState, textAfter: string, cx: IndentContext): number | null {
	if (state.inBlockComment) return null;
	const ctx = top(state);
	const first = textAfter.charAt(0);
	const unit = cx.unit;
	// `translate([0, 0, 1])⏎` — a statement not yet closed by `;` or `{` continues indented.
	const hanging = state.stmtState === 'open' && atBlockLevel(state);
	if (!ctx) {
		if (hanging) return first === '{' ? state.stmtIndent : state.stmtIndent + unit;
		return 0;
	}
	const closer = ctx.type === '{' ? '}' : ctx.type === '(' ? ')' : ']';
	if (first === closer) return ctx.indented;
	if (ctx.type === '{') {
		return hanging ? state.stmtIndent + (first === '{' ? 0 : unit) : ctx.indented + unit;
	}
	if (ctx.align) return ctx.column;
	return ctx.indented + unit;
}

/**
 * Token name → highlighting tag. Names are chosen to avoid CodeMirror's
 * legacy table (`builtin`, `def`, `variable`, `property`, …), which the
 * stream parser resolves before consulting this table.
 */
export const scadTokenTable: Record<string, Tag> = {
	annotation: t.special(t.comment),
	builtinCall: t.standard(t.function(t.variableName)),
	call: t.function(t.variableName),
	moduleDef: t.definition(t.function(t.variableName)),
	variableDef: t.definition(t.variableName),
	special: t.special(t.variableName),
	constant: t.constant(t.variableName),
	includePath: t.special(t.string)
	// controlKeyword definitionKeyword moduleKeyword modifier bool null number string comment
	// docComment propertyName variableName operator punctuation separator paren squareBracket
	// brace invalid — resolve to the standard tags by name.
};

export const scadParser: StreamParser<ScadState> = {
	name: 'openscad',
	startState,
	copyState: (state) => ({ ...state, stack: state.stack.slice() }),
	token,
	indent,
	languageData: {
		commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
		closeBrackets: { brackets: ['(', '[', '{', '"'] },
		indentOnInput: /^\s*[}\])]$/,
		wordChars: '$'
	},
	tokenTable: scadTokenTable
};

/**
 * Indent unit used by a source: templates are 4 spaces, the default snippet
 * is 2, tabs win when present.
 */
export function detectIndentUnit(text: string): string {
	let two = false;
	let four = false;
	for (const line of text.split('\n')) {
		const m = /^([ \t]+)\S/.exec(line);
		if (!m) continue;
		if (m[1].includes('\t')) return '\t';
		const n = m[1].length;
		if (n % 4 === 2) two = true;
		else if (n % 4 === 0) four = true;
	}
	return two || !four ? '  ' : '    ';
}
