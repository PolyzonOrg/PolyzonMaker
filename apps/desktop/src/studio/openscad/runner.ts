// OpenSCAD WASM runner — thin facade around a per-call Web Worker.
//
// The actual compilation happens in `runner.worker.ts` so heavy CGAL operations
// don't block the main thread. This keeps the UI responsive (spinner, cancel
// button, "X seconds elapsed" counter) and prevents Chrome's "Page not
// responding" dialog on long compiles.
//
// Design notes (why no module-level singleton):
//  - In an SPA, ES modules are loaded once and their state persists across
//    route navigations. A module-level `currentWorker` shared across calls
//    causes subtle leaks: an in-flight worker may stay alive after the user
//    navigates away from /workspace/scad, and stale references from one
//    page session can interfere with the next.
//  - Instead, each `compileScad()` invocation OWNS its own Worker instance
//    and ties its lifetime to an optional AbortSignal. Caller passes a fresh
//    AbortController per request; on navigate-away or new request the caller
//    aborts the previous one. No global state, no leaks.
//
// API:
//   await compileScad(source, { signal })  // owns its worker; aborts on signal
//   await preloadOpenScad()                // warm browser cache (call on mount)

import OpenScadWorker from './runner.worker.ts?worker';
import * as m from '$msg/scad/shared';

/** Max time we wait for the worker's `ready` handshake before giving up. */
const WORKER_READY_TIMEOUT_MS = 10_000;

export interface CompileOptions {
	/** Abort signal — caller's AbortController.signal. When aborted, worker
	 *  is terminated and the promise rejects with an AbortError. */
	signal?: AbortSignal;
	/** Extra input files written next to the source before compiling, for
	 *  `import("shape.svg")`, `import("part.stl")`, `surface("photo.png")`.
	 *  Keys are plain file names (no folders). */
	files?: Record<string, Uint8Array | string>;
	/** 'svg' exports a 2D result as SVG — 10–20× faster than extruding it to
	 *  STL, for programs that only draw outlines (text, imported SVG). */
	format?: 'stl' | 'svg';
	/** Font files for text(), written into OpenSCAD's /fonts (plain names). */
	fonts?: Record<string, Uint8Array>;
	/** Receives the ECHO/WARNING lines of a successful build. */
	onLog?: (log: string) => void;
}

// The free tools compile one small program per text edit; starting the WASM
// takes far longer than drawing the text. warmScad() keeps one worker loaded
// ahead (with the font): the next compile takes it, and a new spare starts.
// An unused spare is dropped after a while, so it never outlives the tools.
const SPARE_IDLE_MS = 120_000;
let spare: Worker | null = null;
let spareTimer: ReturnType<typeof setTimeout> | null = null;

export function warmScad(): void {
	if (spareTimer) clearTimeout(spareTimer);
	spareTimer = setTimeout(() => {
		spare?.terminate();
		spare = null;
	}, SPARE_IDLE_MS);
	if (spare) return;
	try {
		spare = new OpenScadWorker();
		spare.postMessage({ kind: 'warm' });
	} catch {
		spare = null;
	}
}

function takeSpare(): Worker | null {
	const w = spare;
	spare = null;
	if (w) warmScad();
	return w;
}

/**
 * Compile an OpenSCAD source string to STL binary (or SVG for a 2D result).
 * Each call owns its own Web Worker — a warm spare if warmScad() made one;
 * pass a `signal` to cancel.
 */
