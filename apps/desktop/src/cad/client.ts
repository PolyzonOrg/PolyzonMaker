/**
 * Builds a CAD program in a worker of its own. One spare worker is always warming up, so a build starts
 * at once instead of after the kernels' seconds of loading, and a worker that ran a program is thrown
 * away with all it did.
 */
import type { Built, BuiltPart, CadRequest, CadResponse } from './cad.worker';
import CadWorker from './cad.worker.ts?worker';

export type { Built, BuiltPart };

export class CadError extends Error {
	constructor(
		message: string,
		readonly line: number | null,
		readonly params: Built['params']
	) {
		super(message);
	}
}

/** The kernels hold hundreds of megabytes: a spare nobody took goes away soon after the page does. */
const SPARE_IDLE_MS = 120_000;
let spare: Worker | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;

/** Gets a worker warming; the page calls this when it opens, and each build calls it for the next one. */
export function warm() {
	spare ??= new CadWorker({ name: 'cad' });
	clearTimeout(idle);
	idle = setTimeout(() => {
		spare?.terminate();
		spare = null;
	}, SPARE_IDLE_MS);
}

export function build(request: CadRequest, signal?: AbortSignal): Promise<Built> {
	warm();
	const worker = spare!;
	spare = null;
	warm();
	return new Promise((resolve, reject) => {
		const done = () => {
			worker.terminate();
			signal?.removeEventListener('abort', abort);
		};
		const abort = () => {
			done();
			reject(new DOMException('Aborted', 'AbortError'));
		};
		if (signal?.aborted) return abort();
		signal?.addEventListener('abort', abort, { once: true });
		worker.onmessage = (e: MessageEvent<CadResponse>) => {
			if ('ready' in e.data) return;
			done();
			if (e.data.ok) resolve(e.data);
			else reject(new CadError(e.data.error, e.data.line, e.data.params));
		};
		worker.onerror = (e) => {
			done();
			reject(new CadError(e.message || 'The build stopped.', null, []));
		};
		worker.postMessage(request);
	});
}

/** The whole model as one binary STL. */
export function stlOf(parts: BuiltPart[]): Uint8Array {
	const count = parts.reduce((n, p) => n + p.triangles.length / 9, 0);
	const out = new Uint8Array(84 + count * 50);
	const view = new DataView(out.buffer);
	view.setUint32(80, count, true);
	let at = 84;
	for (const { triangles } of parts) {
		for (let i = 0; i < triangles.length; i += 9) {
			for (let k = 0; k < 9; k++) view.setFloat32(at + 12 + k * 4, triangles[i + k], true);
			at += 50;
		}
	}
	return out;
}
