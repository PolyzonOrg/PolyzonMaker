<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { lang, t } from '../lib/i18n.svelte';
	import { near } from '../lib/near';
	import { problem } from '../lib/problem';
	import { app, deleteThread, formatDate, go, loadThumb } from '../lib/state.svelte';
	import { threads, type Thread } from '../lib/threads';
	import Dialog from '../parts/Dialog.svelte';
	import Icon from '../parts/Icon.svelte';

	let query = $state('');
	let doomed = $state<Thread | null>(null);
	let deleting = $state(false);
	let trouble = $state('');

	const shown = $derived(threads(app.jobs).filter((th) => (th.title + ' ' + th.cover.model).toLowerCase().includes(query.trim().toLowerCase())));

	// a cover is read when its tile comes near the screen: all at once, a long library read and shrank hundreds of
	// pictures as it opened; once near, a cover that changes (a job that finished) is read again
	const nearby = new SvelteSet<string>();
	$effect(() => shown.forEach((th) => nearby.has(th.id) && loadThumb(th.cover)));

	const label = (state: string) =>
		state === 'failed' ? t('job.failed') : state === 'cancelled' ? t('job.cancelled') : state === 'interrupted' ? t('job.interrupted') : state === 'queued' ? t('job.queued') : '';

	async function remove() {
		deleting = true;
		trouble = '';
		try {
			await deleteThread(doomed!);
			doomed = null;
		} catch (e) {
			trouble = t('job.deleteFailed', { why: problem(e) });
		}
		deleting = false;
	}
</script>

<div class="page">
	<div class="page-head">
		<h1>{t('lib.title')}</h1>
		{#if app.jobs.length}
			<label class="search">
				<Icon name="search" size={16} />
				<input class="input" type="search" placeholder={t('lib.search')} aria-label={t('lib.search')} bind:value={query} />
			</label>
		{/if}
	</div>

	{#if !app.jobs.length}
		<div class="empty">
			<p class="muted">{t('lib.empty')}</p>
			<button class="btn primary" onclick={() => go('create')}>{t('nav.new')}</button>
		</div>
	{:else if !shown.length}
		<p class="muted">{t('lib.noMatch')}</p>
	{:else}
		<ul class="grid">
			{#each shown as thread (thread.id)}
				<li {@attach near(() => nearby.add(thread.id))}>
					<button class="tile" data-tip-cut onclick={() => go('result', thread.cover.id)}>
						<span class="thumb">
							{#if app.thumbs[thread.cover.id]}<img src={app.thumbs[thread.cover.id]} alt="" />{:else}<Icon name="cube" size={28} />{/if}
							{#if label(thread.cover.state)}<span class="chip state">{label(thread.cover.state)}</span>{/if}
							{#if thread.jobs.length > 1}<span class="chip many">{thread.jobs.length}</span>{/if}
						</span>
						<span class="title">{thread.title || t('job.untitled')}</span>
						<span class="faint">{formatDate(thread.created, lang.value)}</span>
					</button>
					<button class="tool drop" aria-label={t('job.delete')} title={t('job.delete')} onclick={() => (doomed = thread)}><Icon name="trash" size={16} /></button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

{#if doomed}
	<Dialog title={t('job.deleteTitle')} onclose={() => !deleting && (doomed = null)}>
		<p class="muted">{doomed.jobs.length > 1 ? t('job.deleteAll', { n: doomed.jobs.length }) : t('job.deleteText')}</p>
		{#if trouble}<p class="note bad selectable" role="alert">{trouble}</p>{/if}
		<div class="row-end">
			<button class="btn ghost" disabled={deleting} onclick={() => (doomed = null)}>{t('models.cancel')}</button>
			<button class="btn danger" disabled={deleting} onclick={remove}><Icon name="trash" size={16} />{t('job.delete')}</button>
		</div>
	</Dialog>
{/if}

<style>
	li {
		position: relative;
		min-width: 0;
	}

	.drop {
		position: absolute;
		top: 8px;
		right: 8px;
		background: var(--surface-2);
		opacity: 0;
		transition:
			background 0.12s,
			color 0.12s,
			opacity 0.12s;
	}

	.drop:hover {
		background: var(--surface-3);
		color: var(--bad);
	}

	li:hover .drop,
	.drop:focus-visible {
		opacity: 1;
	}

	.many {
		position: absolute;
		right: 8px;
		bottom: 8px;
	}

	.search {
		position: relative;
		display: flex;
		align-items: center;
		width: 240px;
		color: var(--ink-faint);
	}

	.search :global(svg) {
		position: absolute;
		left: 11px;
		pointer-events: none;
	}

	.search input {
		padding-left: 34px;
	}

	.empty {
		display: grid;
		justify-items: center;
		gap: 14px;
		padding: 80px 20px;
		text-align: center;
	}

	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 16px;
	}

	.tile {
		display: grid;
		gap: 2px;
		width: 100%;
		text-align: left;
		border-radius: var(--r-lg);
	}

	.thumb {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		margin-bottom: 8px;
		border-radius: var(--r-lg);
		background: var(--surface-2);
		color: var(--ink-faint);
		overflow: hidden;
		transition: background 0.12s;
	}

	.tile:hover .thumb {
		background: var(--surface-3);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.state {
		position: absolute;
		left: 8px;
		bottom: 8px;
		background: var(--surface-3);
		color: var(--ink);
	}

	.title {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
