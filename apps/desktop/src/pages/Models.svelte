<script lang="ts" module>
	type Tab = 'recommended' | 'downloaded' | 'all';
	type Picked = { kind: 'model' | 'hf' | 'yours'; id: string } | null;
	/** The page keeps its place while the person is elsewhere in the program. */
	let kept: { tab: Tab; picked: Picked; query: string } = { tab: 'recommended', picked: null, query: '' };
</script>

<script lang="ts">
	// Models as a list on the left and the chosen one on the right: what it makes, what it needs,
	// how it installs here and what it has made. In a narrow pane one of the two at a time.
	import { classify, fit, formatRange, installProgress, isMature, kindIcon, onDisk, recommend, type HfClass, type HfModel, type Model } from '../lib/catalog';
	import { core } from '../lib/core';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { areaWidth } from '../lib/menu';
	import { app, benchOf, installing, isInstalled, refreshInstalled } from '../lib/state.svelte';
	import AreaEdge from '../parts/AreaEdge.svelte';
	import HfDetail from '../parts/HfDetail.svelte';
	import Icon from '../parts/Icon.svelte';
	import ModelDetail from '../parts/ModelDetail.svelte';
	import ModelsFolder from '../parts/ModelsFolder.svelte';

	let tab = $state<Tab>(kept.tab);
	let picked = $state<Picked>(kept.picked);
	let query = $state(kept.query);
	let searching = $state(false);
	const s = app.search;
	let room = $state(0);

	$effect(() => {
		kept = { tab, picked, query };
	});

	const FILTERS: { task: string; label: Key }[] = [
		{ task: 'image-to-3d', label: 'models.filter.3d' },
		{ task: 'text-to-image', label: 'models.filter.picture' },
		{ task: 'gguf', label: 'models.filter.text' },
		{ task: '', label: 'models.filter.any' }
	];
	const CHIP: Record<HfClass, string> = { known: 'good', compatible: 'good', text: 'good', gated: 'warn', adapter: 'warn', unsafe: 'bad' };

	const matches = (m: Model) => {
		const q = query.trim().toLowerCase();
		return !q || [m.name, m.publisher, m.summary[lang.value]].some((x) => x.toLowerCase().includes(q));
	};
	const best = $derived(recommend(app.models, app.hw!, benchOf()));
	const groups = $derived.by(() => {
		const rest = app.models.filter((m) => matches(m) && m.id !== best?.id);
		return [
			{ title: 'models.forYou' as Key, models: best && matches(best) ? [best] : [] },
			{ title: 'models.photo' as Key, models: rest.filter((m) => m.kind === '3d' && !m.photos) },
			{ title: 'models.group.photos' as Key, models: rest.filter((m) => m.kind === '3d' && m.photos) },
			{ title: 'models.picture' as Key, models: rest.filter((m) => m.kind === 'picture') },
			{ title: 'models.texts' as Key, models: rest.filter((m) => m.kind === 'text') }
		].filter((g) => g.models.length);
	});
	const downloaded = $derived(onDisk(app.models, app.installed, app.packs).filter(matches));
	const yours = $derived(app.installed.filter((p) => p.file));
	const visible = $derived((s.results ?? []).filter((m) => app.settings.show_mature || !isMature(m)));
	const hidden = $derived((s.results?.length ?? 0) - visible.length);

	/** What the right side shows: the one picked, or else the first of the list. */
	const first = $derived<Picked>(
		tab === 'recommended'
			? groups[0] && { kind: 'model', id: groups[0].models[0].id }
			: tab === 'downloaded'
				? downloaded[0]
					? { kind: 'model', id: downloaded[0].id }
					: yours[0] && { kind: 'yours', id: yours[0].id }
				: visible[0] && { kind: 'hf', id: visible[0].id }
	);
	const shown = $derived(picked ?? first ?? null);
	const shownModel = $derived(shown?.kind === 'model' ? app.models.find((m) => m.id === shown.id) : undefined);
	const shownHf = $derived(shown?.kind === 'hf' ? visible.find((m) => m.id === shown.id) : undefined);
	const shownYours = $derived(shown?.kind === 'yours' ? yours.find((p) => p.id === shown.id) : undefined);
	const isShown = (kind: string, id: string) => shown?.kind === kind && shown.id === id;

	/** WebKit leaves a clicked button unfocused: the arrows then walk from it all the same */
	function pick(kind: 'model' | 'hf' | 'yours', id: string, e?: MouseEvent) {
		(e?.currentTarget as HTMLElement | undefined)?.focus();
		picked = { kind, id };
	}

	function switchTab(to: Tab) {
		tab = to;
		picked = null;
		if (to === 'all' && s.results === null) void search();
	}

	async function search() {
		searching = true;
		s.failed = false;
		picked = null;
		try {
			s.results = await core.search(s.query.trim(), s.task);
		} catch {
			s.results = [];
			s.failed = true;
		} finally {
			searching = false;
		}
	}

	$effect(() => {
		if (tab === 'all' && s.results === null && !searching) void search();
	});

	async function removeFile(id: string) {
		await core.remove(id);
		delete app.packs[id];
		await refreshInstalled();
	}

	/** Up and down go through the list, as in a list of files. */
	function walk(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.item')];
		const at = items.findIndex((b) => b === document.activeElement || b.getAttribute('aria-current') === 'true');
		const next = items[Math.min(Math.max(at + (e.key === 'ArrowDown' ? 1 : -1), 0), items.length - 1)];
		if (!next) return;
		e.preventDefault();
		next.focus();
		next.click();
	}

	const compact = (n: number) => new Intl.NumberFormat(lang.value, { notation: 'compact' }).format(n);
	const hfIcon = (m: HfModel) => (m.task === 'image-to-3d' ? 'cube' : m.task === 'text-to-image' ? 'image' : classify(m) === 'text' ? 'chat' : 'brain');
