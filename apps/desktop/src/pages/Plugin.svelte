<script lang="ts">
	import { untrack } from 'svelte';
	import { t } from '../lib/i18n.svelte';
	import { app, go } from '../lib/state.svelte';
	import Icon from '../parts/Icon.svelte';
	import PluginFrame from '../parts/PluginFrame.svelte';

	let { id }: { id: string } = $props();
	let frame = $state<PluginFrame>();
	const plugin = $derived(app.plugins.find((p) => p.id === id));

	// a command that opened this page is handed to it, once
	$effect(() => {
		const run = app.command;
		if (!run || run.plugin !== id || !frame) return;
		untrack(() => {
			frame?.send('command', { command: run.command, job: run.job || undefined });
			app.command = null;
		});
	});
</script>

<div class="room">
	<header>
		<button class="btn small ghost" onclick={() => go('plugins')}><Icon name="back" size={14} />{t('plugins.title')}</button>
		<strong>{plugin?.name}</strong>
	</header>
	{#if plugin?.page}
		{#key id}<PluginFrame bind:this={frame} {id} title={plugin.name} context={{ page: 'plugin' }} />{/key}
	{/if}
</div>

<style>
	.room {
		height: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}

	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--line);
	}

	strong {
		font-weight: 500;
	}
</style>
