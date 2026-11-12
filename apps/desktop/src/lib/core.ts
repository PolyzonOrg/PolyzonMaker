// The page's only way to the computer: typed calls to the Rust commands. In a plain browser
// (`npm run dev`) the same calls go to a stand-in, so the interface can be worked on without a build.
import type { Bench, Hardware, HfFile, HfModel, Model } from './catalog';

export interface Settings {
	onboarded: boolean;
	language: string;
	theme: string;
	analytics: boolean | null;
	install_id: string;
	models_dir: string;
	old_models_dirs: string[];
	benchmark: Bench | null;
	show_mature: boolean;
	gentle: boolean;
	consent: number;
	hf_mirror: boolean;
	slicer: string;
	api_enabled: boolean;
	api_port: number;
	api_token: string;
	updates_off: boolean;
	updates_manual: boolean;
	/** The first close to the tray was explained */
	tray_told?: boolean;
	/** Nothing new starts until the person goes on */
	queue_paused?: boolean;
	plugins: Record<string, Grant>;
}

export interface Grant {
	permissions: string[];
	off: boolean;
	/** The person let its program run on a computer where the fence leaves the network open */
	network: boolean;
}

export interface Program {
	kind?: string;
	id: string;
	title: string;
	code: string;
	updated: number;
}

/** What a plugin adds, as its manifest says (PLUGINS.md); the app checked all of it at install. */
export interface Contributes {
	panels: { id: string; title: string; file: string; where: 'result'; height: number }[];
	commands: { id: string; title: string; where: 'result' | 'app' }[];
	themes: { id: string; title: string; base: 'light' | 'dark'; colors: Record<string, string> }[];
	/** As the catalog writes a model; the app gives each its own id when the plugin is on */
	models: { id: string; name: string; runtime: { torch?: string; packages?: string[]; code?: { url: string; size: number }; weights?: { url: string; size: number }[] } }[];
}

export interface Plugin {
	id: string;
	name: string;
	version: string;
	author: string;
	description: string;
	permissions: string[];
	contributes: Contributes;
	/** It has a page of its own */
	page: boolean;
}

export interface Installed {
	id: string;
	device: string;
	version: number;
	at: number;
	/** A model from Hugging Face: its repository and file */
	name: string;
	file: string;
	/** "text" for a text model from Hugging Face, and whether it came with its vision file. */
	kind?: string;
	vision?: boolean;
	/** The record is there, but what it needs to start is not. */
	broken?: boolean;
}

export interface PackProgress {
	id: string;
	state: 'running' | 'done' | 'failed' | 'cancelled';
	stage: string;
	done: number;
	total: number;
	error: string;
	/** Bytes a second, worked out here from what arrives */
	speed?: number;
	at?: number;
	mark?: number;
}

/** What the computer does when the queue runs out (power.rs) */
export type After = 'nothing' | 'sleep' | 'shutdown';
export interface AfterPlan {
	chosen: After;
	offered: After[];
	/** Seconds left before it happens; null while the queue still runs */
	soon: number | null;
}

export type JobState = 'queued' | 'preparing' | 'running' | 'finalizing' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface Job {
	id: string;
	thread: string;
	created: number;
	kind: 'model' | 'picture';
	title: string;
	prompt: string;
	input: string;
	model: string;
	device: string;
	preset: string;
	seed: number;
	state: JobState;
	stage: string;
	error: string;
	detail: string;
	seconds: number;
	/** When the engine got its turn */
	started: number;
	/** Its place in the queue, ms; 0 or none on jobs from before it */
	turn?: number;
	output: string;
	/** The step of the memory ladder it ran on */
	offload: string;
	/** What the person should know about how it went: `job.note.*` */
	notes: string[];
	/** good or bad, if the person said */
	rating: string;
}

export interface Slicer {
	name: string;
	path: string;
	/** What it opens best */
	file: 'print.3mf' | 'print.stl';
}

type Invoke = <T>(cmd: string, args?: unknown, options?: { headers: Record<string, string> }) => Promise<T>;
type Listen = (event: string, handler: (payload: never) => void) => Promise<() => void>;