</script>

{#snippet modelItem(model: Model)}
	{@const f = fit(model, app.hw!, benchOf())}
	{@const pack = app.packs[model.id]}
	<button class="item" aria-current={isShown('model', model.id)} onclick={(e) => pick('model', model.id, e)}>
		<span class="tile"><Icon name={kindIcon(model)} size={18} /></span>
		<span class="words">
			<span class="top">
				<span class="name">{model.name}</span>
				{#if installing(model.id) && pack}
					<span class="side">{Math.round(installProgress(model.runtime.type, pack.stage, pack.done, pack.total).share * 100)}%</span>
				{:else if isInstalled(model.id)}
					<span class="side good"><Icon name="check" size={14} />{t('models.installed')}</span>
				{:else if f.band === 'no'}
					<span class="side bad">{t('models.band.no')}</span>
				{:else if f.seconds && model.kind !== 'text'}
					<span class="side">{formatRange(f.seconds, lang.value)}</span>
				{/if}
			</span>
			<span class="sub">{model.summary[lang.value]}</span>
		</span>
	</button>
{/snippet}

<div class="browser" class:chosen={picked !== null} bind:clientWidth={room} style:--list="{areaWidth('models', room, app.areas.models)}px">
	<AreaEdge area="models" {room} />
	<section class="list" aria-label={t('models.title')}>
		<div class="head">
			<h1>{t('models.title')}</h1>
			<div class="seg tabs" role="tablist">
				<button role="tab" aria-selected={tab === 'recommended'} onclick={() => switchTab('recommended')}>{t('models.recommended')}</button>
				<button role="tab" aria-selected={tab === 'downloaded'} onclick={() => switchTab('downloaded')}>{t('models.downloaded')}</button>
				<button role="tab" aria-selected={tab === 'all'} onclick={() => switchTab('all')}>{t('models.tabHf')}</button>
			</div>
			{#if tab === 'all'}
				<form class="find" onsubmit={(e) => (e.preventDefault(), search())}>
					<Icon name="search" size={16} />
					<input class="input" type="search" placeholder={t('models.search')} aria-label={t('models.search')} bind:value={s.query} />
				</form>
				<div class="seg filters" role="group">
					{#each FILTERS as f (f.task)}
						<button type="button" aria-pressed={s.task === f.task} onclick={() => ((s.task = f.task), search())}>{t(f.label)}</button>
					{/each}
				</div>
				{#if s.task === 'gguf'}<button class="btn small ghost" onclick={() => ((s.query = 'uncensored'), search())}>{t('models.uncensored')}</button>{/if}
			{:else}
				<label class="find">
					<Icon name="search" size={16} />
					<input class="input" type="search" placeholder={t('models.find')} aria-label={t('models.find')} bind:value={query} />
				</label>
			{/if}
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="items" onkeydown={walk}>
			{#if tab === 'recommended'}
				{#each groups as g (g.title)}
					<h2>{t(g.title)}</h2>
					{#each g.models as model (model.id)}{@render modelItem(model)}{/each}
				{:else}
					<p class="muted empty">{t('models.noResults')}</p>
				{/each}
			{:else if tab === 'downloaded'}
				{#each downloaded as model (model.id)}{@render modelItem(model)}{/each}
				{#if yours.length}
					<h2>{t('models.yours')}</h2>
					{#each yours as p (p.id)}
						<button class="item" aria-current={isShown('yours', p.id)} onclick={(e) => pick('yours', p.id, e)}>
							<span class="tile"><Icon name="image" size={18} /></span>
							<span class="words"><span class="top"><span class="name">{p.name}</span></span><span class="sub">{p.file}</span></span>
						</button>
					{/each}
				{/if}
				{#if !downloaded.length && !yours.length}
					<div class="empty">
						<p class="muted">{t('models.noneDownloaded')}</p>
						<button class="btn small" onclick={() => switchTab('recommended')}>{t('models.recommended')}<Icon name="arrow" size={14} /></button>
					</div>
				{/if}
			{:else}
				{#if searching}
					<div class="bar unknown"><i></i></div>
				{:else if s.failed}
					<p class="muted empty">{t('models.searchFailed')}</p>
				{:else if s.results && !visible.length}
					<p class="muted empty">{t('models.noResults')}</p>
				{/if}
				{#each visible as m (m.id)}
					{@const c = classify(m)}
					<button class="item" aria-current={isShown('hf', m.id)} onclick={(e) => pick('hf', m.id, e)}>
						<span class="tile"><Icon name={hfIcon(m)} size={18} /></span>
						<span class="words">
							<span class="top">
								<span class="name">{m.id.split('/').pop()}</span>
								<span class="side {CHIP[c]}">{t(`models.class.${c}`)}</span>
							</span>
							<span class="sub">{m.id.split('/')[0]}, {t('models.downloads', { n: compact(m.downloads) })}</span>
						</span>
					</button>
				{/each}
				{#if hidden > 0}<p class="faint empty">{t('models.matureHidden')}</p>{/if}
			{/if}
		</div>

		<div class="foot"><ModelsFolder /></div>
	</section>

	<section class="detail" aria-live="polite">
		<button class="btn small ghost back" onclick={() => (picked = null)}><Icon name="back" size={16} />{t('models.title')}</button>
		{#if shownModel}
			{#key shownModel.id}<ModelDetail model={shownModel} />{/key}
		{:else if shownHf}
			<HfDetail m={shownHf} onshow={(id) => ((tab = 'recommended'), (query = ''), pick('model', id))} />
		{:else if shownYours}
			<article class="yours">
				<h2 class="selectable">{shownYours.name}</h2>
				<p class="faint selectable">{shownYours.file}</p>
				<p class="note warn">{t('models.notTested')}</p>
				<div><button class="btn small" onclick={() => removeFile(shownYours.id)}><Icon name="trash" size={15} />{t('models.remove')}</button></div>
			</article>
		{:else}
			<p class="muted pick">{t('models.pickOne')}</p>
		{/if}
	</section>
</div>

<style>
	/* the list as wide as it was pulled by its edge */
	.browser {
		position: relative;
		height: 100%;
		display: grid;
		grid-template-columns: var(--list) minmax(0, 1fr);
	}

	.list {
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--line);
	}

	.head {
		display: grid;
		gap: 10px;
		padding: 24px 16px 12px;
	}

	h1 {
		margin: 0 0 4px 4px;
		font-size: 28px;
		font-weight: 600;
	}

	.tabs,
	.filters {
		display: flex;
	}

	/* a long name takes the room it needs, the others share the rest */
	.tabs button,
	.filters button {
		flex: 1 1 auto;
		min-width: 0;
		padding-inline: 10px;
	}

	.find {
		position: relative;
		display: flex;
		align-items: center;
	}

	.find > :global(svg) {
		position: absolute;
		left: 12px;
		color: var(--ink-faint);
		pointer-events: none;
	}

	.find .input {
		width: 100%;
		padding-left: 36px;
	}

	.items {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 8px 12px;
		display: grid;
		align-content: start;
		gap: 2px;
	}

	h2 {
		margin: 14px 12px 4px;
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-faint);
	}

	.item {
		width: 100%;
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr);
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-radius: var(--r);
		text-align: left;
		transition: background 0.12s;
	}

	.item:hover {
		background: var(--surface-2);
	}

	.item[aria-current='true'] {
		background: var(--surface-3);
	}

	.tile {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border-radius: var(--r-sm);
		background: var(--surface-2);
	}

	.item:hover .tile,
	.item[aria-current='true'] .tile {
		background: var(--surface-4);
	}

	.words {
		min-width: 0;
		display: grid;
		gap: 2px;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.name {
		min-width: 0;
		flex: 1;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.side {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--ink-faint);
	}

	.side.good {
		color: var(--good);
	}

	.side.warn {
		color: var(--warn);
	}

	.side.bad {
		color: var(--bad);
	}

	.sub {
		font-size: 13px;
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty {
		margin: 12px;
		display: grid;
		justify-items: start;
		gap: 12px;
	}

	.foot {
		padding: 12px 16px 16px;
		border-top: 1px solid var(--line);
	}

	.detail {
		min-width: 0;
		overflow-y: auto;
		padding: 28px 32px 48px;
	}

	.back {
		display: none;
		margin-bottom: 16px;
	}

	.pick {
		margin-top: 40px;
		text-align: center;
	}

	.yours {
		display: grid;
		gap: 10px;
		max-width: 820px;
	}

	.yours h2 {
		margin: 0;
		font-size: 22px;
		color: var(--ink);
		font-weight: 600;
	}

	.yours p {
		margin: 0;
	}

	/* no room for both: the list, and the model in its place once one is picked */
	@container (max-width: 760px) {
		.browser {
			grid-template-columns: minmax(0, 1fr);
		}

		/* one of the two at a time: no border between them to pull */
		.browser > :global(.edge) {
			display: none;
		}

		.list {
			border-right: 0;
		}

		.detail {
			display: none;
			padding: 20px 16px 32px;
		}

		.chosen .list {
			display: none;
		}

		.chosen .detail {
			display: block;
		}

		.back {
			display: inline-flex;
		}
	}
</style>
