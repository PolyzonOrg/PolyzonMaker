import { describe, expect, it } from 'vitest';
import { classify, quants, room, textPackId, type Hardware, type HfModel } from './catalog';

const file = (name: string, gb: number) => ({ name, size: gb * 1e9, sha256: 'a'.repeat(64) });

describe('the sizes of a text model', () => {
	it('come smallest first, each with the vision file', () => {
		const found = quants([file('m-Q8_0.gguf', 8), file('m-Q4_K_M.gguf', 4), file('mmproj-F32.gguf', 0.4), file('mmproj-F16.gguf', 0.2)]);
		expect(found.map((q) => q.label)).toEqual(['m-Q4_K_M', 'm-Q8_0']);
		expect(found[0].files.map((f) => f.name)).toEqual(['m-Q4_K_M.gguf', 'mmproj-F16.gguf']);
		expect(found[0].size).toBeCloseTo(4.2e9);
	});

	it('keep the parts of one model together, in order', () => {
		const found = quants([file('big-00002-of-00002.gguf', 5), file('big-00001-of-00002.gguf', 5)]);
		expect(found.length).toBe(1);
		expect(found[0].files[0].name).toBe('big-00001-of-00002.gguf');
		expect(found[0].size).toBe(10e9);
	});

	it('name the pack as the core does', () => {
		expect(textPackId('unsloth/Gemma-4.0', 'sub/m-Q4_K_M.gguf')).toBe('hf-unsloth-gemma-4-0-m-q4-k-m');
	});
});

describe('room for a model', () => {
	const hw = { gpus: [{ vram_mb: 16000 }], ram_mb: 24000 } as Hardware;

	it('is video memory first, then main memory', () => {
		expect(room(7e9, hw)).toBe('vram');
		expect(room(16e9, hw)).toBe('ram');
		expect(room(30e9, hw)).toBe('none');
	});
});

describe('a repository', () => {
	const repo = (task: string, files: string[]) => ({ id: 'a/b', downloads: 0, likes: 0, task, tags: [], gated: false, files }) as HfModel;

	it('of GGUF text is a text model', () => {
		expect(classify(repo('text-generation', ['m.gguf']))).toBe('text');
		expect(classify(repo('image-text-to-text', ['m.gguf']))).toBe('text');
		expect(classify(repo('', ['m.gguf']))).toBe('text');
	});

	it('of other formats still needs more', () => {
		expect(classify(repo('text-generation', ['m.safetensors']))).toBe('adapter');
	});
});
