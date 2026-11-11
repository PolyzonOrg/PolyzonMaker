/**
 * Page side of `serveJob`: start a worker for one build, forward progress,
 * terminate it when the build is cancelled or done.
 */
import * as m from '$msg/tools/voxelizer';
import { ToolError } from '../build.svelte';
import type { JobReply, Progress } from './worker-job';

export function runJob<R>(
	createWorker: () => Worker,
	input: unknown,
	signal: AbortSignal,
	onProgress?: Progress
): Promise<R> {
	return new Promise<R>((resolve, reject) => {
		if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
		const worker = createWorker();
		const finish = () => {
			signal.removeEventListener('abort', abort);
			worker.terminate();
		};
		const abort = () => {
			finish();
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal.addEventListener('abort', abort, { once: true });
		worker.onmessage = (event: MessageEvent<JobReply<R>>) => {
			const reply = event.data;
			if (reply.type === 'progress') {
				onProgress?.(reply.label, reply.percent);
				return;
			}
			finish();
			if (reply.type === 'done') resolve(reply.result);
			else reject(reply.user ? new ToolError(reply.message) : new Error(reply.message));
		};
		worker.onerror = (event) => {
			event.preventDefault();
			finish();
			// Out of memory and similar: the browser gives no useful text.
			reject(new ToolError(m.t_voxelizer_out_of_memory()));
		};
		worker.postMessage(input);
	});
}
