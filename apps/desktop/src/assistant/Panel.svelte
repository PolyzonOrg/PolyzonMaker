<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { core } from '../lib/core';
	import { t } from '../lib/i18n.svelte';
	import { app, go, isInstalled } from '../lib/state.svelte';
	import Icon from '../parts/Icon.svelte';
	import Select from '../parts/Select.svelte';
	import { chat, newChat, openThread, removeThread, send, stop, useModel } from './chat.svelte';
	import Status from './Status.svelte';

	const texts = $derived([
		...app.models.filter((m) => m.kind === 'text' && isInstalled(m.id)).map((m) => ({ id: m.id, name: m.name, vision: !!m.vision })),
		...app.installed.filter((p) => p.kind === 'text' && !p.broken).map((p) => ({ id: p.id, name: p.file.replace(/\.gguf$/, ''), vision: !!p.vision }))
	]);
	let words = $state('');
	let photo = $state<{ name: string; bytes: Uint8Array; url: string } | null>(null);
	let picker = $state<HTMLInputElement>();
	let list = $state<HTMLDivElement>();
	/** Only the plan being worked through marks where it is */
	const lastPlan = $derived(chat.thread.lines.reduce((last, line, i) => (line.plan ? i : last), -1));

	function pickModel(id: string) {
		const model = texts.find((m) => m.id === id);
		void useModel(id, !!model?.vision);
	}

	$effect(() => {
		// also when the chosen one was removed
		if (texts.length && !texts.some((m) => m.id === chat.model)) pickModel(texts[0].id);
	});

	// what is new comes into view, unless the person scrolled up to read: measured before the page grows.
	// What they just sent always does.
	let counted = 0;
	$effect.pre(() => {
		const count = chat.thread.lines.length;
		void chat.status?.stage;
		void JSON.stringify(chat.thread.lines.at(-1)?.plan ?? null);
		const sent = count > counted && chat.thread.lines.at(-1)?.who === 'you';
		counted = count;
		if (sent || !list || list.scrollHeight - list.scrollTop - list.clientHeight < 160) void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
	});

	async function attach(file: File | undefined) {
		if (picker) picker.value = '';
		if (!file) return;
		const bytes = new Uint8Array(await file.arrayBuffer());
		const reader = new FileReader();
		reader.onload = () => (photo = { name: file.name, bytes, url: String(reader.result) });
		reader.readAsDataURL(file);
	}

	function submit() {
		const text = words.trim();
		if (!text || chat.busy || !chat.model) return;
		void send(text, photo ?? undefined);
		words = '';
		photo = null;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	onMount(async () => {
		chat.threads = await core.chats();
	});
</script>

<!-- over the page in a narrow window: what shows of the page is dimmed and a click there closes the assistant; the keys have its close button -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="behind" aria-hidden="true" onclick={() => (app.chatOpen = false)}></div>
<aside class="panel pane" aria-label={t('chat.title')}>
	<header>
		<div class="grow">
			<Select small icon="sparkles" label={t('chat.model')} value={chat.model} onchange={pickModel} options={texts.length ? texts.map((m) => ({ value: m.id, label: m.name })) : [{ value: '', label: t('chat.noModel') }]} />
		</div>
		<button class="tool" title={t('agent.title')} aria-label={t('agent.title')} onclick={() => (app.connect = true)}><Icon name="plug" size={16} /></button>
		<button class="tool" title={t('chat.new')} aria-label={t('chat.new')} disabled={chat.busy} onclick={newChat}><Icon name="plus" size={16} /></button>
		<button class="tool" title={t('chat.close')} aria-label={t('chat.close')} onclick={() => (app.chatOpen = false)}><Icon name="x" size={16} /></button>
	</header>

	<div class="lines selectable" bind:this={list}>
		{#if !texts.length}
			<div class="empty">
				<p>{t('chat.install')}</p>
				<button class="btn small" onclick={() => go('models')}><Icon name="brain" size={14} />{t('chat.toModels')}</button>
			</div>
		{:else if !chat.thread.lines.length}
			<div class="empty">
				<p class="muted">{t('chat.hint')}</p>
				{#each chat.threads.slice(0, 6) as old (old.id)}
					<div class="old">
						<button class="link" onclick={() => openThread(old.id)}>{old.title}</button>
						<button class="tool" title={t('scad.delete')} aria-label={t('scad.delete')} onclick={() => removeThread(old.id)}><Icon name="trash" size={14} /></button>
					</div>
				{/each}
			</div>
		{/if}
		{#each chat.thread.lines as line, i (i)}
			<div class="line {line.who}" class:bad={line.failed}>
				{#if line.picture}<img src={line.picture} alt="" />{/if}
				{#if line.text}<p>{line.text}</p>{/if}
				{#if line.plan}
					{@const next = line.plan.findIndex((s) => !s.done)}
					<div class="plan">
						<p class="faint">{t('chat.plan')}</p>
						<ol>
							{#each line.plan as step, s (s)}
								<li class:done={step.done} class:now={chat.busy && i === lastPlan && s === next}>
									<span class="mark" aria-hidden="true">{#if step.done}<Icon name="check" size={12} />{/if}</span>
									<span>{step.text}</span>
								</li>
							{/each}
						</ol>
					</div>
				{/if}
				{#if line.options && i === chat.thread.lines.length - 1 && !chat.busy}
					<div class="options">
						{#each line.options as option (option)}
							<button class="btn small" onclick={() => send(option)}>{option}</button>
						{/each}
					</div>
				{/if}
			</div>
		{/each}
		<Status />
		{#if chat.error}<p class="note bad" role="alert">{t(`chat.end.${chat.error}` as never)}</p>{/if}
		{#if chat.detail}
			<details class="faint">
				<summary>{t('job.details')}</summary>
				<pre class="code selectable">{chat.detail}</pre>
			</details>
		{/if}
	</div>

	<footer>
		{#if photo}
			<div class="photo">
				<img src={photo.url} alt="" />
				<button class="tool" title={t('chat.removePhoto')} aria-label={t('chat.removePhoto')} onclick={() => (photo = null)}><Icon name="x" size={14} /></button>
			</div>
		{/if}
		<textarea class="input" rows="3" placeholder={t('chat.placeholder')} aria-label={t('chat.placeholder')} bind:value={words} onkeydown={onKey}></textarea>
		<div class="row">
			<input bind:this={picker} class="hidden" type="file" accept="image/*" aria-hidden="true" tabindex="-1" onchange={(e) => attach(e.currentTarget.files?.[0])} />
			<button class="btn small ghost" onclick={() => picker?.click()}><Icon name="image" size={14} />{t('create.attach')}</button>
			<span class="grow"></span>
			{#if chat.busy}
				<button class="btn small" onclick={stop}><Icon name="x" size={14} />{t('scad.stop')}</button>
			{:else}
				<button class="btn small primary" disabled={!words.trim() || !chat.model || chat.starting} onclick={submit}><Icon name="arrow" size={14} />{t('chat.send')}</button>
			{/if}
		</div>
	</footer>
</aside>

<style>
	.panel {
		width: var(--chat, 340px);
		max-width: calc(100% - 8px);
		flex: none;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.behind {
		display: none;
	}

	/* too little room for two: it lies over the page, and the page shows that it is behind */
	@container work (max-width: 760px) {
		.panel {
			position: absolute;
			z-index: 2;
			top: 0;
			right: 0;
			border: 1px solid var(--line);
		}

		.behind {
			display: block;
			position: absolute;
			z-index: 2;
			inset: 0;
			border-radius: var(--r-lg);
			background: rgba(0, 0, 0, 0.45);
			animation: fade-in 0.16s ease-out;
		}
	}

	header {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px;
		border-bottom: 1px solid var(--line);
	}

	.grow {
		flex: 1;
		min-width: 0;
	}

	.lines {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		overflow-y: auto;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		font-size: 13px;
	}

	.old {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.link {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.line {
		font-size: 13px;
		line-height: 1.45;
	}

	.line p {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.line img {
		display: block;
		max-width: 100%;
		border-radius: var(--r-sm);
	}

	.line.you {
		align-self: flex-end;
		max-width: 90%;
		padding: 8px 12px;
		border-radius: var(--r);
		background: var(--surface-2);
	}

	.line.app {
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: var(--ink-muted);
		font-size: 11px;
	}

	.line.app p {
		font-family: ui-monospace, Consolas, Menlo, monospace;
	}

	.line.note {
		color: var(--ink-muted);
		font-size: 12px;
	}

	.line.bad {
		color: var(--bad);
	}

	.plan {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r);
	}

	.plan ol {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.plan li {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		color: var(--ink-muted);
		transition: color 0.2s var(--ease);
	}

	.plan li.now {
		color: var(--ink);
		font-weight: 600;
	}

	.plan li.done {
		color: var(--ink);
	}

	.mark {
		flex: none;
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		margin-top: 1px;
		border: 1px solid var(--line);
		border-radius: 50%;
	}

	.done .mark {
		border-color: var(--good);
		background: var(--good);
		color: var(--bg);
	}

	.now .mark {
		border-color: var(--ink);
	}

	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}

	footer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		border-top: 1px solid var(--line);
	}

	textarea {
		resize: none;
		font: inherit;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.photo {
		position: relative;
		width: 64px;
		height: 64px;
	}

	.photo img {
		width: 100%;
		height: 100%;
		border-radius: var(--r-sm);
		object-fit: cover;
	}

	.photo .tool {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 20px;
		height: 20px;
		background: var(--surface-2);
	}

	.hidden {
		display: none;
	}
</style>
