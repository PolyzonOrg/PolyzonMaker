// A stand-in for the Rust side, for `npm run dev` in a plain browser. It never ships in a build that
// runs inside Tauri, and nothing in it is measured.
import type { Hardware, HfModel, Model } from './catalog';
import type { Installed, Job, Plugin, Settings } from './core';
import { boxGlb } from './mock-model';
// the version the stand shows is the one being built
import pkg from '../../package.json';

type Handler = (payload: never) => void;
const handlers = new Map<string, Handler[]>();
// as the core does: everything as one event, «core», with its name
const emit = (event: string, payload: unknown) => handlers.get('core')?.forEach((h) => h([event, payload] as never));

const KEY = 'maker-mock';
/** A plugin with every kind of thing a plugin can bring, so that each place it appears can be looked at */
const SAMPLE_PLUGIN: Plugin = {
	id: 'stand',
	name: 'Подставка',
	version: '1.0.0',
	author: 'Polyzon',
	description: 'Делает простую подставку с нужным диаметром и высотой.',
	permissions: ['jobs.read', 'library.add', 'program'],
	page: true,
	contributes: {
		panels: [{ id: 'size', title: 'Размеры подставки', file: 'panel.html', where: 'result', height: 200 }],
		commands: [
			{ id: 'stand', title: 'Подставка под модель', where: 'result' },
			{ id: 'new', title: 'Новая подставка', where: 'app' }
		],
		themes: [{ id: 'sand', title: 'Песок', base: 'light', colors: { '--bg': '#f6f1e7', '--chrome': '#ece4d4', '--surface': '#f6f1e7', '--surface-2': '#ece4d4', '--ink': '#2b2418' } }],
		models: [
			{
				id: 'relief',
				name: 'Рельеф по картинке',
				runtime: {
					torch: '2.7.1',
					packages: ['numpy==2.2.6', 'pillow==12.3.0'],
					code: { url: 'https://codeload.github.com/example/relief/zip/0123456789abcdef0123456789abcdef01234567', size: 2 << 20 },
					weights: [{ url: 'https://huggingface.co/example/relief/resolve/0123456789abcdef0123456789abcdef01234567/relief.safetensors', size: 1288 << 20 }]
				}
			}
		]
	}
};
/** The sample plugin's model, as the app's catalog writes it once the plugin is on */
const SAMPLE_MODEL = {
	id: 'stand.relief',
	name: 'Рельеф по картинке',
	kind: '3d',
	quality: 2,
	summary: { en: 'A relief from the brightness of a picture.', ru: 'Рельеф по яркости картинки.' },
	publisher: 'Polyzon',
	license: 'MIT',
	license_url: 'https://example.org/license',
	source_url: 'https://example.org/relief',
	regions_excluded: [],
	presets: [],
	runtime: { type: 'plugin' },
	targets: [{ os: 'windows', device: 'cpu', status: 'experimental', ref_seconds: 20, min_vram_mb: 0, min_ram_mb: 2000, disk_gb: 1.5 }],
	plugin: { id: 'stand', name: 'Подставка' }
};
const UPDATE_NOTES = '## Новое\n- Быстрее проверка перед печатью\n- Две новые модели\n\n## Исправления\n- Окно больше не мигает при запуске';
const saved = (() => {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? 'null');
	} catch {
		return null;
	}
})();

/** In memory only, as in power.rs */
let after = 'nothing';

