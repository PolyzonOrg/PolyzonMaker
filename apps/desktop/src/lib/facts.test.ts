import { describe, expect, it } from 'vitest';
import { daysSince, modelFacts } from './catalog';
import { model, target } from './catalog.fixtures';
import catalog from '../../src-tauri/catalog.json';
import type { Model } from './catalog';

const real = (id: string) => (catalog.models as unknown as Model[]).find((m) => m.id === id)!;

describe('what a model needs, as its page tells it', () => {
	it('counts the least video memory of any graphics card it runs on, and every kind of card', () => {
		const f = modelFacts(real('trellis2'));
		expect(f.vramGb).toBe(4);
		expect(f.cards).toEqual(['nvidia', 'amd-intel', 'apple']);
		expect(f.tested).toBe(true);
		expect(f.seconds).toBe(83);
	});

	it('says «no graphics card needed» only where a processor makes it in minutes, not hours', () => {
		expect(modelFacts(real('triposr')).noCard).toBe(true);
		// TRELLIS.2 runs on a processor too, for hours: that is not «no card needed»
		expect(modelFacts(real('trellis2')).noCard).toBe(false);
	});

	it('names the limits of a licence', () => {
		expect(modelFacts(real('hunyuan-2')).limits).toEqual(['regions']);
		expect(modelFacts(real('vggt')).limits).toEqual(['noncommercial']);
		expect(modelFacts(real('triposg')).limits).toEqual([]);
	});

	it('has no time to show for a model never measured, and says it was not tested', () => {
		const f = modelFacts(model('new', 3, [target({ device: 'cuda', status: 'experimental', ref_seconds: 50, min_vram_mb: 6000 })]));
		expect(f.seconds).toBeNull();
		expect(f.tested).toBe(false);
		expect(f.cards).toEqual(['nvidia']);
	});
});

describe('how long ago a repository changed', () => {
	it('counts whole days, and nothing when the date is unknown', () => {
		const now = Date.parse('2026-11-12T12:00:00Z');
		expect(daysSince('2026-08-14T09:30:00.000Z', now)).toBe(90);
		expect(daysSince('2026-11-12T08:00:00Z', now)).toBe(0);
		expect(daysSince('', now)).toBeNull();
		expect(daysSince('not a date', now)).toBeNull();
	});
});
