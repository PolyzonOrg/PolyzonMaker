// Brings Polyzon Studio's tools in:  node sync-studio.mjs <studio checkout> [ref]
//
// Studio's code lands in src/studio as it is, and its messages become plain modules in src/studio/gen,
// so a newer Studio is one more run of this. Files in src/studio that are not listed here are this app's
// own stand-ins for what only makes sense in Studio (see src/studio/README.md) and are left alone.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [studio, ref = 'origin/main'] = process.argv.slice(2);
if (!studio) throw new Error('usage: node sync-studio.mjs <studio checkout> [ref]');
const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, 'src', 'studio');

/** Studio's src/lib beyond tools/ that the tools use as it is. */
const LIB = [
	'cad/body.ts',
	'cad/build.ts',
	'cad/parts.ts',
	'cad/program.ts',
	'cad/schema.ts',
	'cad/sculpt.ts',
	'chat/build-checks.ts',
	'clipboard.ts',
	'collapsed.ts',
	'latest.ts',
	'own.ts',
	'three-fit.ts',
	'toast.ts',
	'components/Collapsible.svelte',
	'components/ConfirmDialog.svelte',
	'components/Dialog.svelte',
	'components/EmptyState.svelte',
	'components/Rich.svelte',
	'components/Tabs.svelte',
	'components/Tooltip.svelte',
	'components/scad/ScadEditor.svelte',
	'components/scad/ScadParameters.svelte',
	'components/tools/ChoiceField.svelte',
	'components/tools/FieldGroup.svelte',
	'components/tools/FileField.svelte',
	'components/tools/FontField.svelte',
	'components/tools/NumberField.svelte',
	'components/tools/TextField.svelte',
	'components/tools/ToggleField.svelte',
	'components/tools/read-number.ts',
	'components/tools/units.ts',
	'i18n/locale.ts',
	'i18n/rich.ts',
	'i18n/worker.ts',
	'openscad/compile-runs.ts',
	'openscad/diagnostics.ts',
	'openscad/editor',
	'openscad/editor-chrome.ts',
	'openscad/font-gate.ts',
	'openscad/parser.ts',
	'openscad/runner.ts',
	'openscad/runner.worker.ts',
	'openscad/templates',
	'openscad/three-viewer.ts',
	'openscad/view-mesh.ts',
	'openscad/view-mesh.worker.ts',
	'openscad/viewer-look.ts',
	'openscad/views.ts'
];
const STATIC = ['openscad', 'tool-fonts'];
const LANGUAGES = ['en', 'ru'];

/** A field also tells src/studio/agent.ts about itself, so that other programs see the form a person sees. */
function said(field) {
	return [
		[/<\/script>/, () => `\n\tfield({ ${field} });\n</script>`],
		[/<script lang="ts"[^>]*>\n/, (open) => `${open}\timport { field } from '$lib/agent';\n`]
	];
}

