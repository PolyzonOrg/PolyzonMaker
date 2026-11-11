import { describe, expect, it } from 'vitest';
import { classify, fit, formatAmount, formatSpeed, modelFile, formatRange, formatTime, isMature, recommend, type HfModel, type Model, type Report, installProgress, installsShare, onDisk, withSpeed } from './catalog';
import { bench, model, nvidia, pc, target } from './catalog.fixtures';

describe('how much of a download is done', () => {
	it('counts a small file in megabytes, never as 0.0 of 0.0 GB', () => {
		expect(formatAmount(5 * 2 ** 20, 32 * 2 ** 20, 'ru')).toEqual({ big: false, done: '5', total: '32' });
	});

	it('counts a large one in gigabytes', () => {
		expect(formatAmount(2 ** 30, 8.5 * 2 ** 30, 'ru')).toEqual({ big: true, done: '1,0', total: '8,5' });
	});
});

describe('how fast a download goes', () => {
	it('shows a slow line as it is, never as 0 MB/s', () => {
		expect(formatSpeed(0.2 * 2 ** 20, 'ru')).toBe('0,2');
		expect(formatSpeed(3.46 * 2 ** 20, 'en')).toBe('3.5');
	});

	it('drops the tenths once they no longer matter', () => {
		expect(formatSpeed(42.4 * 2 ** 20, 'en')).toBe('42');
	});
});

const trellis = model('trellis', 4, [
	target({ device: 'cuda', ref_seconds: 83, min_vram_mb: 4000 }),
	target({ device: 'vulkan', ref_seconds: 150, min_vram_mb: 4000 }),
	target({ device: 'cpu', ref_seconds: 6120, min_ram_mb: 16000 })
]);
const triposr = model('triposr', 1, [target({ device: 'cuda', ref_seconds: 19, min_vram_mb: 3000 }), target({ ref_seconds: 35 })]);

