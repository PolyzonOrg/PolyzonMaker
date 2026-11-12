// What can run on this computer. Pure functions over the catalog and the measured machine: an
// estimate here is a band with a range, never a promise (TZ §12.4).

export type Device = 'cuda' | 'vulkan' | 'metal' | 'mps' | 'cpu';
export type Band = 'fast' | 'wait' | 'night' | 'no';

export interface Target {
	os: string;
	device: Device;
	status: 'tested' | 'experimental';
	ref_seconds: number;
	min_vram_mb: number;
	min_ram_mb: number;
	disk_gb: number;
}

export interface Preset {
	id: string;
	args: string[];
	time_factor: number;
	vram_factor: number;
}

export interface Model {
	id: string;
	name: string;
	kind: '3d' | 'picture' | 'text';
	/** A text model that can look at pictures. */
	vision?: boolean;
	/** Works from several photos of one thing. */
	photos?: boolean;
	quality: number;
	summary: { en: string; ru: string };
	publisher: string;
	license: string;
	license_url: string;
	source_url: string;
	regions_excluded: string[];
	presets: Preset[];
	targets: Target[];
	runtime: { type: 'native' | 'python' | 'plugin' };
	/** A plugin's model: which plugin brought it (PLUGINS.md) */
	plugin?: { id: string; name: string };
	/** How its engine leaves part of it in main memory when the card is short, fastest first */
	offload?: Offload[];
}

/**
 * The memory ladder (TZ §6): stages take turns on the card (runner.py `--offload model`), layers do
 * (`sequential`), or llama.cpp keeps the layers that do not fit in main memory (`layers`).
 */
export type Offload = 'model' | 'sequential' | 'layers';

/**
 * What share of a model's video memory each step needs and how much slower it runs. Measured on an
 * RTX 5070 Ti with its memory capped (bench 2026-11-05): stages in turn, TripoSG 57 s for 51 at 4 GB
 * of its 7 and Hunyuan3D-2 mini 40 s for 32 at 4 of 8; layer by layer, TripoSG 354 s at 2 GB.
 * llama.cpp's layers in main memory run on the processor: a guess, text models show no time.
 */
const OFFLOAD: Record<Offload, { share: number; slower: number }> = {
	model: { share: 0.5, slower: 1.3 },
	sequential: { share: 0.28, slower: 7 },
	layers: { share: 0.25, slower: 2 }
};

/** Only a card with memory of its own has anything to move out of it. */
const OWN_MEMORY: Device[] = ['cuda', 'vulkan'];

/** The fastest step of the ladder that fits `vram` of the `need` a model has on the card. */
function offloadStep(model: Model, device: Device, vram: number, need: number): Offload | null {
	if (!OWN_MEMORY.includes(device)) return null;
	return (model.offload ?? []).find((step) => vram >= need * OFFLOAD[step].share) ?? null;
}

/** The least video memory a model runs with at all, on its lowest step. */
function leastVram(model: Model, device: Device, need: number): number {
	const steps = OWN_MEMORY.includes(device) ? (model.offload ?? []) : [];
	return Math.min(need, ...steps.map((step) => need * OFFLOAD[step].share));
}

const STEPS = {
	native: ['tool', 'runtime', 'weights'],
	python: ['tool', 'runtime', 'python', 'torch', 'packages', 'weights', 'check'],
	plugin: ['tool', 'runtime', 'python', 'torch', 'packages', 'weights', 'fence', 'check']
};

/** The catalog's models on this computer, in its order: installed, half there or on their way in. */
export function onDisk(models: Model[], installed: { id: string }[], packs: Record<string, { state: string }>): Model[] {
	const here = new Set(installed.map((p) => p.id));
	return models.filter((m) => here.has(m.id) || packs[m.id]?.state === 'running');
}

/** How far the running installs are together, 0 to 1, for the menu; null when none runs. */
export function installsShare(packs: Record<string, Omit<Report, 'speed' | 'at' | 'mark'> & { id: string; total: number }>, models: Model[]): number | null {
	const shares = Object.values(packs)
		.filter((p) => p.state === 'running')
		.map((p) => installProgress(models.find((m) => m.id === p.id)?.runtime.type ?? 'native', p.stage, p.done, p.total).share);
	return shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
}

