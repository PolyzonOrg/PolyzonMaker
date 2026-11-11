/** A click that acts at once: the second click of a double-click is ignored; the keyboard goes through. */
export function singleClick(fn: () => void) {
	return (event: Pick<MouseEvent, 'detail'>) => {
		if (event.detail < 2) fn();
	};
}
