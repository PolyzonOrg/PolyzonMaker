import { afterEach, describe, expect, it, vi } from 'vitest';
import { hub } from './core';

afterEach(() => {
	vi.useRealTimers();
});

describe('everything the core says, through one listen', () => {
	it('gives each news to those who listen for it, and to no one else', () => {
		const h = hub();
		const jobs: unknown[] = [];
		const packs: unknown[] = [];
		h.add('job', (j) => jobs.push(j));
		h.add('pack', (p) => packs.push(p));
		h.tell(['job', { id: 'a' }]);
		h.tell(['stage', ['a', 'mesh']]);
		expect(jobs).toEqual([{ id: 'a' }]);
		expect(packs).toEqual([]);
	});

	it('stops giving it to one who stopped listening, while the others still hear', () => {
		const h = hub();
		const heard: string[] = [];
		const off = h.add('job', () => heard.push('first'));
		h.add('job', () => heard.push('second'));
		off();
		h.tell(['job', null]);
		expect(heard).toEqual(['second']);
	});

	it('lets one that fails fail alone: the others hear, and the failure still reaches the error report', () => {
		vi.useFakeTimers();
		const h = hub();
		const heard: string[] = [];
		h.add('job', () => {
			throw new Error('broken page');
		});
		h.add('job', () => heard.push('library'));
		h.tell(['job', null]);
		expect(heard).toEqual(['library']);
		expect(() => vi.runAllTimers()).toThrow('broken page');
	});

	it('lets one that stops listening as it hears leave the rest as they were', () => {
		const h = hub();
		const heard: string[] = [];
		const off = h.add('job', () => {
			heard.push('once');
			off();
		});
		h.add('job', () => heard.push('always'));
		h.tell(['job', null]);
		h.tell(['job', null]);
		expect(heard).toEqual(['once', 'always', 'always']);
	});
});