/** Bytes in the unit that suits the whole: a small file is not "0.0 of 0.0 GB". */
export function formatAmount(done: number, total: number, lang: string) {
	const big = total >= 2 ** 30;
	const format = (bytes: number) => (big ? (bytes / 2 ** 30).toLocaleString(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : Math.round(bytes / 2 ** 20).toLocaleString(lang));
	return { big, done: format(done), total: format(total) };
}

/** Megabytes a second: tenths while there are under ten, so a slow line never reads as a stopped one. */
export function formatSpeed(bytesPerSecond: number, lang: string) {
	const mb = bytesPerSecond / 2 ** 20;
	return mb.toLocaleString(lang, { maximumFractionDigits: mb < 10 ? 1 : 0, minimumFractionDigits: mb < 10 ? 1 : 0 });
}

/** Where an install is as a whole: the bar only ever moves forward, across every step. */
export function installProgress(type: keyof typeof STEPS, stage: string, done: number, total: number) {
	const steps = STEPS[type];
	const at = Math.max(steps.indexOf(stage), 0);
	const inside = total > 0 ? Math.min(done / total, 1) : 0;
	return { step: at + 1, of: steps.length, share: (at + inside) / steps.length };
}

export interface Report {
	state: string;
	stage: string;
	done: number;
	speed?: number;
	at?: number;
	mark?: number;
}

/**
 * The next report of an install, with its speed. The bar takes every report; the speed is worked
 * out about once a second and smoothed, so that one slow second does not swing what the person reads.
 * `at` and `mark` are when the bytes last grew and how many there were: downloads write in pieces,
 * so a quiet second keeps the speed, and half a minute with nothing new drops it, and the time left with it.
 */
export function withSpeed<T extends Report>(was: T | undefined, next: T, now: number): T {
	if (!sameRun(was, next)) return { ...next, speed: 0, at: now, mark: next.done };
	const seconds = (now - was.at) / 1000;
	const grown = next.done - (was.mark ?? 0);
	if (grown <= 0 || seconds < 0.8) return { ...next, speed: grown <= 0 && seconds > 30 ? 0 : was.speed, at: was.at, mark: was.mark };
	const current = grown / seconds;
	const speed = was.speed ? was.speed * 0.75 + current * 0.25 : current;
	return { ...next, speed, at: now, mark: next.done };
}

const sameRun = <T extends Report>(was: T | undefined, next: T): was is T & { at: number } =>
	next.state === 'running' && was?.stage === next.stage && was.at !== undefined;

export interface Gpu {
	vendor: string;
	name: string;
	vram_mb: number;
	driver: string;
	cuda: number;
}

export interface Hardware {
	os: string;
	os_version: string;
	arch: string;
	cpu: string;
	cores: number;
	threads: number;
	avx2: boolean;
	ram_mb: number;
	ram_free_mb: number;
	/** null: no disk is known to hold the folder, as with a network share */
	disk_free_gb: number | null;
	gpus: Gpu[];
	webview: string;
}

export interface Bench {
	cpu_single: number;
	cpu_multi: number;
	memory_mbs: number;
	disk_write_mbs: number;
	disk_read_mbs: number;
	/** Megapixels a second through a heavy shader; 0 without WebGL 2 */
	gpu_score: number;
	gpu_renderer: string;
}

export interface Fit {
	band: Band;
	target: Target | null;
	/** Low and high guess, seconds */
	seconds: [number, number] | null;
	/** What stands in the way, for the `no` band */
	reason: 'vram' | 'ram' | 'gpu' | 'driver' | 'system' | 'chip' | 'slow' | null;
	missing_mb?: number;
	/** The card is short: part of the model waits in main memory, and the time counts it */
	offload?: Offload;
	/** Vulkan on the graphics in the processor (`shared`), or on an AMD or Intel card: tested only on NVIDIA */
	graphics?: 'shared' | 'untested';
}

/** Graphics built into the processor, by its name: it has little memory of its own and works in main memory. */
const BUILT_IN = /\b(uhd|iris|hd graphics)\b|arc\(tm\) graphics|radeon\(tm\)( \d{3,4}m)? graphics|radeon vega|\b\d{3}m graphics/i;

export function builtIn(g: Gpu): boolean {
	return (g.vendor === 'intel' || g.vendor === 'amd') && (BUILT_IN.test(g.name) || (g.vram_mb > 0 && g.vram_mb <= 2048));
}

/**
 * The card Vulkan works on: ggml takes a card with memory of its own first, and the graphics in the processor
 * only when there is none. Those use up to half of main memory, as Windows and the drivers let them.
 */
function vulkanCard(hw: Hardware): { vram: number; vendor: string; shared: boolean } | null {
	const cards = hw.gpus.filter((g) => g.vendor === 'nvidia' || g.vendor === 'amd' || g.vendor === 'intel');
	const own = cards.filter((g) => !builtIn(g)).sort((a, b) => b.vram_mb - a.vram_mb)[0];
	if (own) return { vram: own.vram_mb, vendor: own.vendor, shared: false };
	const chip = cards.find(builtIn);
	return chip ? { vram: Math.max(chip.vram_mb, Math.round(hw.ram_mb / 2)), vendor: chip.vendor, shared: true } : null;
}

/**
 * How much slower built-in graphics are than the reference card when its graphics test cannot tell.
 * ponytail: a guess from their paper speed (an Iris Xe is about a twentieth of an RTX 5070 Ti); measure one
 */
const BUILT_IN_SLOWER = 20;

/**
 * The reference PC behind every `ref_seconds`: the RTX 5070 Ti machine of `tools/bench`.
 * ponytail: rough until the app has run there once; only the bands depend on them, and they are wide.
 */
const REFERENCE = { cpu_multi: 63000, gpu_score: 2600 };
const FAST_S = 180;
const WAIT_S = 30 * 60;
const NIGHT_S = 12 * 3600;

/** Real speed differs from one object to the next: every estimate is this wide. */
const SPREAD: [number, number] = [0.7, 1.6];

function devicesOf(hw: Hardware): Map<Device, number> {
	const out = new Map<Device, number>([['cpu', 0]]);
	const vulkan = vulkanCard(hw);
	if (vulkan) out.set('vulkan', vulkan.vram);
	for (const g of hw.gpus) {
		if (g.vendor === 'nvidia' && g.cuda >= 12) out.set('cuda', Math.max(out.get('cuda') ?? 0, g.vram_mb));
		if (g.vendor === 'apple') {
			out.set('mps', hw.ram_mb);
			out.set('metal', hw.ram_mb);
		}
	}
	return out;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|\bwarp\b/i;
const MAKERS: Record<string, RegExp> = { nvidia: /nvidia|geforce|quadro|\brtx\b/i, amd: /\bamd\b|radeon/i, intel: /intel/i, apple: /apple/i };

/**
 * The graphics test runs on the card the window draws with. A laptop draws on its own chip and generates on
 * the other card, and a window with no acceleration draws in software: then the test says nothing of the card.
 */
function testedCard(device: Device, hw: Hardware, renderer: string): boolean {
	if (!renderer) return true; // a check from before the name was kept
	if (SOFTWARE.test(renderer)) return false;
	const maker = device === 'cuda' ? 'nvidia' : device === 'metal' || device === 'mps' ? 'apple' : [...hw.gpus].sort((a, b) => b.vram_mb - a.vram_mb)[0]?.vendor;
	return !maker || (MAKERS[maker]?.test(renderer) ?? true);
}

function speedFactor(device: Device, bench: Bench | null, hw: Hardware, shared = false): number {
	// a Mac's `ref_seconds` are an M4 Pro's own times (bench 2026-11-05c): its web view reads Metal 5 times
	// slow and its processor past the other limit, so the PC's scale says nothing there.
	// ponytail: every Apple chip gets the M4 Pro's time; scale by chip once a second Mac has been measured
	if (hw.os === 'macos') return 1;
	const untold = shared ? BUILT_IN_SLOWER : 1;
	if (!bench) return untold;
	const ratio =
		device === 'cpu'
			? REFERENCE.cpu_multi / Math.max(bench.cpu_multi, 1)
			: REFERENCE.gpu_score / Math.max(bench.gpu_score, 1);
	// the graphics test only ranks cards roughly, and only the card it ran on
	if (device !== 'cpu' && (!bench.gpu_score || !testedCard(device, hw, bench.gpu_renderer))) return untold;
	// built-in graphics are slower than any card by far: they get the processor's room
	return Math.min(Math.max(ratio, 0.4), device === 'cpu' || shared ? 40 : 5);
}

function band(seconds: number): Band {
	if (seconds <= FAST_S) return 'fast';
	if (seconds <= WAIT_S) return 'wait';
	if (seconds <= NIGHT_S) return 'night';
	return 'no';
}

/** The best way to run `model` on this machine. */
export function fit(model: Model, hw: Hardware, bench: Bench | null, preset?: Preset): Fit {
	const devices = devicesOf(hw);
	const vulkan = vulkanCard(hw);
	const targets = model.targets.filter((t) => t.os === hw.os);
	if (!targets.length) return { band: 'no', target: null, seconds: null, reason: 'system' };
	// every Mac engine in the catalog is an arm64 build and torch has no Intel Mac wheels; Rosetta runs only the other way
	if (hw.os === 'macos' && hw.arch !== 'aarch64') return { band: 'no', target: null, seconds: null, reason: 'chip' };
	let best: Fit | null = null;
	let blocked: Fit = { band: 'no', target: null, seconds: null, reason: 'gpu' };
	for (const target of targets) {
		const vram = devices.get(target.device);
		if (vram === undefined) continue;
		const needVram = target.min_vram_mb * (preset?.vram_factor ?? 1);
		const short = needVram > 0 && vram > 0 && vram < needVram;
		const step = short ? offloadStep(model, target.device, vram, needVram) : null;
		if (short && !step) {
			blocked = { band: 'no', target, seconds: null, reason: 'vram', missing_mb: leastVram(model, target.device, needVram) - vram };
			continue;
		}
		const shared = target.device === 'vulkan' && !!vulkan?.shared;
		// what leaves the card waits in main memory, and built-in graphics work in main memory anyway
		const moved = step ? needVram - vram : shared ? needVram : 0;
		if (hw.ram_mb < target.min_ram_mb * 0.92 + moved) {
			blocked = { band: 'no', target, seconds: null, reason: 'ram', missing_mb: target.min_ram_mb + moved - hw.ram_mb };
			continue;
		}
		const slower = step ? OFFLOAD[step].slower : 1;
		const middle = target.ref_seconds * (preset?.time_factor ?? 1) * speedFactor(target.device, bench, hw, shared) * slower;
		const graphics = shared ? 'shared' : target.device === 'vulkan' && vulkan && vulkan.vendor !== 'nvidia' ? 'untested' : null;
		const here: Fit = {
			band: band(middle),
			target,
			seconds: [middle * SPREAD[0], middle * SPREAD[1]],
			reason: band(middle) === 'no' ? 'slow' : null,
			...(step && { offload: step }),
			...(graphics && { graphics })
		};
		if (!best || middle < best.seconds![0] / SPREAD[0]) best = here;
	}
	if (best) return best;
	// an NVIDIA card is there, its driver is what is missing
	const oldDriver = blocked.reason === 'gpu' && hw.gpus.some((g) => g.vendor === 'nvidia') && targets.some((t) => t.device === 'cuda');
	return oldDriver ? { ...blocked, reason: 'driver' } : blocked;
}

/** The one model to offer first. A license with holes in it is never the default (TZ §6). */
export function recommend(models: Model[], hw: Hardware, bench: Bench | null): Model | null {
	// a plugin's model is the person's own pick: its quality and times are its author's word
	const usable = models
		.filter((m) => m.kind === '3d' && !m.regions_excluded.length && !m.plugin)
		.map((m) => ({ m, f: fit(m, hw, bench) }))
		.filter(({ f }) => f.band !== 'no');
	const rank = ({ m, f }: { m: Model; f: Fit }) =>
		(f.band === 'fast' ? 100 : f.band === 'wait' ? 10 : 0) + m.quality - (f.target?.status === 'tested' ? 0 : 0.5);
	usable.sort((a, b) => rank(b) - rank(a));
	return usable[0]?.m ?? null;
}

export function formatTime(seconds: number, lang: string): string {
	const ru = lang === 'ru';
	if (seconds < 90) return `${Math.max(Math.round(seconds / 5) * 5, 5)} ${ru ? 'с' : 's'}`;
	if (seconds < 5400) return `${Math.round(seconds / 60)} ${ru ? 'мин' : 'min'}`;
	return `${(Math.round(seconds / 360) / 10).toLocaleString(ru ? 'ru-RU' : 'en-GB')} ${ru ? 'ч' : 'h'}`;
}

export function formatRange([lo, hi]: [number, number], lang: string): string {
	const a = formatTime(lo, lang);
	const b = formatTime(hi, lang);
	return a === b ? a : `${a.split(' ')[0]}${a.split(' ')[1] === b.split(' ')[1] ? '' : ' ' + a.split(' ')[1]}–${b}`;
}

export type Left = { kind: 'range'; seconds: [number, number] } | { kind: 'upto'; seconds: number } | { kind: 'over' };

/** What is left of a run `elapsed` seconds in, by its estimate for this computer: a range under the short end,
 * "up to" the long end, then only that it takes longer than usual. A second seed is a second run. */
export function timeLeft(elapsed: number, [lo, hi]: [number, number], twice = false): Left {
	const [short, long] = twice ? [lo * 2, hi * 2] : [lo, hi];
	if (elapsed < short) return { kind: 'range', seconds: [short - elapsed, long - elapsed] };
	if (elapsed < long) return { kind: 'upto', seconds: long - elapsed };
	return { kind: 'over' };
}

// ---------------------------------------------------------------- Hugging Face

export interface HfModel {
	id: string;
	downloads: number;
	likes: number;
	task: string;
	tags: string[];
	gated: boolean;
	files: string[];
	/** When the repository last changed, ISO; empty when Hugging Face does not say */
	updated: string;
}

/** One icon for each thing a model makes, the same in the list and on its page. */
export function kindIcon(model: Pick<Model, 'kind' | 'photos'>) {
	return model.kind === 'text' ? 'chat' : model.kind === 'picture' ? 'image' : model.photos ? 'layers' : 'cube';
}

/** Whole days from an ISO date to `now`; null when the date is missing or unreadable. */
export function daysSince(iso: string, now: number): number | null {
	const at = Date.parse(iso);
	return Number.isNaN(at) ? null : Math.max(Math.floor((now - at) / 86_400_000), 0);
}

export type Card = 'nvidia' | 'amd-intel' | 'apple';

/** What a model needs and how it was checked, for its page: the same rules as the landing's list. */
export interface Facts {
	/** The least video memory of any graphics card it runs on, in GB */
	vramGb: number | null;
	/** Less still, with part of it in main memory and more time; null when its engine cannot */
	leastVramGb: number | null;
	cards: Card[];
	/** A processor makes it in minutes, not hours */
	noCard: boolean;
	/** It has made models on some system */
	tested: boolean;
	/** The fastest measured time on a graphics card */
	seconds: number | null;
	limits: ('regions' | 'noncommercial')[];
}

/** A processor run under this many seconds counts as «no graphics card needed»; the others take hours there. */
const QUICK_ON_CPU = 120;
const CARD: Record<Device, Card | null> = { cuda: 'nvidia', vulkan: 'amd-intel', metal: 'apple', mps: 'apple', cpu: null };

export function modelFacts(model: Model): Facts {
	const cards = model.targets.filter((t) => t.device !== 'cpu');
	const tested = model.targets.filter((t) => t.status === 'tested');
	const vram = Math.min(...cards.map((t) => t.min_vram_mb).filter((mb) => mb > 0));
	const fastest = tested.filter((t) => t.device !== 'cpu' && t.ref_seconds > 0).sort((a, b) => a.ref_seconds - b.ref_seconds)[0];
	const kinds = new Set(cards.map((t) => CARD[t.device]));
	const least = Math.min(...cards.filter((t) => t.min_vram_mb > 0).map((t) => leastVram(model, t.device, t.min_vram_mb)));
	return {
		vramGb: Number.isFinite(vram) ? Math.round(vram / 1000) : null,
		leastVramGb: Number.isFinite(least) && least < vram ? Math.round(least / 1000) : null,
		cards: (['nvidia', 'amd-intel', 'apple'] as Card[]).filter((c) => kinds.has(c)),
		noCard: tested.some((t) => t.device === 'cpu' && t.ref_seconds > 0 && t.ref_seconds <= QUICK_ON_CPU),
		tested: tested.length > 0,
		seconds: fastest ? fastest.ref_seconds : null,
		limits: [model.regions_excluded.length ? ('regions' as const) : null, /no commercial|BY-NC/i.test(model.license) ? ('noncommercial' as const) : null].filter((l) => l !== null)
	};
}

/**
 * known: Polyzon Maker has a tested package of it. compatible: the file format and task are ones a built-in
 * engine reads. adapter: fine to look at, but it needs its own code to run. unsafe: only formats
 * that can run code when loaded.
 */
export type HfClass = 'known' | 'compatible' | 'text' | 'gated' | 'adapter' | 'unsafe';

export interface HfFile {
	name: string;
	size: number;
	sha256: string;
}

/** One size of a text model: its parts, and what it takes to hold it. */
export interface Quant {
	label: string;
	files: HfFile[];
	size: number;
}

const PART = /-(\d{5})-of-(\d{5})\.gguf$/i;

/** The sizes a repository of GGUF files offers, smallest first; the best vision file goes along with each. */
export function quants(files: HfFile[]): Quant[] {
	const vision = files.filter((f) => /mmproj/i.test(f.name)).sort((a, b) => Number(/F16/i.test(b.name)) - Number(/F16/i.test(a.name)))[0];
	const groups = new Map<string, HfFile[]>();
	for (const file of files) {
		if (/mmproj/i.test(file.name)) continue;
		const base = file.name.replace(PART, '').replace(/\.gguf$/i, '');
		groups.set(base, [...(groups.get(base) ?? []), file]);
	}
	return [...groups]
		.map(([base, parts]) => {
			const ordered = [...parts].sort((a, b) => a.name.localeCompare(b.name));
			const all = vision ? [...ordered, vision] : ordered;
			return { label: base.split('/').pop()!, files: all, size: all.reduce((n, f) => n + f.size, 0) };
		})
		.sort((a, b) => a.size - b.size);
}

/** The pack a size of a text model installs into; the core makes the same name. */
export function textPackId(repo: string, file: string): string {
	const stem = file.split('/').pop()!.replace(/\.gguf$/, '');
	return `hf-${`${repo}-${stem}`.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
}

/** Where a model of this many bytes would live on this computer. */
export function room(bytes: number, hw: Hardware): 'vram' | 'ram' | 'none' {
	const mb = (bytes * 1.15) / 1e6;
	const vram = Math.max(0, ...hw.gpus.map((g) => g.vram_mb));
	if (mb < vram) return 'vram';
	return mb < hw.ram_mb * 0.8 ? 'ram' : 'none';
}

const SAFE = /\.(safetensors|gguf)$/i;
const PICKLE = /\.(bin|ckpt|pt|pth|pkl)$/i;
const KNOWN: Record<string, string> = {
	'stabilityai/TripoSR': 'triposr',
	'VAST-AI/TripoSG': 'triposg',
	'tencent/Hunyuan3D-2mini': 'hunyuan-mini',
	'tencent/Hunyuan3D-2': 'hunyuan-2',
	'tencent/Hunyuan3D-2.1': 'hunyuan-2-1',
	'tencent/Hunyuan3D-2mv': 'hunyuan-2mv',
	'TencentARC/Pixal3D': 'pixal3d',
	'vegax87/Pixal3D': 'pixal3d',
	'facebook/map-anything-apache': 'map-anything',
	'yyfz233/Pi3': 'pi3',
	'facebook/VGGT-1B': 'vggt',
	'ilintar/trellis2-gguf': 'trellis2',
	'microsoft/TRELLIS.2': 'trellis2',
	'microsoft/TRELLIS.2-4B': 'trellis2',
	'leejet/Z-Image-Turbo-GGUF': 'zimage',
	'leejet/FLUX.2-klein-4B-GGUF': 'klein'
};

export const knownPack = (id: string): string | undefined => KNOWN[id];

export function classify(m: HfModel): HfClass {
	if (KNOWN[m.id]) return 'known';
	if (m.gated) return 'gated';
	const safe = m.files.some((f) => SAFE.test(f));
	if (!safe && m.files.some((f) => PICKLE.test(f))) return 'unsafe';
	if (m.task === 'text-to-image' && modelFile(m)) return 'compatible';
	if (/^(text-generation|image-text-to-text)?$/.test(m.task) && m.files.some((f) => /\.gguf$/i.test(f))) return 'text';
	return 'adapter';
}

/** Files that hold a piece of a model, not all of it. */
const PARTS = /vae|lora|clip|t5|text.?encoder|controlnet|embedding/i;

/** The one file the picture engine can load: a whole model at the top of the repository. */
export function modelFile(m: HfModel): string | undefined {
	const whole = m.files.filter((f) => SAFE.test(f) && !f.includes('/') && !PARTS.test(f));
	return whole.find((f) => /\.gguf$/i.test(f)) ?? whole[0];
}

export const isMature = (m: HfModel): boolean => m.tags.includes('not-for-all-audiences');
