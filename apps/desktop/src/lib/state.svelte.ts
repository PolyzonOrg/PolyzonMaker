// What the whole window shares. The Rust side is the source of truth; this is its reflection.
import { fit, recommend, withSpeed, type Bench, type Hardware, type HfModel, type Model } from './catalog';
import { RAIL, storedAreas, storedChatWidth, storedPanes, storedWidth, type Area, type Panes } from './menu';
import { thumbUrl } from './picture';
import { pluginTheme } from './plugins';
import { isWorking, type Thread } from './threads';
import { core, on, type AfterPlan, type Installed, type Job, type PackProgress, type Plugin, type Settings, type Slicer } from './core';
import { setLang, type Key } from './i18n.svelte';

export type Page = 'create' | 'result' | 'library' | 'models' | 'plugins' | 'plugin' | 'tools' | 'tool' | 'openscad' | 'cad' | 'settings';

const MENU_WIDTH_KEY = 'maker-menu-width';
const MENU_WIDE_KEY = 'maker-menu-wide';
const CHAT_WIDTH_KEY = 'maker-chat-width';
/** The code and side panel widths of a desk: CAD and OpenSCAD each keep their own */
const PANES_KEY = { cad: 'maker-cad-panes', openscad: 'maker-openscad-panes' } as const;
/** The side area of Models, the result and a tool: one width each */
const AREAS_KEY = 'maker-areas';
const HARDWARE_KEY = 'maker-hardware';
const CHOSEN_KEY = 'maker-chosen';
const PINNED_KEY = 'maker-pinned-tools';
const PROMPT_TAIL = ', single object, centered, full body, plain white background';

/** Small conveniences kept in the page's own storage; losing them changes nothing. */

const KEYS_KEY = 'maker-keys';

function stored<T>(key: string): T | null {
	try {
		return JSON.parse(localStorage.getItem(key) ?? 'null');
	} catch {
		return null;
	}
}

function pins(stored: unknown): string[] {
	return Array.isArray(stored) ? stored.filter((slug): slug is string => typeof slug === 'string') : [];
}

function store(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// the next start simply asks again
	}
}

export const app = $state({
	ready: false,
	menuWidth: storedWidth(stored(MENU_WIDTH_KEY)),
	chatWidth: storedChatWidth(stored(CHAT_WIDTH_KEY)),
	panes: { cad: storedPanes(stored(PANES_KEY.cad)), openscad: storedPanes(stored(PANES_KEY.openscad)) },
	areas: storedAreas(stored(AREAS_KEY)),
	page: 'create' as Page,
	/** A program on its way to the OpenSCAD page. */
	scad: null as { title: string; code: string; program: string } | null,
	cad: null as { title: string; code: string; program: string } | null,
	chatOpen: false,
	/** Keys the person changed, by action. */
	keys: stored<Record<string, string>>(KEYS_KEY) ?? {},
	shortcuts: false,
	/** The «connect an AI agent» window is open */
	connect: false,
	jobId: '',
	settings: null as unknown as Settings,
	hw: null as Hardware | null,
	/** Where new models go */
	folder: '',
	version: '',
	plugins: [] as Plugin[],
	/** A plugin's command on its way to the plugin's page, with the job it was run on */
	command: null as { plugin: string; command: string; job: string } | null,
	/** The models picked on the start page, kept between runs */
	chosen: stored<{ model3d: string; picture: string }>(CHOSEN_KEY) ?? { model3d: '', picture: '' },
	/** The tools pinned to the menu, in the order they were pinned */
	pinned: pins(stored(PINNED_KEY)),
	/** What is in the start page's box, kept while the person looks at another page */
	draft: { prompt: '', file: null as File | null },
	/** A picture dropped on the window, on its way to the start page */
	dropped: null as File | null,
	/** The program itself, for the MCP settings */
	exe: '',
	/** The API asked for print files of this job */
	prepare: null as { id: string; height: number } | null,
	/** What the computer does when the queue runs out, and when it is about to (ms since 1970) */
	after: { chosen: 'nothing', offered: ['nothing'], soon: null } as AfterPlan,
	afterAt: null as number | null,
	/** A newer version, when there is one */
	update: null as {
		version: string;
		notes: string | null;
		date: string | null;
		state: 'ready' | 'downloading' | 'downloaded' | 'installing' | 'failed';
		done: number;
		total: number;
		/** Restart as soon as the download ends */
		restart: boolean;
	} | null,
	models: [] as Model[],
	installed: [] as Installed[],
	jobs: [] as Job[],
	packs: {} as Record<string, PackProgress>,
	slicers: [] as Slicer[],
	/** Small pictures of jobs, by job id */
	thumbs: {} as Record<string, string>,
	/** Cached between visits to the Models page */
	search: { query: '', task: 'image-to-3d', results: null as HfModel[] | null, failed: false }
});

