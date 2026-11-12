<script lang="ts">
	import { fit, formatAmount, formatRange, formatSpeed, formatTime, installProgress, kindIcon, type Model } from '../lib/catalog';
	import { core } from '../lib/core';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { app, benchOf, chooseModelsFolder, hasRoom, installing, installModel, isBroken, isInstalled, refreshInstalled } from '../lib/state.svelte';
	import Dialog from './Dialog.svelte';
	import FenceOpen from './FenceOpen.svelte';
	import Icon from './Icon.svelte';

	/** page: the head of a model's page, its name on the left and how it installs here on the right */
	let { model, compact = false, actions = true, page = false }: { model: Model; compact?: boolean; actions?: boolean; page?: boolean } = $props();

	let confirmRegion = $state(false);
	let confirmRemove = $state(false);
	let problem = $state<Key | ''>('');

	const hw = $derived(app.hw!);
	const f = $derived(fit(model, hw, benchOf()));
	const pack = $derived(app.packs[model.id]);
	const installed = $derived(isInstalled(model.id));
	const busy = $derived(installing(model.id));
	const broken = $derived(isBroken(model.id) && !busy);
	/** What is already there is not counted, so a model that only needs finishing is never stopped here. */
	const noDisk = $derived(!installed && !isBroken(model.id) && !hasRoom(model));
	const progress = $derived(pack && installProgress(model.runtime.type, pack.stage, pack.done, pack.total));
	const amount = $derived(pack && formatAmount(pack.done, pack.total, lang.value));
	/** Under a megabyte there is nothing worth counting. */
	const counted = $derived(!!pack && pack.total >= 2 ** 20 && pack.done > 0);
	/** Waiting for the network: no speed and no time left, only why it waits. */
	const offline = $derived(pack?.error === 'offline');
	const left = $derived(pack?.speed && !offline && pack.total > pack.done ? (pack.total - pack.done) / pack.speed : 0);
	/** Installed for a slower device than this computer has, as when the graphics card was not seen. */
	const otherDevice = $derived(!!installed && !!f.target && f.band !== 'no' && installed.device !== f.target.device);
	const chip = $derived(f.band === 'fast' ? 'good' : f.band === 'no' ? 'bad' : 'warn');
	const gb = (mb: number) => Math.ceil(mb / 1024);
	/** On this system its engine runs on CUDA or on nothing at all: say so, an AMD or Intel card does not help */
	const nvidiaOnly = $derived(model.targets.filter((t) => t.os === hw.os && t.device !== 'cpu').every((t) => t.device === 'cuda'));
	const why = $derived(
		f.reason === 'vram'
			? t('models.needVram', { gb: gb(f.missing_mb ?? 0) })
			: f.reason === 'ram'
				? t('models.needRam', { gb: gb(f.missing_mb ?? 0) })
				: f.reason === 'gpu'
					? t(nvidiaOnly ? 'models.needNvidia' : 'models.needGpu')
					: f.reason === 'driver'
						? t('models.needDriver')
					: f.reason === 'chip'
						? t('models.needAppleChip')
					: f.reason === 'slow'
						? t('models.tooSlow')
						: t('models.needSystem')
	);

	function install() {
		if (model.regions_excluded.length) confirmRegion = true;
		else installModel(model);
	}

	async function remove() {
		confirmRemove = false;
		problem = '';
		try {
			await core.remove(model.id);
			delete app.packs[model.id];
		} catch (e) {
			problem = e === 'BUSY' ? 'models.removeBusy' : 'models.removeFailed';
		}
		await refreshInstalled();
	}
</script>

