import { afterEach, describe, expect, it } from 'vitest';
import { lang, t, type Key } from './i18n.svelte';

afterEach(() => {
	lang.value = 'en';
});

describe('a text the app has no words for', () => {
	it('is never «undefined»: a stage, device or note named at run time says its own name', () => {
		expect(t('job.decimate' as Key)).toBe('decimate');
		expect(t('device.rocm' as Key)).toBe('rocm');
		lang.value = 'ru';
		expect(t('job.note.something_new' as Key)).toBe('something_new');
	});

	it('leaves the texts it has as they are, with their values', () => {
		lang.value = 'ru';
		expect(t('nav.menu')).toBe('Меню');
		expect(t('job.deleteFailed', { why: 'x' })).toBe('Не получилось удалить. x');
	});
});
