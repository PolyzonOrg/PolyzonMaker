import * as m from '$msg/common';

/**
 * Wording for the fallback after a failed clipboard write: the text is left
 * selected, and the user is told how to finish the copy on *this* device —
 * a keyboard shortcut only exists where a keyboard does. `selected` is the
 * caller's own message («ссылка выделена»).
 */
export function manualCopyHint(selected: string): string {
	if (typeof window === 'undefined') return m.common_copy_failed({ selected });
	const keyboard = window.matchMedia('(pointer: fine)').matches;
	const mac = /Mac|iPhone|iPad/.test(navigator.platform);
	const how = keyboard
		? m.common_copy_press({ keys: mac ? '⌘C' : 'Ctrl+C' })
		: m.common_copy_manually();
	return m.common_copy_failed_how({ selected, how });
}