export function choose(kind: keyof typeof app.chosen, id: string) {
	app.chosen[kind] = id;
	store(CHOSEN_KEY, app.chosen);
}

/** What a person calls a model: its name in the catalog, or the file it came as from Hugging Face. */
export const modelName = (id: string) => app.models.find((m) => m.id === id)?.name ?? app.installed.find((p) => p.id === id)?.name.split('/').pop() ?? id;

/** Picture models of the catalog and the ones taken from Hugging Face */
export const pictureModels = () => [
	...app.models.filter((m) => m.kind === 'picture' && isInstalled(m.id)).map((m) => ({ id: m.id, name: m.name })),
	...app.installed.filter((p) => p.file && !p.broken && p.kind !== 'text').map((p) => ({ id: p.id, name: p.name.split('/').pop() ?? p.id }))
];

export const pickPicture = () => {
	const models = pictureModels();
	return models.find((m) => m.id === app.chosen.picture) ?? models[0];
};

const seed = () => Math.floor(Math.random() * 2 ** 31);

/** Words to pictures: the first job, and the others as variants beside it. `modelId`: another model than the one picked. */
export async function startPictures(words: string, variants = 1, modelId?: string) {
	const model = modelId ? pictureModels().find((m) => m.id === modelId) : pickPicture();
	if (!model) throw new Error('NO_MODEL');
	const device = isInstalled(model.id)!.device;
	const picture = { kind: 'picture' as const, title: words, prompt: words + PROMPT_TAIL, model: model.id, device };
	const job = await core.addJob({ ...picture, seed: seed() });
	for (let i = 1; i < variants; i++) await core.addJob({ ...picture, thread: job.id, seed: seed() });
	return job;
}

/** A picture to a 3D model. `modelId`: another model than the one picked. */
export async function startModel(name: string, bytes: Uint8Array, title: string, preset: string, more: File[] = [], modelId?: string) {
	const model = modelId ? app.models.find((m) => m.id === modelId && isInstalled(m.id)) : pick3d();
	if (!model) throw new Error('NO_MODEL');
	const { plainPicture } = await import('./picture');
	const plain = await plainPicture(new Blob([bytes.slice()]));
	const { id, input } = plain ? await core.addImage('input.png', plain.bytes) : await core.addImage(name, bytes);
	for (const [i, photo] of more.entries()) {
		const other = await plainPicture(photo);
		const kept = other ? other.bytes : new Uint8Array(await photo.arrayBuffer());
		await core.writeFile(id, `view-${i + 1}.${other ? 'png' : photo.name.split('.').pop()}`, kept);
	}
	const notes = plain?.small ? ['low_res'] : [];
	return core.addJob({ id, kind: 'model', title, input, model: model.id, device: isInstalled(model.id)!.device, preset, seed: seed(), notes });
}

/** The 3D model for new work: the one picked, or the best this computer can run */
export function pick3d() {
	const models = app.models.filter((m) => m.kind === '3d' && isInstalled(m.id));
	return models.find((m) => m.id === app.chosen.model3d) ?? recommend(models, app.hw!, benchOf()) ?? models[0];
}

export function setKeys(keys: Record<string, string>) {
	app.keys = keys;
	store(KEYS_KEY, keys);
}

/** The width it comes back to from the icons. */
let menuWide = storedWidth(stored(MENU_WIDE_KEY));

/** Everything in a thread goes, whatever state it is in: what still runs is stopped first. */
export async function deleteThread(thread: Thread) {
	await Promise.all(thread.jobs.filter(isWorking).map((j) => core.cancelJob(j.id)));
	for (const job of thread.jobs) {
		await deleteStopped(job.id);
		setThumb(job.id, null);
		app.jobs = app.jobs.filter((j) => j.id !== job.id);
	}
}

/** A stopped engine takes a moment to leave, and the job cannot be deleted until it has. */
async function deleteStopped(id: string) {
	for (let tries = 60; ; tries--) {
		try {
			return await core.deleteJob(id);
		} catch (e) {
			if (!tries || String(e) !== 'the job is running') throw e;
			await new Promise((r) => setTimeout(r, 500));
		}
	}
}

export function setMenuWidth(width: number) {
	app.menuWidth = width;
	store(MENU_WIDTH_KEY, width);
	if (width === RAIL) return;
	menuWide = width;
	store(MENU_WIDE_KEY, width);
}

export function setChatWidth(width: number) {
	app.chatWidth = width;
	store(CHAT_WIDTH_KEY, width);
}

export function setPanes(desk: keyof typeof PANES_KEY, panes: Panes) {
	app.panes[desk] = panes;
	store(PANES_KEY[desk], panes);
}

export function setArea(area: Area, width: number) {
	app.areas[area] = width;
	store(AREAS_KEY, $state.snapshot(app.areas));
}