export const inTauri = '__TAURI_INTERNALS__' in globalThis;
export const isMac = /Mac/.test(navigator.userAgent);

/** The window itself, for the title bar; there is none in a plain browser. */
export const frame = async () => (inTauri ? (await import('@tauri-apps/api/window')).getCurrentWindow() : null);

let backend: Promise<{ invoke: Invoke; listen: Listen }> | null = null;

function load(): Promise<{ invoke: Invoke; listen: Listen }> {
	backend ??= (async (): Promise<{ invoke: Invoke; listen: Listen }> => {
		if (inTauri) {
			const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
			return {
				invoke: invoke as Invoke,
				listen: ((event, handler) => listen(event, (e) => handler(e.payload as never))) as Listen
			};
		}
		return (await import('./mock')) as { invoke: Invoke; listen: Listen };
	})();
	return backend!;
}

/** Rust answers a failure with bare text; which command it was is kept by that text, for the report of one nobody caught. */
const failed = new Map<string, string>();
export function failCall(cmd: string, reason: unknown) {
	if (typeof reason !== 'string') return;
	failed.delete(reason);
	failed.set(reason, cmd);
	if (failed.size > 20) failed.delete(failed.keys().next().value!);
}
export const failedCommand = (reason: unknown) => (typeof reason === 'string' ? failed.get(reason) : undefined);

const call = async <T>(cmd: string, args?: unknown, options?: { headers: Record<string, string> }) =>
	(await load()).invoke<T>(cmd, args, options).catch((reason: unknown) => {
		failCall(cmd, reason);
		throw reason;
	});

/** The way to stop listening comes back: a page that leaves must take it, or its listener stays for good. */
export const on = async <T>(event: string, handler: (payload: T) => void) => (await load()).listen(event, handler as (payload: never) => void);

