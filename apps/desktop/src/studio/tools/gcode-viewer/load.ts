/**
 * Read an uploaded G-code file in a worker. One worker per file, terminated
 * when done or when the signal aborts (a new file was chosen, the page left).
 */
import { ToolError } from '../build.svelte';
import { workerName } from '$lib/i18n/worker';
import * as m from '$msg/tools/gcode-viewer';
import type { Toolpath } from './parse';

export function parseGcodeFile(
	file: File,
	signal: AbortSignal,
	onProgress: (share: number) => void
): Promise<Toolpath> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), {
			type: 'module',
			name: workerName('gcode')
		});
		const stop = () => {
			worker.terminate();
			reject(new DOMException(m.t_gcode_viewer_cancelled(), 'AbortError'));
		};
		signal.addEventListener('abort', stop, { once: true });
		const done = () => {
			signal.removeEventListener('abort', stop);
			worker.terminate();
		};
		worker.onmessage = (event: MessageEvent) => {
			const data = event.data as
				| { kind: 'progress'; value: number }
				| { kind: 'done'; toolpath: Toolpath }
				| { kind: 'error'; message: string };
			if (data.kind === 'progress') onProgress(data.value);
			else if (data.kind === 'done') {
				done();
				resolve(data.toolpath);
			} else {
				done();
				reject(new ToolError(data.message || m.t_gcode_viewer_read_failed()));
			}
		};
		worker.onerror = () => {
			done();
			reject(new ToolError(m.t_gcode_viewer_read_failed()));
		};
		worker.postMessage({ file });
	});
}
