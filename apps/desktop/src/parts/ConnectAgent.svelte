<script lang="ts">
	import { onDestroy } from 'svelte';
	import { agents, osOf, type Agent } from '../lib/agents';
	import { core } from '../lib/core';
	import { t, type Key } from '../lib/i18n.svelte';
	import { app } from '../lib/state.svelte';
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';

	/** Connect an AI agent to the program through MCP: pick the agent, copy one command or press one button. */
	let { onclose }: { onclose: () => void } = $props();

	const list = $derived(agents(app.exe, osOf(navigator.userAgent)));
	let chosen = $state('claude-code');
	const agent = $derived(list.find((a) => a.id === chosen) ?? list[0]);
	let copied = $state('');
	let allowing = $state(false);
	let failed = $state(false);
	let seen = $state<{ name: string; seconds_ago: number }[]>([]);

	const EXAMPLE: Key = 'agent.example';

	async function copy(text: string, what: string) {
		await navigator.clipboard?.writeText(text);
		copied = what;
		setTimeout(() => copied === what && (copied = ''), 1600);
	}

	async function allow() {
		allowing = true;
		failed = false;
		try {
			app.settings = await core.apiSet(true, app.settings.api_port, false);
		} catch {
			failed = true;
		} finally {
			allowing = false;
		}
	}

	// who has connected: asked again every few seconds while this is open, so a new agent shows up by itself
	async function look() {
		seen = await core.apiAgents().catch(() => seen);
	}
	void look();
	const timer = setInterval(look, 3000);
	onDestroy(() => clearInterval(timer));

	function ago(seconds: number) {
		if (seconds < 60) return t('agent.justNow');
		const minutes = Math.round(seconds / 60);
		return minutes < 60 ? t('agent.minutesAgo', { n: minutes }) : t('agent.hoursAgo', { n: Math.round(minutes / 60) });
	}

	const step = (a: Agent): Key => (a.how === 'run' ? 'agent.run' : a.how === 'link' ? 'agent.orFile' : a.file ? 'agent.file' : 'agent.settings');
</script>

<Dialog title={t('agent.title')} {onclose} wide>
	<p class="muted">{t('agent.what')}</p>

	{#if !app.settings.api_enabled}
		<div class="allow">
			<span>{t('agent.off')}</span>
			<button class="btn primary small" disabled={allowing} onclick={allow}><Icon name="check" size={14} />{t('agent.allow')}</button>
		</div>
		{#if failed}<p class="note bad" role="alert">{t('agent.portTaken', { port: app.settings.api_port })}</p>{/if}
	{:else}
		<p class="on"><i aria-hidden="true"></i>{t('agent.on', { port: app.settings.api_port })}</p>
	{/if}

	<div class="picker" role="group" aria-label={t('agent.which')}>
		{#each list as a (a.id)}
			<button class="pick" aria-pressed={a.id === chosen} onclick={() => (chosen = a.id)}>{a.name}</button>
		{/each}
	</div>

	<section class="how" aria-live="polite">
		{#if agent.how === 'link'}
			<button class="btn primary" onclick={() => core.openUrl(agent.link!)}><Icon name="external" size={16} />{t('agent.addTo', { name: agent.name })}</button>
		{/if}
		<p>{t(step(agent), { file: agent.file ?? '' })}</p>
		<div class="copyable">
			<pre class="selectable">{agent.text}</pre>
			<button class="btn small" onclick={() => copy(agent.text, 'text')}><Icon name={copied === 'text' ? 'check' : 'copy'} size={14} />{t(copied === 'text' ? 'agent.copied' : 'agent.copy')}</button>
		</div>
		<p class="faint">{t(agent.how === 'run' ? 'agent.afterRun' : 'agent.afterFile')}</p>
	</section>

	<section class="seen">
		<strong>{t('agent.connected')}</strong>
		{#if seen.length}
			<ul>
				{#each seen as s (s.name)}<li><i aria-hidden="true"></i>{s.name}<span class="faint">{ago(s.seconds_ago)}</span></li>{/each}
			</ul>
		{:else}
			<p class="faint">{t('agent.nobody')}</p>
		{/if}
	</section>

	<section class="try">
		<span class="faint">{t('agent.tryIt')}</span>
		<div class="copyable">
			<p class="selectable">{t(EXAMPLE)}</p>
			<button class="btn small ghost" onclick={() => copy(t(EXAMPLE), 'example')}><Icon name={copied === 'example' ? 'check' : 'copy'} size={14} />{t(copied === 'example' ? 'agent.copied' : 'agent.copy')}</button>
		</div>
	</section>

	<div class="row-end"><button class="btn" onclick={onclose}>{t('agent.done')}</button></div>
</Dialog>

<style>
	.allow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		border-radius: var(--r);
		background: var(--surface-2);
	}

	.on {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 13px;
		color: var(--ink-muted);
	}

	.on i,
	.seen i {
		width: 8px;
		height: 8px;
		flex: none;
		border-radius: 50%;
		background: var(--good);
	}

	.picker {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.pick {
		height: 32px;
		padding: 0 12px;
		border-radius: var(--r-sm);
		background: var(--surface-2);
		font-size: 13px;
		color: var(--ink-muted);
		transition:
			background 0.14s,
			color 0.14s;
	}

	.pick:hover {
		background: var(--surface-3);
		color: var(--ink);
	}

	.pick[aria-pressed='true'] {
		background: var(--surface-4);
		color: var(--ink);
		font-weight: 600;
	}

	.how {
		display: grid;
		gap: 10px;
		justify-items: start;
	}

	.how p,
	.seen p {
		margin: 0;
	}

	.copyable {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		width: 100%;
	}

	.copyable pre,
	.copyable p {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: var(--surface-2);
		font-size: 12px;
		line-height: 18px;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.copyable pre {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		max-height: 168px;
		overflow: auto;
	}

	.copyable p {
		word-break: normal;
		font-size: 13px;
	}

	.seen {
		display: grid;
		gap: 6px;
	}

	.seen ul {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.seen li {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}

	.seen li span {
		margin-left: auto;
	}

	.try {
		display: grid;
		gap: 6px;
	}
</style>
