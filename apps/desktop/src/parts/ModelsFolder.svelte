<script lang="ts">
	import { t, type Key } from '../lib/i18n.svelte';
	import { app, chooseModelsFolder } from '../lib/state.svelte';

	let { hint = '' }: { hint?: string } = $props();
	let problem = $state<Key | ''>('');

	async function change() {
		problem = await chooseModelsFolder();
	}
</script>

<div class="setting">
	<span class="where">
		<strong>{t('settings.folder')}</strong>
		<small class="path selectable" title={app.folder}>{app.folder}{#if app.hw?.disk_free_gb != null}, {t('check.free', { gb: app.hw.disk_free_gb })}{/if}</small>
		{#if hint}<small>{hint}</small>{/if}
	</span>
	<button class="btn small" onclick={change}>{t('settings.change')}</button>
</div>
{#if problem}<p class="note bad">{t(problem)}</p>{/if}

<style>
	.where {
		min-width: 0;
	}

	/* a folder's path breaks anywhere: kept on one line, the usual C:\Users\…\packs made the page wider than a narrow window */
	.path {
		overflow-wrap: anywhere;
	}
</style>
