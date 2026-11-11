/**
 * Rebuild-on-change for a tool: debounce the parameters, cancel the build
 * that is still running, keep the last good result on screen while the next
 * one computes, and turn failures into one readable line.
 *
 *   const result = createBuild((p, signal) => buildBox(p, signal));
 *   $effect(() => result.run({ ...params }));
 *   <ToolShell stl={result.stl} busy={result.busy} error={result.error} … />
 */
import { untrack } from 'svelte';
import * as tc from '$msg/tools/common';
export interface BuildState<R> {
	readonly value: R | null;
	readonly busy: boolean;
	readonly error: string | null;
	/**
	 * The parameters changed since the result on screen was built, and the
	 * build waits for `flush()`: see `manualAfterMs`.
	 */
	readonly stale: boolean;
	/** Schedule a build with these parameters (debounced). */
	run(params: unknown, delayMs?: number): void;
	/** Build the waiting parameters now («Пересобрать»). */
	flush(): void;
	/** Back to rebuilding on every change (a new model was loaded). */
	fresh(): void;
	/** Drop the pending/running build (component teardown). */
	cancel(): void;
}

/** A build slower than this switches a mesh tool to «Пересобрать» (DESIGN_CODE §9). */
export const SLOW_BUILD_MS = 2000;

export interface BuildOptions {
	/**
	 * Once a build took longer than this (ms), later changes wait for
	 * `flush()` instead of rebuilding on every slider move: a dense uploaded
	 * model would otherwise restart a minute-long job each time.
	 */
	manualAfterMs?: number;
}

export function createBuild<P, R>(
	build: (params: P, signal: AbortSignal) => Promise<R>,
	defaultDelayMs = 350,
	options: BuildOptions = {}
): BuildState<R> {
	let value = $state<R | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let stale = $state(false);
	let manual = false;
	let waiting: unknown = undefined;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;
	let startedAt = 0;

	function cancel() {
		if (timer) clearTimeout(timer);
		timer = null;
		controller?.abort();
		controller = null;
		busy = false;
	}

	function run(params: unknown, delayMs = defaultDelayMs) {
		const slowRunning =
			options.manualAfterMs !== undefined &&
			controller !== null &&
			performance.now() - startedAt > options.manualAfterMs;
		if (slowRunning) {
			// Let the long build finish instead of restarting it from zero.
			manual = true;
			waiting = params;
			stale = true;
			return;
		}
		// Untracked: run() is called from the tool's $effect, which must not
		// re-run (and mark the new result stale) each time a build lands.
		if (manual && untrack(() => value !== null)) {
			cancel();
			waiting = params;
			stale = true;
			return;
		}
		cancel();
		busy = true;
		timer = setTimeout(() => void execute(params), delayMs);
	}

	function flush() {
		if (!stale) return;
		const params = waiting;
		waiting = undefined;
		stale = false;
		cancel();
		busy = true;
		void execute(params);
	}

	function fresh() {
		// A build of the previous model is of no use any more.
		cancel();
		manual = false;
		stale = false;
		waiting = undefined;
	}

	async function execute(params: unknown) {
		timer = null;
		const own = new AbortController();
		controller = own;
		busy = true;
		startedAt = performance.now();
		try {
			const next = await build(params as P, own.signal);
			if (own.signal.aborted) return;
			value = next;
			error = null;
			if (options.manualAfterMs && performance.now() - startedAt > options.manualAfterMs) {
				manual = true;
			}
		} catch (e) {
			if (own.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
			error = readableError(e);
		} finally {
			if (controller === own) {
				busy = false;
				controller = null;
			}
		}
	}

	return {
		get value() {
			return value;
		},
		get busy() {
			return busy;
		},
		get error() {
			return error;
		},
		get stale() {
			return stale;
		},
		run,
		flush,
		fresh,
		cancel
	};
}

/** Errors meant for the user are thrown as ToolError; anything else is ours. */
export class ToolError extends Error {}

export function readableError(e: unknown): string {
	if (e instanceof ToolError) return e.message;
	const message = e instanceof Error ? e.message : String(e);
	// OpenSCAD compiler lines are useful to nobody using a form.
	if (/ERROR|WARNING|CGAL|Parser error/i.test(message)) {
		return tc.tc_build_failed_params();
	}
	return message.length < 160 ? message : tc.tc_build_failed();
}
