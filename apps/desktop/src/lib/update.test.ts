import { describe, expect, it } from 'vitest';
import { releaseDate, whatsNew } from './update';

describe('whatsNew', () => {
	it('splits the notes into headed lists', () => {
		expect(whatsNew('## Fixes\n- One\n- Two\n\n## New\n* Three')).toEqual([
			{ title: 'Fixes', items: ['One', 'Two'] },
			{ title: 'New', items: ['Three'] }
		]);
	});

	it('keeps plain text as items of a list with no heading', () => {
		expect(whatsNew('A faster start\n\nFewer crashes\r\n')).toEqual([{ title: '', items: ['A faster start', 'Fewer crashes'] }]);
	});

	it('has nothing to show for empty notes', () => {
		expect(whatsNew('')).toEqual([]);
		expect(whatsNew(null)).toEqual([]);
		expect(whatsNew(' \n ')).toEqual([]);
	});

	it('drops a heading with nothing under it', () => {
		expect(whatsNew('## Empty\n## Full\n- One')).toEqual([{ title: 'Full', items: ['One'] }]);
	});
});

describe('releaseDate', () => {
	it('writes the date in the language of the app', () => {
		expect(releaseDate('2026-11-06T09:00:00Z', 'en')).toBe('November 6, 2026');
		expect(releaseDate('2026-11-06T09:00:00Z', 'ru')).toBe('6 ноября 2026 г.');
	});

	it('leaves out a date it cannot read', () => {
		expect(releaseDate('soon', 'en')).toBe('');
		expect(releaseDate(null, 'en')).toBe('');
	});
});
