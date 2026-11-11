<script lang="ts">
	import { core, type Plugin } from '../lib/core';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { fetches } from '../lib/plugins';
	import { app, go, pluginsChanged, runCommand } from '../lib/state.svelte';
	import Dialog from '../parts/Dialog.svelte';
	import Icon, { type IconName } from '../parts/Icon.svelte';

	const WORDS: Record<string, Key> = {
		'jobs.read': 'plugins.perm.read',
		'jobs.create': 'plugins.perm.create',
		'library.add': 'plugins.perm.add',
		program: 'plugins.perm.program'
	};
	const PROBLEMS: Record<string, Key> = {
		NOT_A_PLUGIN: 'plugins.error.notPlugin',
		BAD_MANIFEST: 'plugins.error.manifest',
		BAD_FILE: 'plugins.error.file',
		TOO_LARGE: 'plugins.error.large'
	};

	let asking = $state<{ path: string; manifest: Plugin } | null>(null);
	let removing = $state<Plugin | null>(null);
	let error = $state('');
	let detail = $state('');
	let busy = $state(false);

	const on = (id: string) => !app.settings.plugins[id]?.off;
	/** A fence for a plugin's program: there is one on Windows only, so far (fence.rs) */
	const fenced = $derived(app.hw?.os === 'windows');

	function problem(e: unknown) {
		const [code, ...rest] = String(e).split(': ');
		error = PROBLEMS[code] ? t(PROBLEMS[code]) : String(e);
		// the author of a plugin needs to know which part was wrong
		detail = PROBLEMS[code] ? rest.join(': ') : '';
	}

	/** Everything a plugin adds, in words, with the icon it has where it appears */
	function adds(p: Plugin): { key: string; icon: IconName; text: string }[] {
		const c = p.contributes;
		return [
			...(p.page ? [{ key: 'page', icon: 'external' as IconName, text: t('plugins.adds.page') }] : []),
			...c.panels.map((x) => ({ key: 'panel/' + x.id, icon: 'panel' as IconName, text: t('plugins.adds.panel', { name: x.title }) })),
			...c.commands.map((x) => ({ key: 'command/' + x.id, icon: 'play' as IconName, text: t(x.where === 'result' ? 'plugins.adds.commandResult' : 'plugins.adds.command', { name: x.title }) })),
			...c.themes.map((x) => ({ key: 'theme/' + x.id, icon: 'sun' as IconName, text: t('plugins.adds.theme', { name: x.title }) })),
			...c.models.map((x) => ({ key: 'model/' + x.id, icon: 'cube' as IconName, text: t('plugins.adds.model', { name: x.name }) }))
		];
	}

	/** What its models download, from where, in one line */
	function downloads(p: Plugin) {
		const f = fetches(p);
		const gb = (bytes: number) => (bytes / 2 ** 30).toLocaleString(lang.value, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
		return [
			...(f.code.length ? [t('plugins.fetch.code', { from: f.code.join(', ') })] : []),
			...(f.weights.count ? [t('plugins.fetch.weights', { n: f.weights.count, gb: gb(f.weights.bytes), from: f.weights.hosts.join(', ') })] : []),
			...(f.torch.length ? [t('plugins.fetch.torch', { v: f.torch.join(', ') })] : []),
			...(f.packages ? [t('plugins.fetch.packages', { n: f.packages })] : [])
		];
	}

	async function pick() {
		error = detail = '';
		try {
			asking = await core.pickPlugin();
		} catch (e) {
			problem(e);
		}
	}

	async function install() {
		busy = true;
		try {
			await pluginsChanged(await core.installPlugin(asking!.path));
		} catch (e) {
			problem(e);
		} finally {
			asking = null;
			busy = false;
		}
	}

	async function remove() {
		busy = true;
		try {
			await pluginsChanged(await core.removePlugin(removing!.id));
		} finally {
			removing = null;
			busy = false;
		}
	}
</script>

<div class="page">
	<header class="top">
		<div>
			<h1>{t('plugins.title')}</h1>
			<p class="muted">{t('plugins.text')}</p>
		</div>
		<button class="btn primary" onclick={pick}><Icon name="plus" size={16} />{t('plugins.add')}</button>
	</header>

	{#if error}
		<div class="note bad" role="alert">
			<p>{error}</p>
			{#if detail}<p class="selectable detail">{detail}</p>{/if}
		</div>
	{/if}
	{#if !app.plugins.length}<p class="faint">{t('plugins.empty')}</p>{/if}

	<div class="list">
		{#each app.plugins as plugin (plugin.id)}
			{@const grant = app.settings.plugins[plugin.id]}
			<section class="card">
				<div class="setting">
					<span>
						<strong>{plugin.name}</strong>
						<small>{plugin.author ? t('plugins.by', { v: plugin.version, author: plugin.author }) : t('plugins.version', { v: plugin.version })}</small>
					</span>
					<input
						type="checkbox"
						role="switch"
						aria-label={t('plugins.on', { name: plugin.name })}
						checked={on(plugin.id)}
						onchange={async (e) => pluginsChanged(await core.switchPlugin(plugin.id, e.currentTarget.checked))}
					/>
				</div>
				{#if plugin.description}<p class="muted">{plugin.description}</p>{/if}
				<ul class="adds">
					{#each adds(plugin) as line (line.key)}
						<li><Icon name={line.icon} size={14} />{line.text}</li>
					{/each}
				</ul>
				{#if plugin.contributes.models.length && !fenced}<p class="faint">{t('plugins.noFence')}</p>{/if}
				{#if grant?.network}
					<p class="faint network">
						{t('plugins.networkAllowed')}
						<button class="btn small ghost" onclick={async () => pluginsChanged(await core.allowPluginNetwork(plugin.id, false))}>{t('plugins.networkTakeBack')}</button>
					</p>
				{/if}
				<div class="buttons">
					{#if plugin.page}<button class="btn small" disabled={!on(plugin.id)} onclick={() => go('plugin', plugin.id)}><Icon name="external" size={14} />{t('plugins.open')}</button>{/if}
					{#each plugin.contributes.commands.filter((c) => c.where === 'app') as command (command.id)}
						<button class="btn small" disabled={!on(plugin.id)} onclick={() => runCommand(plugin.id, command.id)}><Icon name="play" size={14} />{command.title}</button>
					{/each}
					<button class="btn small ghost" onclick={() => (removing = plugin)}><Icon name="trash" size={14} />{t('plugins.remove')}</button>
				</div>
			</section>
		{/each}
	</div>
</div>

{#if asking}
	{@const plugin = asking.manifest}
	{@const fetched = downloads(plugin)}
	<Dialog title={t('plugins.askTitle', { name: plugin.name })} onclose={() => (asking = null)}>
		<p class="faint selectable">
			{plugin.author ? t('plugins.by', { v: plugin.version, author: plugin.author }) : t('plugins.version', { v: plugin.version })}
		</p>
		{#if plugin.description}<p class="muted">{plugin.description}</p>{/if}
		<div class="asks">
			<strong>{t('plugins.adds')}</strong>
			<ul>
				{#each adds(plugin) as line (line.key)}
					<li><Icon name={line.icon} size={16} />{line.text}</li>
				{/each}
			</ul>
		</div>
		{#if plugin.permissions.length}
			<div class="asks">
				<strong>{t('plugins.can')}</strong>
				<ul>
					{#each plugin.permissions as permission (permission)}
						<li class:strong={permission === 'program'}><Icon name="check" size={16} />{t(WORDS[permission])}</li>
					{/each}
				</ul>
				{#if fetched.length}<p class="faint">{t('plugins.fetch', { list: fetched.join('; ') })}</p>{/if}
			</div>
		{:else}
			<p>{t('plugins.canNothing')}</p>
		{/if}
		{#if plugin.contributes.models.length && !fenced}<p class="note">{t('plugins.noFence')}</p>{/if}
		<p class="muted">{t('plugins.never')} {t('plugins.trust')}</p>
		<div class="buttons end">
			<button class="btn" onclick={() => (asking = null)}>{t('plugins.cancel')}</button>
			<button class="btn primary" disabled={busy} onclick={install}><Icon name="download" size={16} />{t('plugins.install')}</button>
		</div>
	</Dialog>
{/if}

{#if removing}
	<Dialog title={t('plugins.removeTitle', { name: removing.name })} onclose={() => (removing = null)}>
		<p class="muted">{t(removing.contributes.models.length ? 'plugins.removeTextModels' : 'plugins.removeText')}</p>
		<div class="buttons end">
			<button class="btn" onclick={() => (removing = null)}>{t('plugins.cancel')}</button>
			<button class="btn danger" disabled={busy} onclick={remove}>{t('plugins.remove')}</button>
		</div>
	</Dialog>
{/if}

<style>
	.top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 16px;
	}

	.top h1 {
		margin: 0 0 4px;
	}

	.top p {
		margin: 0;
	}

	.list {
		display: grid;
		gap: 12px;
	}

	.card p,
	.note p {
		margin: 0;
	}

	.detail {
		margin-top: 4px;
		font-family: ui-monospace, monospace;
		font-size: 12px;
		word-break: break-word;
	}

	.asks {
		display: grid;
		gap: 8px;
		padding: 12px 14px;
		border-radius: var(--r);
		background: var(--surface-2);
	}

	.asks strong {
		font-weight: 500;
	}

	.asks p {
		margin: 0;
	}

	ul {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 13px;
	}

	li {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}

	li :global(svg) {
		flex: none;
		margin-top: 1px;
	}

	/* the one that reaches past the frame is read first */
	li.strong {
		color: var(--ink);
		font-weight: 500;
	}

	.adds {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		color: var(--ink-muted);
		font-size: 12px;
	}

	.adds li {
		align-items: center;
		gap: 6px;
	}

	.network {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.end {
		justify-content: flex-end;
	}
</style>
