// The page's side of worker.ts: one request, one answer.
import type { Request } from './worker';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const waiting = new Map<number, { resolve: (value: never) => void; reject: (e: Error) => void }>();
let seq = 0;

worker.onmessage = (e: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
	const { id, value, error } = e.data;
	const w = waiting.get(id);
	waiting.delete(id);
	if (error === undefined) w?.resolve(value as never);
	else w?.reject(new Error(error));
};
// a module that fails to load (CSP, missing file) ends up here, not in onmessage
worker.onerror = (e) => {
	for (const w of waiting.values()) w.reject(new Error(`worker: ${e.message || 'failed to start'}`));
	waiting.clear();
};

export function call<T>(req: Request, transfer: Transferable[] = [], ms = 300_000): Promise<T> {
	const id = ++seq;
	return new Promise<T>((resolve, reject) => {
		waiting.set(id, { resolve, reject });
		setTimeout(() => waiting.delete(id) && reject(new Error(`${req.op}: no answer in ${ms / 1000} s`)), ms);
		worker.postMessage({ id, ...req }, transfer);
	});
}
