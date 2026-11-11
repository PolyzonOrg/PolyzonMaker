import { describe, expect, it } from 'vitest';
import type { Job } from './core';
import { stepped, threads, threadOf, threadWith, versions } from './threads';

const job = (id: string, created: number, more: Partial<Job> = {}): Job =>
	({ id, created, thread: '', title: id, kind: 'picture', state: 'succeeded', ...more }) as Job;

describe('threads', () => {
	it('keeps everything made from one start in one row', () => {
		const list = threads([
			job('model', 4, { thread: 'first', kind: 'model' }),
			job('again', 3, { thread: 'first' }),
			job('first', 2),
			job('other', 1)
		]);
		expect(list.map((t) => t.id)).toEqual(['first', 'other']);
		expect(list[0].jobs.map((j) => j.id)).toEqual(['first', 'again', 'model']);
	});

	it('names a thread after how it began and shows it by its best result', () => {
		const [thread] = threads([
			job('pic', 1, { title: 'a boat' }),
			job('model', 2, { thread: 'pic', kind: 'model', title: 'something later' }),
			job('pic2', 3, { thread: 'pic' })
		]);
		expect(thread.title).toBe('a boat');
		expect(thread.cover.id).toBe('model');
	});

	it('falls back to the newest job while nothing has finished', () => {
		const [thread] = threads([job('a', 1, { state: 'failed' }), job('b', 2, { thread: 'a', state: 'running' })]);
		expect(thread.cover.id).toBe('b');
		expect(thread.busy).toBe(true);
	});

	it('shows a thread by its newest model, else its newest finished picture, else its newest job', () => {
		const cover = (...list: Job[]) => threads(list)[0].cover.id;
		const models = [job('p1', 1), job('m1', 2, { thread: 'p1', kind: 'model' }), job('m2', 3, { thread: 'p1', kind: 'model' }), job('p2', 4, { thread: 'p1' })];
		expect(cover(...models)).toBe('m2');
		expect(cover(job('p1', 1), job('p2', 2, { thread: 'p1' }), job('p3', 3, { thread: 'p1' }), job('p4', 4, { thread: 'p1', state: 'failed' }))).toBe('p3');
		expect(cover(job('p1', 1, { state: 'failed' }), job('p2', 2, { thread: 'p1', state: 'running' }), job('p3', 3, { thread: 'p1', state: 'queued' }))).toBe('p3');
	});

	it('puts the thread that moved last on top', () => {
		const list = threads([job('old', 1), job('new', 2), job('more', 3, { thread: 'old' })]);
		expect(list[0].id).toBe('old');
	});

	it('keeps variants started within one second in the order they were asked for', () => {
		const [thread] = threads([job('third', 5, { thread: 'first' }), job('second', 5, { thread: 'first' }), job('first', 5)]);
		expect(thread.jobs.map((j) => j.id)).toEqual(['first', 'second', 'third']);
	});

	it('takes jobs from before threads existed as threads of their own', () => {
		expect(threads([job('a', 1), job('b', 2)])).toHaveLength(2);
		expect(threadOf({ id: 'a', thread: '' })).toBe('a');
	});

	it('finds the thread of any job in it', () => {
		const jobs = [job('a', 1), job('b', 2, { thread: 'a' })];
		expect(threadWith(jobs, 'b')?.id).toBe('a');
		expect(threadWith(jobs, 'nothing')).toBeUndefined();
	});
});

describe('the versions of a generation', () => {
	it('puts the pictures first and the models made from them after, each counted in its kind', () => {
		const list = [job('p1', 1), job('m1', 2, { kind: 'model' }), job('p2', 3), job('m2', 4, { kind: 'model' })];
		expect(versions(list).map((g) => [g.kind, g.jobs.map((j) => j.id)])).toEqual([
			['picture', ['p1', 'p2']],
			['model', ['m1', 'm2']]
		]);
	});

	it('shows only the kinds there are', () => {
		expect(versions([job('m1', 1, { kind: 'model' }), job('m2', 2, { kind: 'model' })]).map((g) => g.kind)).toEqual(['model']);
	});

	it('moves along them with the arrows, Home and End, and stops at the ends', () => {
		const order = ['p1', 'p2', 'm1'];
		expect(stepped(order, 'p2', 'ArrowRight')).toBe('m1');
		expect(stepped(order, 'p2', 'ArrowLeft')).toBe('p1');
		expect(stepped(order, 'm1', 'Home')).toBe('p1');
		expect(stepped(order, 'p1', 'End')).toBe('m1');
		expect(stepped(order, 'm1', 'ArrowRight')).toBeNull();
		expect(stepped(order, 'p1', 'ArrowLeft')).toBeNull();
		expect(stepped(order, 'p1', 'Home')).toBeNull();
		expect(stepped(order, 'p1', 'Enter')).toBeNull();
	});
});
