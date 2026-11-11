<script lang="ts">
	/**
	 * Studio's favourite star is this app's pin: a pinned tool stands in the menu for quick access. The menu,
	 * the tools page and each tool's header show the same list (`app.pinned`).
	 */
	import { t } from '../../../lib/i18n.svelte';
	import { app, togglePin } from '../../../lib/state.svelte';
	import Icon from '../../../parts/Icon.svelte';

	let { slug, size = 16 }: { slug: string; title?: string; size?: number } = $props();

	const pinned = $derived(app.pinned.includes(slug));
	const label = $derived(t(pinned ? 'tools.unpin' : 'tools.pin'));
</script>

<button type="button" class="tool pin" class:on={pinned} aria-pressed={pinned} aria-label={label} data-tip={label} onclick={() => togglePin(slug)}><Icon name="pin" {size} /></button>

<style>
	.pin.on :global(svg) {
		fill: currentColor;
	}
</style>
