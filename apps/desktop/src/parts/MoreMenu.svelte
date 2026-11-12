<script lang="ts" module>
	import type { IconName } from './Icon.svelte';

	export interface Action {
		label: string;
		icon: IconName;
		run: () => void;
		/** Cannot be undone: last, below a line, in red */
		danger?: boolean;
	}
</script>

<script lang="ts">
	// What a bar has no room for, behind «⋯»: the rows of an action list (DESIGN.md), opened under the button
	// and kept to its right edge. Arrows, Home and End walk it; Esc, Tab, a click elsewhere close it.
	import { tick } from 'svelte';
	import { t } from '../lib/i18n.svelte';
	import Icon from './Icon.svelte';

	let { actions }: { actions: Action[] } = $props();

	let open = $state(false);
	let place = $state({ right: 0, top: 0 });
	let button = $state<HTMLButtonElement>();
	let menu = $state<HTMLDivElement>();
	// what cannot be undone goes last, whatever order the page gave
	const rows = $derived([...actions.filter((a) => !a.danger), ...actions.filter((a) => a.danger)]);
	const items = () => [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

	async function show(at: 'first' | 'last' = 'first') {
		const box = button!.getBoundingClientRect();
		place = { right: innerWidth - box.right, top: box.bottom + 4 };
		open = true;
		await tick();
		(at === 'first' ? items()[0] : items().at(-1))?.focus();
	}

	function hide() {
		open = false;
		button?.focus();
	}

	function choose(action: Action) {
		hide();
		action.run();
	}

	function keys(e: KeyboardEvent) {
		const all = items();
		const at = all.indexOf(document.activeElement as HTMLButtonElement);
		const go = (i: number) => all[(i + all.length) % all.length]?.focus();
		const moves: Record<string, () => void> = {
			ArrowDown: () => go(at + 1),
			ArrowUp: () => go(at - 1),
			Home: () => go(0),
			End: () => go(all.length - 1),
			Escape: hide,
			Tab: hide
		};
		if (!moves[e.key]) return;
		e.preventDefault();
		e.stopPropagation();
		moves[e.key]();
	}
</script>

<svelte:window onresize={() => open && hide()} />

<button
	bind:this={button}
	type="button"
	class="tool"
	aria-haspopup="menu"
	aria-expanded={open}
	aria-label={t('menu.more')}
	title={t('menu.more')}
	onclick={() => (open ? hide() : show())}
	onkeydown={(e) => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			void show(e.key === 'ArrowDown' ? 'first' : 'last');
		}
	}}
>
	<Icon name="more" size={16} />
</button>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="away" onclick={hide}></div>
	<div bind:this={menu} class="menu-list pop" role="menu" aria-label={t('menu.more')} tabindex="-1" style:right="{place.right}px" style:top="{place.top}px" onkeydown={keys}>
		{#each rows as action, i (action.label)}
			{#if action.danger && i > 0 && !rows[i - 1].danger}<hr />{/if}
			<button role="menuitem" class:danger={action.danger} onclick={() => choose(action)}><Icon name={action.icon} size={16} />{action.label}</button>
		{/each}
	</div>
{/if}

<style>
	.away {
		position: fixed;
		inset: 0;
		z-index: 40;
	}

	.pop {
		position: fixed;
		z-index: 41;
		min-width: 200px;
		animation: pop 0.12s var(--ease);
		transform-origin: top right;
		outline: none;
	}

	[role='menuitem']:focus-visible {
		background: var(--surface-3);
		outline: none;
	}
</style>
