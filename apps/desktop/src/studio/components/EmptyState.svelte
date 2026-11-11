<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { Icon as LucideIcon } from 'lucide-svelte';

	// Lucide icons are legacy class components; runes components are accepted too.
	type IconComponent = Component<Record<string, unknown>> | typeof LucideIcon;

	let {
		icon: Icon,
		title,
		description,
		action
	}: { icon: IconComponent; title: string; description: string; action?: Snippet } = $props();
</script>

<section class="empty-state" aria-labelledby="empty-state-title">
	<div class="icon-tile mx-auto"><Icon size={24} aria-hidden="true" /></div>
	<h2 id="empty-state-title" class="section-title mb-0 mt-4">{title}</h2>
	<p class="section-lead mx-auto mb-0">{description}</p>
	{#if action}<div class="mt-6">{@render action()}</div>{/if}
</section>

<style>
	/* DESIGN_CODE §7.8: icon tile, a section title, one sentence, one action. */
	.empty-state {
		max-width: 440px;
		margin-inline: auto;
		padding: var(--pz-space-10) var(--pz-space-6);
		text-align: center;
	}
</style>