describe('fit', () => {
	it('takes the fastest way this machine has', () => {
		expect(fit(trellis, pc({ gpus: [nvidia(16000)] }), bench).target?.device).toBe('cuda');
		const amd = { vendor: 'amd', name: 'RX', vram_mb: 8000, driver: '', cuda: 0 };
		expect(fit(trellis, pc({ gpus: [amd] }), bench).target?.device).toBe('vulkan');
	});

	it('falls back to the processor and says that takes the night', () => {
		const f = fit(trellis, pc(), bench);
		expect(f.target?.device).toBe('cpu');
		expect(f.band).toBe('night');
	});

	it('says what is missing rather than a bare no', () => {
		const f = fit(model('big', 3, [target({ device: 'cuda', min_vram_mb: 8000 })]), pc({ gpus: [nvidia(6000)] }), bench);
		expect([f.band, f.reason, f.missing_mb]).toEqual(['no', 'vram', 2000]);
		expect(fit(triposr, pc({ ram_mb: 4000 }), bench).reason).toBe('ram');
		expect(fit(triposr, pc({ os: 'macos' }), bench).reason).toBe('system');
		const gpuOnly = model('g', 3, [target({ device: 'cuda', min_vram_mb: 4000 })]);
		expect(fit(gpuOnly, pc(), bench).reason).toBe('gpu');
	});

	it('a slower machine gets a longer estimate, in a range', () => {
		const here = fit(triposr, pc(), { ...bench, cpu_multi: 15750 });
		expect(here.seconds![0]).toBeCloseTo(35 * 4 * 0.7);
		expect(here.seconds![1]).toBeCloseTo(35 * 4 * 1.6);
	});

	it('a bigger preset needs more memory', () => {
		const preset = { id: '1024', args: [], time_factor: 3.9, vram_factor: 1.9 };
		expect(fit(trellis, pc({ gpus: [nvidia(6000)] }), bench, preset).target?.device).toBe('cpu');
		expect(fit(trellis, pc({ gpus: [nvidia(8000)] }), bench, preset).target?.device).toBe('cuda');
	});

	it('Apple memory counts for the chip', () => {
		const mps = model('m', 2, [target({ os: 'macos', device: 'mps', status: 'experimental', min_vram_mb: 8000 })]);
		const apple = { vendor: 'apple', name: 'Apple M3', vram_mb: 16000, driver: '', cuda: 0 };
		expect(fit(mps, pc({ os: 'macos', arch: 'aarch64', ram_mb: 16000, gpus: [apple] }), bench).target?.device).toBe('mps');
	});

	it('on an Apple silicon Mac Hunyuan mini and TripoSG run on the processor, where the Mac run made them whole', async () => {
		// bench 2026-11-05c on an M4 Pro: on the graphics Hunyuan mini gave a cube of noise for 34 pictures out of 34
		// (as upstream Hunyuan3D-2#151 tells), TripoSG stopped on max_pool3d; on the processor both made the goblin
		const catalog = (await import('../../src-tauri/catalog.json')).default as unknown as { models: Model[] };
		const mac = pc({ os: 'macos', arch: 'aarch64', ram_mb: 24576, gpus: [{ vendor: 'apple', name: 'Apple M4 Pro', vram_mb: 0, driver: '', cuda: 0 }] });
		for (const [id, measured] of [['hunyuan-mini', 1337], ['triposg', 731]] as const) {
			const m = catalog.models.find((x) => x.id === id)!;
			const f = fit(m, mac, bench);
			expect(f.target?.device, id).toBe('cpu');
			expect(f.seconds![0] <= measured && measured <= f.seconds![1], `${id} ${f.seconds}`).toBe(true);
		}
	});

	it('on a Mac the time is the one measured on a Mac: its tests read Metal 5 times slow and the processor at the other end', () => {
		// the owner's M4 Pro showed Hunyuan mini 300 s × 5 = «18–40 мин» and TripoSR 35 s × 0.4 = «10–20 с»,
		// both factors at their limits, while the bench there measured each engine's own time
		const metal = model('m', 2, [target({ os: 'macos', device: 'metal', status: 'experimental', ref_seconds: 191, min_vram_mb: 0 })]);
		const apple = { vendor: 'apple', name: 'Apple M4 Pro', vram_mb: 0, driver: '', cuda: 0 };
		const m4 = { ...bench, cpu_multi: 160000, gpu_score: 400, gpu_renderer: 'Apple M4 Pro' };
		expect(fit(metal, pc({ os: 'macos', arch: 'aarch64', ram_mb: 24576, gpus: [apple] }), m4).seconds).toEqual([191 * 0.7, 191 * 1.6]);
	});

	it('every model on the Models page has a way to run on an Apple silicon Mac', async () => {
		const catalog = (await import('../../src-tauri/catalog.json')).default as unknown as { models: Model[] };
		const mac = pc({ os: 'macos', arch: 'aarch64', ram_mb: 24576, gpus: [{ vendor: 'apple', name: 'Apple M4 Pro', vram_mb: 0, driver: '', cuda: 0 }] });
		const none = catalog.models.filter((m) => fit(m, mac, bench).reason === 'system').map((m) => m.id);
		expect(none).toEqual([]);
	});

	it('on an Apple silicon Mac TRELLIS.2 runs on Metal, in the time trellis.cpp took there', async () => {
		// bench 2026-11-05c, M4 Pro 24 GB, trellis.cpp v0.8.1 on Metal with the textured remesh the app asks for
		// (--box-uv): 512 median 453 s, 1024 median 1574 s; at most 7 GB at 512 and 11.6 GB at 1024
		const catalog = (await import('../../src-tauri/catalog.json')).default as unknown as { models: Model[] };
		const trellis = catalog.models.find((x) => x.id === 'trellis2')!;
		const mac = pc({ os: 'macos', arch: 'aarch64', ram_mb: 24576, gpus: [{ vendor: 'apple', name: 'Apple M4 Pro', vram_mb: 0, driver: '', cuda: 0 }] });
		const m4 = { ...bench, cpu_multi: 160000, gpu_score: 400, gpu_renderer: 'Apple M4 Pro' };
		for (const [preset, measured] of [['512', 453], ['1024', 1574]] as const) {
			for (const check of [m4, null]) {
				const f = fit(trellis, mac, check, trellis.presets.find((p) => p.id === preset));
				expect([f.target?.device, f.target?.status]).toEqual(['metal', 'experimental']);
				expect(f.seconds![0] <= measured && measured <= f.seconds![1], `${preset} ${f.seconds}`).toBe(true);
			}
		}
		expect(fit(trellis, { ...mac, ram_mb: 8192 }, m4).reason).toBe('ram');
	});

	it('an Intel Mac runs none: every Mac engine and torch are built for Apple chips only', () => {
		const metal = model('n', 2, [target({ os: 'macos', device: 'metal', min_vram_mb: 0 })]);
		const intel = pc({ os: 'macos', arch: 'x86_64', gpus: [{ vendor: 'amd', name: 'Radeon Pro', vram_mb: 8000, driver: '', cuda: 0 }] });
		expect(fit(metal, intel, bench)).toEqual({ band: 'no', target: null, seconds: null, reason: 'chip' });
		expect(fit(metal, { ...intel, arch: 'aarch64' }, bench).reason).not.toBe('chip');
	});
});

