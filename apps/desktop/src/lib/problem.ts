import { allKeys, t, type Key } from './i18n.svelte';

// The system's error numbers worth saying in words, by what each means where it came from: 5 is «access
// denied» on Windows and an input/output error on macOS and Linux. The number, not the system's own words,
// which come in its language.
const WINDOWS: Record<number, string> = { 2: 'NOT_FOUND', 3: 'NOT_FOUND', 5: 'DENIED', 32: 'IN_USE', 33: 'IN_USE', 39: 'DISK_FULL', 112: 'DISK_FULL' };
const UNIX: Record<number, string> = { 1: 'DENIED', 2: 'NOT_FOUND', 13: 'DENIED', 16: 'IN_USE', 28: 'DISK_FULL', 30: 'DENIED' };

/** What a person is told when a call failed, after what did not work («Не получилось удалить.»): the core's
 *  code or the system's error in words, else what was said, as details. */
export function problem(e: unknown, windows = /Windows/.test(globalThis.navigator?.userAgent ?? '')): string {
	const said = e instanceof Error ? e.message : String(e);
	if (!said.trim()) return t('app.actionFailed');
	const number = /\(os error (\d+)\)/.exec(said)?.[1];
	// a code is a word in capitals (DISK_FULL): «detail», said as it is, is no key of ours
	const code = number ? (windows ? WINDOWS : UNIX)[+number] : /^[A-Z][A-Z0-9_]+$/.test(said) ? said : '';
	const key = `error.${code}`;
	return allKeys.en.includes(key) ? t(key as Key) : t('error.detail', { said });
}
