/**
 * One heavy job at a time in a Web Worker, cancellable: the worker stays
 * alive between jobs (no start-up cost on every rebuild); a cancelled job
 * terminates it, and the next job starts a fresh one.
 *
 * Worker side (see `serveMeshJobs`): reply `{ type: 'progress', stage }`
 * any number of times, then `{ type: 'done', result }` or
 * `{ type: 'error', message }`.
 */
import { ToolError } from '../build.svelte';
import * as tc from '$msg/tools/common';

export type WorkerReply<T> =
	| { type: 'progress'; stage: string }
	| { type: 'done'; result: T }
	| { type: 'error'; message: string };

export interface WorkerRunner<M, T> {
	run(
		message: M,
		signal: AbortSignal,
		options?: { transfer?: Transferable[]; onProgress?: (stage: string) => void }
	): Promise<T>;
	dispose(): void;
}

export function createWorkerRunner<M, T>(create: () => Worker): WorkerRunner<M, T> {
	let worker: Worker | null = null;

	function dispose() {
		worker?.terminate();
		worker = null;
	}

	function run(
		message: M,
		signal: AbortSignal,
		options: { transfer?: Transferable[]; onProgress?: (stage: string) => void } = {}
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			if (signal.aborted) {
				reject(new DOMException('cancelled', 'AbortError'));
				return;
			}
			const own = (worker ??= create());
			const finish = () => {
				own.onmessage = null;
				own.onerror = null;
				signal.removeEventListener('abort', onAbort);
			};
			const onAbort = () => {
				finish();
				// A job cannot be interrupted midway: drop the whole worker.
				if (worker === own) dispose();
				reject(new DOMException('cancelled', 'AbortError'));
			};
			signal.addEventListener('abort', onAbort);
			own.onmessage = (event: MessageEvent<WorkerReply<T>>) => {
				const reply = event.data;
				if (reply.type === 'progress') {
					options.onProgress?.(reply.stage);
					return;
				}
				finish();
				if (reply.type === 'done') resolve(reply.result);
				else reject(new Error(reply.message));
			};
			own.onerror = (event) => {
				event.preventDefault();
				finish();
				if (worker === own) dispose();
				reject(new Error(tc.tc_worker_failed()));
			};
			own.postMessage(message, options.transfer ?? []);
		});
	}

	return { run, dispose };
}

/**
 * Worker side: answer each message with `handle`'s result. A ToolError goes
 * to the user as it is (its text is in the page's language, see workerName);
 * anything else becomes the `fallback` line.
 */
export function serveMeshJobs<M, T>(
	handle: (message: M, progress: (stage: string) => void) => Promise<T> | T,
	transferOf: (result: T) => Transferable[] = () => [],
	fallback: string = tc.tc_build_failed()
): void {
	const scope = self as unknown as {
		onmessage: ((event: MessageEvent<M>) => void) | null;
		postMessage(message: unknown, transfer?: Transferable[]): void;
	};
	async function answer(message: M) {
		try {
			const result = await handle(message, (stage) =>
				scope.postMessage({ type: 'progress', stage })
			);
			scope.postMessage({ type: 'done', result }, transferOf(result));
		} catch (e) {
			const text = e instanceof Error ? e.message : String(e);
			const readable = e instanceof ToolError && text.length < 160;
			scope.postMessage({ type: 'error', message: readable ? text : fallback });
		}
	}
	scope.onmessage = (event) => void answer(event.data);
}
