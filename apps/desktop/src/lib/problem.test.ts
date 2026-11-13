import { afterEach, describe, expect, it } from 'vitest';
import { lang } from './i18n.svelte';
import { problem } from './problem';

afterEach(() => {
	lang.value = 'en';
});

describe('what a person is told when a call failed', () => {
	it('says the core’s code in words', () => {
		expect(problem('DISK_FULL')).toBe('The disk is full. Free some space and try again.');
		lang.value = 'ru';
		expect(problem('DISK_FULL')).toBe('Диск заполнен. Освободите место и попробуйте снова.');
	});

	it('says what the system’s error means, whatever language the system wrote it in', () => {
		lang.value = 'ru';
		expect(problem('Процесс не может получить доступ к файлу, так как этот файл занят другим процессом. (os error 32)', true)).toMatch(/^Файл занят другой программой/);
		expect(problem('Access is denied. (os error 5)', true)).toMatch(/^Нет доступа/);
		expect(problem('There is not enough space on the disk. (os error 112)', true)).toMatch(/^Диск заполнен/);
		expect(problem('The system cannot find the file specified. (os error 2)', true)).toMatch(/^Файл или папка не найдены/);
	});

	it('reads an error number as the system it came from means it', () => {
		// 5 is «access denied» on Windows and an input/output error elsewhere: that is not said as denied
		expect(problem('Input/output error (os error 5)', false)).toBe('Details: Input/output error (os error 5)');
		expect(problem('Permission denied (os error 13)', false)).toMatch(/^No access/);
		expect(problem('No space left on device (os error 28)', false)).toMatch(/^The disk is full/);
	});

	it('gives anything else as details, as it was said, without the name of an error type', () => {
		expect(problem(new TypeError('the model has no file'))).toBe('Details: the model has no file');
		expect(problem('the job is running')).toBe('Details: the job is running');
		expect(problem('NOT_A_CODE_WE_KNOW')).toBe('Details: NOT_A_CODE_WE_KNOW');
		lang.value = 'ru';
		expect(problem('the job is running')).toBe('Подробности: the job is running');
	});

	it('says a code it has no words for as details, and nothing said as a plain «did not work»', () => {
		expect(problem('A_CODE_OF_A_NEWER_VERSION')).toBe('Details: A_CODE_OF_A_NEWER_VERSION');
		// a word that happens to name one of the texts is not a code
		expect(problem('detail')).toBe('Details: detail');
		expect(problem('')).toBe('That did not work. Try again, and if it repeats, restart the program.');
	});
});