export const core = {
	settings: () => call<Settings>('settings'),
	saveSettings: (settings: Settings) => call<Settings>('save_settings', { new: settings }),
	/** `again`: look anew instead of taking the look made as the app started */
	hardware: (again = false) => call<Hardware>('hardware', { again }),
	diskFree: () => call<number | null>('disk_free'),
	measure: (threads: number) => call<Omit<Bench, 'gpu_score' | 'gpu_renderer'>>('measure', { threads }),
	catalog: () => call<{ models: Model[] }>('models'),
	installed: () => call<Installed[]>('packs_installed'),
	install: (id: string, device: string) => call<void>('pack_install', { id, device }),
	installFile: (repo: string, file: string, device: string) => call<string>('pack_install_file', { repo, file, device }),
	installText: (repo: string, files: HfFile[], device: string) => call<string>('pack_install_text', { repo, files, device }),
	repoFiles: (repo: string) => call<HfFile[]>('hf_files', { repo }),
	cancelInstall: (id: string) => call<void>('pack_cancel', { id }),
	remove: (id: string) => call<void>('pack_remove', { id }),
	search: (query: string, task: string) => call<HfModel[]>('hf_search', { query, task }),
	readme: (repo: string) => call<string>('hf_readme', { repo }),
	addImage: (name: string, bytes: Uint8Array) =>
		call<{ id: string; input: string }>('job_image', bytes, { headers: { 'x-name': encodeURIComponent(name) } }),
	addJob: (job: Partial<Job>) => call<Job>('job_add', { job }),
	saveFile: (name: string, bytes: Uint8Array) => call<string | null>('file_save', bytes, { headers: { 'x-name': encodeURIComponent(name) } }),
	assistantStart: (id: string) => call<void>('assistant_start', { id }),
	assistantChat: (id: string, messages: unknown) => call<void>('assistant_chat', { id, messages }),
	assistantStop: (id: string) => call<void>('assistant_cancel', { id }),
	chats: () => call<import('../assistant/chat.svelte').ThreadName[]>('chats_list'),
	readChat: (id: string) => call<import('../assistant/chat.svelte').Thread>('chat_read', { id }),
	saveChat: (chat: import('../assistant/chat.svelte').Thread) => call<import('../assistant/chat.svelte').Thread>('chat_save', { chat }),
	deleteChat: (id: string) => call<void>('chat_delete', { id }),
	programs: () => call<Program[]>('programs_list'),
	saveProgram: (program: Partial<Program>) => call<Program>('program_save', { program }),
	deleteProgram: (id: string) => call<void>('program_delete', { id }),
	toolAnswer: (id: string, value: unknown) => call<void>('tool_answer', { id, value }),
	toolsReady: () => (inTauri ? call<void>('tools_ready') : Promise.resolve()),
	importModel: (title: string, glb: Uint8Array) => call<Job>('job_import', glb, { headers: { 'x-title': encodeURIComponent(title) } }),
	jobs: () => call<Job[]>('jobs_list'),
	cancelJob: (id: string) => call<void>('job_cancel', { id }),
	moveJob: (id: string, earlier: boolean) => call<void>('job_move', { id, earlier }),
	pauseQueue: (on: boolean) => call<boolean>('queue_pause', { on }),
	afterQueue: (after?: After) => call<AfterPlan>('queue_after', { after: after ?? null }),
	retryJob: (id: string) => call<void>('job_retry', { id }),
	deleteJob: (id: string) => call<void>('job_delete', { id }),
	readFile: (id: string, name: string) => call<ArrayBuffer>('job_read', { id, name }),
	writeFile: (id: string, name: string, bytes: Uint8Array) =>
		call<void>('job_write', bytes, { headers: { 'x-id': id, 'x-name': name } }),
	reveal: (id: string, name: string) => call<void>('job_reveal', { id, name }),
	exportFile: (id: string, name: string, suggested: string) => call<string | null>('job_export', { id, name, suggested }),
	slicers: () => call<Slicer[]>('slicers_found'),
	openInSlicer: (slicer: string, id: string, name: string) => call<void>('slicer_open', { slicer, id, name }),
	openUrl: (url: string) => call<void>('open_url', { url }),
	/** Through the system's own tool, for when the web view refuses the page (lib/clipboard.ts) */
	copyText: (content: string) => call<void>('copy_text', { content }),
	trayLanguage: (lang: string) => call<void>('tray_language', { lang }),
	toTray: () => call<void>('to_tray'),
	chooseModelsFolder: () => call<Settings | null>('models_folder'),
	apiSet: (enabled: boolean, port: number, newKey: boolean) => call<Settings>('api_set', { enabled, port, newKey }),
	/** AI agents that connected through MCP since the program started, the latest first */
	apiAgents: () => call<{ name: string; seconds_ago: number }[]>('api_agents'),
	plugins: () => call<Plugin[]>('plugins_list'),
	pickPlugin: () => call<{ path: string; manifest: Plugin } | null>('plugin_pick'),
	installPlugin: (path: string) => call<Settings>('plugin_install', { path }),
	switchPlugin: (id: string, on: boolean) => call<Settings>('plugin_switch', { id, on }),
	allowPluginNetwork: (id: string, allow: boolean) => call<Settings>('plugin_network', { id, allow }),
	removePlugin: (id: string) => call<Settings>('plugin_remove', { id }),
	updateCheck: () => call<{ version: string; notes: string | null; date: string | null } | null>('update_check'),
	updateDownload: () => call<void>('update_download'),
	updateInstall: () => call<void>('update_install'),
	snapReady: () => call<void>('snap_ready'),
	telemetrySample: () => call<unknown>('telemetry_sample'),
	report: (event: string, model = '', device = '', code = '', seconds = 0) => call<void>('report', { event, model, device, code, seconds }).catch(() => undefined),
	rateJob: (id: string, rating: 'good' | 'bad') => call<void>('job_rate', { id, rating }),
	folders: () => call<{ data: string; models: string; version: string; exe: string }>('data_folder'),
	quit: () => call<void>('quit')
};

/** Picture bytes as a URL the page can show. */
/** The address of a plugin's page; a sandboxed frame loads it. */
export async function pluginUrl(id: string): Promise<string> {
	if (!inTauri) return 'about:blank';
	return (await import('@tauri-apps/api/core')).convertFileSrc(id, 'plugin') + '/';
}

export async function fileUrl(id: string, name: string, type: string): Promise<string> {
	return URL.createObjectURL(new Blob([await core.readFile(id, name)], { type }));
}
