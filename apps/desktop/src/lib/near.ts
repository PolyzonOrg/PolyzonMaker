/** `{@attach near(() => …)}`: runs it once the element comes within a screen of being seen, in the box that
 *  scrolls it; an element far down a long list costs nothing until then. */
export const near = (then: () => void) => (node: HTMLElement) => {
	let box = node.parentElement;
	while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
	const watch = new IntersectionObserver(
		(seen) => {
			if (!seen.some((e) => e.isIntersecting)) return;
			watch.disconnect();
			then();
		},
		{ root: box, rootMargin: '100% 0px' }
	);
	watch.observe(node);
	return () => watch.disconnect();
};