describe('recommend', () => {
	it('offers the best fast model, and a draft to a machine without a graphics card', () => {
		const list = [trellis, triposr];
		expect(recommend(list, pc({ gpus: [nvidia(16000)] }), bench)?.id).toBe('trellis');
		expect(recommend(list, pc(), bench)?.id).toBe('triposr');
	});

	it('does not judge a card by a graphics test that ran on another one, or on none', () => {
		// the trellis fixture takes 83 s at the reference score; a test 5 times slower makes it a wait
		const slow = (gpu_renderer: string) => ({ ...bench, gpu_score: 200, gpu_renderer });
		const rtx = pc({ gpus: [{ vendor: 'intel', name: 'Intel(R) UHD Graphics 630', vram_mb: 128, driver: '', cuda: 0 }, nvidia(8000)] });
		// a laptop draws its window on the Intel chip and generates on the NVIDIA card
		expect(fit(trellis, rtx, slow('ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)')).band).toBe('fast');
		expect(fit(trellis, rtx, slow('Google SwiftShader')).band).toBe('fast');
		expect(fit(trellis, rtx, slow('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)')).band).toBe('fast');
		expect(fit(trellis, pc({ gpus: [nvidia(8000)] }), slow('llvmpipe (LLVM 15.0.7, 256 bits)')).band).toBe('fast');
		// the card itself measured slow is slow
		expect(fit(trellis, rtx, slow('ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)')).band).toBe('wait');
		expect(fit(trellis, pc({ gpus: [nvidia(8000)] }), slow('')).band).toBe('wait');
		expect(recommend([trellis, triposr], rtx, slow('ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11)'))?.id).toBe('trellis');
	});

	it('never defaults to a model whose license leaves countries out', () => {
		const hunyuan = model('hunyuan', 9, [target({ device: 'cuda', ref_seconds: 10, min_vram_mb: 3000 })], { regions_excluded: ['EU'] });
		expect(recommend([hunyuan, triposr], pc({ gpus: [nvidia(16000)] }), bench)?.id).toBe('triposr');
	});

	it('finds nothing rather than something that cannot run', () => {
		expect(recommend([triposr], pc({ ram_mb: 2000 }), bench)).toBeNull();
	});

	it('never offers a plugin’s model, whose quality is its author’s word', () => {
		const boasting = model('lab.best', 9, [target({ device: 'cuda', ref_seconds: 5, min_vram_mb: 1000 })], { plugin: { id: 'lab', name: 'Lab' } });
		expect(recommend([boasting, triposr], pc({ gpus: [nvidia(16000)] }), bench)?.id).toBe('triposr');
		expect(recommend([boasting], pc({ gpus: [nvidia(16000)] }), bench)).toBeNull();
	});
});