const state = {
	plugins: (saved?.plugins ?? []) as Plugin[],
	settings: (saved?.settings ?? {
		onboarded: false,
		language: '',
		theme: '',
		analytics: null,
		install_id: '',
		models_dir: '',
		old_models_dirs: [],
		benchmark: null,
		show_mature: false,
		gentle: true,
		hf_mirror: false,
		slicer: '',
		api_enabled: false,
		api_port: 7878,
		api_token: '',
		updates_off: false,
		updates_manual: false,
		plugins: {}
	}) as Settings,
	installed: (saved?.installed ?? []) as Installed[],
	jobs: (saved?.jobs ?? []) as Job[]
};
const persist = () => localStorage.setItem(KEY, JSON.stringify(state));
const files = new Map<string, Uint8Array>();
// the files a stand starts with, base64 by `<job>/<name>`: the landing's screenshots bring pictures of real results
// (apps/site), as the stand has no disk to keep them on
if (import.meta.env.DEV)
	for (const [name, data] of Object.entries((globalThis as { standFiles?: Record<string, string> }).standFiles ?? {})) files.set(name, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
const key = (id: string, name: string) => `${id}/${name}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);

/** Other computers for the stand: ?gpu=none|nvidia6|amd8|intel|apple&ram=8&disk=4 */
const GPUS: Record<string, Hardware['gpus']> = {
	none: [],
	nvidia6: [{ vendor: 'nvidia', name: 'NVIDIA GeForce GTX 1660', vram_mb: 6144, driver: '552.22', cuda: 12.4 }],
	amd8: [{ vendor: 'amd', name: 'AMD Radeon RX 6600', vram_mb: 8176, driver: '24.9.1', cuda: 0 }],
	intel: [{ vendor: 'intel', name: 'Intel(R) UHD Graphics 620', vram_mb: 128, driver: '31.0.101', cuda: 0 }],
	apple: [{ vendor: 'apple', name: 'Apple M1', vram_mb: 0, driver: '', cuda: 0 }]
};
const ram = Number(params.get('ram')) * 1024 || 24417;
const hardware: Hardware = {
	os: params.get('gpu') === 'apple' ? 'macos' : 'windows',
	os_version: params.get('gpu') === 'apple' ? 'macOS 15.1' : 'Windows 11 Pro',
	arch: params.get('gpu') === 'apple' ? 'aarch64' : 'x86_64',
	cpu: '12th Gen Intel Core i5-12400F',
	cores: 6,
	threads: 12,
	avx2: true,
	ram_mb: ram,
	ram_free_mb: Math.round(ram * 0.6),
	disk_free_gb: Number(params.get('disk')) || 412,
	gpus: GPUS[params.get('gpu') ?? ''] ?? [{ vendor: 'nvidia', name: 'NVIDIA GeForce RTX 5070 Ti', vram_mb: 16303, driver: '610.88', cuda: 13.3 }],
	webview: '140.0'
};

async function somePicture(seed: number) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 1024;
	const paint = canvas.getContext('2d')!;
	paint.fillStyle = '#fff';
	paint.fillRect(0, 0, 1024, 1024);
	paint.fillStyle = `hsl(${seed % 360} 60% 50%)`;
	paint.beginPath();
	paint.arc(512, 512, 300, 0, 7);
	paint.fill();
	const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
	return new Uint8Array(await blob.arrayBuffer());
}

/** One job at a time, the smallest place first, as jobs.rs runs them; `?slow` stretches each to half a minute. */
const placeOf = (job: Job) => job.turn || job.created * 1000;
const waiting = () => state.jobs.filter((j) => j.state === 'queued').sort((a, b) => placeOf(a) - placeOf(b));
let running = false;
async function lineUp(_job?: Job) {
	const next = running || state.settings.queue_paused ? undefined : waiting()[0];
	if (!next) return;
	running = true;
	await runJob(next).finally(() => (running = false));
	void lineUp();
}
const STEP_MS = params.get('slow') ? 8000 : 900;

async function runJob(job: Job) {
	const update = (change: Partial<Job>) => {
		Object.assign(job, change);
		persist();
		emit('job', { ...job });
	};
	for (const [state_, stage] of [['preparing', 'prepare'], ['running', 'load'], ['running', 'generate'], ['finalizing', 'export']] as const) {
		update({ state: state_, stage, started: job.started || Math.floor(Date.now() / 1000) });
		await sleep(STEP_MS);
		if (job.state === 'cancelled') return;
	}
	if (job.kind === 'model') files.set(key(job.id, 'model.glb'), boxGlb());
	else files.set(key(job.id, 'picture.png'), await somePicture(job.seed));
	update({ state: params.get('fail') ? 'failed' : 'succeeded', stage: '', seconds: 34, output: job.kind === 'model' ? 'model.glb' : 'picture.png', error: params.get('fail') ?? '', detail: params.get('fail') ? 'torch.cuda.OutOfMemoryError: CUDA out of memory.' : '' });
}

async function runInstall(id: string, device: string) {
	const total = 4_000_000_000;
	for (const stage of ['tool', 'runtime', 'python', 'torch', 'packages']) {
		emit('pack', { id, state: 'running', stage, done: 0, total: 0, error: '' });
		await sleep(350);
	}
	for (let done = 0; done <= total; done += total / 40) {
		emit('pack', { id, state: 'running', stage: 'weights', done, total, error: '' });
		await sleep(50);
	}
	state.installed.push({ id, device, version: 1, at: Date.now() / 1000, name: '', file: '' });
	persist();
	emit('pack', { id, state: 'done', stage: '', done: 0, total: 0, error: '' });
}

const search: HfModel[] = [
	{ id: 'google/gemma-4-31b-qat-gguf', downloads: 524212, likes: 25, task: 'image-text-to-text', tags: ['gguf'], gated: false, files: ['gemma-4-31b-Q4_0.gguf', 'mmproj-F16.gguf'], updated: '2026-08-05T10:00:00.000Z' },
	{ id: 'stabilityai/TripoSR', downloads: 512034, likes: 1800, task: 'image-to-3d', tags: ['image-to-3d'], gated: false, files: ['model.ckpt'], updated: '2024-03-04T12:00:00.000Z' },
	{ id: 'stabilityai/stable-diffusion-xl-base-1.0', downloads: 2400310, likes: 7100, task: 'text-to-image', tags: ['diffusers'], gated: false, files: ['sd_xl_base_1.0.safetensors', 'unet/diffusion_pytorch_model.safetensors'], updated: '2023-10-30T16:03:47.000Z' },
	{ id: 'someone/flat-icons-xl', downloads: 90421, likes: 88, task: 'text-to-image', tags: [], gated: false, files: ['model.safetensors'], updated: '2026-06-01T08:00:00.000Z' },
	{ id: 'lab/shape-from-image', downloads: 8040, likes: 120, task: 'image-to-3d', tags: ['image-to-3d'], gated: false, files: ['model.safetensors'], updated: '' },
	{ id: 'old/checkpoint-only', downloads: 1201, likes: 3, task: 'text-to-image', tags: [], gated: false, files: ['model.ckpt'], updated: '2022-01-20T00:00:00.000Z' },
	{ id: 'corp/closed-model', downloads: 40123, likes: 900, task: 'text-to-image', tags: [], gated: true, files: ['model.safetensors'], updated: '2026-09-09T09:00:00.000Z' },
	{ id: 'someone/adult-model', downloads: 7000, likes: 10, task: 'text-to-image', tags: ['not-for-all-audiences'], gated: false, files: ['model.safetensors'], updated: '2026-02-02T00:00:00.000Z' }
];

const README = `---
license: gemma
tags: [gguf]
---
<p align="center"><img src="banner.png"></p>

# Gemma 4 31B QAT

Gemma 4 31B QAT is the **Quantization-Aware Training** version of Gemma 4 31B. It aims to keep quality close to bfloat16 while using much less memory. See [the model card](https://ai.google.dev/gemma).

## Highlights
- **Vision**: reads pictures as well as text
- **Long context**: up to 128K tokens
- Runs with \`llama.cpp\`

| Quant | Size |
|---|---|
| Q4_0 | 18.85 GB |

\`\`\`bash
llama-cli -m gemma-4-31b-Q4_0.gguf
\`\`\`
`;

let programs: { id: string }[] = [];
let chats: { id: string }[] = [];

/** What the pretend text model says: to a cat it asks the size, plans and generates; to anything else it builds in CAD. */
const SCRIPTS = {
	cad: [
		"Сейчас соберу.\n```plan\n- [ ] Пластина 100 × 60 мм\n- [ ] Штифт\n```\n```cad\nconst plate = box(100, 60, 4, 2).color('blue')\nreturn { plate, peg: cyl(6) }\n```",
		"Ошибка в цилиндре, исправляю.\n```plan\n- [x] Пластина 100 × 60 мм\n- [ ] Штифт\n```\n```edit\ncyl(6)\n===\ncyl(6, 40).on(plate).color('red')\n```",
		'```plan\n- [x] Пластина 100 × 60 мм\n- [x] Штифт\n```\nГотово: подставка 100 × 60 мм со штифтом.'
	],
	cat: [
		'Уточню, чтобы кот вышел каким нужно.\n```ask\nКакого размера кот?\n- 5 см, брелок\n- 10 см, фигурка\n- 20 см, на полку\n```',
		'Сделаю фигурку.\n```plan\n- [ ] Картинка кота\n- [ ] 3D-модель\n```\n```generate\na ginger cat sitting, figurine\n```',
		'```plan\n- [x] Картинка кота\n- [x] 3D-модель\n```\nГотово: кот в библиотеке, подготовлен к печати.'
	]
};

/** A pretend text model for the stand: it builds, sees its error, fixes it, and is content. */
async function scripted(id: string, messages: { role: string; content: unknown }[]) {
	const asked = messages.filter((m) => m.role === 'assistant').length;
	const first = JSON.stringify(messages.find((m) => m.role === 'user')?.content ?? '');
	const answers = SCRIPTS[/кот|cat/i.test(first) ? 'cat' : 'cad'];
	const text = answers[Math.min(asked, answers.length - 1)];
	// as slow as a small model on a modest card, so each stage can be seen
	for (let at = 0; at < text.length; at += 6) {
		emit('assistant-delta', { id, text: text.slice(at, at + 6) });
		await new Promise((resolve) => setTimeout(resolve, 60));
	}
	emit('assistant-end', { id, error: '' });
}

export async function invoke<T>(cmd: string, args?: unknown, options?: { headers: Record<string, string> }): Promise<T> {
	// what a failed call looks like: ?broken=job_delete:32 answers as Windows does for a file another program holds
	const [broken, number] = (params.get('broken') ?? '').split(':');
	if (broken === cmd) throw `The process cannot access the file because it is being used by another process. (os error ${number || 32})`;
	const a = (args ?? {}) as Record<string, never>;
	const result = await (async (): Promise<unknown> => {
		switch (cmd) {
			case 'settings':
				return state.settings;
			case 'save_settings':
				state.settings = a.new;
				persist();
				return state.settings;
			case 'hardware':
				await sleep(500);
				return hardware;
			case 'measure':
				for (const step of ['cpu', 'memory', 'disk']) {
					emit('bench', step);
					await sleep(1000);
				}
				return { cpu_single: 980, cpu_multi: 7600, memory_mbs: 21000, disk_write_mbs: 1400, disk_read_mbs: 2600 };
			case 'models': {
				const own = (await import('../../src-tauri/catalog.json')).models as unknown as Model[];
				const on = state.plugins.some((p) => p.id === SAMPLE_PLUGIN.id && !state.settings.plugins[p.id]?.off);
				return { models: on ? [...own, SAMPLE_MODEL as unknown as Model] : own };
			}
			case 'disk_free':
				return hardware.disk_free_gb;
			case 'packs_installed':
				return state.installed;
			case 'pack_install':
				void runInstall(a.id, a.device);
				return null;
			case 'hf_readme':
				await sleep(300);
				return (a.repo as string).startsWith('google/') ? README : '';
			case 'hf_files':
				await sleep(300);
				return [
					{ name: 'gemma-4-31b-Q4_0.gguf', size: 18_850_000_000, sha256: 'a'.repeat(64) },
					{ name: 'mmproj-F16.gguf', size: 850_000_000, sha256: 'b'.repeat(64) }
				];
			case 'pack_install_text': {
				const files = a.files as { name: string }[];
				const id = `hf-${`${a.repo}-${files[0].name.replace(/\.gguf$/, '')}`.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
				void runInstall(id, a.device);
				return id;
			}
			case 'pack_install_file': {
				const id = `hf-${(a.repo as string).replace(/[/.]/g, '-').toLowerCase()}`;
				void runInstall(id, a.device).then(() => {
					Object.assign(state.installed.at(-1)!, { name: a.repo, file: a.file });
					persist();
				});
				return id;
			}
			case 'pack_remove':
				state.installed = state.installed.filter((p) => p.id !== (a.id as string));
				persist();
				return null;
			case 'hf_search':
				await sleep(350);
				return search.filter((m) => m.id.includes(a.query) && (!a.task || m.task === (a.task as string) || (a.task === 'gguf' && m.tags.includes('gguf'))));
			case 'job_image': {
				const id = crypto.randomUUID().slice(0, 16);
				const name = decodeURIComponent(options!.headers['x-name']);
				const input = `input.${name.split('.').pop()}`;
				files.set(key(id, input), a as unknown as Uint8Array);
				return { id, input };
			}
			case 'job_add': {
				const made = crypto.randomUUID();
				const turn = Math.max(Date.now(), ...state.jobs.map((j) => placeOf(j) + 1));
				const job = { thread: (a.job as Job).thread || (a.job as Job).id || made, ...(a.job as object), id: (a.job as Job).id || made, created: Math.floor(Date.now() / 1000), turn, state: 'queued', stage: '', error: '', detail: '', seconds: 0, output: '' } as Job;
				state.jobs.push(job);
				persist();
				emit('job', { ...job });
				void lineUp(job);
				return job;
			}
			case 'jobs_list':
				return [...state.jobs].sort((x, y) => y.created - x.created);
			case 'queue_pause':
				state.settings.queue_paused = a.on as boolean;
				persist();
				void lineUp();
				return state.settings.queue_paused;
			case 'queue_after':
				after = a.after ?? after;
				return { chosen: after, offered: ['nothing', 'sleep', 'shutdown'], soon: null };
			case 'to_tray':
				state.settings.tray_told = true;
				persist();
				return null;
			case 'job_move': {
				const line = waiting();
				const at = line.findIndex((j) => j.id === a.id);
				const other = line[a.earlier ? at - 1 : at + 1];
				if (at < 0 || !other) return null;
				[line[at].turn, other.turn] = [placeOf(other), placeOf(line[at])];
				persist();
				for (const job of [line[at], other]) emit('job', { ...job });
				return null;
			}
			case 'job_cancel': {
				const job = state.jobs.find((j) => j.id === (a.id as string));
				if (job) {
					job.state = 'cancelled';
					emit('job', { ...job });
				}
				return null;
			}
			case 'job_retry': {
				const job = state.jobs.find((j) => j.id === (a.id as string));
				if (!job) return null;
				Object.assign(job, { state: 'queued', stage: '', error: '', detail: '' }); // its old place, as jobs.rs retry keeps it
				emit('job', { ...job });
				void lineUp(job);
				return null;
			}
			case 'job_delete':
				state.jobs = state.jobs.filter((j) => j.id !== (a.id as string));
				persist();
				return null;
			case 'job_read': {
				const file = files.get(key(a.id, a.name)) ?? (a.name === ('model.glb' as never) ? boxGlb(String(a.id).includes('torn')) : null);
				if (!file) throw new Error('no such file');
				return file.buffer;
			}
			case 'job_write':
				files.set(key(options!.headers['x-id'], options!.headers['x-name']), a as unknown as Uint8Array);
				return null;
			case 'job_export':
				return `C:\\Users\\you\\Documents\\${a.suggested}`;
			case 'slicers_found':
				return [{ name: 'Bambu Studio', path: 'bambu-studio.exe', file: 'print.3mf' }, { name: 'CHITUBOX Basic', path: 'chitubox.exe', file: 'print.stl' }];
			case 'models_folder':
				state.settings.models_dir = 'D:\\ArkModels';
				persist();
				return state.settings;
			case 'api_agents':
				return state.settings.api_enabled ? [{ name: 'Claude Code', seconds_ago: 42 }] : [];
			case 'api_set':
				state.settings = { ...state.settings, api_enabled: a.enabled, api_port: a.port, api_token: a.newKey || !state.settings.api_token ? 'f3a91c07d2b84e65a1c0ffee5d7e9b42' : state.settings.api_token };
				persist();
				return state.settings;
			case 'job_import': {
				const job = { id: crypto.randomUUID(), thread: '', created: Date.now(), kind: 'model', title: decodeURIComponent(options?.headers['x-title'] ?? ''), prompt: '', input: '', model: '', device: '', preset: '', seed: 0, state: 'succeeded', stage: '', error: '', detail: '', seconds: 0, output: 'model.glb' } as Job;
				job.thread = job.id;
				// what was brought in is what its page shows
				files.set(key(job.id, 'model.glb'), a as unknown as Uint8Array);
				state.jobs.unshift(job);
				persist();
				emit('job', job);
				return job;
			}
			case 'file_save':
				return true;
			case 'support_report':
				return String.raw`C:\Users\you\Downloads\ `.trim() + a.name;
			case 'assistant_start':
				return undefined;
			case 'assistant_cancel':
				return undefined;
			case 'assistant_chat':
				void scripted(a.id as string, a.messages as { role: string; content: unknown }[]);
				return undefined;
			case 'chats_list':
				return chats;
			case 'chat_read':
				return chats.find((c) => c.id === (a.id as string));
			case 'chat_save': {
				const saved = { ...(a.chat as { id: string }), id: (a.chat as { id: string }).id || crypto.randomUUID() };
				chats = [saved, ...chats.filter((c) => c.id !== saved.id)];
				return saved;
			}
			case 'chat_delete':
				chats = chats.filter((c) => c.id !== (a.id as string));
				return undefined;
			case 'programs_list':
				return programs;
			case 'program_save': {
				const program = { ...(a.program as object), id: (a.program as { id?: string }).id || crypto.randomUUID(), updated: Date.now() } as { id: string };
				programs = [program, ...programs.filter((p) => p.id !== program.id)];
				return program;
			}
			case 'program_delete':
				programs = programs.filter((p) => p.id !== (a.id as string));
				return undefined;
			case 'plugins_list':
				return state.plugins;
			case 'plugin_pick':
				return params.has('badplugin')
					? Promise.reject('NOT_A_PLUGIN')
					: { path: 'C:/stand.zip', manifest: SAMPLE_PLUGIN };
			case 'plugin_install':
				state.plugins = [SAMPLE_PLUGIN];
				state.settings = { ...state.settings, plugins: { [SAMPLE_PLUGIN.id]: { permissions: SAMPLE_PLUGIN.permissions, off: false, network: false } } };
				persist();
				return state.settings;
			case 'plugin_switch': {
				const a = args as { id: string; on: boolean };
				state.settings.plugins[a.id].off = !a.on;
				persist();
				return state.settings;
			}
			case 'plugin_network': {
				const a = args as { id: string; allow: boolean };
				state.settings.plugins[a.id].network = a.allow;
				persist();
				return state.settings;
			}
			case 'plugin_remove':
				state.plugins = [];
				state.settings = { ...state.settings, plugins: {} };
				persist();
				return state.settings;
			case 'update_check':
				return params.has('update') ? { version: '0.2.0', notes: UPDATE_NOTES, date: '2026-11-06T09:00:00Z' } : null;
			case 'update_download':
				for (let done = 10; done <= 100; done += 10) {
					await sleep(400);
					emit('update', [done, 100]);
				}
				return null;
			case 'update_install':
				return null;
			case 'telemetry_sample':
				return [
					{ id: '0123456789abcdef', app: pkg.version, os: 'windows', arch: 'x86_64', event: 'machine', model: '', device: '', code: '', seconds: 0, detail: 'os=windows Windows 11 Pro 10.0.26300;arch=x86_64;cpu=AMD Ryzen 7 7840HS w/ Radeon 780M Graphics;cores=8;threads=16;avx2=1;ram=31950;gpu1=nvidia,NVIDIA GeForce RTX 4070 Laptop GPU,8188,32.0.15.8180,cuda12.9;webview=131.0.2903.112' },
					{ id: '0123456789abcdef', app: pkg.version, os: 'windows', arch: 'x86_64', event: 'job_failed', model: 'trellis2', device: 'vulkan', code: 'GPU_OOM_1024_seq', seconds: 42 }
				];
			case 'data_folder':
				return { version: pkg.version, exe: 'C:\\Users\\you\\AppData\\Local\\Polyzon Maker\\polyzon-maker.exe', data: 'C:\\Users\\you\\AppData\\Local\\org.polyzon.maker', models: state.settings.models_dir || 'C:\\Users\\you\\AppData\\Local\\org.polyzon.maker\\packs' };
			default:
				return null;
		}
	})();
	return result as T;
}

export async function listen(event: string, handler: Handler) {
	handlers.set(event, [...(handlers.get(event) ?? []), handler]);
	return () => handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== handler));
}
