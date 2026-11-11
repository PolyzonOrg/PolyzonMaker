<script lang="ts">
	import { lang, t } from '../lib/i18n.svelte';
	import { app, downloadUpdate, installUpdate, save, working } from '../lib/state.svelte';
	import { releaseDate, whatsNew } from '../lib/update';
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const update = $derived(app.update!);
	const percent = $derived(update.total ? Math.round((update.done / update.total) * 100) : 0);
	const downloading = $derived(update.state === 'downloading');
	const date = $derived(releaseDate(update.date, lang.value));
	const later = $derived(update.state === 'downloaded' || update.state === 'installing');

	function inBackground() {
		if (downloading) update.restart = false;
		else if (!later) void downloadUpdate();
		onclose();
	}
</script>

<Dialog title={t('update.ready', { v: update.version })} {onclose}>
	<p class="faint when selectable">{[date, t('update.current', { v: app.version })].filter(Boolean).join(' · ')}</p>

	{#if whatsNew(update.notes).length}
		<div class="news selectable">
			<strong>{t('update.whatsNew')}</strong>
			{#each whatsNew(update.notes) as section (section.title)}
				{#if section.title}<h3>{section.title}</h3>{/if}
				<ul>
					{#each section.items as item (item)}<li>{item}</li>{/each}
				</ul>
			{/each}
		</div>
	{/if}

	{#if downloading}
		<div class="bar live" class:unknown={!update.total}><i style:width={update.total ? `${percent}%` : ''}></i></div>
	{/if}
	{#if update.state === 'failed'}<p class="note bad">{t('update.failed')}</p>{/if}
	{#if update.state === 'installing'}<p class="note">{t('update.installing')}</p>{/if}
	{#if update.state === 'downloaded' && working()}<p class="note">{t('update.busy')}</p>{/if}

	<label class="setting">
		<span><strong>{t('update.auto')}</strong><small>{t('update.autoHint')}</small></span>
		<input type="checkbox" role="switch" checked={!app.settings.updates_manual} onchange={(e) => save({ updates_manual: !e.currentTarget.checked })} />
	</label>

	<div class="buttons end">
		<button class="btn" onclick={inBackground}>{t(later ? 'update.later' : 'update.background')}</button>
		{#if downloading}
			<button class="btn primary" disabled>{update.total ? t('update.progress', { p: percent }) : t('update.starting')}</button>
		{:else if update.state === 'installing'}
			<button class="btn primary" disabled>{t('update.installingShort')}</button>
		{:else if update.state === 'downloaded'}
			<button class="btn primary" disabled={working()} onclick={installUpdate}><Icon name="refresh" size={16} />{t('update.restart')}</button>
		{:else}
			<button class="btn primary" onclick={() => downloadUpdate(true)}><Icon name="download" size={16} />{t('update.install')}</button>
		{/if}
	</div>
</Dialog>

<style>
	.when {
		margin: -8px 0 0;
		font-size: 13px;
	}

	.news {
		display: grid;
		gap: 8px;
		max-height: 240px;
		overflow-y: auto;
		padding: 12px 14px;
		border-radius: var(--r);
		background: var(--surface-2);
	}

	.news strong,
	.news h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 500;
	}

	.news h3 {
		font-size: 13px;
		color: var(--ink-muted);
	}

	ul {
		margin: 0;
		padding-left: 18px;
		font-size: 13px;
		color: var(--ink-muted);
	}

	li + li {
		margin-top: 4px;
	}

	.end {
		justify-content: flex-end;
	}
</style>