describe('times', () => {
	it('reads like a person wrote it', () => {
		expect(formatTime(33, 'ru')).toBe('35 с');
		expect(formatTime(600, 'en')).toBe('10 min');
		expect(formatTime(9000, 'ru')).toBe('2,5 ч');
		expect(formatTime(9000, 'en')).toBe('2.5 h');
		expect(formatRange([24, 56], 'ru')).toBe('25–55 с');
		expect(formatRange([50, 200], 'en')).toBe('50 s–3 min');
	});
});

describe('Hugging Face', () => {
	const hf = (m: Partial<HfModel>): HfModel => ({ id: 'a/b', downloads: 0, likes: 0, task: '', tags: [], gated: false, files: [], ...m });

	it('tells what can run from what only downloads', () => {
		expect(classify(hf({ id: 'stabilityai/TripoSR' }))).toBe('known');
		expect(classify(hf({ task: 'text-to-image', files: ['model.safetensors'] }))).toBe('compatible');
		expect(classify(hf({ task: 'image-to-3d', files: ['model.safetensors'] }))).toBe('adapter');
		expect(classify(hf({ task: 'text-to-image', files: ['model.ckpt'] }))).toBe('unsafe');
		expect(classify(hf({ task: 'text-to-image', files: ['model.gguf'], gated: true }))).toBe('gated');
		expect(classify(hf({ task: 'text-to-image', files: ['unet/diffusion_pytorch_model.safetensors'] }))).toBe('adapter');
	});

	it('knows the tag for adult models', () => {
		expect(isMature(hf({ tags: ['not-for-all-audiences'] }))).toBe(true);
		expect(isMature(hf({}))).toBe(false);
	});
});

describe('installProgress', () => {
	it('moves forward through the steps and inside each one', () => {
		const shares = [
			installProgress('python', 'tool', 0, 0),
			installProgress('python', 'python', 0, 0),
			installProgress('python', 'torch', 0, 100),
			installProgress('python', 'torch', 50, 100),
			installProgress('python', 'packages', 0, 0),
			installProgress('python', 'weights', 90, 100),
			installProgress('python', 'check', 0, 0)
		].map((p) => p.share);
		expect(shares).toEqual([...shares].sort((a, b) => a - b));
		expect(new Set(shares).size).toBe(shares.length);
		expect(installProgress('python', 'torch', 1, 2)).toMatchObject({ step: 4, of: 7 });
	});

	it('never passes the end, even when more landed than expected', () => {
		expect(installProgress('native', 'weights', 200, 100).share).toBe(1);
		expect(installProgress('python', 'something new', 0, 0).share).toBe(0);
	});
});

describe('onDisk', () => {
	it('lists the models on this computer in the catalog order: installed, half there or on their way', () => {
		const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => model(id, 1, []));
		const installed = [{ id: 'c' }, { id: 'a', broken: true }, { id: 'hf-own-file' }];
		const packs = { d: { state: 'running' }, b: { state: 'failed' } };
		expect(onDisk([a, b, c, d], installed, packs).map((m) => m.id)).toEqual(['a', 'c', 'd']);
	});
});

describe('installsShare', () => {
	it('tells how far the running installs are together, and nothing once none runs', () => {
		const py = model('py', 1, [], { runtime: { type: 'python' } as Model['runtime'] });
		const packs = {
			py: { id: 'py', state: 'running', stage: 'weights', done: 50, total: 100 },
			file: { id: 'file', state: 'running', stage: 'weights', done: 0, total: 0 },
			old: { id: 'old', state: 'done', stage: '', done: 0, total: 0 }
		};
		// a model's own steps; a Hugging Face file has none in the list and goes as a native one
		expect(installsShare(packs, [py])).toBeCloseTo((5.5 / 7 + 2 / 3) / 2);
		expect(installsShare({ old: packs.old }, [py])).toBeNull();
	});
});

