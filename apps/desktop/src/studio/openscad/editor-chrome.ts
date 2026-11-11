/** Decisions of the code editor's frame (ScadEditor.svelte): keys, line wrap, the status line. */
import type { ScadDiagnostic } from './diagnostics';

/** What a key pressed inside the editor does while it fills the screen. */
export type FullscreenKey = 'close' | 'trap' | null;

/**
 * Escape leaves fullscreen and Tab stays inside it. CodeMirror sets
 * defaultPrevented when it used the key itself (completion, search panel,
 * selection, snippet fields, indentation), and then the frame keeps out.
 */
export function fullscreenKey(
	event: { key: string; defaultPrevented: boolean },
	fullscreen: boolean
): FullscreenKey {
	if (!fullscreen || event.defaultPrevented) return null;
	if (event.key === 'Escape') return 'close';
	return event.key === 'Tab' ? 'trap' : null;
}

/**
 * Tab at an end of the fullscreen editor wraps to the other end: the index
 * to focus, or null to let the browser move focus. `active` is the index of
 * the focused element among the `count` focusable ones (-1: none of them).
 */
export function wrapFocus(count: number, active: number, backwards: boolean): number | null {
	if (count === 0) return null;
	if (backwards) return active === 0 ? count - 1 : null;
	return active === count - 1 ? 0 : null;
}

/** Line wrap as the user last set it; on first visit on by default below 1024 px. */
export function initialWrap(saved: string | null, viewportWidth: number): boolean {
	if (saved === null) return viewportWidth < 1024;
	return saved === '1';
}

/** The message the status line shows: the first error, else the first diagnostic of any kind. */
export function statusMessage(diagnostics: readonly ScadDiagnostic[]): string | null {
	const shown = diagnostics.find((d) => d.severity === 'error') || diagnostics[0];
	return shown ? shown.message : null;
}
