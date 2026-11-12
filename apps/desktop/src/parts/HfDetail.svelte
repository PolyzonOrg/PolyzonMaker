<script lang="ts">
	// A model from Hugging Face: what it is, whether and how it installs here, and its README.
	import { classify, daysSince, fit, installProgress, modelFile, quants, room, textPackId, type HfClass, type HfModel, type Quant } from '../lib/catalog';
	import { core } from '../lib/core';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { markdown, type Block } from '../lib/markdown';
	import { app, benchOf, isInstalled } from '../lib/state.svelte';
	import Icon from './Icon.svelte';
	import Markdown from './Markdown.svelte';

	let { m, onshow }: { m: HfModel; onshow: (catalogId: string) => void } = $props();

	const c = $derived(classify(m));
	const CHIP: Record<HfClass, string> = { known: 'good', compatible: 'good', text: 'good', gated: 'warn', adapter: 'warn', unsafe: 'bad' };
	const HINT: Partial<Record<HfClass, Key>> = { compatible: 'models.class.compatibleHint', adapter: 'models.class.adapterHint', gated: 'models.class.gatedHint', unsafe: 'models.class.unsafeHint', text: 'models.class.textHint' };
	const icon = $derived(m.task === 'image-to-3d' ? 'cube' : m.task === 'text-to-image' ? 'image' : c === 'text' ? 'chat' : 'brain');
	const formats = $derived([m.files.some((f) => f.endsWith('.gguf')) && 'GGUF', m.files.some((f) => f.endsWith('.safetensors')) && 'safetensors'].filter(Boolean) as string[]);
	const days = $derived(daysSince(m.updated, Date.now()));
	/** «5 дней назад», «2 года назад», «сегодня», in the page's language */
	const ago = (days: number) => {
		const rtf = new Intl.RelativeTimeFormat(lang.value, { numeric: 'auto' });
		return days < 45 ? rtf.format(-days, 'day') : days < 730 ? rtf.format(-Math.round(days / 30.4), 'month') : rtf.format(-Math.round(days / 365), 'year');
	};
	const compact = (n: number) => new Intl.NumberFormat(lang.value, { notation: 'compact' }).format(n);
	const packId = $derived(`hf-${m.id.replace(/[/.]/g, '-').toLowerCase()}`);
	const pack = $derived(app.packs[packId]);
	/** The catalog's own model of this repository, for «known» */
	const known = $derived(app.models.find((model) => model.source_url.toLowerCase().includes(m.id.toLowerCase())));

	/** The device a built-in engine of that kind runs on here. */
	const deviceOf = (kind: 'picture' | 'text') => {
		const engine = app.models.find((model) => model.kind === kind);
		return engine ? fit(engine, app.hw!, benchOf()).target?.device : undefined;
	};

	let sizes = $state<Quant[] | null>(null);
	let sizeProblem = $state<Key | ''>('');
	let readme = $state<Block[] | null>(null);
	let readmeProblem = $state<Key | ''>('');
	let copied = $state(false);

	$effect(() => {
		const repo = m.id;
		const text = c === 'text';
		let gone = false;
		[sizes, sizeProblem, readme, readmeProblem, copied] = [null, '', null, '', false];
		core.readme(repo).then(
			(md) => {
				if (gone) return;
				readme = markdown(md);
				if (!readme.length) readmeProblem = 'models.readmeNone';
			},
			() => !gone && (readmeProblem = 'models.readmeFailed')
		);
		if (text) {
			core.repoFiles(repo).then(
				(files) => {
					if (gone) return;
					sizes = quants(files);
					if (!sizes.length) sizeProblem = 'models.sizesNone';
				},
				() => !gone && (sizeProblem = 'models.sizesFailed')
			);
		}
		return () => (gone = true);
	});

	async function installSize(quant: Quant) {
		const id = textPackId(m.id, quant.files[0].name);
		app.packs[id] = { id, state: 'running', stage: 'runtime', done: 0, total: 0, error: '' };
		await core.installText(m.id, $state.snapshot(quant.files), deviceOf('text') ?? 'cpu');
	}

	async function installFile() {
		const file = modelFile(m);
		const device = deviceOf('picture');
		if (!file || !device) return;
		app.packs[packId] = { id: packId, state: 'running', stage: 'runtime', done: 0, total: 0, error: '' };
		await core.installFile(m.id, file, device);
	}

	/** main.ts mends navigator.clipboard where the WebView refuses it (lib/clipboard.ts) */
	async function copy() {
		await navigator.clipboard.writeText(m.id);
		copied = true;
	}
</script>

