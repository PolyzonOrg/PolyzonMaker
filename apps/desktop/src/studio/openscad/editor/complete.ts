/**
 * Autocompletion for OpenSCAD: builtin modules/functions with signatures and
 * one-liners in the page's language (most as snippets), keywords, special
 * variables and the symbols defined in the document itself.
 */
import {
	autocompletion,
	snippetCompletion,
	type Completion,
	type CompletionContext,
	type CompletionResult
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { Extension, Text } from '@codemirror/state';
import { currentLocale } from '$lib/i18n/current';
import * as m from '$msg/scad';

export interface DocSymbol {
	name: string;
	kind: 'module' | 'function' | 'variable';
	from: number;
	to: number;
}

/** Modules/functions first, then top-level-looking assignments (`name =`). Pure. */
export function collectSymbols(source: string): DocSymbol[] {
	const out: DocSymbol[] = [];
	for (const m of source.matchAll(/\b(module|function)\s+([A-Za-z_]\w*)/g)) {
		const to = m.index + m[0].length;
		out.push({ name: m[2], kind: m[1] as 'module' | 'function', from: to - m[2].length, to });
	}
	for (const m of source.matchAll(/^[ \t]*([A-Za-z_$][\w]*)\s*=(?!=)/gm)) {
		const from = m.index + m[0].indexOf(m[1]);
		out.push({ name: m[1], kind: 'variable', from, to: from + m[1].length });
	}
	return out;
}

/** `Text` is immutable: a new instance per change doubles as the cache version. */
const symbolCache = new WeakMap<Text, DocSymbol[]>();
function docSymbols(doc: Text): DocSymbol[] {
	let symbols = symbolCache.get(doc);
	if (!symbols) {
		symbols = collectSymbols(doc.toString());
		symbolCache.set(doc, symbols);
	}
	return symbols;
}

interface BuiltinSpec {
	label: string;
	detail?: string;
	info: string;
	snippet?: string;
	type: 'function' | 'keyword' | 'variable' | 'constant' | 'text';
}

const BLOCK = ' {\n\t${}\n}';

/** Built per language: messages are read when called, never at import. */
const builtinSpecs = (): BuiltinSpec[] => [
	// 3D primitives
	{
		label: 'cube',
		detail: 'cube(size, center)',
		info: m.scad_complete_cube(),
		snippet: 'cube([${x}, ${y}, ${z}], center = ${false})',
		type: 'function'
	},
	{
		label: 'sphere',
		detail: 'sphere(r | d)',
		info: m.scad_complete_sphere(),
		snippet: 'sphere(d = ${d})',
		type: 'function'
	},
	{
		label: 'cylinder',
		detail: 'cylinder(h, r | d, r1, r2 | d1, d2, center)',
		info: m.scad_complete_cylinder(),
		snippet: 'cylinder(h = ${h}, d = ${d})',
		type: 'function'
	},
	{
		label: 'polyhedron',
		detail: 'polyhedron(points, faces, convexity)',
		info: m.scad_complete_polyhedron(),
		snippet: 'polyhedron(points = [${}], faces = [${}])',
		type: 'function'
	},
	// 2D primitives
	{
		label: 'square',
		detail: 'square(size, center)',
		info: m.scad_complete_square(),
		snippet: 'square([${x}, ${y}], center = ${false})',
		type: 'function'
	},
	{
		label: 'circle',
		detail: 'circle(r | d)',
		info: m.scad_complete_circle(),
		snippet: 'circle(d = ${d})',
		type: 'function'
	},
	{
		label: 'polygon',
		detail: 'polygon(points, paths, convexity)',
		info: m.scad_complete_polygon(),
		snippet: 'polygon(points = [${}])',
		type: 'function'
	},
	{
		label: 'text',
		detail: 'text(text, size, font, halign, valign, spacing, direction, language, script)',
		info: m.scad_complete_text(),
		snippet: `text(\${"${m.scad_complete_text_sample()}"}, size = \${10}, font = "Noto Sans", halign = "center", valign = "center")`,
		type: 'function'
	},
	// transformations
	{
		label: 'translate',
		detail: 'translate(v)',
		info: m.scad_complete_translate(),
		snippet: 'translate([${x}, ${y}, ${z}]) ${}',
		type: 'function'
	},
	{
		label: 'rotate',
		detail: 'rotate(a, v)',
		info: m.scad_complete_rotate(),
		snippet: 'rotate([${0}, ${0}, ${a}]) ${}',
		type: 'function'
	},
	{
		label: 'scale',
		detail: 'scale(v)',
		info: m.scad_complete_scale(),
		snippet: 'scale([${1}, ${1}, ${1}]) ${}',
		type: 'function'
	},
	{
		label: 'mirror',
		detail: 'mirror(v)',
		info: m.scad_complete_mirror(),
		snippet: 'mirror([${1}, ${0}, ${0}]) ${}',
		type: 'function'
	},
	{
		label: 'multmatrix',
		detail: 'multmatrix(m)',
		info: m.scad_complete_multmatrix(),
		snippet: 'multmatrix(${m}) ${}',
		type: 'function'
	},
	{
		label: 'color',
		detail: 'color(c, alpha)',
		info: m.scad_complete_color(),
		snippet: 'color(${"red"}) ${}',
		type: 'function'
	},
	{
		label: 'offset',
		detail: 'offset(r | delta, chamfer)',
		info: m.scad_complete_offset(),
		snippet: 'offset(r = ${1}) ${}',
		type: 'function'
	},
	{
		label: 'resize',
		detail: 'resize(newsize, auto, convexity)',
		info: m.scad_complete_resize(),
		snippet: 'resize([${x}, ${y}, ${z}]) ${}',
		type: 'function'
	},
	// booleans and combinators
	{
		label: 'union',
		detail: 'union()',
		info: m.scad_complete_union(),
		snippet: 'union()' + BLOCK,
		type: 'function'
	},
	{
		label: 'difference',
		detail: 'difference()',
		info: m.scad_complete_difference(),
		snippet: 'difference()' + BLOCK,
		type: 'function'
	},
	{
		label: 'intersection',
		detail: 'intersection()',
		info: m.scad_complete_intersection(),
		snippet: 'intersection()' + BLOCK,
		type: 'function'
	},
	{
		label: 'hull',
		detail: 'hull()',
		info: m.scad_complete_hull(),
		snippet: 'hull()' + BLOCK,
		type: 'function'
	},
	{
		label: 'minkowski',
		detail: 'minkowski(convexity)',
		info: m.scad_complete_minkowski(),
		snippet: 'minkowski()' + BLOCK,
		type: 'function'
	},
	{
		label: 'render',
		detail: 'render(convexity)',
		info: m.scad_complete_render(),
		snippet: 'render() ${}',
		type: 'function'
	},
	// extrusion and projection
	{
		label: 'linear_extrude',
		detail: 'linear_extrude(height, center, convexity, twist, slices, scale)',
		info: m.scad_complete_linear_extrude(),
		snippet: 'linear_extrude(height = ${h}) ${}',
		type: 'function'
	},
	{
		label: 'rotate_extrude',
		detail: 'rotate_extrude(angle, convexity)',
		info: m.scad_complete_rotate_extrude(),
		snippet: 'rotate_extrude(angle = ${360}) ${}',
		type: 'function'
	},
	{
		label: 'projection',
		detail: 'projection(cut)',
		info: m.scad_complete_projection(),
		snippet: 'projection(cut = ${false}) ${}',
		type: 'function'
	},
	// language-level modules
	{
		label: 'children',
		detail: 'children(index)',
		info: m.scad_complete_children(),
		snippet: 'children(${})',
		type: 'function'
	},
	{
		label: 'echo',
		detail: 'echo(…)',
		info: m.scad_complete_echo(),
		snippet: 'echo(${});',
		type: 'function'
	},
	{
		label: 'assert',
		detail: 'assert(condition, message)',
		info: m.scad_complete_assert(),
		snippet: `assert(\${cond}, \${"${m.scad_complete_assert_sample()}"});`,
		type: 'function'
	},
	// math
	{
		label: 'abs',
		detail: 'abs(x)',
		info: m.scad_complete_abs(),
		snippet: 'abs(${x})',
		type: 'function'
	},
	{
		label: 'sign',
		detail: 'sign(x)',
		info: m.scad_complete_sign(),
		snippet: 'sign(${x})',
		type: 'function'
	},
	{
		label: 'sin',
		detail: 'sin(deg)',
		info: m.scad_complete_sin(),
		snippet: 'sin(${a})',
		type: 'function'
	},
	{
		label: 'cos',
		detail: 'cos(deg)',
		info: m.scad_complete_cos(),
		snippet: 'cos(${a})',
		type: 'function'
	},
	{
		label: 'tan',
		detail: 'tan(deg)',
		info: m.scad_complete_tan(),
		snippet: 'tan(${a})',
		type: 'function'
	},
	{
		label: 'asin',
		detail: 'asin(x)',
		info: m.scad_complete_asin(),
		snippet: 'asin(${x})',
		type: 'function'
	},
	{
		label: 'acos',
		detail: 'acos(x)',
		info: m.scad_complete_acos(),
		snippet: 'acos(${x})',
		type: 'function'
	},
	{
		label: 'atan',
		detail: 'atan(x)',
		info: m.scad_complete_atan(),
		snippet: 'atan(${x})',
		type: 'function'
	},
	{
		label: 'atan2',
		detail: 'atan2(y, x)',
		info: m.scad_complete_atan2(),
		snippet: 'atan2(${y}, ${x})',
		type: 'function'
	},
	{
		label: 'floor',
		detail: 'floor(x)',
		info: m.scad_complete_floor(),
		snippet: 'floor(${x})',
		type: 'function'
	},
	{
		label: 'ceil',
		detail: 'ceil(x)',
		info: m.scad_complete_ceil(),
		snippet: 'ceil(${x})',
		type: 'function'
	},
	{
		label: 'round',
		detail: 'round(x)',
		info: m.scad_complete_round(),
		snippet: 'round(${x})',
		type: 'function'
	},
	{
		label: 'ln',
		detail: 'ln(x)',
		info: m.scad_complete_ln(),
		snippet: 'ln(${x})',
		type: 'function'
	},
	{
		label: 'log',
		detail: 'log(x) | log(b, x)',
		info: m.scad_complete_log(),
		snippet: 'log(${x})',
		type: 'function'
	},
	{
		label: 'pow',
		detail: 'pow(base, exp)',
		info: m.scad_complete_pow(),
		snippet: 'pow(${x}, ${2})',
		type: 'function'
	},
	{
		label: 'sqrt',
		detail: 'sqrt(x)',
		info: m.scad_complete_sqrt(),
		snippet: 'sqrt(${x})',
		type: 'function'
	},
	{
		label: 'exp',
		detail: 'exp(x)',
		info: m.scad_complete_exp(),
		snippet: 'exp(${x})',
		type: 'function'
	},
	{
		label: 'rands',
		detail: 'rands(min, max, count, seed)',
		info: m.scad_complete_rands(),
		snippet: 'rands(${0}, ${1}, ${1})',
		type: 'function'
	},
	{
		label: 'min',
		detail: 'min(a, b, …) | min(v)',
		info: m.scad_complete_min(),
		snippet: 'min(${a}, ${b})',
		type: 'function'
	},
	{
		label: 'max',
		detail: 'max(a, b, …) | max(v)',
		info: m.scad_complete_max(),
		snippet: 'max(${a}, ${b})',
		type: 'function'
	},
	{
		label: 'norm',
		detail: 'norm(v)',
		info: m.scad_complete_norm(),
		snippet: 'norm(${v})',
		type: 'function'
	},
	{
		label: 'cross',
		detail: 'cross(a, b)',
		info: m.scad_complete_cross(),
		snippet: 'cross(${a}, ${b})',
		type: 'function'
	},
	{
		label: 'concat',
		detail: 'concat(v1, v2, …)',
		info: m.scad_complete_concat(),
		snippet: 'concat(${a}, ${b})',
		type: 'function'
	},
	{
		label: 'lookup',
		detail: 'lookup(key, table)',
		info: m.scad_complete_lookup(),
		snippet: 'lookup(${key}, ${table})',
		type: 'function'
	},
	{
		label: 'len',
		detail: 'len(v)',
		info: m.scad_complete_len(),
		snippet: 'len(${v})',
		type: 'function'
	},
	{
		label: 'str',
		detail: 'str(…)',
		info: m.scad_complete_str(),
		snippet: 'str(${})',
		type: 'function'
	},
	{
		label: 'chr',
		detail: 'chr(code)',
		info: m.scad_complete_chr(),
		snippet: 'chr(${65})',
		type: 'function'
	},
	{
		label: 'ord',
		detail: 'ord(ch)',
		info: m.scad_complete_ord(),
		snippet: 'ord(${ch})',
		type: 'function'
	},
	{
		label: 'search',
		detail: 'search(match, table, num, col)',
		info: m.scad_complete_search(),
		snippet: 'search(${x}, ${v})',
		type: 'function'
	},
	{
		label: 'version',
		detail: 'version()',
		info: m.scad_complete_version(),
		snippet: 'version()',
		type: 'function'
	},
	{
		label: 'version_num',
		detail: 'version_num()',
		info: m.scad_complete_version_num(),
		snippet: 'version_num()',
		type: 'function'
	},
	{
		label: 'is_undef',
		detail: 'is_undef(x)',
		info: m.scad_complete_is_undef(),
		snippet: 'is_undef(${x})',
		type: 'function'
	},
	{
		label: 'is_list',
		detail: 'is_list(x)',
		info: m.scad_complete_is_list(),
		snippet: 'is_list(${x})',
		type: 'function'
	},
	{
		label: 'is_num',
		detail: 'is_num(x)',
		info: m.scad_complete_is_num(),
		snippet: 'is_num(${x})',
		type: 'function'
	},
	{
		label: 'is_bool',
		detail: 'is_bool(x)',
		info: m.scad_complete_is_bool(),
		snippet: 'is_bool(${x})',
		type: 'function'
	},
	{
		label: 'is_string',
		detail: 'is_string(x)',
		info: m.scad_complete_is_string(),
		snippet: 'is_string(${x})',
		type: 'function'
	},
	{
		label: 'is_function',
		detail: 'is_function(x)',
		info: m.scad_complete_is_function(),
		snippet: 'is_function(${x})',
		type: 'function'
	},
	{
		label: 'parent_module',
		detail: 'parent_module(n)',
		info: m.scad_complete_parent_module(),
		snippet: 'parent_module(${0})',
		type: 'function'
	},
	// keywords
	{
		label: 'module',
		detail: 'module name() { … }',
		info: m.scad_complete_module(),
		snippet: 'module ${name}(${})' + BLOCK,
		type: 'keyword'
	},
	{
		label: 'function',
		detail: 'function name() = …;',
		info: m.scad_complete_function(),
		snippet: 'function ${name}(${}) = ${};',
		type: 'keyword'
	},
	{
		label: 'for',
		detail: 'for (i = [a : b]) { … }',
		info: m.scad_complete_for(),
		snippet: 'for (${i} = [${0} : ${n}])' + BLOCK,
		type: 'keyword'
	},
	{
		label: 'intersection_for',
		detail: 'intersection_for (i = [a : b]) { … }',
		info: m.scad_complete_intersection_for(),
		snippet: 'intersection_for (${i} = [${0} : ${n}])' + BLOCK,
		type: 'keyword'
	},
	{
		label: 'if',
		detail: 'if (cond) { … }',
		info: m.scad_complete_if(),
		snippet: 'if (${cond})' + BLOCK,
		type: 'keyword'
	},
	{
		label: 'else',
		detail: 'else { … }',
		info: m.scad_complete_else(),
		snippet: 'else' + BLOCK,
		type: 'keyword'
	},
	{
		label: 'let',
		detail: 'let (x = …) …',
		info: m.scad_complete_let(),
		snippet: 'let (${x} = ${}) ${}',
		type: 'keyword'
	},
	{ label: 'each', info: m.scad_complete_each(), type: 'keyword' },
	{ label: 'true', info: m.scad_complete_true(), type: 'constant' },
	{ label: 'false', info: m.scad_complete_false(), type: 'constant' },
	{ label: 'undef', info: m.scad_complete_undef(), type: 'constant' },
	{ label: 'PI', detail: '3.14159…', info: m.scad_complete_pi(), type: 'constant' },
	// special variables
	{ label: '$fn', info: m.scad_complete_special_fn(), type: 'variable' },
	{
		label: '$fa',
		info: m.scad_complete_special_fa(),
		type: 'variable'
	},
	{ label: '$fs', info: m.scad_complete_special_fs(), type: 'variable' },
	{ label: '$t', info: m.scad_complete_special_t(), type: 'variable' },
	{ label: '$vpr', info: m.scad_complete_special_vpr(), type: 'variable' },
	{ label: '$vpt', info: m.scad_complete_special_vpt(), type: 'variable' },
	{ label: '$vpd', info: m.scad_complete_special_vpd(), type: 'variable' },
	{ label: '$vpf', info: m.scad_complete_special_vpf(), type: 'variable' },
	{ label: '$children', info: m.scad_complete_special_children(), type: 'variable' },
	{
		label: '$preview',
		info: m.scad_complete_special_preview(),
		type: 'variable'
	},
	// Customizer helpers
	{
		label: 'param',
		detail: `// ${m.scad_complete_param_caption()}⏎name = 10; // [0:1:100]`,
		info: m.scad_complete_param(),
		snippet: `// \${${m.scad_complete_param_sample()}}\n\${name} = \${10}; // [\${0}:\${1}:\${100}]`,
		type: 'text'
	},
	{
		label: 'group',
		detail: `/* [${m.scad_complete_group_sample()}] */`,
		info: m.scad_complete_group(),
		snippet: `/* [\${${m.scad_complete_group_sample()}}] */`,
		type: 'text'
	}
];

let builtins: { locale: string; completions: Completion[] } | null = null;
function builtinCompletions(): Completion[] {
	const locale = currentLocale();
	if (builtins?.locale !== locale) {
		const completions = builtinSpecs().map((spec) => {
			const base: Completion = {
				label: spec.label,
				detail: spec.detail,
				info: spec.info,
				type: spec.type
			};
			return spec.snippet ? snippetCompletion(spec.snippet, base) : base;
		});
		builtins = { locale, completions };
	}
	return builtins.completions;
}

/** Contexts where popping up suggestions would only get in the way. */
const NO_COMPLETE = new Set(['comment', 'docComment', 'annotation', 'string', 'includePath']);

const KIND_LABEL = {
	module: m.scad_complete_kind_module,
	function: m.scad_complete_kind_function,
	variable: m.scad_complete_kind_variable
} as const;

export function scadCompletion(cx: CompletionContext): CompletionResult | null {
	const word = cx.matchBefore(/[\w$]*/);
	if (!word) return null;
	const typed = word.text;
	if (!cx.explicit && typed.length < 2 && typed !== '$') return null;
	if (NO_COMPLETE.has(syntaxTree(cx.state).resolveInner(cx.pos, -1).name)) return null;

	const seen = new Set<string>();
	const options: Completion[] = [];
	for (const symbol of docSymbols(cx.state.doc)) {
		// The identifier being typed must not offer to complete itself.
		if (symbol.from <= cx.pos && cx.pos <= symbol.to) continue;
		if (seen.has(symbol.name)) continue;
		seen.add(symbol.name);
		options.push({
			label: symbol.name,
			type: symbol.kind === 'variable' ? 'variable' : 'function',
			detail: KIND_LABEL[symbol.kind](),
			boost: 2
		});
	}
	// A user definition shadows the builtin of the same name.
	for (const completion of builtinCompletions()) {
		if (!seen.has(completion.label)) options.push(completion);
	}
	return { from: word.from, options, validFor: /^[\w$]*$/ };
}

export function scadAutocompletion(): Extension {
	return autocompletion({ override: [scadCompletion], icons: false, maxRenderedOptions: 50 });
}
