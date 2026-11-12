import { describe, expect, it } from 'vitest';
import { fit, type Model } from './catalog';
import { bench, model, nvidia, pc, target } from './catalog.fixtures';
import catalog from '../../src-tauri/catalog.json';

const real = (id: string) => (catalog.models as unknown as Model[]).find((m) => m.id === id)!;
const middle = (f: ReturnType<typeof fit>) => (f.seconds![0] + f.seconds![1]) / 2;

// Hunyuan-like: its stages go to the card one at a time; TripoSG-like: layer by layer too
const stages = model('stages', 3, [target({ device: 'cuda', ref_seconds: 100, min_vram_mb: 10000, min_ram_mb: 12000 })], { offload: ['model'] });
const layers = model('layers', 3, [target({ device: 'cuda', ref_seconds: 50, min_vram_mb: 7000, min_ram_mb: 12000 })], { offload: ['model', 'sequential'] });
const whole = model('whole', 3, [target({ device: 'cuda', ref_seconds: 80, min_vram_mb: 4000 })]);

describe('a model on a graphics card with less memory than it asks for', () => {
	it('runs with its stages taking turns on the card, somewhat slower, when half of it fits', () => {
		const full = fit(stages, pc({ gpus: [nvidia(12000)] }), bench);
		const short = fit(stages, pc({ gpus: [nvidia(8000)] }), bench);
		expect(full.offload).toBeUndefined();
		expect(short.band).not.toBe('no');
		expect(short.offload).toBe('model');
		expect(middle(short) / middle(full)).toBeCloseTo(1.3, 5);
	});

	it('goes layer by layer when less than half fits, many times slower', () => {
		const f = fit(layers, pc({ gpus: [nvidia(2500)] }), bench);
		expect(f.offload).toBe('sequential');
		expect(middle(f) / middle(fit(layers, pc({ gpus: [nvidia(8000)] }), bench))).toBeCloseTo(7, 5);
	});

	it('stays out of reach below what its lowest step needs, and says how much is missing', () => {
		const f = fit(stages, pc({ gpus: [nvidia(4000)] }), bench);
		expect(f).toMatchObject({ band: 'no', reason: 'vram', missing_mb: 1000 });
	});

	it('never offloads a model whose engine cannot', () => {
		expect(fit(whole, pc({ gpus: [nvidia(3000)] }), bench)).toMatchObject({ band: 'no', reason: 'vram' });
	});

	it('keeps what leaves the card in main memory, so that has to be there too', () => {
		const f = fit(stages, pc({ gpus: [nvidia(8000)], ram_mb: 13000 }), bench);
		expect(f).toMatchObject({ band: 'no', reason: 'ram' });
	});

	it('has nothing to offload where the card and the memory are one, as on a Mac', () => {
		const mac = model('mac', 3, [target({ os: 'macos', device: 'mps', ref_seconds: 100, min_vram_mb: 16000, min_ram_mb: 16000 })], { offload: ['model'] });
		const f = fit(mac, pc({ os: 'macos', arch: 'aarch64', ram_mb: 12000, gpus: [{ vendor: 'apple', name: 'M4', vram_mb: 0, driver: '', cuda: 0 }] }), bench);
		expect(f.band).toBe('no');
		expect(f.offload).toBeUndefined();
	});
});

describe('the catalog', () => {
	it('lets Hunyuan3D-2.1 run on an 8 GB card, stage by stage', () => {
		const f = fit(real('hunyuan-2-1'), pc({ gpus: [nvidia(8000)], ram_mb: 32000 }), bench);
		expect(f.band).not.toBe('no');
		expect(f.offload).toBe('model');
	});

	it('lets a text model too big for the card answer with part of it in main memory', () => {
		const f = fit(real('qwen3-6-27b'), pc({ gpus: [nvidia(12000)], ram_mb: 32000 }), bench);
		expect(f.offload).toBe('layers');
		expect(f.target?.device).toBe('cuda');
	});

	it('keeps TRELLIS.2 whole on the card: trellis.cpp does not offload', () => {
		expect(real('trellis2').offload ?? []).toEqual([]);
	});
});