<article class="detail">
	<header>
		<span class="tile"><Icon name={icon} size={22} /></span>
		<div class="title">
			<h2 class="selectable">{m.id}</h2>
			<p class="faint">{m.task || '—'}</p>
		</div>
		<button class="tool" aria-label={t('models.copyName')} title={copied ? t('models.copied') : t('models.copyName')} onclick={copy}><Icon name={copied ? 'check' : 'copy'} size={16} /></button>
	</header>

	<div class="chips">
		<span class="chip {CHIP[c]}">{t(`models.class.${c}`)}</span>
		<span class="chip" title={t('models.downloads', { n: m.downloads.toLocaleString(lang.value) })}><Icon name="download" size={13} />{compact(m.downloads)}</span>
		<span class="chip" title={t('models.likesN', { n: m.likes.toLocaleString(lang.value) })}><Icon name="star" size={13} />{compact(m.likes)}</span>
		{#each formats as format (format)}<span class="chip">{format}</span>{/each}
		{#if days !== null}<span class="faint updated">{t('models.updated', { when: ago(days) })}</span>{/if}
	</div>

	{#if HINT[c]}<p class="muted">{t(HINT[c]!)}</p>{/if}

	<section class="block">
		{#if c === 'known' && known}
			<div class="line">
				<p class="muted">{known.name}</p>
				<button class="btn small" onclick={() => onshow(known.id)}>{t('models.inCatalog')}<Icon name="arrow" size={14} /></button>
			</div>
		{:else if c === 'text'}
			{#if sizeProblem}
				<p class="note bad">{t(sizeProblem)}</p>
			{:else if !sizes}
				<div class="bar unknown"><i></i></div>
			{/if}
			{#each sizes ?? [] as quant (quant.label)}
				{@const id = textPackId(m.id, quant.files[0].name)}
				{@const state = app.packs[id]}
				{@const fits = room(quant.size, app.hw!)}
				<div class="line size">
					<div class="info">
						<span class="selectable">{quant.label}</span>
						<span class="faint">{(quant.size / 1e9).toFixed(1)} {t('models.gb')}, {t(`models.room.${fits}`)}{quant.files.some((f) => /mmproj/i.test(f.name)) ? `, ${t('models.sees')}` : ''}</span>
						{#if state?.state === 'running'}<div class="bar"><i style:width="{Math.round(installProgress('native', state.stage, state.done, state.total).share * 100)}%"></i></div>{/if}
						{#if state?.state === 'failed'}<span class="note bad">{t('models.failed')}</span>{/if}
					</div>
					{#if isInstalled(id)}
						<span class="chip good"><Icon name="check" size={14} />{t('models.installed')}</span>
					{:else if state?.state === 'running'}
						<button class="btn small" onclick={() => core.cancelInstall(id)}><Icon name="x" size={14} />{t('models.cancel')}</button>
					{:else}
						<button class="btn small primary" disabled={fits === 'none'} onclick={() => installSize(quant)}><Icon name="download" size={15} />{t('models.install')}</button>
					{/if}
				</div>
			{/each}
		{:else if c === 'compatible'}
			<div class="line">
				<div class="info">
					<span class="faint">{t('models.notTested')}</span>
					{#if pack?.state === 'running'}<div class="bar"><i style:width="{Math.round(installProgress('native', pack.stage, pack.done, pack.total).share * 100)}%"></i></div>{/if}
					{#if pack?.state === 'failed'}<span class="note bad">{t('models.failed')}</span>{/if}
				</div>
				{#if isInstalled(packId)}
					<span class="chip good"><Icon name="check" size={14} />{t('models.installed')}</span>
				{:else if pack?.state === 'running'}
					<button class="btn small" onclick={() => core.cancelInstall(packId)}><Icon name="x" size={14} />{t('models.cancel')}</button>
				{:else}
					<button class="btn small primary" disabled={!deviceOf('picture')} onclick={installFile}><Icon name="download" size={15} />{t('models.install')}</button>
				{/if}
			</div>
		{/if}
		<div class="line end">
			<button class="btn small ghost" onclick={() => core.openUrl(`https://huggingface.co/${m.id}`)}><Icon name="external" size={15} />{t('models.openHf')}</button>
		</div>
	</section>

	<section>
		<h3>{t('models.readme')}</h3>
		{#if readmeProblem}
			<p class="muted">{t(readmeProblem)}</p>
		{:else if !readme}
			<div class="bar unknown"><i></i></div>
		{:else}
			<div class="readme"><Markdown blocks={readme} /></div>
		{/if}
	</section>
</article>

<style>
	.detail {
		display: grid;
		gap: 20px;
		max-width: 820px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.tile {
		flex: none;
		width: 48px;
		height: 48px;
		display: grid;
		place-items: center;
		border-radius: var(--r);
		background: var(--surface-2);
	}

	.title {
		flex: 1;
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}

	header p {
		margin: 4px 0 0;
		font-size: 13px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: -6px;
	}

	.chip {
		background: var(--surface-2);
	}

	.updated {
		font-size: 13px;
	}

	.muted {
		margin: 0;
	}

	.block {
		display: grid;
		gap: 12px;
		padding: 16px 18px;
		border-radius: var(--r-lg);
		background: var(--surface-2);
	}

	.block .chip {
		background: var(--surface-3);
	}

	.line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.line.end {
		justify-content: flex-end;
	}

	.size + .size {
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}

	.info {
		min-width: 0;
		display: grid;
		gap: 2px;
	}

	section {
		display: grid;
		gap: 10px;
	}

	h3 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}

	.readme {
		padding: 18px 20px;
		border-radius: var(--r-lg);
		background: var(--surface-2);
	}

	.readme :global(code) {
		background: var(--surface-3);
	}
</style>
