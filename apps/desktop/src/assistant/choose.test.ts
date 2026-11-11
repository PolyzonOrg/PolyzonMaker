import { describe, expect, it } from 'vitest';
import { bench, model, nvidia, pc, target } from '../lib/catalog.fixtures';
import { bestGenerator, bestPicture } from './choose';

const presets = [
	{ id: '512', args: [], time_factor: 1, vram_factor: 1 },
	{ id: '1024', args: [], time_factor: 3.9, vram_factor: 1.9 }
];
const trellis = model('trellis2', 4, [target({ device: 'cuda', ref_seconds: 83, min_vram_mb: 8000 }), target({ ref_seconds: 6120, min_ram_mb: 16000 })], { presets });
const triposg = model('triposg', 3, [target({ device: 'cuda', ref_seconds: 40, min_vram_mb: 6000 })]);
const triposr = model('triposr', 1, [target({ device: 'cuda', ref_seconds: 19, min_vram_mb: 3000 }), target({ ref_seconds: 35 })]);
const several = model('vggt', 5, [target({ device: 'cuda', ref_seconds: 10, min_vram_mb: 3000 })], { photos: true });

const pick = (models = [trellis, triposg, triposr, several], hw = pc({ gpus: [nvidia(16000)] })) => {
	const c = bestGenerator(models, hw, bench);
	return c && `${c.model.id} ${c.preset}`.trim();
};

describe('the generator the assistant takes', () => {
	it('is the best model at the most detail this computer finishes while the person waits', () => {
		expect(pick()).toBe('trellis2 1024');
	});

	it('takes less detail when the most would not fit in the card', () => {
		// 1024 needs 8000 × 1.9 MB of graphics memory
		expect(pick(undefined, pc({ gpus: [nvidia(12000)] }))).toBe('trellis2 512');
	});

	it('takes a weaker model when the best one would not fit at all', () => {
		expect(pick(undefined, pc({ gpus: [nvidia(7000)] }))).toBe('triposg');
	});

	it('takes what is ready soon over a better one that runs all night', () => {
		// no graphics card: TRELLIS.2 on the processor takes hours, TripoSR minutes
		expect(pick(undefined, pc())).toBe('triposr');
	});

	it('still runs the best it can when nothing is ready soon', () => {
		expect(pick([trellis], pc())).toBe('trellis2 512');
	});

	it('takes a plugin’s model only when none of the app’s own is installed', () => {
		const boasting = model('lab.best', 5, [target({ device: 'cuda', ref_seconds: 5, min_vram_mb: 1000 })], { plugin: { id: 'lab', name: 'Lab' } });
		expect(pick([boasting, triposr])).toBe('triposr');
		expect(pick([boasting])).toBe('lab.best');
	});

	it('still takes an installed model the estimate says will not fit: the memory ladder may run it', () => {
		// 8000 MB for TRELLIS.2 and 16000 MB of memory for the processor: this computer has neither
		expect(pick([trellis], pc({ ram_mb: 8000, gpus: [nvidia(4000)] }))).toBe('trellis2 512');
	});

	it('never takes a model made for several photos for one picture', () => {
		expect(pick([several, triposr])).toBe('triposr');
		expect(pick([several])).toBeNull();
	});

	it('is nothing when nothing is installed', () => {
		expect(pick([])).toBeNull();
	});
});

describe('the picture model', () => {
	const zimage = model('zimage', 3, [target({ device: 'cuda' })], { kind: 'picture' });
	const klein = model('klein', 2, [target({ device: 'cuda' })], { kind: 'picture' });

	it('is the best of the catalog, then one taken from Hugging Face', () => {
		expect(bestPicture([klein, zimage], ['hf-pic'])).toBe('zimage');
		expect(bestPicture([], ['hf-pic'])).toBe('hf-pic');
		expect(bestPicture([], [])).toBeNull();
	});
});
