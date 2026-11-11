<script lang="ts">
	import { onMount } from 'svelte';
	import { isMac } from '../lib/core';
	import { ACTIONS, shown } from '../lib/keys';
	import { app } from '../lib/state.svelte';

	/**
	 * One tooltip for every control, in place of the system's slow one: each control's `title` says what it is
	 * and how it stands now (it changes with the control), `data-keys` names the shortcut it answers to, and a
	 * `data-tip-side` around it says where there is room.
	 */
	type Side = 'below' | 'above' | 'left' | 'right';

	let text = $state('');
	let keys = $state<string[]>([]);
	let place = $state<{ x: number; y: number; side: Side } | null>(null);
	let bubble = $state<HTMLElement>();
	let shift = $state(0);

	onMount(() => {
		let owner: HTMLElement | null = null;
		let timer = 0;
		let lastHidden = 0;
		// the control's own title moves here: two tooltips at once help nobody
		const take = (el: HTMLElement) => {
			const title = el.getAttribute('title');
			if (title !== null) {
				el.removeAttribute('title');
				el.dataset.tip = title;
				if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
			}
			if (el.dataset.tip) return el.dataset.tip;
			// `data-tip-cut`: a name the row cuts off is told whole, and one that fits says nothing
			const name = el.hasAttribute('data-tip-cut') ? (el.querySelector<HTMLElement>('.title') ?? el) : null;
			return name && name.scrollWidth > name.clientWidth + 1 ? (name.textContent?.trim() ?? '') : '';
		};
		const watch = new MutationObserver(() => {
			if (owner) text = take(owner);
		});
		const hide = () => {
			clearTimeout(timer);
			watch.disconnect();
			if (place) lastHidden = performance.now();
			owner = null;
			place = null;
		};
		const show = (el: HTMLElement) => {
			text = take(el);
			if (!text) return;
			const id = el.closest<HTMLElement>('[data-keys]')?.dataset.keys;
			const combo = id ? (app.keys[id] ?? ACTIONS.find((a) => a.id === id)?.keys) : undefined;
			keys = combo ? shown(combo, isMac).split('+') : [];
			const r = el.getBoundingClientRect();
			const side = (el.closest<HTMLElement>('[data-tip-side]')?.dataset.tipSide as Side | undefined) ?? (r.bottom + 40 > innerHeight ? 'above' : 'below');
			const gap = 8;
			place =
				side === 'left'
					? { x: r.left - gap, y: r.top + r.height / 2, side }
					: side === 'right'
						? { x: r.right + gap, y: r.top + r.height / 2, side }
						: { x: r.left + r.width / 2, y: side === 'above' ? r.top - gap : r.bottom + gap, side };
			watch.observe(el, { attributes: true, attributeFilter: ['title', 'data-tip'] });
		};
		const enter = (el: HTMLElement) => {
			if (el === owner) return;
			hide();
			owner = el;
			take(el);
			// along a toolbar the next one shows at once; the first waits for the pointer to rest
			const soon = performance.now() - lastHidden < 500;
			timer = window.setTimeout(() => owner === el && show(el), soon ? 0 : 400);
		};
		const over = (e: Event) => {
			const el = (e.target as Element | null)?.closest?.<HTMLElement>('[title], [data-tip], [data-tip-cut]');
			if (el) enter(el);
			else if (owner) hide();
		};
		const out = (e: PointerEvent) => {
			if (owner && !owner.contains(e.relatedTarget as Node | null)) hide();
		};
		const focus = (e: FocusEvent) => {
			const el = (e.target as Element | null)?.closest?.<HTMLElement>('[title], [data-tip], [data-tip-cut]');
			if (el?.matches(':focus-visible')) enter(el);
		};
		const key = (e: KeyboardEvent) => e.key === 'Escape' && hide();
		// focus leaves a control Svelte is taking out of the page, in the middle of its update: change nothing there
		const left = () => queueMicrotask(hide);
		document.addEventListener('pointerover', over, true);
		document.addEventListener('pointerout', out, true);
		document.addEventListener('focusin', focus, true);
		document.addEventListener('focusout', left, true);
		document.addEventListener('wheel', hide, { capture: true, passive: true });
		document.addEventListener('keydown', key, true);
		window.addEventListener('blur', hide);
		return () => {
			hide();
			document.removeEventListener('pointerover', over, true);
			document.removeEventListener('pointerout', out, true);
			document.removeEventListener('focusin', focus, true);
			document.removeEventListener('focusout', left, true);
			document.removeEventListener('wheel', hide, true);
			document.removeEventListener('keydown', key, true);
			window.removeEventListener('blur', hide);
		};
	});

	// above or below, it stays inside the window
	$effect(() => {
		void text;
		if (!place || !bubble || place.side === 'left' || place.side === 'right') return void (shift = 0);
		const half = bubble.offsetWidth / 2;
		shift = Math.min(0, innerWidth - 8 - (place.x + half)) + Math.max(0, 8 - (place.x - half));
	});
</script>

{#if place && text}
	<div class="tip {place.side}" role="tooltip" bind:this={bubble} style:left="{place.x + shift}px" style:top="{place.y}px">
		<span>{text}</span>
		{#each keys as k, i (i)}<kbd>{k}</kbd>{/each}
	</div>
{/if}

<style>
	.tip {
		position: fixed;
		z-index: 1000;
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 280px;
		padding: 5px 8px;
		border: 1px solid var(--tip-line);
		border-radius: var(--r-sm);
		background: var(--tip-bg);
		color: var(--tip-ink);
		font-size: 12px;
		line-height: 16px;
		pointer-events: none;
		animation: in 0.12s ease-out;
	}

	.below {
		transform: translate(-50%, 0);
	}

	.above {
		transform: translate(-50%, -100%);
	}

	.left {
		transform: translate(-100%, -50%);
	}

	.right {
		transform: translate(0, -50%);
	}

	kbd {
		min-width: 18px;
		padding: 0 4px;
		border: 1px solid var(--tip-key);
		border-radius: 4px;
		font: inherit;
		font-size: 11px;
		text-align: center;
		color: var(--tip-ink);
		opacity: 0.8;
	}

	@keyframes in {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tip {
			animation: none;
		}
	}
</style>
