import { describe, expect, it } from 'vitest';
import { bench, model, pc, target } from './catalog.fixtures';
import type { Job } from './core';
import { lang } from './i18n.svelte';
import { queue, readyBy, taskbar } from './queue';

const job = (id: string, more: Partial<Job>): Job =>
	({ id, thread: id, created: 0, kind: 'model', title: id, prompt: '', input: '', model: 'm', device: 'cpu', preset: '', seed: 0, state: 'queued', stage: '', error: '', detail: '', seconds: 0, started: 0, output: '', offload: '', notes: [], rating: '', ...more }) as Job;

describe('queue', () => {
	const m = model('m', 1, [target({ ref_seconds: 100 })]);
	const now = 1_000_000_000_000;

	it('lists what runs, then what waits in the order the engine takes it, with the time each still needs', () => {
		const jobs = [
			job('late', { created: 30 }),
			job('done', { state: 'succeeded' }),
			job('early', { created: 10 }),
			job('now', { state: 'running', created: 20, started: now / 1000 - 40 })
		];
		const q = queue(jobs, [m], pc(), bench, now);
		expect(q.places.map((p) => [p.job.id, p.running])).toEqual([['now', true], ['early', false], ['late', false]]);
		// 100 s × 0.7–1.6, the running one 40 s in
		expect(q.places[0].seconds).toEqual([30, 120]);
		expect(q.places[1].seconds).toEqual([70, 160]);
		expect(q.done).toEqual([now + (30 + 70 + 70) * 1000, now + (120 + 160 + 160) * 1000]);
	});

	it('takes a place a move gave over the time a job was made, as the engine does', () => {
		const jobs = [job('first', { created: 10, turn: 30_000 }), job('moved', { created: 20, turn: 10_000 }), job('old', { created: 15 })];
		expect(queue(jobs, [m], pc(), bench, now).places.map((p) => p.job.id)).toEqual(['moved', 'old', 'first']);
	});

	it('promises no finish when one of them has no time of its own, and nothing when nothing waits', () => {
		const q = queue([job('a', {}), job('b', { model: 'gone' })], [m], pc(), bench, now);
		expect(q.places[1].seconds).toBeNull();
		expect(q.done).toBeNull();
		expect(queue([job('x', { state: 'failed' })], [m], pc(), bench, now)).toEqual({ places: [], done: null });
	});
});

describe('readyBy', () => {
	const evening = new Date(2026, 10, 10, 22, 0).getTime();
	const at = (h: number, min: number, day = 10) => new Date(2026, 10, day, h, min).getTime();

	it('says the clock time, and that it is tomorrow when it is', () => {
		lang.value = 'ru';
		expect(readyBy([at(22, 30), at(23, 10)], evening)).toBe('Всё будет готово примерно к 22:30–23:10');
		expect(readyBy([at(23, 50), at(6, 40, 11)], evening)).toBe('Всё будет готово завтра примерно к 06:40');
		lang.value = 'en';
		expect(readyBy([at(22, 40), at(22, 40)], evening)).toBe('Everything should be done by about 22:40');
	});
});

describe('the work on the taskbar button', () => {
	it('shows an install by its bytes, ahead of a job', () => {
		expect(taskbar(0.426, 0.8)).toEqual({ status: 'normal', progress: 43 });
	});

	it('shows a job by its estimate, or only that it is busy when there is none', () => {
		expect(taskbar(null, 0.3)).toEqual({ status: 'normal', progress: 30 });
		expect(taskbar(null, 0)).toEqual({ status: 'normal', progress: 0 });
		expect(taskbar(null, 'busy')).toEqual({ status: 'indeterminate' });
	});

	it('shows nothing when nothing runs', () => {
		expect(taskbar(null, null)).toEqual({ status: 'none' });
	});
});
