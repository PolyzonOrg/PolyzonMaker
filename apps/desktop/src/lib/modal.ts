// A modal's keys, as the APG dialog pattern has them: focus goes in when it opens, Tab and Shift+Tab go round
// inside it, Escape closes it, and focus goes back where it was when it closes. Only the modal on top hears
// them, so a dialog over a picture viewer closes alone. Studio's own Dialog does the same for its tools.

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const open: HTMLElement[] = [];

/** Where Tab goes from stop `at` of `count` (-1: from outside them): round past either end, else `null`, the browser's own step. */
export function wrap(count: number, at: number, back: boolean): number | null {
	if (at < 0) return back ? count - 1 : 0;
	if (back && at === 0) return count - 1;
	if (!back && at === count - 1) return 0;
	return null;
}

/** Where focus goes as it opens: the first button, unless the dialog marks another */
const first = (node: HTMLElement) => node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>('button:not([disabled])') ?? node;

/** Tab inside: round past either end; a modal with nothing to stop at keeps the focus itself. */
function tab(node: HTMLElement, e: KeyboardEvent) {
	const stops = [...node.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.getClientRects().length > 0);
	const to = stops.length ? wrap(stops.length, stops.indexOf(document.activeElement as HTMLElement), e.shiftKey) : -1;
	if (to === null) return;
	e.preventDefault();
	(stops[to] ?? node).focus();
}

/** `{@attach modal(() => onclose())}` on the element with role="dialog" */
export const modal = (close: () => void) => (node: HTMLElement) => {
	const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	open.push(node);
	queueMicrotask(() => first(node).focus());

	function keys(e: KeyboardEvent) {
		if (open.at(-1) !== node || e.defaultPrevented) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		} else if (e.key === 'Tab') tab(node, e);
	}

	document.addEventListener('keydown', keys);
	return () => {
		document.removeEventListener('keydown', keys);
		open.splice(open.indexOf(node), 1);
		// what opened it may have gone with what it did, a deleted model's button
		if (before?.isConnected) before.focus();
	};
};