/** The changes to Studio's code. For the rest, a file goes through the system's save dialog, not a browser download. */
const PATCHES = {
	'components/tools/NumberField.svelte': said(`kind: 'number', get label() { return label; }, get hint() { return hint; }, get value() { return value; }, set value(v) { value = v as number; }, get min() { return min; }, get max() { return max; }, get step() { return step; }, get unit() { return unit; }`),
	'components/tools/ChoiceField.svelte': said(`kind: 'choice', get label() { return label; }, get hint() { return hint; }, get value() { return value; }, set value(v) { value = v as T; }, get options() { return options; }`),
	'components/tools/ToggleField.svelte': said(`kind: 'toggle', get label() { return label; }, get hint() { return hint; }, get value() { return checked; }, set value(v) { checked = v as boolean; }`),
	'components/tools/TextField.svelte': said(`kind: 'text', get label() { return label; }, get hint() { return hint; }, get value() { return value; }, set value(v) { value = v as string; }, get maxlength() { return maxlength; }`),
	'components/tools/FileField.svelte': said(`kind: 'file', get label() { return label; }, get hint() { return hint; }, get accept() { return accept; }, open: (file) => onfile(file)`),
	// the language in src/cad goes on top of Studio's program, and zod stays out of the app
	'cad/program.ts': [
		[/import \{ CAD_CODE_BANNED \} from '\.\/schema';/, "const CAD_CODE_BANNED = /\\bimport\\b/;"],
		[/(manifold\?: ManifoldToplevel;\n)(\}\n\nexport class CadProgramError)/, (_, a, b) => `${a}\t/** Adds the names of src/cad/lang.ts to what a program sees. */\n\tlang?: (api: CadApi) => CadApi;\n\t/** What the program returned, as parts. */\n\tfinish?: (result: unknown) => unknown;\n${b}`],
		[/compileProgram\(code, cadApi\(r, ctx\)\)/, 'compileProgram(code, ctx.lang ? ctx.lang(cadApi(r, ctx)) : cadApi(r, ctx))'],
		[/return partsOf\(r, result\);/, 'return partsOf(r, ctx.finish ? ctx.finish(result) : result);'],
		[/parts\.length > 64/, 'parts.length > 4000'],
		[/\nconst SHADOWED = \[/, '\nexport const SHADOWED = ['],
		[/return \{ name: clean\(fallback, 'part'\), shape: v \};/, "return { name: clean(fallback, 'part'), shape: v };"],
		[/name: clean\(p\.name, clean\(fallback, 'part'\)\),\n\t\t\t\tshape: p\.shape!,/, "...p,\n\t\t\t\tname: clean(p.name, clean(fallback, 'part')),\n\t\t\t\tshape: p.shape!,"],
		[/at most 64 parts/, 'at most 4000 bodies']
	],
	// the editor takes other languages: CAD programs are JavaScript
	'openscad/editor/index.ts': [
		[/(export interface ScadEditorOptions \{\n)/, (_, a) => `${a}\t/** Stands in for OpenSCAD. */\n\tlanguage?: Extension;\n`],
		[/\n\t\tscad\(\),\n/, '\n\t\topts.language ?? scad(),\n'],
		[/\n\t\tscadAutocompletion\(\),\n/, '\n\t\topts.language ? [] : scadAutocompletion(),\n']
	],
	'components/scad/ScadEditor.svelte': [
		[/(\t\tactions\?: Snippet;\n)/, (_, a) => `${a}\t\t/** Stands in for OpenSCAD. */\n\t\tlanguage?: import('@codemirror/state').Extension;\n\t\theading?: string;\n`],
		[/\{m\.scad_editor_title\(\)\}/, '{heading ?? m.scad_editor_title()}'],
		[/(\t\tonSave,\n\t\tactions\n)/, () => '\t\tonSave,\n\t\tactions,\n\t\tlanguage,\n\t\theading\n'],
		[/(createScadEditor\(host, \{\n\t+doc: value,\n)/, (_, a) => `${a}\t\t\t\t\tlanguage,\n`]
	],
	// a parameter's words wrap instead of being cut off: a model writes long ones, and the panel is narrow
	'components/scad/ScadParameters.svelte': [
		[/<span class="block truncate text-sm font-medium text-neutral-100"/, '<span class="block text-sm font-medium text-neutral-100"'],
		[/<span class="block truncate text-xs text-neutral-400">\{parameter\.name\}<\/span>/, '<span class="block truncate text-xs text-neutral-400" title={parameter.name}>{parameter.name}</span>']
	],
	// a picture costs a model tokens by its size: no empty cells
	'openscad/views.ts': [
		[/const CELL = 384;/, 'let CELL = 384;'],
		[/const SCENE = '#26262a';/, "let SCENE = '#26262a';"],
		[/new THREE\.PerspectiveCamera\(30, 1, 0\.1, distance \* 4\)/, 'new THREE.PerspectiveCamera(30, 1, radius / 10, distance * 4)'],
		[/(-radius \* 1\.1,\n\s*)0\.1,(\n\s*distance \* 2)/, (_, a, b) => `${a}radius / 10,${b}`],
		[/const edges = edgeLines\(geometry, MODEL\);/, 'const edges = opts.cell ? null : edgeLines(geometry, MODEL);'],
		[/opts: \{ parts\?: ViewPart\[\]; look\?: Look \} = \{\}\n\): Promise<Blob> \{\n/, 'opts: { parts?: ViewPart[]; look?: Look; cell?: number } = {}\n): Promise<Blob> {\n\tCELL = opts.cell ?? 384;\n\tSCENE = opts.cell ? \'#5a5b61\' : \'#26262a\';\n'],
		[/canvas\.width = CELL \* 2;/, 'const across = legendHeight ? 2 : Math.min(viewsOf(look).length, 2);\n\t\tconst down = Math.ceil(viewsOf(look).length / 2);\n\t\tcanvas.width = CELL * across;'],
		[/canvas\.height = CELL \* 2 \+ legendHeight;/, 'canvas.height = CELL * down + legendHeight;'],
		[/ctx\.fillRect\(CELL - 1, 0, 2, CELL \* 2\);/, 'if (across > 1) ctx.fillRect(CELL - 1, 0, 2, CELL * down);'],
		[/ctx\.fillRect\(0, CELL - 1, CELL \* 2, 2\);/, 'if (down > 1) ctx.fillRect(0, CELL - 1, CELL * 2, 2);'],
		[/ctx\.fillRect\(0, CELL \* 2 - 1, CELL \* 2, 2\);/, 'ctx.fillRect(0, CELL * down - 1, CELL * 2, 2);'],
		[/CELL \* 2 \+ 12 \+/, 'CELL * down + 12 +'],
		[/CELL \* 2 \+ 25 \+/, 'CELL * down + 25 +']
	],
	// the tools that are pages and not form and scene: their styles need the room too
	'tools/print-kit/ToolPage.svelte': [
		[/<div class="h-full overflow-y-auto">/, '<div class="studio h-full overflow-y-auto">'],
		[/ · Polyzon Studio/, ' · Polyzon Maker']
	],
	// no account here to keep a book in: it stays on this computer, and a sticker's code is the spool's number
	'tools/shared/account-book.ts': [[/async function run\(\): Promise<B> \{\n/, (open) => `${open}\t\tif (store.endpoint) return store.load();\n`]],
	'tools/spool-tracker/label.ts': [[/return `\$\{origin\}\/workspace\/tools\/spool-tracker\?spool=\$\{encodeURIComponent\(spoolId\)\}`;/, 'return spoolId;']],
	'tools/stl.ts': [
		[
			/export function downloadBytes\([\s\S]*?\n}\n/,
			`export function downloadBytes(bytes: Uint8Array | string, filename: string, _mime: string): void {\n\tvoid saveFile(filename, bytes);\n}\n`
		],
		[/^/, `import { saveFile } from '$lib/save';\n`]
	]
};

const tmp = mkdtempSync(join(tmpdir(), 'studio-'));
const paths = ['src/lib/tools', ...LIB.map((f) => `src/lib/${f}`), 'src/lib/styles/components.css', 'messages', ...STATIC.map((d) => `static/${d}`)];
execFileSync('git', ['-C', studio, '-c', 'core.autocrlf=false', 'archive', '-o', join(tmp, 'x.tar'), ref, ...paths]);
execFileSync('tar', ['-xf', 'x.tar'], { cwd: tmp });

rmSync(join(dest, 'tools'), { recursive: true, force: true });
rmSync(join(dest, 'gen'), { recursive: true, force: true });
cpSync(join(tmp, 'src/lib/tools'), join(dest, 'tools'), { recursive: true });
for (const file of LIB) cpSync(join(tmp, 'src/lib', file), join(dest, file), { recursive: true });
for (const dir of STATIC) cpSync(join(tmp, 'static', dir), join(here, 'public', dir), { recursive: true });

// Studio's component styles, kept inside the tools' own room: their class names would clash with the app's
mkdirSync(join(dest, 'styles'), { recursive: true });
writeFileSync(join(dest, 'styles', 'components.css'), `.studio {
${unlayered(readFileSync(join(tmp, 'src/lib/styles/components.css'), 'utf8'))}
}
`);

// A browser holds about 16 graphics contexts and drops the oldest, whatever it shows: a viewer gives its own back.
for (const file of ['openscad/three-viewer.ts', 'tools/booleans/parts-viewer.ts', 'tools/gcode-viewer/viewer.ts'])
	(PATCHES[file] ??= []).push([/this\.renderer\.dispose\(\);/, 'this.renderer.dispose();\n\t\tthis.renderer.forceContextLoss();']);

for (const [file, changes] of Object.entries(PATCHES)) {
	let text = readFileSync(join(dest, file), 'utf8');
	for (const [from, to] of changes) {
		if (!from.test(text)) throw new Error(`${file}: ${from} no longer matches`);
		text = text.replace(from, typeof to === 'function' ? to : () => to);
	}
	writeFileSync(join(dest, file), text);
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const groups = new Set();
for (const file of walk(dest).filter((f) => /\.(ts|svelte)$/.test(f) && !f.includes(`${join('studio', 'gen')}`)))
	for (const [, group] of readFileSync(file, 'utf8').matchAll(/['"]\$msg\/([\w/-]+)['"]/g)) groups.add(group);

/** The rules of a stylesheet without their @layer blocks around them. */
function unlayered(css) {
	css = css.replace(/\/\*[\s\S]*?\*\//g, '');
	for (let at = css.indexOf('@layer'); at >= 0; at = css.indexOf('@layer')) {
		const open = css.indexOf('{', at);
		let depth = 1;
		let end = open + 1;
		for (; depth; end++) depth += css[end] === '{' ? 1 : css[end] === '}' ? -1 : 0;
		css = css.slice(0, at) + css.slice(open + 1, end - 1) + css.slice(end);
	}
	return css;
}

/** Studio runs in a browser, this app does not, and what it promises is the same thing in other words. */
const WORDS = [
	['в браузере', 'на этом компьютере'],
	['покидает браузер', 'покидает компьютер'],
	['in your browser', 'on this computer'],
	['leaves your browser', 'leaves this computer'],
	['Polyzon Studio', 'Polyzon Maker'],
	['обновите страницу и попробуйте снова', 'откройте инструмент заново и попробуйте снова'],
	['обновите страницу', 'откройте инструмент заново'],
	['reload the page', 'open the tool again'],
	['пока открыта страница', 'пока открыта программа'],
	['while the page is open', 'while the app is open']
];

/** Where Studio promises what only an account gives. The first text is English, the second Russian. */
const REWORD = {
	t_spool_tracker_lead: [
		'How much filament is left on each spool and what it cost you, a usage history, and filament reserved for prints in progress. All of it stays on this computer.',
		'Сколько нити осталось на каждой катушке и во что она обошлась, история расхода и нить, отложенная под идущую печать. Всё это хранится на этом компьютере.'
	],
	t_spool_tracker_backup_lead: [
		'Spools are kept on this computer. The 50 × 30 mm stickers go on self-adhesive paper, and the QR code holds the spool’s number. The JSON file is a backup, just in case.',
		'Катушки хранятся на этом компьютере. Наклейки 50 × 30 мм — на самоклеящуюся бумагу, в QR записан номер катушки. JSON — копия на всякий случай.'
	],
	t_spool_tracker_restore_text: [
		'Spools in the file: {count}. Your spools and history will be replaced with the file’s contents.',
		'В файле катушек: {count}. Катушки и история заменятся содержимым файла.'
	]
};
const inThisApp = (text) => WORDS.reduce((said, [from, to]) => said.replaceAll(from, to), text);

/** A message is text, or a text per plural category of its `count`. */
function forms(words, name) {
	if (typeof words === 'string') return inThisApp(words);
	const [variant] = words;
	if (!/Plural$/.test(variant?.selectors?.[0])) throw new Error(`${name} is neither text nor a plural`);
	return Object.fromEntries(Object.entries(variant.match).map(([when, text]) => [when.split('=')[1].replace('*', 'other'), inThisApp(text)]));
}

let messages = 0;
for (const group of groups) {
	const read = (lang) => {
		const file = join(tmp, 'messages', group, `${lang}.json`);
		return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
	};
	const tables = LANGUAGES.map(read);
	const keys = [...new Set(tables.flatMap((t) => Object.keys(t)))].filter((k) => k !== '$schema');
	const lines = keys.map((key) => {
		const words = REWORD[key] ?? tables.map((t) => forms(t[key] ?? tables.find((other) => other[key])?.[key], `${group}/${key}`));
		return `export const ${key} = (p?: Params, o?: Options) => say(${words.map((w) => JSON.stringify(w)).join(', ')}, p, o);`;
	});
	const out = join(dest, 'gen', `${group}.ts`);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `// Made by sync-studio.mjs from Polyzon Studio's messages.\nimport { say, type Options, type Params } from '$lib/i18n/say';\n\n${lines.join('\n')}\n`);
	messages += keys.length;
}
rmSync(tmp, { recursive: true, force: true });
console.log(`${groups.size} message groups, ${messages} messages`);
