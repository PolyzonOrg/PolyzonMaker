<script lang="ts">
	import { classify, fit, installProgress, isMature, modelFile, onDisk, quants, recommend, room, textPackId, type HfClass, type HfModel, type Quant } from '../lib/catalog';
	import { core } from '../lib/core';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { app, benchOf, isInstalled, refreshInstalled } from '../lib/state.svelte';
	import Icon from '../parts/Icon.svelte';
	import ModelRow from '../parts/ModelRow.svelte';
	import ModelsFolder from '../parts/ModelsFolder.svelte';

	let tab = $state<'recommended' | 'downloaded' | 'all'>('recommended');
	let searching = $state(false);
	const s = app.search;

	const best = $derived(recommend(app.models, app.hw!, benchOf()));
	const rest3d = $derived(app.models.filter((m) => m.kind === '3d' && m.id !== best?.id));
	const pictures = $derived(app.models.filter((m) => m.kind === 'picture'));
	const texts = $derived(app.models.filter((m) => m.kind === 'text'));

	const FILTERS: { task: string; label: Key }[] = [
		{ task: 'image-to-3d', label: 'models.filter.3d' },
		{ task: 'text-to-image', label: 'models.filter.picture' },
		{ task: 'gguf', label: 'models.filter.text' },
		{ task: '', label: 'models.filter.any' }
	];

	async function search() {
		searching = true;
		s.failed = false;
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
		if (tab === 'all' && s.results === null) void search();
	});

	const visible = $derived((s.results ?? []).filter((m) => app.settings.show_mature || !isMature(m)));
	const hidden = $derived((s.results?.length ?? 0) - visible.length);
	const chip: Record<HfClass, string> = { known: 'good', compatible: 'good', text: 'good', gated: 'warn', adapter: 'warn', unsafe: 'bad' };
	const yours = $derived(app.installed.filter((p) => p.file));
	const downloaded = $derived(onDisk(app.models, app.installed, app.packs));
	const packId = (repo: string) => `hf-${repo.replace(/[/.]/g, '-').toLowerCase()}`;

	/** The picture engine's best device here, from the catalog's own picture model. */
	const device = $derived.by(() => {
		const engine = app.models.find((m) => m.kind === 'picture');
		return engine ? fit(engine, app.hw!, benchOf()).target?.device : undefined;
	});

	/** The sizes of an opened text model. */
	let sizes = $state<Record<string, Quant[]>>({});
	let sizeProblem = $state<Record<string, Key>>({});

	async function openSizes(m: HfModel) {
		if (sizes[m.id]) return void delete sizes[m.id];
		delete sizeProblem[m.id];
		try {
			sizes[m.id] = quants(await core.repoFiles(m.id));
			if (!sizes[m.id].length) sizeProblem[m.id] = 'models.sizesNone';
		} catch {
			sizeProblem[m.id] = 'models.sizesFailed';
		}
	}

	/** The device text models run on here, from the catalog's own text model. */
	const textDevice = $derived.by(() => {
		const engine = app.models.find((model) => model.kind === 'text');
		return engine ? fit(engine, app.hw!, benchOf()).target?.device : undefined;
	});

	async function installSize(m: HfModel, quant: Quant) {
		const id = textPackId(m.id, quant.files[0].name);
		app.packs[id] = { id, state: 'running', stage: 'runtime', done: 0, total: 0, error: '' };
		await core.installText(m.id, $state.snapshot(quant.files), textDevice ?? 'cpu');
	}

	async function installFile(m: HfModel) {
		const file = modelFile(m);
		if (!file || !device) return;
		const id = packId(m.id);
		app.packs[id] = { id, state: 'running', stage: 'runtime', done: 0, total: 0, error: '' };
		await core.installFile(m.id, file, device);
	}

	async function removeFile(id: string) {
		await core.remove(id);
		delete app.packs[id];
		await refreshInstalled();
	}
	const compact = (n: number) => new Intl.NumberFormat(lang.value, { notation: 'compact' }).format(n);

	function hint(c: HfClass) {
		if (c === 'compatible') return t('models.class.compatibleHint');
		if (c === 'adapter') return t('models.class.adapterHint');
		if (c === 'gated') return t('models.class.gatedHint');
		if (c === 'unsafe') return t('models.class.unsafeHint');
		return '';
	}

	const open = (m: HfModel) => core.openUrl(`https://huggingface.co/${m.id}`);
