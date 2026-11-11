/**
 * One heavy computation per Web Worker (the voxelizer and the texturizer
 * share this): the worker receives the input once, reports progress and
 * answers with the result or an error. Cancelling a build terminates the
 * worker, so the work itself stays plain synchronous code. Pure — nothing
 * here touches Svelte or the DOM, the worker bundle imports it.
 */

/** A failure meant for the user: its message is shown as is. */
export class MeshError extends Error {}

export type Progress = (label: string, percent: number) => void;

export type JobReply<R> =
	| { type: 'progress'; label: string; percent: number }
	| { type: 'done'; result: R }
	| { type: 'error'; message: string; user: boolean };

/** Worker side: run `work` on every message, post its result or error. */
export function serveJob<I, R>(work: (input: I, progress: Progress) => [R, Transferable[]]): void {
	const scope = self as unknown as Worker;
	const post = (reply: JobReply<R>, transfer: Transferable[] = []) =>
		scope.postMessage(reply, transfer);
	scope.onmessage = (event: MessageEvent<I>) => {
		let last = '';
		const progress: Progress = (label, percent) => {
			const p = Math.max(0, Math.min(100, Math.round(percent)));
			if (`${label}${p}` === last) return;
			last = `${label}${p}`;
			post({ type: 'progress', label, percent: p });
		};
		try {
			const [result, transfer] = work(event.data, progress);
			post({ type: 'done', result }, transfer);
		} catch (e) {
			post({
				type: 'error',
				message: e instanceof Error ? e.message : String(e),
				user: e instanceof MeshError
			});
		}
	};
}
