import { currentLocale } from './current';

/**
 * The name of a tool's module worker, carrying the page language into it (read by
 * ./page-locale.ts), so a message thrown in the worker reaches the user in that language:
 *
 *   new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module', name: workerName('x') })
 *
 * `type: 'module'` stays a literal in the call: Vite reads it from there.
 */
export function workerName(name = 'tool'): string {
	return `${name}@${currentLocale()}`;
}