export function togglePin(slug: string) {
	app.pinned = app.pinned.includes(slug) ? app.pinned.filter((one) => one !== slug) : [...app.pinned, slug];
	store(PINNED_KEY, app.pinned);
}

export function toggleMenu() {
	setMenuWidth(app.menuWidth === RAIL ? menuWide : RAIL);
}

export function go(page: Page, jobId = '') {
	app.page = page;
	// files can leave while the program is open
	if (page === 'create' || page === 'models') void refreshInstalled();
	app.jobId = jobId;
}

/** The colours a plugin's theme set, to be taken back when another theme comes */
let painted: string[] = [];

/** Runs a plugin's command: its page opens and is told which, and on what. */
export function runCommand(plugin: string, command: string, job = '') {
	app.command = { plugin, command, job };
	go('plugin', plugin);
}

export function applyTheme() {
	const wanted = app.settings.theme;
	// a plugin's theme while its plugin is on; when it goes, the app follows the system
	const theme = pluginTheme(wanted, app.plugins, app.settings.plugins ?? {});
	const plain = wanted === 'light' || wanted === 'dark' ? wanted === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
	const root = document.documentElement;
	root.dataset.theme = (theme ? theme.base === 'dark' : plain) ? 'dark' : 'light';
	for (const token of painted) root.style.removeProperty(token);
	painted = theme?.colors.map(([token]) => token) ?? [];
	for (const [token, value] of theme?.colors ?? []) root.style.setProperty(token, value);
}

/** After a plugin came, went or was switched: what it brings comes or goes with it. */
export async function pluginsChanged(settings: Settings) {
	const [plugins, { models }] = await Promise.all([core.plugins(), core.catalog()]);
	Object.assign(app, { settings, plugins, models });
	applyTheme();
	await refreshInstalled();
}

export async function save(change: Partial<Settings>) {
	app.settings = await core.saveSettings({ ...$state.snapshot(app.settings), ...change } as Settings);
	setLang(app.settings.language);
	applyTheme();
}

export const benchOf = (): Bench | null => app.settings?.benchmark ?? null;

/** How long a job should take on this computer, low and high; null for a model the catalog does not know. */
export function jobExpected(job: Job): [number, number] | null {
	const model = app.models.find((m) => m.id === job.model);
	return model && app.hw ? fit(model, app.hw, benchOf(), model.presets.find((p) => p.id === job.preset)).seconds : null;
}

/** How far a running job is, by the longer end of its estimate; it stops short of the end until the engine is done. */
export function jobShare(job: Job, now: number): number {
	if (job.state === 'succeeded') return 1;
	const expected = jobExpected(job);
	if (!expected || !job.started) return 0;
	return Math.min(Math.max(now / 1000 - job.started, 0) / expected[1], 0.95);
}

export const isInstalled = (id: string) => app.installed.find((p) => p.id === id && !p.broken);
export const isBroken = (id: string) => app.installed.some((p) => p.id === id && p.broken);

export async function refreshInstalled() {
	const [installed, free] = await Promise.all([core.installed(), core.diskFree()]);
	app.installed = installed;
	if (app.hw) app.hw.disk_free_gb = free;
}

/** Whether the models' disk has room for it. A number nobody knows stops nobody. */
export function hasRoom(model: Model) {
	const need = fit(model, app.hw!, benchOf()).target?.disk_gb ?? 0;
	return app.hw?.disk_free_gb == null || app.hw.disk_free_gb >= need;
}

async function refreshFolder() {
	const [folders, hw, installed] = await Promise.all([core.folders(), core.hardware(), core.installed()]);
	Object.assign(app, { folder: folders.models, version: folders.version, hw, installed });
}

/** Asks for a folder for new models. Gives back what to tell the person, if anything. */
export async function chooseModelsFolder(): Promise<Key | ''> {
	try {
		const settings = await core.chooseModelsFolder();
		if (settings) {
			app.settings = settings;
			await refreshFolder();
		}
		return '';
	} catch (e) {
		return e === 'LATIN_ONLY' ? 'folder.latin' : e === 'BUSY' ? 'folder.busy' : 'folder.notWritable';
	}
}

export async function checkUpdate(): Promise<'found' | 'none' | 'failed'> {
	try {
		if (app.update && app.update.state !== 'ready' && app.update.state !== 'failed') return 'found';
		const found = await core.updateCheck();
		app.update = found && { ...found, state: 'ready', done: 0, total: 0, restart: false };
		if (found && !app.settings.updates_manual) void downloadUpdate();
		return found ? 'found' : 'none';
	} catch {
		return 'failed';
	}
}

export async function downloadUpdate(restart = false) {
	const update = app.update;
	if (!update) return;
	Object.assign(update, { state: 'downloading', restart, done: 0, total: 0 });
	try {
		await core.updateDownload();
		update.state = 'downloaded';
		if (update.restart) await installUpdate();
	} catch {
		update.state = 'failed';
	}
}

