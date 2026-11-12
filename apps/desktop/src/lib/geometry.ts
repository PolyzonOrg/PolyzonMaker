// The page's side of the geometry worker: a promise per request, and a fresh worker per model, so a
// heavy model's memory goes away with it.
import type { Provenance } from '@polyzon/mesh-kit';
import type { Opened, Prepared, Request } from './geometry.worker';

export type { Opened, Prepared };

export class Geometry {
	private worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
	private waiting = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
	private next = 1;
	onStage: (stage: string) => void = () => {};

	constructor() {
		this.worker.onmessage = (e) => {
			if (e.data.stage) return this.onStage(e.data.stage);
			const pending = this.waiting.get(e.data.id);
			this.waiting.delete(e.data.id);
			if (e.data.error) pending?.reject(new Error(e.data.error));
			else pending?.resolve(e.data.value as never);
		};
		// a worker that cannot start says so here and nowhere else
		this.worker.onerror = (e) => {
			for (const pending of this.waiting.values()) pending.reject(new Error(e.message || 'the geometry worker did not start'));
			this.waiting.clear();
		};
	}

	private call<T>(req: Request, transfer: Transferable[] = []): Promise<T> {
		const id = this.next++;
		return new Promise<T>((resolve, reject) => {
			this.waiting.set(id, { resolve: resolve as (v: never) => void, reject });
			this.worker.postMessage({ id, ...req }, transfer);
		});
	}

	open(bytes: Uint8Array, finished: boolean) {
		return this.call<Opened>({ op: 'open', bytes, finished }, [bytes.buffer as ArrayBuffer]);
	}

	/** `solid`: the model rebuilt as one solid body on a grid, when the person asked for it; `provenance`: an AI made it */
	prepare(height: number, name: string, solid = false, provenance?: Provenance) {
		return this.call<Prepared>({ op: 'prepare', height, name, solid, provenance });
	}

	/** The screen's picture of print files made before, placed over the opened model */
	printed(stl: Uint8Array) {
		return this.call<Float32Array>({ op: 'printed', stl }, [stl.buffer as ArrayBuffer]);
	}

	close() {
		this.worker.terminate();
	}
}
