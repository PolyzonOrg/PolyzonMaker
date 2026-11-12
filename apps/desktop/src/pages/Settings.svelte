<script lang="ts">
	import { onMount } from 'svelte';
	import { core } from '../lib/core';
	import { problem } from '../lib/problem';
	import { gpuTest } from '../lib/gpu-test';
	import { t } from '../lib/i18n.svelte';
	import { contributed, themeKey } from '../lib/plugins';
	import { app, benchOf, checkUpdate, save } from '../lib/state.svelte';
	import { isWorking } from '../lib/threads';
	import Icon from '../parts/Icon.svelte';
	import ModelsFolder from '../parts/ModelsFolder.svelte';
	import Select from '../parts/Select.svelte';

	let checking = $state(false);
	let reporting = $state(false);
	let reported = $state('');

	async function saveReport() {
		reporting = true;
		reported = '';
		try {
			const path = await core.supportReport(`polyzon-maker-report-${new Date().toISOString().slice(0, 10)}.zip`);
			if (path) reported = t('support.saved', { path });
		} catch (e) {
			reported = t('app.actionFailed') + ' ' + problem(e);
		} finally {
			reporting = false;
		}
	}
	let sample = $state('');
	let showSample = $state(false);

	const bench = $derived(benchOf());
	const hw = $derived(app.hw!);
	/** Themes the plugins that are on bring; the app's own light and dark come first, above */
	const themes = $derived(contributed(app.plugins, app.settings.plugins ?? {}, 'themes').map(({ plugin, item }) => ({ value: themeKey(plugin.id, item.id), label: `${item.title} · ${plugin.name}` })));

	let port = $state(app.settings.api_port || 7878);
	let portTaken = $state(false);
	let portBad = $state(false);
	let copied = $state(false);
	let lookingForUpdate = $state(false);
	let updateNote = $state<'' | 'none' | 'failed'>('');
	const address = $derived(`http://127.0.0.1:${app.settings.api_port}`);
	const example = $derived(
		`curl -H "Authorization: Bearer ${app.settings.api_token}" ${address}/v1/status\n\n` +
			`curl -H "Authorization: Bearer ${app.settings.api_token}" --data-binary @cat.png "${address}/v1/jobs?model=trellis2&preset=512"`
	);

	onMount(async () => {
		app.slicers = await core.slicers();
		sample = JSON.stringify(await core.telemetrySample(), null, 2);
	});

	async function recheck() {
		checking = true;
		try {
			const measured = await core.measure(hw.threads);
			const g = await gpuTest();
			await save({ benchmark: { ...measured, gpu_score: g.score, gpu_renderer: g.renderer } });
			app.hw = await core.hardware(true);
		} finally {
			checking = false;
		}
	}

	async function setApi(enabled: boolean, newKey = false) {
		portTaken = false;
		portBad = !Number.isInteger(port) || port < 1024 || port > 65535;
		if (portBad) return;
		try {
			app.settings = await core.apiSet(enabled, port, newKey);
			port = app.settings.api_port;
		} catch {
			portTaken = true;
			app.settings = await core.settings();
		}
	}

	async function copyKey() {
		await navigator.clipboard?.writeText(app.settings.api_token);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	async function lookForUpdate() {
		lookingForUpdate = true;
		const result = await checkUpdate();
		updateNote = result === 'found' ? '' : result;
		lookingForUpdate = false;
	}
</script>

<div class="page">
	<div class="narrow">
		<div class="page-head"><h1>{t('settings.title')}</h1></div>

		<section class="card">
			<div class="setting">
				<span><strong>{t('settings.language')}</strong></span>
				<div class="seg" role="group" aria-label={t('settings.language')}>
					<button aria-pressed={app.settings.language === ''} onclick={() => save({ language: '' })}>{t('settings.langAuto')}</button>
					<button aria-pressed={app.settings.language === 'ru'} onclick={() => save({ language: 'ru' })}>Русский</button>
					<button aria-pressed={app.settings.language === 'en'} onclick={() => save({ language: 'en' })}>English</button>
				</div>
			</div>
			<div class="setting">
				<span><strong>{t('settings.theme')}</strong></span>
				<div class="seg" role="group" aria-label={t('settings.theme')}>
					<button aria-pressed={app.settings.theme === ''} onclick={() => save({ theme: '' })}>{t('settings.themeAuto')}</button>
					<button aria-pressed={app.settings.theme === 'light'} onclick={() => save({ theme: 'light' })}>{t('settings.themeLight')}</button>
					<button aria-pressed={app.settings.theme === 'dark'} onclick={() => save({ theme: 'dark' })}>{t('settings.themeDark')}</button>
				</div>
			</div>
			{#if themes.length}
				<div class="setting">
					<span><strong>{t('settings.pluginTheme')}</strong><small>{t('settings.pluginThemeText')}</small></span>
					<span class="choice">
						<Select
							label={t('settings.pluginTheme')}
							value={themes.some((o) => o.value === app.settings.theme) ? app.settings.theme : ''}
							options={[{ value: '', label: t('settings.pluginThemeNone') }, ...themes]}
							onchange={(theme) => save({ theme })}
						/>
					</span>
				</div>
			{/if}
			<div class="setting">
				<span><strong>{t('keys.title')}</strong></span>
				<button class="btn small" onclick={() => (app.shortcuts = true)}>{t('keys.open')}</button>
			</div>
		</section>

		<h2>{t('settings.computer')}</h2>
		<section class="card">
			<dl class="selectable">
				<dt>{t('check.processor')}</dt>
				<dd>{hw.cpu}, {t('check.threads', { cores: hw.cores, threads: hw.threads })}</dd>
				<dt>{t('check.memory')}</dt>
				<dd>{t('check.ramSize', { gb: Math.round(hw.ram_mb / 1024) })}</dd>
				<dt>{t('check.graphics')}</dt>
				<dd>{hw.gpus.map((g) => g.name).join(', ') || t('check.noGpu')}</dd>
				<dt>{t('check.disk')}</dt>
				<dd>{t('check.free', { gb: hw.disk_free_gb ?? '—' })}</dd>
				{#if bench}
					<dt>{t('settings.scoreCpu')}</dt>
					<dd>{Math.round(bench.cpu_multi)}</dd>
					<dt>{t('settings.scoreGpu')}</dt>
					<dd>{Math.round(bench.gpu_score) || '—'}</dd>
					<dt>{t('settings.scoreDisk')}</dt>
					<dd>{Math.round(bench.disk_read_mbs)} MB/s</dd>
				{/if}
			</dl>
			<div><button class="btn small" disabled={checking || app.jobs.some(isWorking)} data-tip={app.jobs.some(isWorking) ? t('settings.recheckBusy') : undefined} onclick={recheck}><Icon name="refresh" size={14} />{checking ? t('check.running') : t('settings.recheck')}</button></div>
		</section>

		<h2>{t('nav.models')}</h2>
		<section class="card">
			<label class="setting">
				<span><strong>{t('settings.gentle')}</strong><small>{t('settings.gentleHint')}</small></span>
				<input type="checkbox" role="switch" checked={app.settings.gentle} onchange={(e) => save({ gentle: e.currentTarget.checked })} />
			</label>
			<label class="setting">
				<span><strong>{t('settings.mature')}</strong><small>{t('settings.matureHint')}</small></span>
				<input type="checkbox" role="switch" checked={app.settings.show_mature} onchange={(e) => save({ show_mature: e.currentTarget.checked })} />
			</label>
			<ModelsFolder hint={t('folder.stay')} />
		</section>

		<h2>{t('settings.sectionPrint')}</h2>
		<section class="card">
			{#if app.slicers.length}
				<div class="setting">
					<span><strong>{t('print.slicer')}</strong><small>{t('settings.slicerHint')}</small></span>
					<span class="choice"><Select label={t('print.slicer')} value={app.settings.slicer || app.slicers[0].path} options={app.slicers.map((s) => ({ value: s.path, label: s.name }))} onchange={(slicer) => save({ slicer })} /></span>
				</div>
			{:else}
				<p class="muted">{t('settings.noSlicer')}</p>
			{/if}
		</section>

		<h2>{t('settings.sectionPrivacy')}</h2>
		<section class="card">
			<label class="setting">
				<span><strong>{t('settings.analytics')}</strong><small>{t('settings.analyticsHint')}</small></span>
				<input type="checkbox" role="switch" checked={app.settings.analytics === true} onchange={(e) => save({ analytics: e.currentTarget.checked })} />
			</label>
			<button class="link more" aria-expanded={showSample} onclick={() => (showSample = !showSample)}>{showSample ? t('consent.hide') : t('consent.show')}</button>
			{#if showSample}<pre class="code selectable">{sample}</pre>{/if}
		</section>

		<h2>{t('settings.sectionDev')}</h2>
		<section class="card">
			<label class="setting">
				<span><strong>{t('settings.api')}</strong><small>{t('settings.apiHint')}</small></span>
				<input
					type="checkbox"
					role="switch"
					checked={app.settings.api_enabled}
					onchange={async (e) => {
						const box = e.currentTarget;
						await setApi(box.checked);
						box.checked = app.settings.api_enabled;
					}}
				/>
			</label>
			{#if portTaken}<p class="note bad">{t('settings.apiBusy', { port })}</p>{/if}
			{#if portBad}<p class="note bad">{t('settings.apiPortRange')}</p>{/if}
			{#if app.settings.api_enabled || portTaken || portBad}
				<div class="setting">
					<span><strong>{t('settings.apiAddress')}</strong><small class="selectable">{address}</small></span>
					<input class="input short" type="number" min="1024" max="65535" aria-label={t('settings.apiPort')} bind:value={port} onchange={() => setApi(true)} />
				</div>
			{/if}
			{#if app.settings.api_enabled}
				<div class="setting">
					<span><strong>{t('settings.apiKey')}</strong><small class="selectable">{app.settings.api_token}</small></span>
					<span class="buttons">
						<button class="btn small" onclick={copyKey}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? t('settings.apiCopied') : t('settings.apiCopy')}</button>
						<button class="btn small" onclick={() => setApi(true, true)}><Icon name="refresh" size={14} />{t('settings.apiNewKey')}</button>
					</span>
				</div>
				<pre class="code selectable">{example}</pre>
			{/if}
		</section>

		<section class="card next">
			<div><strong>{t('settings.mcp')}</strong></div>
			<p class="muted">{t(app.settings.api_enabled ? 'settings.mcpHint' : 'settings.mcpOff')}</p>
			<div><button class="btn small" onclick={() => (app.connect = true)}><Icon name="plug" size={14} />{t('agent.title')}</button></div>
		</section>

		<h2>{t('settings.updates')}</h2>
		<section class="card">
			<label class="setting">
				<span><strong>{t('settings.updatesAuto')}</strong><small>{t('settings.updatesHint')}</small></span>
				<input type="checkbox" role="switch" checked={!app.settings.updates_off} onchange={(e) => save({ updates_off: !e.currentTarget.checked })} />
			</label>
			{#if !app.settings.updates_off}
				<label class="setting">
					<span><strong>{t('update.auto')}</strong><small>{t('update.autoHint')}</small></span>
					<input type="checkbox" role="switch" checked={!app.settings.updates_manual} onchange={(e) => save({ updates_manual: !e.currentTarget.checked })} />
				</label>
			{/if}
			<div class="setting">
				<span>
					<strong>{t('settings.updatesCurrent', { v: app.version })}</strong>
					{#if updateNote}<small>{updateNote === 'none' ? t('settings.updatesNone') : t('settings.updatesFailed')}</small>{/if}
				</span>
				<button class="btn small" disabled={lookingForUpdate} onclick={lookForUpdate}><Icon name="refresh" size={14} />{t('settings.updatesCheck')}</button>
			</div>
		</section>

		<h2>{t('settings.about')}</h2>
		<section class="card">
			<p class="muted">{t('settings.version', { v: app.version })}</p>
			<div class="setting">
				<span><strong>{t('support.title')}</strong><span class="faint">{t('support.text')}</span></span>
				<button class="btn small" disabled={reporting} onclick={saveReport}><Icon name="download" size={14} />{t('support.save')}</button>
			</div>
			{#if reported}<p class="faint selectable" role="status">{reported}</p>{/if}
		</section>
	</div>
</div>

<style>
	h2 {
		margin: 24px 0 10px;
		font-size: 14px;
		color: var(--ink-muted);
		font-weight: 500;
	}

	.next {
		margin-top: 8px;
	}

	strong {
		font-weight: 500;
	}

	/* a choice beside its words keeps one width, whatever it says now */
	.choice {
		display: block;
		width: 240px;
		flex-shrink: 0;
	}

	dl {
		margin: 0;
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 4px 24px;
	}

	dt {
		color: var(--ink-muted);
	}

	dd {
		margin: 0;
	}

	.more {
		justify-self: start;
	}

</style>