export function compileScad(source: string, opts: CompileOptions = {}): Promise<Uint8Array> {
	return new Promise<Uint8Array>((resolve, reject) => {
		let w: Worker;
		try {
			w = takeSpare() ?? new OpenScadWorker();
		} catch (e) {
			reject(new Error(`Cannot spawn worker: ${e instanceof Error ? e.message : String(e)}`));
			return;
		}

		let settled = false;
		let ready = false;
		let readyTimeout: ReturnType<typeof setTimeout> | null = null;
		const signal = opts.signal;

		const finish = (err?: Error, stl?: Uint8Array) => {
			if (settled) return;
			settled = true;
			if (readyTimeout) {
				clearTimeout(readyTimeout);
				readyTimeout = null;
			}
			signal?.removeEventListener('abort', onAbort);
			try {
				w.terminate();
			} catch {
				/* noop */
			}
			if (err) reject(err);
			else if (stl) resolve(stl);
			else reject(new Error('worker returned no result'));
		};

		const onAbort = () => {
			finish(new DOMException('compileScad aborted', 'AbortError'));
		};
		if (signal) {
			if (signal.aborted) {
				try {
					w.terminate();
				} catch {
					/* noop */
				}
				reject(new DOMException('compileScad aborted', 'AbortError'));
				return;
			}
			signal.addEventListener('abort', onAbort, { once: true });
		}

		w.onmessage = (
			e: MessageEvent<{ kind: string; stl?: ArrayBuffer; message?: string; log?: string }>
		) => {
			const msg = e.data;
			if (!msg) return;
			if (msg.kind === 'ready') {
				// Worker module fully loaded — safe to hand it the source.
				ready = true;
				if (readyTimeout) {
					clearTimeout(readyTimeout);
					readyTimeout = null;
				}
				w.postMessage({
					kind: 'compile',
					source,
					files: opts.files,
					format: opts.format,
					fonts: opts.fonts
				});
				return;
			}
			if (msg.kind === 'success' && msg.stl) {
				opts.onLog?.(msg.log ?? '');
				finish(undefined, new Uint8Array(msg.stl));
				return;
			}
			if (msg.kind === 'error') {
				finish(new Error(msg.message ?? 'compile failed'));
				return;
			}
			// Unknown kind — log and ignore.
			console.warn('compileScad: unknown worker message', msg);
		};
		w.onerror = (e: ErrorEvent) => {
			finish(new Error(e.message || 'worker error'));
		};
		w.onmessageerror = () => {
			finish(new Error('worker messageerror (deserialization failed)'));
		};

		// Send ping AFTER handlers are bound — worker replies with `ready`
		// only once its module has finished loading. This avoids the race
		// where worker could fire ready before our handler was attached.
		w.postMessage({ kind: 'ping' });

		// Watchdog: if no `ready` within 10s, the worker bundle didn't load
		// (stale build hash, CSP block, network failure with no error event).
		readyTimeout = setTimeout(() => {
			if (ready) return;
			// The hard-reload shortcut only exists where a keyboard does (phones see this too).
			const keyboard =
				typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
			const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
			const seconds = WORKER_READY_TIMEOUT_MS / 1000;
			// The text is in the page's language; callers recognise the failure by the flag.
			const error = new Error(
				keyboard
					? m.scad_worker_timeout_keys({
							count: seconds,
							n: seconds,
							keys: mac ? '⌘+Shift+R' : 'Ctrl+Shift+R'
						})
					: m.scad_worker_timeout({ count: seconds, n: seconds })
			);
			finish(Object.assign(error, { unavailable: true }));
		}, WORKER_READY_TIMEOUT_MS);
	});
}

/**
 * Back-compat shim. Callers used to invoke `cancelCompile()` to nuke a global
 * in-flight worker. Now compileScad takes an AbortSignal — this function is a
 * no-op kept so older imports don't break the build. New code should use signal.
 */
export function cancelCompile(): void {
	/* no-op — compileScad is now per-call with AbortSignal */
}

/**
 * Warm the browser's HTTP cache so the first real compile is faster.
 * Done from the main thread via fetch — no worker spin-up overhead.
 * Fire-and-forget on page mount; never throws.
 */
export async function preloadOpenScad(): Promise<void> {
	const base = '/openscad/';
	try {
		// The bootstrap is imported as `openscad.wasm.js?instance=1` by every
		// fresh worker (see static/openscad/openscad.js), so warm exactly that
		// URL. Noto Sans (825 KB) is deliberately not here: the worker fetches
		// it only for sources that can render text.
		await Promise.all([
			fetch(base + 'openscad.js'),
			fetch(base + 'openscad.wasm.js?instance=1'),
			fetch(base + 'openscad.wasm'),
			fetch(base + 'openscad.fonts-lite.js')
		]);
	} catch {
		/* offline / cache-miss — first compile will fetch lazily */
	}
}
