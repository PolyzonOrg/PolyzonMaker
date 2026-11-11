<script lang="ts">
	import type { Component } from 'svelte';
	import { core } from '../lib/core';
	import { t } from '../lib/i18n.svelte';
	import { go } from '../lib/state.svelte';
	import '../studio/styles/studio.css';
	import { toolBySlug, type ToolInfo } from '../studio/tools/registry';

	let { slug }: { slug: string } = $props();

	/** Each tool is one lazy component, as in Studio: nothing of it loads before it is opened. */
	const modules = import.meta.glob<{ default: Component<{ tool: ToolInfo }> }>('../studio/tools/*/Tool.svelte');
	const tool = $derived(toolBySlug(slug));
	const loading = $derived(modules[`../studio/tools/${slug}/Tool.svelte`]?.());

	/** Studio's links would take the whole window away: its own go between tools, others to the browser. */
	function link(e: MouseEvent) {
		const anchor = (e.target as Element).closest?.('a');
		const href = anchor?.getAttribute('href');
		if (!href || href.startsWith('#')) return;
		e.preventDefault();
		const inside = href.match(/^\/workspace\/tools\/?([\w-]*)/);
		if (inside) go(inside[1] ? 'tool' : 'tools', inside[1] ?? '');
		else if (/^https?:/.test(href)) void core.openUrl(href);
	}
</script>

<div class="room" onclickcapture={link} role="none">
	{#key slug}
		{#await loading then module}
			{#if module && tool}<module.default {tool} />{/if}
		{:catch}
			<div class="page">
				<p class="muted">{t('tools.notLoaded')}</p>
				<div class="buttons"><button class="btn" onclick={() => go('tools')}>{t('nav.tools')}</button></div>
			</div>
		{/await}
	{/key}
</div>

<style>
	.room {
		height: 100%;
	}
</style>
