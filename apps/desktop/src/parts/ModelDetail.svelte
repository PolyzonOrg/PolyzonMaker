<script lang="ts">
	// A catalog model's page: its name with how it installs here on the right, what it makes, what it
	// needs, and what it has made.
	import { fit, formatRange, modelFacts, type Model } from '../lib/catalog';
	import { core } from '../lib/core';
	import { groupsOf, MEASURED_ON } from '../lib/examples';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { app, benchOf } from '../lib/state.svelte';
	import ModelExamples from './ModelExamples.svelte';
	import ModelRow from './ModelRow.svelte';

	let { model }: { model: Model } = $props();

	const f = $derived(fit(model, app.hw!, benchOf()));
	const facts = $derived(modelFacts(model));
	const examples = $derived(groupsOf(model.id));
	const chip = $derived(f.band === 'fast' ? 'good' : f.band === 'no' ? 'bad' : 'warn');
	const does = $derived(model.kind === 'text' ? 'text' : model.kind === 'picture' ? 'picture' : model.photos ? 'photos' : 'photo');
	const CARD = { nvidia: 'NVIDIA', 'amd-intel': 'AMD, Intel', apple: 'Apple' };
	const source = $derived(model.source_url.replace(/^https?:\/\/(www\.)?/, ''));
</script>

<article class="detail">
	<ModelRow {model} page />

	<div class="chips">
		<span class="chip {chip}">{t(`models.band.${f.band}`)}{#if f.seconds && model.kind !== 'text'}, {formatRange(f.seconds, lang.value)}{/if}</span>
		{#if f.target}<span class="chip">{t('models.here', { device: t(`device.${f.target.device}` as Key), gb: f.target.disk_gb })}</span>{/if}
		<!-- an untested model says so under its name already -->
		{#if facts.tested}<span class="chip good">{t('models.tested')}</span>{/if}
	</div>

	<p class="lead">{model.summary[lang.value]}</p>

	<dl class="facts">
		<div><dt>{t('models.fact.does')}</dt><dd>{t(`models.does.${does}` as Key)}{#if model.vision}, {t('models.sees')}{/if}</dd></div>
		{#if facts.vramGb}<div><dt>{t('models.fact.vram')}</dt><dd>{t('models.fact.vramFrom', { gb: facts.vramGb })}{#if facts.leastVramGb}; {t('models.fact.vramLeast', { gb: facts.leastVramGb })}{/if}</dd></div>{/if}
		{#if facts.cards.length || facts.noCard}
			<div><dt>{t('models.fact.cards')}</dt><dd>{facts.cards.map((c) => CARD[c]).join(', ')}{#if facts.noCard}{facts.cards.length ? ', ' : ''}{t('models.fact.noCard')}{/if}</dd></div>
		{/if}
		{#if facts.seconds && model.kind !== 'text'}<div><dt>{t('models.fact.time')}</dt><dd>{t('models.fact.measured', { s: Math.round(facts.seconds), on: MEASURED_ON })}</dd></div>{/if}
		<div><dt>{t('models.license')}</dt><dd><button class="link" onclick={() => core.openUrl(model.license_url)}>{model.license}</button></dd></div>
		{#if facts.limits.length}<div><dt>{t('models.fact.limits')}</dt><dd class="warn">{facts.limits.map((l) => t(`models.limit.${l}`)).join('. ')}</dd></div>{/if}
		<div><dt>{t('models.source')}</dt><dd><button class="link" onclick={() => core.openUrl(model.source_url)}>{source}</button></dd></div>
	</dl>

	{#if model.kind !== 'text'}
		<section>
			<h3>{t('models.examples')}</h3>
			{#if examples.length}
				<ModelExamples groups={examples} of={model.id} />
				<p class="faint note-under">{t(model.kind === 'picture' ? 'models.examplesFrom' : 'models.examplesNote', { on: MEASURED_ON })}</p>
			{:else}
				<p class="muted">{t('models.noExamples')}</p>
			{/if}
		</section>
	{/if}
</article>

<style>
	.detail {
		display: grid;
		gap: 20px;
		max-width: 820px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: -6px;
	}

	.chip {
		background: var(--surface-2);
	}

	.lead {
		margin: 0;
		font-size: 18px;
		line-height: 1.45;
		max-width: 60ch;
	}

	.facts {
		margin: 0;
		display: grid;
		gap: 10px;
		padding: 16px 18px;
		border-radius: var(--r-lg);
		background: var(--surface-2);
	}

	.facts div {
		display: grid;
		grid-template-columns: minmax(120px, 34%) 1fr;
		gap: 12px;
	}

	dt {
		color: var(--ink-faint);
		font-size: 13px;
	}

	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	dd.warn {
		color: var(--warn);
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

	.note-under {
		margin: 0;
		font-size: 12px;
	}

	@container (max-width: 520px) {
		.facts div {
			grid-template-columns: 1fr;
			gap: 2px;
		}
	}
</style>
