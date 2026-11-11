/**
 * Which collapsible sections the viewer closed (DESIGN_CODE §7.9): a
 * convenience of this browser only, so a blocked storage just keeps them open.
 */
const PREFIX = 'collapsed:';

/** Whether the viewer folded the section (`fallback` until they chose either way). */
export function isCollapsed(key: string, fallback = false): boolean {
	try {
		const stored = localStorage.getItem(PREFIX + key);
		return stored === null ? fallback : stored === '1';
	} catch {
		return fallback;
	}
}

/** The choice is kept both ways, so a section folded at first can be opened for good. */
export function setCollapsed(key: string, collapsed: boolean): void {
	try {
		localStorage.setItem(PREFIX + key, collapsed ? '1' : '0');
	} catch {
		/* private mode */
	}
}