describe('withSpeed', () => {
	const report = (done: number, stage = 'weights', state = 'running'): Report => ({ state, stage, done });
	const second = 1000;

	it('works out bytes a second from what really arrived', () => {
		const first = withSpeed(undefined, report(0), 0);
		const next = withSpeed(first, report(50_000_000), second);
		expect(next.speed).toBe(50_000_000);
		expect(next.done).toBe(50_000_000);
	});

	it('takes every report for the bar and keeps the speed steady between measurements', () => {
		const first = withSpeed(undefined, report(0), 0);
		const measured = withSpeed(first, report(50), second);
		const soon = withSpeed(measured, report(60), second + 100);
		expect(soon.done).toBe(60);
		expect(soon.speed).toBe(measured.speed);
		const later = withSpeed(soon, report(150), 2 * second);
		expect(later.speed).toBe(50 * 0.75 + 100 * 0.25);
	});

	it('keeps the speed through a quiet second and counts what comes next over the whole gap', () => {
		// downloads write in pieces: a second with nothing new is not a slower connection
		const first = withSpeed(withSpeed(undefined, report(0), 0), report(100), second);
		const quiet = withSpeed(first, report(100), 2 * second);
		expect(quiet.speed).toBe(100);
		const piece = withSpeed(quiet, report(500), 3 * second);
		expect(piece.speed).toBe(100 * 0.75 + 200 * 0.25);
	});

	it('promises no time once nothing has arrived for half a minute', () => {
		// it used to fade the speed a quarter a second and read «0 MB/s, 147 507,4 h left»
		let r = withSpeed(withSpeed(undefined, report(0), 0), report(100_000_000), second);
		r = withSpeed(r, report(100_000_000), 20 * second);
		expect(r.speed).toBe(100_000_000);
		r = withSpeed(r, report(100_000_000), 32 * second);
		expect(r.speed).toBe(0);
	});

	it('never loses the end of an install, however soon it comes', () => {
		const running = withSpeed(undefined, report(10), 0);
		const finished = withSpeed(running, report(0, 'weights', 'done'), 5);
		expect(finished.state).toBe('done');
		expect(withSpeed(running, report(0, 'weights', 'failed'), 5).state).toBe('failed');
	});

	it('starts over on a new step', () => {
		const first = withSpeed(withSpeed(undefined, report(0, 'torch'), 0), report(100, 'torch'), second);
		expect(withSpeed(first, report(0, 'packages'), 2 * second).speed).toBe(0);
	});

	it('never goes below zero when a count starts again', () => {
		const first = withSpeed(undefined, report(100), 0);
		expect(withSpeed(first, report(0), second).speed).toBe(0);
	});
});

describe('the file of a model from Hugging Face', () => {
	const repo = (files: string[]) => ({ id: 'a/b', downloads: 0, likes: 0, task: 'text-to-image', tags: [], gated: false, files });

	it('is never a piece of a model', () => {
		expect(modelFile(repo(['ae_vae.safetensors', 'model.safetensors']))).toBe('model.safetensors');
		expect(modelFile(repo(['lora.safetensors']))).toBeUndefined();
	});
});

describe('an NVIDIA card whose driver is too old for CUDA 12', () => {
	it('is told to update its driver, not that it needs a graphics card', () => {
		const old = { vendor: 'nvidia', name: 'GTX 1080', vram_mb: 8000, driver: '472.12', cuda: 11.4 };
		const onlyCuda = model('cuda-only', 3, [target({ device: 'cuda', min_vram_mb: 4000 })]);
		expect(fit(onlyCuda, pc({ gpus: [old] }), bench).reason).toBe('driver');
		expect(fit(onlyCuda, pc({ gpus: [] }), bench).reason).toBe('gpu');
	});
});
