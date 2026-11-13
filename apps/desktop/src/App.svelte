<script lang="ts">
	import { onMount } from 'svelte';
	import { core, isMac, on, showTaskbar, type After } from './lib/core';
	import { dragged, RAIL, settled, stepped, WIDEST } from './lib/menu';
	import { reportError } from './lib/report';
	import { lang, setLang, t } from './lib/i18n.svelte';
	import { problem } from './lib/problem';
	import { actionFor, run, type Scope } from './lib/keys';
	import { app, go, init, jobExpected, jobShare, loadThumb, save, setAfter, setMenuWidth, toggleMenu, togglePin, working, type Page } from './lib/state.svelte';
	import { taskbar } from './lib/queue';
	import { installsShare } from './lib/catalog';
	import { threads, threadWith } from './lib/threads';
	import Create from './pages/Create.svelte';
	import Library from './pages/Library.svelte';
	import Models from './pages/Models.svelte';
	import Settings from './pages/Settings.svelte';
	import Welcome from './pages/Welcome.svelte';
	import Boat from './parts/Boat.svelte';
	import Dialog from './parts/Dialog.svelte';
	import UpdateDialog from './parts/UpdateDialog.svelte';
	import Plugin from './pages/Plugin.svelte';
	import Plugins from './pages/Plugins.svelte';
	import Icon, { type IconName } from './parts/Icon.svelte';
	import Edge from './parts/Edge.svelte';
	import TitleBar from './parts/TitleBar.svelte';
	import Tip from './parts/Tip.svelte';
	import Toasts from './parts/Toasts.svelte';
	import { showToast } from './studio/toast';

	let failed = $state('');
	let closing = $state(false);
	/** The first close with the tray there: where the window goes is said once */
	let traying = $state(false);
	let showUpdate = $state(false);
	/** Over the window with a file: enter and leave come in pairs for every element crossed */
	let dragging = $state(0);
	let resizing = $state(false);

	const SCOPES: Partial<Record<Page, Scope>> = { cad: 'cad', result: 'result' };

	function typing(target: EventTarget | null) {
		const element = target as HTMLElement | null;
		return !!element?.closest?.('input, textarea, select, [contenteditable="true"]');
	}

	function shortcut(e: KeyboardEvent) {
		if (!app.ready || !app.settings?.onboarded) return;
		// a key a part already took (the editor's, a menu's), or one pressed in a dialog, is not the page's:
		// Delete in «Удалить программу?» deleted the selected part behind it too
		if (e.defaultPrevented) return;
		const action = actionFor(e, typing(e.target), SCOPES[app.page] ?? null, app.keys);
		if (!action) return;
		// the keys that opened the sheet of keys close it too, as before
		if (document.querySelector('[aria-modal="true"]') && !(action.id === 'help' && app.shortcuts)) return;
		const pages: Record<string, () => void> = {
			new: () => go('create'),
			menu: toggleMenu,
			assistant: () => (app.chatOpen = !app.chatOpen),
			help: () => (app.shortcuts = !app.shortcuts)
		};
		const page = action.id.startsWith('page.') ? () => go(action.id.slice(5) as Page) : pages[action.id];
		if (page) page();
		else if (!run(action.id)) return;
		e.preventDefault();
	}

	function dropped(e: DragEvent) {
		e.preventDefault();
		dragging = 0;
		const file = e.dataTransfer?.files[0];
		if (file && app.settings?.onboarded) {
			app.dropped = file;
			go('create');
		}
	}

	onMount(() => {
		init().catch((e) => {
			// in the person's language even when their settings were what could not be read
			setLang(app.settings?.language ?? '');
			failed = problem(e);
		});
		const error = (e: ErrorEvent) => reportError(e.error ?? e);
		// whatever nobody caught: the person is told something did not work, the code goes to the report
		const rejected = (e: PromiseRejectionEvent) => {
			reportError(e.reason);
			showToast(t('app.actionFailed'), { kind: 'error', duration: 6000 });
		};
		addEventListener('error', error);
		addEventListener('unhandledrejection', rejected);
		void on('close-requested', () => (closing = true));
		void on('close-to-tray', () => (traying = true));
		void on<[After, string]>('after-queue-failed', ([after, why]) =>
			showToast(t(after === 'shutdown' ? 'power.failedShutdown' : 'power.failedSleep', { why }), { kind: 'error', duration: 12000 })
		);
	});

	/** The seconds left before the computer sleeps or shuts down tick on screen */
	let now = $state(Date.now());
	$effect(() => {
		if (!app.afterAt) return;
		now = Date.now();
		const tick = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(tick);
	});
	const keepOn = async () => setAfter(await core.afterQueue('nothing'));

	/** The places; the page where a model starts is «Новая модель» above them, so it is not here twice.
	 * «Модели» is below, over «Настройки»: nothing is made there, it is close to a setting (owner, 2026-11-10). */
	const nav: { page: Page; icon: IconName; label: 'nav.library' | 'nav.tools' | 'nav.scad' | 'nav.cad' | 'nav.plugins' }[] = [
		{ page: 'library', icon: 'library', label: 'nav.library' },
		{ page: 'tools', icon: 'grid', label: 'nav.tools' },
		{ page: 'cad', icon: 'cube', label: 'nav.cad' },
		{ page: 'openscad', icon: 'code', label: 'nav.scad' },
		{ page: 'plugins', icon: 'puzzle', label: 'nav.plugins' }
	];

	const folded = $derived(app.menuWidth === RAIL);
	const recent = $derived(threads(app.jobs).slice(0, 8));
	const openThread = $derived(app.page === 'result' ? threadWith(app.jobs, app.jobId)?.id : undefined);
	const active = $derived(app.jobs.find((j) => ['preparing', 'running', 'finalizing'].includes(j.state)));
	const gpu = $derived(app.hw?.gpus[0]?.name.replace(/^(NVIDIA|AMD|Intel\(R\)) /, '') ?? '');
	/** A model on its way in, shown beside «Модели» wherever the person is */
	const installs = $derived(installsShare(app.packs, app.models));
	const installPercent = $derived(installs === null ? '' : t('nav.installing', { p: Math.round(installs * 100) }));
	const updatePercent = $derived(app.update?.total ? Math.round((app.update.done / app.update.total) * 100) : 0);

	// the work on the taskbar's button, for a window behind others or minimized: a running job's share moves with
	// time, so it ticks while one runs, and the system hears only of a change
	let tick = $state(Date.now());
	$effect(() => {
		if (!active) return;
		const timer = setInterval(() => (tick = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const bar = $derived(taskbar(installs, active ? (jobExpected(active) && active.started ? jobShare(active, tick) : 'busy') : null));
	let told = JSON.stringify({ status: 'none' });
	$effect(() => {
		const now = JSON.stringify(bar);
		if (now !== told) {
			told = now;
			void showTaskbar(bar);
		}
	});

	$effect(() => recent.forEach((thread) => loadThumb(thread.cover)));
	// the tray's menu speaks the page's language, «as the system» included, which only the page can tell
	$effect(() => void core.trayLanguage(lang.value).catch(() => {}));

	/** The list of tools loads with the first pin: the menu is drawn without it */
	let registry = $state.raw<typeof import('./studio/tools/registry') | null>(null);
	$effect(() => {
		if (app.pinned.length && !registry) void import('./studio/tools/registry').then((m) => (registry = m));
	});
	const pinned = $derived(registry ? app.pinned.flatMap((slug) => registry?.toolBySlug(slug) ?? []) : []);
</script>

<svelte:window
	ondragenter={(e) => e.dataTransfer?.types.includes('Files') && dragging++}
	ondragleave={() => dragging && dragging--}
	ondragover={(e) => e.preventDefault()}
	ondrop={dropped}
	onkeydown={shortcut}
/>

<div class="shell">
<TitleBar menu={app.ready && app.settings.onboarded} />
<div class="below">
{#if failed || !app.ready || !app.settings.onboarded}
	<div class="pane alone">
		{#if failed}
			<main class="center">
				<div class="failed" role="alert">
					<h1>{t('app.startFailed')}</h1>
					<p class="muted selectable">{failed}</p>
					<button class="btn primary" onclick={() => location.reload()}>{t('app.startAgain')}</button>
				</div>
			</main>
		{:else if !app.ready}
			<main class="center"><Boat size={48} /></main>
		{:else}
			<Welcome />
		{/if}
	</div>
{:else}
	<div class="app" class:folded class:resizing style:--menu="{app.menuWidth}px">
		<aside class="side" data-tip-side="right" aria-label={t('nav.menu')}>
		<div class="rail">
			<button class="btn new" data-keys="new" data-tip={folded ? t('nav.new') : undefined} aria-current={app.page === 'create' ? 'page' : undefined} onclick={() => go('create')}><Icon name="plus" size={16} /><span class="title">{t('nav.new')}</span></button>
			<nav aria-label={t('app.name')}>
				{#each nav as item (item.page)}
					<button class="item" data-keys="page.{item.page}" data-tip={folded ? t(item.label) : undefined} aria-current={app.page === item.page ? 'page' : undefined} onclick={() => go(item.page)}>
						<Icon name={item.icon} /><span class="title">{t(item.label)}</span>
					</button>
				{/each}
				<button class="item" data-keys="assistant" data-tip={folded ? t('nav.chat') : undefined} aria-pressed={app.chatOpen} onclick={() => (app.chatOpen = !app.chatOpen)}><Icon name="chat" /><span class="title">{t('nav.chat')}</span></button>
			</nav>
			{#if pinned.length}
				<h3 class="label">{t('nav.pinned')}</h3>
				<ul class="pinned">
					{#each pinned as tool (tool.slug)}
						<li>
							<button class="item small" data-tip-cut data-tip={folded ? tool.title : undefined} aria-current={app.page === 'tool' && app.jobId === tool.slug ? 'page' : undefined} onclick={() => go('tool', tool.slug)}>
								<span class="glyph"><tool.icon size={15} strokeWidth={1.7} aria-hidden="true" /></span><span class="title">{tool.title}</span>
							</button>
							<button class="unpin" aria-label={t('tools.unpin')} data-tip={t('tools.unpin')} onclick={() => togglePin(tool.slug)}><Icon name="x" size={14} /></button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if recent.length}
				<h3 class="label">{t('nav.recent')}</h3>
				<ul class="recent">
					{#each recent as thread (thread.id)}
						<li>
							<button class="item small" data-tip-cut data-tip={folded ? thread.title || t('job.untitled') : undefined} aria-current={openThread === thread.id ? 'page' : undefined} onclick={() => go('result', thread.cover.id)}>
								{#if app.thumbs[thread.cover.id]}<img src={app.thumbs[thread.cover.id]} alt="" />{:else}<span class="dot" class:live={thread.busy}></span>{/if}
								<span class="title">{thread.title || t('job.untitled')}</span>
								{#if thread.busy}<i class="working"></i>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="foot">
				{#if app.update}
					<button class="update" data-tip={folded ? t('update.ready', { v: app.update.version }) : undefined} onclick={() => (showUpdate = true)}>
						{#if folded}
							<Icon name="download" />
						{:else}
							<strong>{t('update.ready', { v: app.update.version })}</strong>
							<span class="faint">
								{#if app.update.state === 'downloading'}
									{t('update.progress', { p: updatePercent })}
								{:else if app.update.state === 'downloaded'}
									{t('update.onClose')}
								{:else if app.update.state === 'installing'}
									{t('update.installing')}
								{:else if app.update.state === 'failed'}
									{t('update.failed')}
								{:else}
									{t('update.whatsNew')}
								{/if}
							</span>
						{/if}
						{#if app.update.state === 'downloading'}
							<div class="bar live" class:unknown={!app.update.total}><i style:width={app.update.total ? `${updatePercent}%` : ''}></i></div>
						{/if}
					</button>
				{/if}
				<button class="item" data-keys="page.models" data-tip={folded ? [t('nav.models'), installPercent].filter(Boolean).join(', ') : undefined} aria-current={app.page === 'models' ? 'page' : undefined} onclick={() => go('models')}>
					<Icon name="brain" /><span class="title">{t('nav.models')}</span>
					{#if installPercent}<span class="share faint">{installPercent}</span><i class="working" aria-hidden="true"></i>{/if}
				</button>
				<button class="item" data-keys="page.settings" data-tip={folded ? t('nav.settings') : undefined} aria-current={app.page === 'settings' ? 'page' : undefined} onclick={() => go('settings')}><Icon name="gear" /><span class="title">{t('nav.settings')}</span></button>
				<!-- one line: the card gives way to the version, which is never cut -->
				<p class="faint machine" title={[gpu, t('settings.updatesCurrent', { v: app.version })].filter(Boolean).join(', ')}>
					{#if gpu}<span class="gpu">{gpu}</span><span aria-hidden="true">·</span><span class="selectable">v{app.version}</span>{:else}<span class="selectable">{t('settings.updatesCurrent', { v: app.version })}</span>{/if}
				</p>
			</div>
		</div>
		<!-- inside the menu's landmark, where a screen reader finds it with the menu; the menu is not positioned and
		     its overflow does not clip it, so it stands on the app's grid as before -->
		<Edge
			label={t('nav.menuWidth')}
			value={app.menuWidth}
			min={RAIL}
			max={WIDEST}
			place="left: calc(var(--menu) - 11px)"
			onchange={(width) => (app.menuWidth = dragged(width))}
			onsettle={() => setMenuWidth(settled(app.menuWidth))}
			onstep={(by) => setMenuWidth(stepped(app.menuWidth, by))}
			bind:held={resizing}
		/>
		</aside>
		<div class="work" style:--chat="{app.chatWidth}px">
		<main class="content pane">
			{#key `${app.page}:${openThread ?? app.jobId}`}
				<svelte:boundary onerror={reportError}>
				<div class="view">
					{#if app.page === 'create'}
						<Create />
					{:else if app.page === 'result'}
						{#await import('./pages/Thread.svelte') then page}<page.default id={app.jobId} />{/await}
					{:else if app.page === 'library'}
						<Library />
					{:else if app.page === 'plugins'}
						<Plugins />
					{:else if app.page === 'cad'}
						{#await import('./pages/Cad.svelte') then page}<page.default />{/await}
					{:else if app.page === 'openscad'}
						{#await import('./pages/OpenScad.svelte') then page}<page.default />{/await}
					{:else if app.page === 'tools'}
						{#await import('./pages/Tools.svelte') then page}<page.default />{/await}
					{:else if app.page === 'tool'}
						{#await import('./pages/ToolRoom.svelte') then page}<page.default slug={app.jobId} />{/await}
					{:else if app.page === 'plugin'}
						<Plugin id={app.jobId} />
					{:else if app.page === 'models'}
						<Models />
					{:else}
						<Settings />
					{/if}
				</div>
				{#snippet failed(_: unknown, reset: () => void)}
					<div class="page center">
						<h1>{t('app.broke')}</h1>
						<p class="muted">{t('app.brokeText')}</p>
						<div class="buttons">
							<button class="btn primary" onclick={reset}><Icon name="refresh" size={16} />{t('job.retry')}</button>
							<button class="btn" onclick={() => go('library')}>{t('nav.library')}</button>
						</div>
					</div>
				{/snippet}
				</svelte:boundary>
			{/key}
		</main>
		{#if app.shortcuts}
			{#await import('./parts/Shortcuts.svelte') then sheet}<sheet.default onclose={() => (app.shortcuts = false)} />{/await}
		{/if}
		{#if app.connect}
			{#await import('./parts/ConnectAgent.svelte') then panel}<panel.default onclose={() => (app.connect = false)} />{/await}
		{/if}
		{#if app.chatOpen}
			{#await import('./assistant/Panel.svelte') then panel}
				<!-- its edge lives in the panel's own landmark (Panel.svelte) -->
				<panel.default />
			{/await}
		{/if}
		</div>
	</div>
{/if}
</div>
</div>

{#if app.ready && app.settings.onboarded && app.settings.analytics === null}
	<Dialog title={t('consent.title')} onclose={() => void save({ analytics: false })}>
		<p class="muted">{t('consent.text')}</p>
		<p class="muted">{t('consent.never')}</p>
		<div class="row-end">
			<button class="btn ghost" onclick={() => save({ analytics: false })}>{t('consent.no')}</button>
			<button class="btn primary" onclick={() => save({ analytics: true })}>{t('consent.yes')}</button>
		</div>
	</Dialog>
{/if}

{#if dragging && app.settings?.onboarded}
	<div class="dropping"><Icon name="image" size={28} /><strong>{t('create.dropHere')}</strong></div>
{/if}

{#if showUpdate && app.update}
	<UpdateDialog onclose={() => (showUpdate = false)} />
{/if}

<Toasts />
<Tip />

{#if traying}
	<Dialog title={t('tray.title')} onclose={() => (traying = false)}>
		<p class="muted">{t(isMac ? 'tray.textMac' : 'tray.text')}</p>
		<div class="row-end">
			<button class="btn ghost" onclick={() => ((traying = false), working() ? (closing = true) : core.quit())}>{t('tray.quit')}</button>
			<button class="btn primary" onclick={() => ((traying = false), core.toTray())}>{t('tray.ok')}</button>
		</div>
	</Dialog>
{/if}

{#if app.afterAt}
	<Dialog title={t('power.title')} onclose={keepOn}>
		<p class="muted">{t(app.after.chosen === 'shutdown' ? 'power.shutdown' : 'power.sleep', { s: Math.max(Math.ceil((app.afterAt - now) / 1000), 0) })}</p>
		<div class="row-end">
			<button class="btn primary" onclick={keepOn}>{t('power.keepOn')}</button>
		</div>
	</Dialog>
{/if}

{#if closing}
	<Dialog title={t('close.title')} onclose={() => (closing = false)}>
		<p class="muted">{t('close.text')}</p>
		<div class="row-end">
			<button class="btn ghost" onclick={() => (closing = false)}>{t('close.stay')}</button>
			<button class="btn danger" onclick={() => core.quit()}><Icon name="x" size={16} />{t('close.quit')}</button>
		</div>
	</Dialog>
{/if}

<style>
	.center {
		height: 100%;
		display: grid;
		place-items: center;
		padding: 40px;
	}

	/* what did not work, why, and the one thing to do about it */
	.failed {
		max-width: 520px;
		display: grid;
		justify-items: center;
		gap: 12px;
		text-align: center;
	}

	.failed h1 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}

	.failed p {
		margin: 0 0 4px;
	}

	.dropping {
		position: fixed;
		inset: 0;
		z-index: 45;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		background: var(--bg);
		opacity: 0.94;
		font-size: 18px;
		pointer-events: none;
		animation: fade-in 0.12s ease-out;
	}

	.dropping strong {
		font-weight: 500;
	}

	.view {
		height: 100%;
		animation: enter 0.26s var(--ease) backwards;
	}

	.working {
		flex: none;
		width: 7px;
		height: 7px;
		margin-left: auto;
		border-radius: 50%;
		background: var(--good);
		animation: breathe 1.4s ease-in-out infinite;
	}

	.recent li,
	.pinned li,
	.update {
		animation: enter 0.24s var(--ease) backwards;
	}

	.shell {
		height: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}

	.below {
		min-height: 0;
	}

	.alone {
		margin-left: 8px;
	}

	.app {
		position: relative;
		height: 100%;
		display: grid;
		grid-template-columns: var(--menu) minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		min-width: 0;
		transition: grid-template-columns 0.24s var(--ease);
	}

	.app.resizing,
	.resizing .rail {
		transition: none;
	}

	.rail {
		width: var(--menu);
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 12px 12px;
		overflow: hidden auto;
		transition: width 0.24s var(--ease);
	}

	.rail > :not(.recent) {
		flex: none;
	}

	.side {
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}

	/* its icon stands in the same column as the icons under it */
	.new {
		justify-content: flex-start;
		gap: 10px;
		padding: 0 11px;
		margin-bottom: 10px;
	}

	nav {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 2px;
	}

	.item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 36px;
		padding: 0 10px;
		border-radius: 10px;
		color: var(--ink-muted);
		font-weight: 500;
		text-align: left;
		transition:
			background 0.12s,
			color 0.12s;
	}

	.item:hover {
		background: var(--surface-3);
		color: var(--ink);
	}

	.item[aria-current='page'] {
		background: var(--surface-3);
		color: var(--ink);
	}

	.item.small {
		min-height: 34px;
		font-weight: 400;
		font-size: 13px;
	}

	.label {
		margin: 16px 10px 4px;
		font-size: 12px;
		font-weight: 500;
		color: var(--ink-faint);
	}

	.recent {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		min-height: 72px;
		flex: 0 1 auto;
	}

	.pinned {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.pinned li {
		position: relative;
	}

	/* room for the unpin button at the end */
	.pinned .item {
		padding-right: 34px;
	}

	.glyph {
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		background: var(--surface-4);
	}

	.unpin {
		position: absolute;
		top: 50%;
		right: 5px;
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		border-radius: 6px;
		color: var(--ink-faint);
		opacity: 0;
		transform: translateY(-50%);
		transition:
			opacity 0.12s,
			background 0.12s,
			color 0.12s;
	}

	.pinned li:hover .unpin,
	.unpin:focus-visible {
		opacity: 1;
	}

	.unpin:hover {
		background: var(--surface-4);
		color: var(--ink);
	}

	.recent img {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.dot {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		background: var(--surface-4);
		flex-shrink: 0;
	}

	.dot.live {
		animation: pulse 1.4s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.4;
		}
	}

	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.folded .title {
		display: none;
	}

	/* a picture is wider than an icon */
	.folded .small {
		position: relative;
		padding: 0 8px;
	}

	.share {
		margin-left: auto;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}

	.share + .working {
		margin-left: 0;
	}

	.folded .share {
		display: none;
	}

	.folded .working {
		position: absolute;
		top: 4px;
		right: 4px;
		margin: 0;
	}

	.folded .label,
	.folded .machine {
		display: none;
	}

	.folded .recent,
	.folded .pinned {
		margin-top: 12px;
	}

	.folded .unpin {
		display: none;
	}

	.folded .rail::-webkit-scrollbar,
	.folded .recent::-webkit-scrollbar {
		display: none;
	}

	.folded .update {
		justify-items: center;
		padding: 10px 0;
	}

	.foot {
		margin-top: auto;
		padding-top: 8px;
	}

	.update {
		width: 100%;
		display: grid;
		gap: 6px;
		margin-bottom: 8px;
		padding: 12px;
		border-radius: var(--r-lg);
		background: var(--surface-3);
		text-align: left;
		transition: background 0.12s;
	}

	.update:hover {
		background: var(--surface-4);
	}

	.update strong {
		font-weight: 500;
	}

	.update span {
		font-size: 12px;
	}

	.machine {
		display: flex;
		gap: 6px;
		padding: 4px 10px 0;
		font-size: 12px;
		white-space: nowrap;
	}

	.gpu {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.work {
		position: relative;
		container: work / inline-size;
		min-width: 0;
		height: 100%;
		display: flex;
	}

	.content {
		container-type: inline-size;
		flex: 1;
	}
</style>
