/**
 * Compiles on the OpenSCAD page overlap: an edit starts a new one while the
 * last is still in the worker, «Отменить» and the watchdog end one early.
 * Only the newest run may touch the page; a late answer from any other is
 * dropped.
 */
export class CompileRuns {
	#latest = 0;

	/** A new run; every earlier one goes stale. */
	start(): number {
		return ++this.#latest;
	}

	/** Whether `run` is still the one the page shows. */
	current(run: number): boolean {
		return run === this.#latest;
	}

	/** Cancel or timeout: the running one goes stale too, its late answer is dropped. */
	drop(): void {
		this.#latest++;
	}
}

/**
 * The error a failed compile shows. An AbortError is a cancellation the page
 * asked for (leaving the page, a newer run), not a failure: nothing to show.
 */
export function compileFailureText(error: unknown, fallback: string): string | null {
	if (error instanceof DOMException && error.name === 'AbortError') return null;
	return error instanceof Error ? error.message : fallback;
}

export type EditorStatus = 'idle' | 'compiling' | 'error' | 'ok';

/** The editor's status bar: a running compile first, then its error, then the built model. */
export function editorStatus(
	compiling: boolean,
	error: string | null,
	built: boolean
): EditorStatus {
	if (compiling) return 'compiling';
	if (error) return 'error';
	return built ? 'ok' : 'idle';
}