<article class="row" class:compact class:page>
	<div class="info">
		{#if page}
			<header class="head">
				<span class="tile"><Icon name={kindIcon(model)} size={22} /></span>
				<div class="title">
					<h2 class="selectable">{model.name}</h2>
					<p class="faint">{model.publisher}</p>
				</div>
			</header>
		{:else}
			<div class="name">
				<h3>{model.name}</h3>
				<span class="chip {chip}">{t(`models.band.${f.band}`)}</span>
				{#if f.seconds && model.kind !== 'text'}<span class="faint">{formatRange(f.seconds, lang.value)}</span>{/if}
			</div>
			<p class="muted">{model.summary[lang.value]}</p>
		{/if}
		{#if !compact && !page}
			<p class="faint meta">
				{#if f.target}<span>{t('models.size', { gb: f.target.disk_gb })}</span>{/if}
				<button class="link" onclick={() => core.openUrl(model.license_url)}>{t('models.license')}: {model.license}</button>
				<button class="link" onclick={() => core.openUrl(model.source_url)}>{t('models.source')}</button>
			</p>
		{/if}
		{#if f.band === 'no'}
			<p class="note bad">{why}</p>
		{:else if noDisk}
			<p class="note bad">
				{t('models.noDiskIn', { gb: f.target?.disk_gb ?? 0 })}
				<button class="link" onclick={async () => (problem = await chooseModelsFolder())}>{t('folder.other')}</button>
			</p>
		{:else if broken}
			<p class="note warn">{t('models.broken')}</p>
		{:else if otherDevice && !busy}
			<p class="note warn">{t('models.otherDevice', { was: t(`device.${installed!.device}` as Key), now: t(`device.${f.target!.device}` as Key) })}</p>
		{:else if model.plugin}
			<p class="note warn">{t('models.fromPlugin', { name: model.plugin.name })}</p>
		{:else if f.target?.status === 'experimental'}
			<p class="note warn">{t('models.experimental')}</p>
		{/if}
		{#if f.offload && f.band !== 'no'}<p class="note warn">{t(`models.offload.${f.offload}`)}</p>{/if}
		{#if f.graphics && f.band !== 'no'}<p class="note warn">{t(`models.graphics.${f.graphics}`)}</p>{/if}
		{#if problem}<p class="note bad">{t(problem)}</p>{/if}
	</div>
	<div class="actions" hidden={!actions}>
		{#if busy}
			<button class="btn" class:small={!page} onclick={() => core.cancelInstall(model.id)}><Icon name="x" size={14} />{t('models.cancel')}</button>
		{:else if installed}
			{#if otherDevice}
				<button class="btn" class:small={!page} onclick={install}><Icon name="refresh" size={14} />{t('models.reinstall')}</button>
			{:else}
				<span class="chip good"><Icon name="check" size={14} />{t('models.installed')}</span>
			{/if}
			<button class="btn ghost" class:small={!page} aria-label={t('models.remove')} title={t('models.remove')} onclick={() => (confirmRemove = true)}><Icon name="trash" size={16} /></button>
		{:else}
			<button class="btn primary" class:small={!page} disabled={f.band === 'no' || noDisk} onclick={install}><Icon name="download" size={16} />{t('models.install')}</button>
			{#if broken}<button class="btn ghost" class:small={!page} aria-label={t('models.remove')} title={t('models.remove')} onclick={() => (confirmRemove = true)}><Icon name="trash" size={16} /></button>{/if}
		{/if}
	</div>
	{#if busy || pack?.state === 'failed'}
		<div class="below">
			{#if busy}
				<div class="progress">
					<span class="faint status">
						<i class="alive"></i>
						<span>
							{t('models.step', { n: progress!.step, of: progress!.of })}. {t(`models.stage.${pack.stage || 'tool'}` as never)}{#if counted}: {t(amount!.big ? 'models.amount' : 'models.amountSmall', { done: amount!.done, total: amount!.total })}{/if}{#if pack.speed && counted && !offline}, {t('models.speed', { mb: formatSpeed(pack.speed, lang.value) })}{/if}{#if left > 1}, {t('models.left', {
									time: formatTime(left, lang.value)
								})}{/if}
						</span>
					</span>
					{#if offline}<span class="faint">{t('models.offline')}</span>{/if}
					<div class="bar live"><i style:width="{(progress!.share * 100).toFixed(1)}%"></i></div>
				</div>
			{:else if pack?.state === 'failed' && pack.error === 'fence: FENCE_OPEN' && model.plugin}
				<FenceOpen plugin={model.plugin.id} then={() => installModel(model)} />
			{:else if pack?.state === 'failed' && pack.error === 'fence: FENCE_MISSING'}
				<p class="note bad">{t('error.FENCE_MISSING')}</p>
			{:else if pack?.state === 'failed'}
				<p class="note bad">{t(/^build:/.test(pack.error) ? 'models.failedBuild' : /^disk:.*(space|os error (112|28))/i.test(pack.error) ? 'models.failedDisk' : 'models.failed')}</p>
				{#if pack.error}
					<details class="faint">
						<summary>{t('job.details')}</summary>
						<pre class="code selectable">{pack.error}</pre>
					</details>
				{/if}
			{/if}
		</div>
	{/if}
</article>

{#if confirmRegion}
	<Dialog title={t('models.region.title')} onclose={() => (confirmRegion = false)}>
		<p class="muted">{t('models.region.text', { name: model.name })}</p>
		<div class="row-end">
			<button class="btn ghost" onclick={() => core.openUrl(model.license_url)}>{t('models.region.read')}</button>
			<button class="btn primary" onclick={() => ((confirmRegion = false), installModel(model))}>{t('models.region.accept')}</button>
		</div>
	</Dialog>
{/if}

{#if confirmRemove}
	<Dialog title={t('models.removeTitle', { name: model.name })} onclose={() => (confirmRemove = false)}>
		<p class="muted">{t('models.removeText')}</p>
		<div class="row-end">
			<button class="btn ghost" onclick={() => (confirmRemove = false)}>{t('models.cancel')}</button>
			<button class="btn danger" onclick={remove}><Icon name="trash" size={16} />{t('models.remove')}</button>
		</div>
	</Dialog>
{/if}

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-start;
		justify-content: space-between;
		padding: 16px 18px;
		border-radius: var(--r-lg);
		background: var(--surface-2);
	}

	/* the whole width of the card, under the name and the button */
	.below {
		flex-basis: 100%;
		min-width: 0;
		display: grid;
		gap: 4px;
		margin-top: -6px;
	}

	.info {
		min-width: 0;
		flex: 1 1 0;
		display: grid;
		gap: 4px;
	}

	.name {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.chip {
		background: var(--surface-3);
	}

	/* the head of a model's page: on the page itself, not in a block */
	.row.page {
		padding: 0;
		background: none;
	}

	.page .chip {
		background: var(--surface-2);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 14px;
		min-width: 0;
		margin-bottom: 4px;
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
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-size: 28px;
		font-weight: 600;
		line-height: 1.15;
		overflow-wrap: anywhere;
	}

	.title p {
		margin: 4px 0 0;
		font-size: 13px;
	}

	.page .actions {
		padding-top: 5px;
	}

	.meta {
		display: flex;
		gap: 14px;
		flex-wrap: wrap;
		margin-top: 2px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* it pulses for as long as the install is alive, whatever the numbers are doing */
	.alive {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--good);
		animation: alive 1.4s ease-in-out infinite;
	}

	@keyframes alive {
		50% {
			opacity: 0.25;
			transform: scale(0.8);
		}
	}

	/* reports come once a second: the bar glides between them instead of jumping */
	.bar.live > i {
		transition: width 1s linear;
	}

	.progress {
		display: grid;
		gap: 6px;
		margin-top: 8px;
	}

	summary {
		cursor: pointer;
	}

	pre {
		margin: 6px 0 0;
		padding: 10px;
		border-radius: var(--r-sm);
		background: var(--surface-3);
		font: 12px/1.5 ui-monospace, Consolas, Menlo, monospace;
		max-height: 180px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}
</style>
