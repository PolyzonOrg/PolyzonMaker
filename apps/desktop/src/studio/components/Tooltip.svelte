<script lang="ts">
	/**
	 * Help tooltip (DESIGN_CODE §7): an icon trigger that reveals a short
	 * explanation. Hover shows it after a short delay, keyboard focus shows it
	 * immediately, click/tap toggles it (touch devices have no hover), Escape
	 * hides it. The text is linked to the trigger with `aria-describedby`, so
	 * screen readers get it without opening anything.
	 */
	import { onDestroy } from 'svelte';
	import { CircleHelp } from 'lucide-svelte';
	import * as m from '$msg/common';

	interface Props {
		text: string;
		/** Accessible name of the trigger; defaults to a generic label. */
		label?: string;
		/** Icon size (DESIGN_CODE §8): 14 next to 12px text, 16 next to 14px. */
		size?: 14 | 16;
		class?: string;
	}
	let {
		text,
		label = m.common_tooltip_label(),
		size = 14,
		class: className = ''
	}: Props = $props();

	const id = `tip-${Math.random().toString(36).slice(2, 9)}`;
	let open = $state(false);
	let pinned = $state(false);
	let trigger = $state<HTMLButtonElement>();
	let top = $state(0);
	let left = $state(0);
	let placeAbove = $state(false);
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;

	function place() {
		if (!trigger) return;
		const rect = trigger.getBoundingClientRect();
		const width = Math.min(240, window.innerWidth - 16);
		const half = width / 2;
		left = Math.max(8 + half, Math.min(window.innerWidth - 8 - half, rect.left + rect.width / 2));
		placeAbove = rect.bottom + 120 > window.innerHeight && rect.top > 140;
		top = placeAbove ? rect.top - 6 : rect.bottom + 6;
	}

	function show() {
		place();
		open = true;
	}
	function hide() {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = null;
		if (!pinned) open = false;
	}
	function hoverIn() {
		if (hoverTimer) clearTimeout(hoverTimer);
		hoverTimer = setTimeout(show, 450);
	}
	function toggle() {
		pinned = !pinned;
		if (pinned) show();
		else open = false;
	}
	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			pinned = false;
			open = false;
		}
	}
	function onDocumentClick(event: MouseEvent) {
		if (pinned && trigger && !trigger.contains(event.target as Node)) {
			pinned = false;
			open = false;
		}
	}

	$effect(() => {
		if (!open) return;
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		document.addEventListener('click', onDocumentClick);
		return () => {
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
			document.removeEventListener('click', onDocumentClick);
		};
	});
	onDestroy(() => {
		if (hoverTimer) clearTimeout(hoverTimer);
	});
</script>

<button
	bind:this={trigger}
	type="button"
	class="tooltip-trigger {className}"
	aria-label={label}
	aria-describedby={id}
	aria-expanded={open}
	onmouseenter={hoverIn}
	onmouseleave={hide}
	onfocus={show}
	onblur={hide}
	onclick={toggle}
	onkeydown={onKey}
>
	<CircleHelp {size} aria-hidden="true" />
</button>
<!-- Always in the DOM (visually hidden when closed) so aria-describedby resolves. -->
<span
	{id}
	role="tooltip"
	class="tooltip-bubble"
	class:is-open={open}
	class:is-above={placeAbove}
	style:top={`${top}px`}
	style:left={`${left}px`}
>
	{text}
</span>

<style>
	.tooltip-trigger {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		margin: -4px 0;
		border-radius: var(--pz-radius-sm);
		color: var(--pz-color-text-muted);
		vertical-align: middle;
		cursor: help;
		transition: color var(--pz-duration-fast) var(--pz-ease-standard);
	}
	/* Touch: the 24px glyph keeps its place, the hit area grows to a centred
	   48×48 box (DESIGN_CODE §12) — invisible, no layout change. A plain
	   inset:-8px measured from the padding edge left the box a hair under 44px,
	   so the edge points of a 44px target missed it (same fix as .hit-44). */
	@media (pointer: coarse) {
		/* Above its neighbours: the 48px box reaches past the label into the
		   field below it, and the tap there belongs to the «?». */
		.tooltip-trigger {
			z-index: 1;
		}
		.tooltip-trigger::before {
			content: '';
			position: absolute;
			inset: calc(50% - 24px);
		}
	}
	.tooltip-trigger[aria-expanded='true'],
	.tooltip-trigger:active {
		color: var(--pz-color-text);
		background: var(--pz-color-subtle);
	}
	@media (hover: hover) {
		.tooltip-trigger:hover {
			color: var(--pz-color-text);
			background: var(--pz-color-subtle);
		}
	}
	.tooltip-bubble {
		position: fixed;
		z-index: 60;
		width: max-content;
		max-width: min(240px, calc(100vw - 16px));
		padding: var(--pz-space-2) var(--pz-space-3);
		/* A floating layer (DESIGN_CODE §7.8): raised paper, popover radius, shadow. */
		border-radius: var(--pz-radius-popover);
		color: var(--pz-color-text-secondary);
		background: var(--pz-color-raised);
		box-shadow: var(--pz-shadow-pop);
		font-size: var(--pz-text-xs);
		font-weight: 400;
		line-height: 1rem;
		letter-spacing: normal;
		text-transform: none;
		text-align: left;
		white-space: normal;
		transform: translateX(-50%);
		pointer-events: none;
		opacity: 0;
		visibility: hidden;
		transition:
			opacity var(--pz-duration-fast) var(--pz-ease-standard),
			visibility var(--pz-duration-fast);
	}
	.tooltip-bubble.is-above {
		transform: translate(-50%, -100%);
	}
	.tooltip-bubble.is-open {
		opacity: 1;
		visibility: visible;
	}
</style>
