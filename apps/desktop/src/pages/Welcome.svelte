<script lang="ts">
	import { fit, formatRange, recommend, type Model } from '../lib/catalog';
	import { core, on } from '../lib/core';
	import { gpuTest } from '../lib/gpu-test';
	import { lang, setLang, t, type Key } from '../lib/i18n.svelte';
	import { app, go, hasRoom, installModel, save } from '../lib/state.svelte';
	import Boat from '../parts/Boat.svelte';
	import Icon from '../parts/Icon.svelte';
	import ModelRow from '../parts/ModelRow.svelte';
	import ModelsFolder from '../parts/ModelsFolder.svelte';

	type Step = 'hello' | 'check' | 'consent' | 'pick';
	let step = $state<Step>('hello');

	// ---- the check
	type Line = 'cpu' | 'memory' | 'gpu' | 'disk';
	let running = $state<Line | null>(null);
	let finished = $state<Line[]>([]);
	let checked = $state(false);
	let sample = $state('');
	let showSample = $state(false);

	const hw = $derived(app.hw!);
	const gpu = $derived(hw.gpus[0]);
	const pick = $derived<Model | null>(recommend(app.models, hw, app.settings.benchmark));
	const best = $derived(pick ? fit(pick, hw, app.settings.benchmark) : null);

	const lines = $derived<{ id: Line; label: Key; value: string }[]>([
		{ id: 'cpu', label: 'check.processor', value: `${hw.cpu}, ${t('check.threads', { cores: hw.cores, threads: hw.threads })}` },
		{ id: 'memory', label: 'check.memory', value: t('check.ramSize', { gb: Math.round(hw.ram_mb / 1024) }) },
		{ id: 'disk', label: 'check.disk', value: t('check.free', { gb: hw.disk_free_gb ?? '—' }) },
		{
			id: 'gpu',
			label: 'check.graphics',
			value: gpu ? `${gpu.name}${gpu.vram_mb ? `, ${t('check.vram', { gb: Math.round(gpu.vram_mb / 1024) })}` : ''}` : t('check.noGpu')
		}
	]);

	let listening = false;

	async function runCheck() {
		step = 'check';
		running = 'cpu';
		if (!listening) {
			listening = true;
			await on<string>('bench', (s) => {
				if (running && running !== s) finished.push(running);
				running = s as Line;
			});
		}
		const measured = await core.measure(hw.threads);
		finished.push('disk');
		running = 'gpu';
		const g = await gpuTest();
		finished.push('gpu');
		running = null;
		await save({ benchmark: { ...measured, gpu_score: g.score, gpu_renderer: g.renderer } });
		checked = true;
	}

	async function answer(yes: boolean) {
		await save({ analytics: yes });
		step = 'pick';
	}

	async function finish(page: 'create' | 'models') {
		await save({ onboarded: true });
		go(page);
	}

	function installAndGo() {
		if (pick) installModel(pick);
		void finish('create');
	}

	$effect(() => {
		if (step === 'consent' && !sample) void core.telemetrySample().then((s) => (sample = JSON.stringify(s, null, 2)));
	});
</script>

