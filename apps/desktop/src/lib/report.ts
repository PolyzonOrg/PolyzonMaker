// The window's own errors, for the anonymous reports: the kind and the place in the code, never the
// message, which can hold a file name.
import { core, failedCommand } from './core';

/** A page stuck in a loop reports a few times, not thousands. */
const MOST = 5;
const told = new Set<string>();
const FILE = /\/([A-Za-z]+)[-.\w]*\.(?:js|ts|svelte)(?:\?[^:]*)?$/;

/** The window's own error without an error object: its place in the code. A layout that settles a frame later is no error. */
function windowError(e: ErrorEvent): string {
	if (/ResizeObserver loop/.test(e.message)) return '';
	const file = FILE.exec(e.filename ?? '')?.[1];
	return file ? `script_${file}_${e.lineno}_${e.colno}` : 'script';
}

export function errorCode(error: unknown): string {
	if (error instanceof Event && error.type === 'error' && !(error as ErrorEvent).error) return windowError(error as ErrorEvent);
	if (!(error instanceof Error)) {
		const command = failedCommand(error);
		return command ? `call_${command}` : `thrown_${typeof error}`;
	}
	const place = /\/([A-Za-z]+)[-.\w]*\.(?:js|ts|svelte)(?:\?[^:]*)?:(\d+):(\d+)/.exec(error.stack ?? '');
	return place ? `${error.name}_${place[1]}_${place[2]}_${place[3]}` : error.name;
}

export function reportError(error: unknown) {
	const code = errorCode(error);
	if (!code || told.has(code) || told.size >= MOST) return;
	told.add(code);
	void core.report('ui_error', '', '', code);
}
