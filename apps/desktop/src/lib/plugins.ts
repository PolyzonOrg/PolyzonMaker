import type { Contributes, Grant, Job, Plugin } from './core';

/** What the plugins that are on bring of one kind, each beside its plugin. */
export function contributed<K extends 'panels' | 'commands' | 'themes'>(plugins: readonly Plugin[], grants: Record<string, Grant>, kind: K) {
	const on = plugins.filter((p) => grants[p.id] && !grants[p.id].off);
	return on.flatMap((plugin) => (plugin.contributes?.[kind] ?? []).map((item) => ({ plugin, item: item as Contributes[K][number] })));
}

const host = (url: string) => {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
};

/** What the app downloads for a plugin's models, said before it is installed: from where, and how much. */
export function fetches(plugin: Plugin) {
	const runtimes = plugin.contributes.models.map((m) => m.runtime);
	const weights = runtimes.flatMap((r) => r.weights ?? []);
	return {
		code: [...new Set(runtimes.flatMap((r) => (r.code ? [host(r.code.url)] : [])))],
		weights: { count: weights.length, bytes: weights.reduce((sum, w) => sum + w.size, 0), hosts: [...new Set(weights.map((w) => host(w.url)))] },
		packages: new Set(runtimes.flatMap((r) => r.packages ?? [])).size,
		torch: [...new Set(runtimes.flatMap((r) => (r.torch ? [r.torch] : [])))]
	};
}

/** How the settings name a plugin's theme. */
export const themeKey = (plugin: string, theme: string) => `plugin:${plugin}/${theme}`;

const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The theme a setting names, of a plugin that is on, with only plain colours for the app's own tokens: the
 * app checked them at install, and a value is set as a style here, so it is checked again.
 */
export function pluginTheme(setting: string, plugins: readonly Plugin[], grants: Record<string, Grant>) {
	const found = contributed(plugins, grants, 'themes').find(({ plugin, item }) => themeKey(plugin.id, item.id) === setting)?.item;
	if (!found) return null;
	const colors = Object.entries(found.colors).filter(([token, value]) => /^--[a-z0-9-]+$/.test(token) && COLOR.test(value));
	return { base: found.base, colors };
}

/** Files of a job a plugin may read: what was made, never what is kept about it. */
const FINISHED = ['model.glb', 'picture.png', 'print.stl', 'print.3mf'];
const MAX_TITLE = 200;
const MAX_MODEL = 256 << 20;

/** GLB stays as it is, anything else is read as STL: the app keeps every model as GLB. */
export async function modelFile(file: Uint8Array): Promise<Uint8Array> {
	if (new TextDecoder().decode(file.subarray(0, 4)) === 'glTF') return file;
	const { parseStl, writeGlb } = await import('@polyzon/mesh-kit');
	return writeGlb([parseStl(file)]);
}

/** What the app really does; passed in so that the rules above can be tested alone. */
export interface Doors {
	info(): unknown;
	jobs(): Job[];
	read(id: string, name: string): Promise<ArrayBuffer>;
	pictures(prompt: string, variants: number): Promise<Job>;
	model(image: Uint8Array, title: string, preset: string): Promise<Job>;
	add(title: string, file: Uint8Array): Promise<Job>;
	open(id: string): void;
	/** Where the frame is: the page it is on, and for a panel the job that page shows */
	context(): unknown;
	/** What came before the frame listened for it: the command that opened its page */
	listen(name: string): unknown[];
}

type Args = Record<string, unknown>;

const text = (value: unknown, max: number) => {
	const clean = typeof value === 'string' ? value.trim() : '';
	if (!clean || clean.length > max) throw new Error('BAD_INPUT');
	return clean;
};

const bytes = (value: unknown, max: number) => {
	if (!(value instanceof Uint8Array) || !value.length || value.length > max) throw new Error('BAD_INPUT');
	return value;
};

const known = (a: Args, doors: Doors) => doors.jobs().some((j) => j.id === a.id);

const variants = (value: unknown) => {
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 4) throw new Error('BAD_INPUT');
	return value as number;
};

type Call = { needs: string | null; run: (a: Args, doors: Doors) => unknown };

/** The one place that says what a plugin can do, which permission it takes, and what it gets. */
const CALLS = new Map<string, Call>([
	['info', { needs: null, run: (_, d) => d.info() }],
	['context', { needs: null, run: (_, d) => d.context() }],
	['listen', { needs: null, run: (a, d) => d.listen(text(a.name, 40)) }],
	['open', { needs: null, run: (a, d) => (known(a, d) ? d.open(a.id as string) : fail('NO_SUCH_JOB')) }],
	['jobs.list', { needs: 'jobs.read', run: (_, d) => d.jobs().map(({ id, title, kind, state, created }) => ({ id, title, kind, state, created })) }],
	['jobs.file', { needs: 'jobs.read', run: (a, d) => (known(a, d) && FINISHED.includes(a.name as string) ? d.read(a.id as string, a.name as string) : fail('NO_SUCH_FILE')) }],
	['jobs.picture', { needs: 'jobs.create', run: (a, d) => d.pictures(text(a.prompt, 2000), variants(a.variants ?? 1)) }],
	['jobs.model', { needs: 'jobs.create', run: (a, d) => d.model(bytes(a.image, 64 << 20), text(a.title ?? 'Model', MAX_TITLE), a.preset === '1024' ? '1024' : '512') }],
	['library.add', { needs: 'library.add', run: (a, d) => d.add(text(a.title, MAX_TITLE), bytes(a.file, MAX_MODEL)) }]
]);

function fail(code: string): never {
	throw new Error(code);
}

/** Answers one call from a plugin that holds `granted`. Its arguments are not to be trusted. */
export async function answer(method: string, args: unknown, granted: readonly string[], doors: Doors): Promise<unknown> {
	const call = CALLS.get(method);
	if (!call) throw new Error('NO_SUCH_METHOD');
	if (call.needs && !granted.includes(call.needs)) throw new Error('NOT_ALLOWED');
	return call.run((args ?? {}) as Args, doors);
}
