<script lang="ts">
	import type { Snippet } from 'svelte';
	import Collapsible from '$lib/components/Collapsible.svelte';

	/**
	 * A group of fields: 24px between groups, 16px between fields. A titled
	 * group folds away under its caption (DESIGN_CODE §7.9).
	 */
	let { title, key, children }: { title?: string; key?: string; children: Snippet } = $props();
</script>

{#if title}
	<Collapsible variant="group" {title} {key} class="[&+&]:mt-6" bodyClass="space-y-4">
		{@render children()}
	</Collapsible>
{:else}
	<section class="[&+&]:mt-6">
		<div class="space-y-4">{@render children()}</div>
	</section>
{/if}
