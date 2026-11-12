import { describe, expect, it } from 'vitest';
import { fit, type Gpu, type Model } from './catalog';
import { bench, nvidia, pc } from './catalog.fixtures';
import catalog from '../../src-tauri/catalog.json';

const real = (id: string) => (catalog.models as unknown as Model[]).find((m) => m.id === id)!;
const card = (vendor: string, name: string, vram_mb: number): Gpu => ({ vendor, name, vram_mb, driver: '', cuda: 0 });
const iris = card('intel', 'Intel(R) Iris(R) Xe Graphics', 128);
const radeon780 = card('amd', 'AMD Radeon(TM) 780M Graphics', 2048);
const arc = card('intel', 'Intel(R) Arc(TM) A770 Graphics', 16288);
const rx = card('amd', 'AMD Radeon RX 7600', 8176);
// the graphics test on the PC behind every time: what a laptop's own chip scores is far below it
const slowTest = { ...bench, gpu_score: 130, gpu_renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)' };

describe('graphics built into the processor', () => {
	it('makes TRELLIS.2 through Vulkan in the memory it shares, not on the processor', () => {
		const f = fit(real('trellis2'), pc({ gpus: [iris], ram_mb: 16000 }), slowTest);
		expect(f.target?.device).toBe('vulkan');
		expect(f.graphics).toBe('shared');
		expect(f.band).not.toBe('no');
	});

	it('is counted as slow as its graphics test says, past what a card ever is', () => {
		const f = fit(real('trellis2'), pc({ gpus: [iris], ram_mb: 16000 }), slowTest);
		// 150 s on the reference card through Vulkan, 20 times slower here
		expect((f.seconds![0] + f.seconds![1]) / 2).toBeGreaterThan(150 * 15);
	});

	it('takes the memory it shares from main memory, which then has to hold both', () => {
		expect(fit(real('trellis2'), pc({ gpus: [iris], ram_mb: 11000 }), slowTest)).toMatchObject({ band: 'no', reason: 'ram' });
	});

	it('works the same for an AMD chip with a little memory of its own', () => {
		const f = fit(real('zimage'), pc({ gpus: [radeon780], ram_mb: 32000 }), slowTest);
		expect(f).toMatchObject({ graphics: 'shared' });
		expect(f.target?.device).toBe('vulkan');
	});

	it('gives way to a card with memory of its own: Vulkan works on that one', () => {
		const f = fit(real('trellis2'), pc({ gpus: [iris, rx], ram_mb: 64000 }), bench);
		expect(f.target?.device).toBe('vulkan');
		expect(f.graphics).toBe('untested');
	});
});

describe('cards of every maker', () => {
	it('runs the Vulkan models on AMD and Intel cards and says they were tested only on NVIDIA', () => {
		for (const gpu of [arc, rx]) {
			const f = fit(real('trellis2'), pc({ gpus: [gpu] }), bench);
			expect(f.target?.device).toBe('vulkan');
			expect(f.graphics).toBe('untested');
		}
	});

	it('says nothing more on an NVIDIA card', () => {
		expect(fit(real('trellis2'), pc({ gpus: [nvidia(16000)] }), bench).graphics).toBeUndefined();
	});
});

describe('an older NVIDIA card or driver', () => {
	// a GTX 1080 whose driver stops at CUDA 11.8: torch's cu118 build runs there, CUDA 12 builds do not
	const gtx = { vendor: 'nvidia', name: 'NVIDIA GeForce GTX 1080', vram_mb: 8192, driver: '522.25', cuda: 11.8 };

	it('runs the PyTorch models on the card with CUDA 11.8', () => {
		expect(fit(real('hunyuan-mini'), pc({ gpus: [gtx] }), bench).target?.device).toBe('cuda');
		expect(fit(real('triposr'), pc({ gpus: [gtx] }), bench).target?.device).toBe('cuda');
	});

	it('runs a native engine built for CUDA 12 through Vulkan on the same card', () => {
		expect(fit(real('trellis2'), pc({ gpus: [gtx] }), bench).target?.device).toBe('vulkan');
	});

	it('asks for the driver a model needs, and names its CUDA', () => {
		const old = { ...gtx, driver: '471.11', cuda: 11.4 };
		const f = fit(real('hunyuan-2-1'), pc({ gpus: [old] }), bench);
		expect(f).toMatchObject({ band: 'no', reason: 'driver', need_cuda: 11.8 });
	});
});
