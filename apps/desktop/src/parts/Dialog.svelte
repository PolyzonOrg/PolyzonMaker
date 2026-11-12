<script lang="ts">
	import type { Snippet } from 'svelte';
	import { modal } from '../lib/modal';

	/** `wide`: room for code and lists, still within the window */
	let { title, onclose, children, wide = false }: { title: string; onclose: () => void; children: Snippet; wide?: boolean } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="dialog" class:wide role="dialog" aria-modal="true" aria-label={title} {@attach modal(() => onclose())}>
		<h2>{title}</h2>
		{@render children()}
	</div>
</div>
