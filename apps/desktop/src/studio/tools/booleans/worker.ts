/**
 * One Web Worker per tool page for the manifold work. The worker stays alive
 * between builds, so it keeps the loaded WASM and whatever the tool caches
 * (the uploaded mesh, the hollow's cavity); a build that is cancelled while
 * running terminates it, and the next build starts a fresh one.
 */
import { readableError, ToolError } from '../build.svelte';
import * as m from '$msg/tools/booleans';

interface Reply<R> {
	id: number;
	result?: R;
	error?: string;
	user?: boolean;
	/** 0…1 while the job runs. */
	progress?: number;
}

export class ToolWorker {
	private worker: Worker | null = null;
	private seq = 0;
	private stop: (() => void) | null = null;
	/**
	 * The model (`key` + `tris` in the message) this worker already holds.
	 * The tool workers cache the uploaded model by key, so a job for the same
	 * file goes without its triangles — tens of MB per slider move otherwise.
	 */
	private heldKey: string | null = null;

	constructor(private spawn: () => Worker) {}

	run<R>(
		message: object,
		signal?: AbortSignal,
		transfer: Transferable[] = [],
		onProgress?: (fraction: number) => void
	): Promise<R> {
		// One job at a time: a job still running is dropped with its worker.
		this.stop?.();
		return new Promise<R>((resolve, reject) => {
			if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
			if (!this.worker) {
				this.worker = this.spawn();
				this.heldKey = null;
			}
			const worker = this.worker;
			const id = ++this.seq;
			const key = 'key' in message && typeof message.key === 'string' ? message.key : null;
			const carriesModel = key !== null && 'tris' in message;
			let payload = message;
			if (carriesModel && key === this.heldKey) {
				payload = Object.fromEntries(Object.entries(message).filter(([name]) => name !== 'tris'));
			}
			const done = () => {
				worker.removeEventListener('message', onMessage);
				worker.removeEventListener('error', onError);
				signal?.removeEventListener('abort', abort);
				this.stop = null;
			};
			const kill = () => {
				done();
				worker.terminate();
				if (this.worker === worker) {
					this.worker = null;
					this.heldKey = null;
				}
			};
			const abort = () => {
				kill();
				reject(new DOMException('Aborted', 'AbortError'));
			};
			const onMessage = (event: MessageEvent<Reply<R>>) => {
				if (event.data.id !== id) return;
				if (event.data.progress !== undefined) return onProgress?.(event.data.progress);
				done();
				if (event.data.error === undefined) {
					// The worker built from this model, so it holds it now.
					if (carriesModel) this.heldKey = key;
					resolve(event.data.result as R);
				} else {
					// A failed load may have dropped the model it held before.
					if (carriesModel) this.heldKey = null;
					reject(event.data.user ? new ToolError(event.data.error) : new Error(event.data.error));
				}
			};
			const onError = (event: ErrorEvent) => {
				event.preventDefault();
				kill();
				// Out of memory and similar: the browser gives no useful text.
				reject(new ToolError(m.t_booleans_out_of_memory()));
			};
			this.stop = abort;
			worker.addEventListener('message', onMessage);
			worker.addEventListener('error', onError);
			signal?.addEventListener('abort', abort, { once: true });
			worker.postMessage({ ...payload, id }, payload === message ? transfer : []);
		});
	}

	dispose(): void {
		this.stop?.();
		this.worker?.terminate();
		this.worker = null;
		this.heldKey = null;
	}
}

/** Worker side: answer every message with `handle`'s result or a readable error. */
export function serve<M>(
	handle: (message: M, progress: (fraction: number) => void) => Promise<[unknown, Transferable[]]>
): void {
	const scope = self as unknown as Worker;
	let queue = Promise.resolve();
	scope.onmessage = (event: MessageEvent<M & { id: number }>) => {
		const { id } = event.data;
		queue = queue.then(async () => {
			try {
				let last = -1;
				const progress = (fraction: number) => {
					const p = Math.round(Math.min(0.99, Math.max(0, fraction)) * 100) / 100;
					if (p !== last) scope.postMessage({ id, progress: (last = p) });
				};
				const [result, transfer] = await handle(event.data, progress);
				scope.postMessage({ id, result }, transfer);
			} catch (e) {
				scope.postMessage({ id, error: readableError(e), user: e instanceof ToolError });
			}
		});
	};
}
