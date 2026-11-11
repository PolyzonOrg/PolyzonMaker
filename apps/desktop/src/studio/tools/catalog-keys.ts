/**
 * The tool catalog's keyboard (routes/workspace/tools): what a key in the
 * search field does, and when «/» anywhere on the page jumps to the search.
 */

/** In the search field: empty it, open the best match, or step into the results. */
export type SearchKeyAction = 'clear' | 'open' | 'results' | null;

export function searchKeyAction(
	e: Pick<KeyboardEvent, 'key' | 'isComposing'>,
	typed: string
): SearchKeyAction {
	// A word still being composed (an input method): its keys are not ours.
	if (e.isComposing) return null;
	if (e.key === 'Escape') return typed ? 'clear' : null;
	// Enter and ↓ need something to search for; spaces alone are not.
	if (!typed.trim()) return null;
	if (e.key === 'Enter') return 'open';
	return e.key === 'ArrowDown' ? 'results' : null;
}

type ShortcutKey = Pick<
	KeyboardEvent,
	'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>;

/**
 * A bare «/» (by character or by the key itself, for layouts where it types
 * something else), not while the user is typing into a field of their own.
 */
export function isSearchShortcut(e: ShortcutKey, inField: boolean): boolean {
	if (e.key !== '/' && e.code !== 'Slash') return false;
	if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
	return !inField;
}
