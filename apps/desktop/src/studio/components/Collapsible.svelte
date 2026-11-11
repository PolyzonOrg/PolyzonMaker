<script lang="ts">
	/**
	 * A section that folds away under its heading (DESIGN_CODE §7.9). The
	 * chevron and the title are one button; the choice is remembered in this
	 * browser per page and `key` (the title when there is no key).
	 *
	 * - `pane` — a panel section under a 48px `.pane-head`;
	 * - `section` — a page section under a `.section-title`;
	 * - `group` — a group of fields under a 12px caption.
	 */
	import { onMount, untrack, type Snippet } from 'svelte';
	import { ChevronDown } from 'lucide-svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import { isCollapsed, setCollapsed } from '$lib/collapsed';

	let {
		title,
		key,
		variant = 'pane',
		tip,
		lead,
		actions,
		class: className = '',
		bodyClass = '',
		closed = false,
		children
	}: {
		title: string;
		key?: string;
		variant?: 'pane' | 'section' | 'group';
		/** Help next to the title (Tooltip). */
		tip?: string;
		/** `section`: the one-line lead under the title, folded with the body. */
		lead?: string;
		/** Small actions on the right of the head; they stay when folded. */
		actions?: Snippet;
		class?: string;
		bodyClass?: string;
		/** Folded until the viewer opens it: settings needed rarely («Тонкая настройка»). */
		closed?: boolean;
		children: Snippet;
	} = $props();

	const id = $props.id();
	let open = $state(untrack(() => !closed));
	let storeKey = '';
	onMount(() => {
		storeKey = `${location.pathname}:${key ?? title}`;
		open = !isCollapsed(storeKey, closed);
	});

	function toggle() {
		open = !open;
		setCollapsed(storeKey, !open);
	}
</script>

{#snippet button(size: 14 | 16, extra: string)}
	<button
		type="button"
		id="{id}-title"
		class="collapse-toggle {extra}"
		aria-expanded={open}
		aria-controls="{id}-body"
		onclick={toggle}
	>
		<ChevronDown {size} class="collapse-chevron shrink-0" aria-hidden="true" />
		<span class="min-w-0 truncate">{title}</span>
	</button>
{/snippet}

<!-- Page sections stay landmarks, as before; panes and field groups do not. -->
<section class={className} aria-labelledby={variant === 'section' ? `${id}-title` : undefined}>
	{#if variant === 'pane'}
		<div class="pane-head">
			<div class="flex min-w-0 items-center gap-1">
				<h2 class="min-w-0">{@render button(16, 'min-h-11 gap-2 font-semibold')}</h2>
				{#if tip}<Tooltip text={tip} />{/if}
			</div>
			{@render actions?.()}
		</div>
	{:else if variant === 'section'}
		{#if actions}
			<div class="section-head">
				<h2 class="section-title">{@render button(16, 'hit-44 relative gap-2')}</h2>
				{@render actions()}
			</div>
		{:else}
			<h2 class="section-title">{@render button(16, 'hit-44 relative gap-2')}</h2>
		{/if}
		{#if lead}<p class="section-lead" hidden={!open}>{lead}</p>{/if}
	{:else}
		<h2 class="mb-2">
			{@render button(14, 'hit-44 relative gap-1 text-xs font-medium text-neutral-400')}
		</h2>
	{/if}
	<div id="{id}-body" class={bodyClass} hidden={!open}>
		{@render children()}
	</div>
</section>

<style>
	.collapse-toggle {
		display: flex;
		max-width: 100%;
		align-items: center;
		text-align: left;
	}
	.collapse-toggle :global(.collapse-chevron) {
		color: var(--pz-color-text-tertiary);
		transition: transform var(--pz-duration-fast) var(--pz-ease-standard);
	}
	.collapse-toggle[aria-expanded='false'] :global(.collapse-chevron) {
		transform: rotate(-90deg);
	}
	@media (hover: hover) {
		.collapse-toggle:hover,
		.collapse-toggle:hover :global(.collapse-chevron) {
			color: var(--pz-color-text);
		}
	}
	/* The body may be a flex box: `hidden` must still win over its display. */
	[hidden] {
		display: none !important;
	}
</style>