</script>

<div class="page">
	<div class="narrow">
		<div class="page-head">
			<h1>{t('models.title')}</h1>
			<div class="seg" role="tablist">
				<button role="tab" aria-selected={tab === 'recommended'} onclick={() => (tab = 'recommended')}>{t('models.recommended')}</button>
				<button role="tab" aria-selected={tab === 'downloaded'} onclick={() => (tab = 'downloaded')}>{t('models.downloaded')}</button>
				<button role="tab" aria-selected={tab === 'all'} onclick={() => (tab = 'all')}>{t('models.all')}</button>
			</div>
		</div>

		<div class="card"><ModelsFolder /></div>

		{#if tab === 'recommended'}
			{#if best}
				<h2>{t('models.forYou')}</h2>
				<div class="list"><ModelRow model={best} /></div>
			{/if}
			<h2>{t('models.photo')}</h2>
			<div class="list">
				{#each rest3d as model (model.id)}<ModelRow {model} />{/each}
			</div>
			<h2>{t('models.picture')}</h2>
			<div class="list">
				{#each pictures as model (model.id)}<ModelRow {model} />{/each}
			</div>
			<h2>{t('models.texts')}</h2>
			<div class="list">
				{#each texts as model (model.id)}<ModelRow {model} />{/each}
			</div>
		{:else if tab === 'downloaded'}
			{#if downloaded.length}
				<div class="list mine">
					{#each downloaded as model (model.id)}<ModelRow {model} />{/each}
				</div>
			{/if}
			{#if yours.length}
				<h2>{t('models.yours')}</h2>
				<ul class="hf">
					{#each yours as p (p.id)}
						<li>
							<div class="hf-info">
								<h3 class="selectable">{p.name}</h3>
								<p class="faint">{p.file}. {t('models.notTested')}</p>
							</div>
							<button class="btn small ghost" aria-label={t('models.remove')} title={t('models.remove')} onclick={() => removeFile(p.id)}><Icon name="trash" size={16} /></button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if !downloaded.length && !yours.length}
				<div class="empty">
					<p class="muted">{t('models.noneDownloaded')}</p>
					<button class="btn small" onclick={() => (tab = 'recommended')}>{t('models.recommended')}<Icon name="arrow" size={14} /></button>
				</div>
			{/if}
		{:else}
			<form class="searchbar" onsubmit={(e) => (e.preventDefault(), search())}>
				<input class="input" type="search" placeholder={t('models.search')} aria-label={t('models.search')} bind:value={s.query} />
				<div class="seg" role="group">
					{#each FILTERS as f (f.task)}
						<button type="button" aria-pressed={s.task === f.task} onclick={() => ((s.task = f.task), search())}>{t(f.label)}</button>
					{/each}
				</div>
			</form>
			{#if s.task === 'gguf'}
				<div class="row"><button class="btn small ghost" onclick={() => ((s.query = 'uncensored'), search())}>{t('models.uncensored')}</button></div>
			{/if}
			{#if searching}
				<div class="bar unknown"><i></i></div>
			{:else if s.failed}
				<p class="muted">{t('models.searchFailed')}</p>
			{:else if s.results && !visible.length}
				<p class="muted">{t('models.noResults')}</p>
			{/if}
			<ul class="hf">
				{#each visible as m (m.id)}
					{@const c = classify(m)}
					{@const p = app.packs[packId(m.id)]}
					<li>
						<div class="hf-info">
							<div class="hf-name">
								<h3 class="selectable">{m.id}</h3>
								<span class="chip {chip[c]}">{t(`models.class.${c}`)}</span>
							</div>
							<p class="faint">
								{m.task || '—'}, {t('models.downloads', { n: compact(m.downloads) })}
								{#if hint(c)}<br />{hint(c)}{/if}
							</p>
							{#if p?.state === 'running'}
								<div class="bar"><i style:width="{Math.round(installProgress('native', p.stage, p.done, p.total).share * 100)}%"></i></div>
							{:else if p?.state === 'failed'}
								<p class="faint">{t('models.failed')}</p>
							{/if}
						</div>
						{#if c === 'known'}
							<button class="btn small" onclick={() => (tab = 'recommended')}>{t('models.goInstall')}<Icon name="arrow" size={14} /></button>
						{:else if c === 'text'}
							<button class="btn small" aria-expanded={!!sizes[m.id]} onclick={() => openSizes(m)}>{t('models.pickSize')}<Icon name="chevron" size={14} /></button>
						{:else if c === 'compatible' && isInstalled(packId(m.id))}
							<span class="chip good"><Icon name="check" size={14} />{t('models.installed')}</span>
						{:else if c === 'compatible' && p?.state === 'running'}
							<button class="btn small" onclick={() => core.cancelInstall(packId(m.id))}><Icon name="x" size={14} />{t('models.cancel')}</button>
						{:else if c === 'compatible'}
							<button class="btn small primary" disabled={!device} onclick={() => installFile(m)}><Icon name="download" size={15} />{t('models.install')}</button>
						{:else}
							<button class="btn small ghost" onclick={() => open(m)}><Icon name="external" size={15} />{t('models.open')}</button>
						{/if}
					</li>
					{#if sizeProblem[m.id]}<li class="size"><p class="note bad">{t(sizeProblem[m.id])}</p></li>{/if}
					{#each sizes[m.id] ?? [] as quant (quant.label)}
						{@const id = textPackId(m.id, quant.files[0].name)}
						{@const state = app.packs[id]}
						{@const fits = room(quant.size, app.hw!)}
						<li class="size">
							<div class="hf-info">
								<h3 class="selectable">{quant.label}</h3>
								<p class="faint">{(quant.size / 1e9).toFixed(1)} {t('models.gb')}, {t(`models.room.${fits}`)}{quant.files.some((f) => /mmproj/i.test(f.name)) ? `, ${t('models.sees')}` : ''}</p>
								{#if state?.state === 'running'}<div class="bar"><i style:width="{Math.round(installProgress('native', state.stage, state.done, state.total).share * 100)}%"></i></div>{/if}
								{#if state?.state === 'failed'}<p class="faint">{t('models.failed')}</p>{/if}
							</div>
							{#if isInstalled(id)}
								<span class="chip good"><Icon name="check" size={14} />{t('models.installed')}</span>
							{:else if state?.state === 'running'}
								<button class="btn small" onclick={() => core.cancelInstall(id)}><Icon name="x" size={14} />{t('models.cancel')}</button>
							{:else}
								<button class="btn small primary" disabled={fits === 'none'} onclick={() => installSize(m, quant)}><Icon name="download" size={15} />{t('models.install')}</button>
							{/if}
						</li>
					{/each}
				{/each}
			</ul>
			{#if hidden > 0}<p class="faint">{t('models.matureHidden')}</p>{/if}
		{/if}
	</div>
</div>

<style>
	h2 {
		margin: 22px 0 10px;
		font-size: 14px;
		color: var(--ink-muted);
		font-weight: 500;
	}

	.list {
		display: grid;
		gap: 8px;
	}

	.mine {
		margin-top: 22px;
	}

	.empty {
		display: grid;
		justify-items: start;
		gap: 12px;
		margin-top: 22px;
	}

	.searchbar {
		display: flex;
		gap: 8px;
		margin: 14px 0;
	}

	.searchbar .seg {
		flex-shrink: 0;
	}

	.hf {
		list-style: none;
		margin: 8px 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.hf li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 12px 16px;
		border-radius: var(--r-lg);
		background: var(--surface-2);
	}

	.hf-info {
		min-width: 0;
		display: grid;
		gap: 2px;
	}

	.hf-name {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.hf .chip {
		background: var(--surface-3);
	}
</style>
