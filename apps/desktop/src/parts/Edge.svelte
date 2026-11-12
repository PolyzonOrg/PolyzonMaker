<script lang="ts">
	/** A border between two areas that the person drags, or moves with the arrow keys. */
	let {
		label,
		value,
		min,
		max,
		grow = 1,
		place,
		onchange,
		onsettle,
		onstep,
		held = $bindable(false)
	}: {
		label: string;
		value: number;
		min: number;
		max: number;
		/** 1: dragging to the right widens what this edge belongs to; -1: dragging to the left does */
		grow?: 1 | -1;
		/** Where it stands, as CSS: its middle is where the line is drawn */
		place: string;
		onchange: (width: number) => void;
		onsettle: () => void;
		onstep: (by: number) => void;
		held?: boolean;
	} = $props();

	const STEP = 16;
	/** Where on the edge it was taken, so that the edge does not jump to the pointer. */
	let grip = 0;

	function press(e: PointerEvent & { currentTarget: HTMLElement }) {
		if (e.button) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		grip = e.clientX - grow * value;
		held = true;
	}

	function move(e: PointerEvent) {
		if (held) onchange(grow * (e.clientX - grip));
	}

	function letGo() {
		held = false;
		onsettle();
	}

	function key(e: KeyboardEvent) {
		const by = { ArrowLeft: -STEP, ArrowRight: STEP }[e.key];
		if (!by) return;
		e.preventDefault();
		onstep(by * grow);
	}
</script>

<!-- a focusable separator is a control: https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/ -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class="edge"
	class:held
	style={place}
	role="separator"
	tabindex="0"
	aria-label={label}
	aria-orientation="vertical"
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={value}
	onpointerdown={press}
	onpointermove={move}
	onlostpointercapture={letGo}
	onkeydown={key}
></div>

<style>
	.edge {
		position: absolute;
		z-index: 3;
		top: 0;
		bottom: 8px;
		width: 16px;
		cursor: col-resize;
		touch-action: none;
		transition:
			left 0.24s var(--ease),
			right 0.24s var(--ease);
	}

	.edge.held {
		transition: none;
	}

	.edge::after {
		content: '';
		position: absolute;
		top: 16px;
		bottom: 16px;
		left: 7px;
		width: 2px;
		border-radius: var(--r-pill);
		background: var(--ink-faint);
		opacity: 0;
		transition: opacity 0.12s;
	}

	.edge:hover::after,
	.edge.held::after,
	.edge:focus-visible::after {
		opacity: 1;
	}

	/* the keys' focus: the line itself, in the ring's colour, not hover's faint one */
	.edge:focus-visible {
		outline: none;
	}

	.edge:focus-visible::after {
		background: var(--ink);
	}
</style>