<main class="wrap">
	{#if step === 'hello'}
		<div class="lang seg" role="group" aria-label={t('settings.language')}>
			<button aria-pressed={lang.value === 'ru'} onclick={() => setLang('ru')}>Русский</button>
			<button aria-pressed={lang.value === 'en'} onclick={() => setLang('en')}>English</button>
		</div>
	{/if}
	{#key step}
	<div class="panel">
		{#if step === 'hello'}
			<Boat size={64} />
			<h1>{t('welcome.title')}</h1>
			<p class="lead muted">{t('welcome.text')}</p>
			<button class="btn primary big" onclick={() => (save({ language: lang.value }), runCheck())}>{t('welcome.start')}<Icon name="arrow" size={16} /></button>
		{:else if step === 'check'}
			<h1>{t('check.title')}</h1>
			<p class="lead muted">{t('check.text')}</p>
			<ul class="lines">
				{#each lines as line, i (line.id)}
					<li style:--i={i}>
						<span class="what">{t(line.label)}</span>
						<span class="value selectable">{line.value}</span>
						<span class="state faint">
							{#if finished.includes(line.id)}{t('check.done')}{:else if running === line.id}{t('check.running')}{:else}{t('check.waiting')}{/if}
						</span>
						<div class="bar" class:unknown={running === line.id}><i style:width={finished.includes(line.id) ? '100%' : running === line.id ? '' : '0%'}></i></div>
					</li>
				{/each}
			</ul>
			{#if checked && !app.settings.benchmark?.gpu_score}<p class="faint">{t('check.noWebgl')}</p>{/if}
			<button class="btn primary big" disabled={!checked} onclick={() => (step = 'consent')}>{t('check.next')}<Icon name="arrow" size={16} /></button>
		{:else if step === 'consent'}
			<h1>{t('consent.title')}</h1>
			<p class="lead muted">{t('consent.text')}</p>
			<p class="lead muted">{t('consent.never')}</p>
			<button class="link more" aria-expanded={showSample} onclick={() => (showSample = !showSample)}>{showSample ? t('consent.hide') : t('consent.show')}</button>
			{#if showSample}<pre class="code selectable">{sample}</pre>{/if}
			<div class="two">
				<button class="btn big" onclick={() => answer(false)}><Icon name="x" size={16} />{t('consent.no')}</button>
				<button class="btn big" onclick={() => answer(true)}><Icon name="check" size={16} />{t('consent.yes')}</button>
			</div>
		{:else}
			<h1>{t('pick.title')}</h1>
			{#if pick && best}
				<p class="lead muted">{t('pick.text')}</p>
				<div class="pick"><ModelRow model={pick} actions={false} /></div>
				<div class="card"><ModelsFolder /></div>
				{#if best.seconds}<p class="faint">{t('create.time', { time: formatRange(best.seconds, lang.value) })}</p>{/if}
				<div class="two">
					<button class="btn big" onclick={() => finish('models')}>{t('pick.other')}</button>
					<button class="btn primary big" disabled={!hasRoom(pick)} onclick={installAndGo}><Icon name="download" size={16} />{t('pick.install')}</button>
				</div>
				<button class="link later" onclick={() => finish('create')}>{t('pick.later')}</button>
			{:else}
				<p class="lead muted">{t('pick.none')}</p>
				<button class="btn primary big" onclick={() => finish('models')}>{t('pick.other')}</button>
			{/if}
		{/if}
	</div>
	{/key}
</main>

<style>
	.wrap {
		height: 100%;
		display: grid;
		place-items: center;
		padding: 32px;
		overflow-y: auto;
	}

	.panel {
		width: min(560px, 100%);
		display: grid;
		justify-items: start;
		gap: 16px;
		position: relative;
		animation: step-in 0.32s var(--ease) backwards;
	}

	.lang {
		position: fixed;
		top: 54px;
		right: 24px;
	}

	.later {
		justify-self: center;
	}

	.lead {
		font-size: 15px;
		max-width: 52ch;
	}

	.lines {
		list-style: none;
		margin: 4px 0;
		padding: 0;
		width: 100%;
		display: grid;
		gap: 2px;
	}

	.lines li {
		animation: enter 0.3s var(--ease) backwards;
		animation-delay: calc(var(--i) * 70ms + 120ms);
		display: grid;
		grid-template-columns: 110px 1fr auto;
		gap: 2px 12px;
		padding: 12px 0;
		align-items: baseline;
	}

	.what {
		font-weight: 500;
	}

	.value {
		min-width: 0;
		color: var(--ink-muted);
	}

	.bar {
		grid-column: 1 / -1;
		height: 3px;
		margin-top: 8px;
	}

	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		width: 100%;
	}

	.more {
		color: var(--ink-muted);
		font-size: 13px;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.more:hover {
		color: var(--ink);
	}

	.pick {
		width: 100%;
	}

	pre {
		width: 100%;
		margin: 0;
		padding: 12px 14px;
		border-radius: var(--r);
		background: var(--surface-2);
		font: 12px/1.5 ui-monospace, Consolas, Menlo, monospace;
		overflow-x: auto;
	}
</style>