/** Never in the middle of someone's work: the core refuses, and the download waits. */
export async function installUpdate() {
	const update = app.update;
	if (!update) return;
	update.state = 'installing';
	try {
		await core.updateInstall();
	} catch (e) {
		update.state = e === 'BUSY' ? 'downloaded' : 'failed';
	}
}

/** Something runs that a restart would stop */
export const working = () =>
	app.jobs.some((j) => ['preparing', 'running', 'finalizing'].includes(j.state)) || Object.values(app.packs).some((p) => p.state === 'running');

export function setAfter(plan: AfterPlan) {
	app.after = plan;
	app.afterAt = plan.soon === null ? null : Date.now() + plan.soon * 1000;
}

export async function init() {
	app.settings = await core.settings();
	setLang(app.settings.language);
	applyTheme();
	matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
	const [{ models }, installed, jobs, slicers, plugins] = await Promise.all([core.catalog(), core.installed(), core.jobs(), core.slicers(), core.plugins()]);
	Object.assign(app, { models, installed, jobs, slicers, plugins });
	applyTheme(); // a plugin's theme is known only now
	await on<Job>('job', (job) => {
		const at = app.jobs.findIndex((j) => j.id === job.id);
		if (at >= 0) app.jobs[at] = job;
		else app.jobs.unshift(job);
	});
	await on<[string, string]>('stage', ([id, stage]) => {
		const job = app.jobs.find((j) => j.id === id);
		if (job) job.stage = stage;
	});
	await on<PackProgress>('pack', (p) => {
		app.packs[p.id] = withSpeed(app.packs[p.id], p, performance.now());
		if (p.state === 'done') void refreshInstalled();
	});
	await on<AfterPlan>('after-queue', setAfter);
	setAfter(await core.afterQueue());
	await on<string>('api-open', (id) => go('result', id));
	await on<[string, number]>('api-prepare', ([id, height]) => {
		app.prepare = { id, height };
		go('result', id);
	});
	await on<{ id: string; call: string; args: Record<string, unknown> }>('api-tool', async ({ id, call, args }) => {
		// only an agent's first call loads the tools
		const { toolCall } = await import('../studio/agent');
		const value = await toolCall(call, args).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
		await core.toolAnswer(id, value);
	});
	void core.toolsReady();
	await on<string>('api-install', (id) => {
		const model = app.models.find((m) => m.id === id);
		if (model && !isInstalled(id) && !installing(id)) installModel(model);
	});
	await on<[number, number | null]>('update', ([done, total]) => {
		if (app.update) Object.assign(app.update, { done, total: total ?? 0 });
	});
	const folders = await core.folders();
	Object.assign(app, { folder: folders.models, version: folders.version, exe: folders.exe });
	// asking the system about graphics cards takes seconds: open at once with what was found last time
	const known = stored<Hardware>(HARDWARE_KEY);
	if (known) {
		app.hw = known;
		app.ready = true;
	}
	app.hw = await core.hardware();
	store(HARDWARE_KEY, app.hw);
	app.ready = true;
	if (!app.settings.updates_off) setTimeout(checkUpdate, 3000);
}

export function installModel(model: Model) {
	const device = fit(model, app.hw!, benchOf()).target?.device;
	if (!device) return;
	app.packs[model.id] = { id: model.id, state: 'running', stage: 'tool', done: 0, total: 0, error: '' };
	void core.install(model.id, device);
}

export function installing(id: string) {
	return app.packs[id]?.state === 'running';
}

const asked = new Set<string>();

/** A picture for the lists. The one before it is let go: the browser keeps a blob until it is told. */
export function setThumb(id: string, url: string | null) {
	const old = app.thumbs[id];
	if (old) URL.revokeObjectURL(old);
	if (url) app.thumbs[id] = url;
	else delete app.thumbs[id];
}

/** The picture of a job: its result when there is one, or what it started from. Asked once per state. */
export function loadThumb(job: Job) {
	const key = `${job.id}:${job.state}`;
	if (asked.has(key)) return;
	asked.add(key);
	const done = job.state === 'succeeded';
	const names = done ? [job.kind === 'picture' ? 'picture.png' : 'thumb.png', job.input] : [job.input];
	const next = async (i: number) => {
		if (!names[i]) return;
		try {
			setThumb(job.id, await thumbUrl(new Blob([await core.readFile(job.id, names[i])], { type: 'image/png' })));
		} catch {
			await next(i + 1);
		}
	};
	void next(0);
}

export function jobTitle(job: Job, fallback: string) {
	return job.title || fallback;
}

export function formatDate(seconds: number, lang: string) {
	return new Date(seconds * 1000).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short' });
}
