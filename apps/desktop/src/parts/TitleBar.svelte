<script lang="ts">
	import { onMount } from 'svelte';
	import { core, frame, isMac, on } from '../lib/core';
	import { t } from '../lib/i18n.svelte';
	import { RAIL } from '../lib/menu';
	import { app, toggleMenu } from '../lib/state.svelte';
	import Boat from './Boat.svelte';
	import Icon from './Icon.svelte';

	let { menu }: { menu: boolean } = $props();
	let maximized = $state(false);
	// on Windows a native window lies over the maximize button for snap layouts, and tells us about the mouse
	let overMaximize = $state(false);
	const folded = $derived(app.menuWidth === RAIL);

	onMount(async () => {
		void core.snapReady();
		void on<boolean>('snap', (over) => (overMaximize = over));
		const win = await frame();
		if (!win) return;
		const read = async () => {
			maximized = await win.isMaximized();
		};
		await read();
		await win.onResized(read);
	});

	const act = async (what: 'minimize' | 'toggleMaximize' | 'close') => {
		await (await frame())?.[what]();
	};
</script>

<header class="titlebar" class:mac={isMac} data-tauri-drag-region>
	{#if menu}
		<button
			class="tool"
			data-keys="menu"
			aria-label={t(folded ? 'nav.unfoldMenu' : 'nav.foldMenu')}
			title={t(folded ? 'nav.unfoldMenu' : 'nav.foldMenu')}
			aria-expanded={!folded}
			onclick={toggleMenu}
		>
			<Icon name="panel" size={17} />
		</button>
	{/if}
	<span class="name">
		<Boat size={18} />Polyzon Maker
		{#if !menu || folded}<span class="version">{app.version}</span>{/if}
	</span>
	{#if !isMac}
		<div class="controls">
			<button aria-label={t('window.minimize')} title={t('window.minimize')} onclick={() => act('minimize')}>
				<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" /></svg>
			</button>
			<button
				class:over={overMaximize}
				aria-label={t(maximized ? 'window.restore' : 'window.maximize')}
				title={t(maximized ? 'window.restore' : 'window.maximize')}
				onclick={() => act('toggleMaximize')}
			>
				<svg viewBox="0 0 10 10" aria-hidden="true">
					{#if maximized}
						<path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" />
					{:else}
						<path d="M.5.5h9v9h-9z" />
					{/if}
				</svg>
			</button>
			<button class="close" aria-label={t('window.close')} title={t('window.close')} onclick={() => act('close')}>
				<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M.5.5l9 9M9.5.5l-9 9" /></svg>
			</button>
		</div>
	{/if}
</header>

<style>
	.titlebar {
		height: 38px;
		display: flex;
		align-items: center;
		gap: 6px;
		padding-left: 10px;
	}

	/* room for the system's own three buttons */
	.titlebar.mac {
		padding-left: 78px;
	}

	.name {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 0 4px;
		font-size: 13px;
		font-weight: 600;
		pointer-events: none;
	}

	.version {
		font-weight: 400;
		color: var(--ink-faint);
	}

	.controls {
		margin-left: auto;
		display: flex;
		height: 100%;
	}

	/* its width and the bar's height are also in src-tauri/src/titlebar.rs */
	.controls button {
		width: 46px;
		height: 100%;
		display: grid;
		place-items: center;
		color: var(--ink);
		transition: background 0.08s;
	}

	.controls button:hover,
	.controls button.over {
		background: var(--surface-3);
	}

	.controls .close:hover {
		background: #c42b1c;
		color: #fff;
	}

	svg {
		width: 10px;
		height: 10px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1;
	}
</style>
