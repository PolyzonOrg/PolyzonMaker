<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t, type Key } from '../lib/i18n.svelte';
	import { LOOKS, ZOOMS, type Look, type Side, type Viewable } from '../lib/view-kit';
	import Icon, { type IconName } from './Icon.svelte';

	/**
	 * One set of controls for every 3D view: how to look at what came out. `before` holds a page's own tools;
	 * `keyed`: the page answers to the CAD view keys, and the tooltips name them.
	 */
	let {
		viewer,
		facts = [],
		shadows = false,
		grid: gridAtStart = false,
		keyed = false,
		before
	}: { viewer: Viewable | null; facts?: [Key, string][]; shadows?: boolean; grid?: boolean; keyed?: boolean; before?: Snippet } = $props();

	let pan = $state(false);
	let spin = $state(false);
	// svelte-ignore state_referenced_locally
	let grid = $state(gridAtStart);
	let shade = $state(true);
	let look = $state<Look>('clay');
	let zoom = $state(100);
	let open = $state<'' | 'look' | 'zoom'>('');
	let info = $state(false);

	$effect(() => {
		if (!viewer) return;
		viewer.onZoom((percent) => (zoom = percent));
		zoom = viewer.zoom();
	});

	const SIDES: { side: Side; label: Key; short: Key; keys: string }[] = [
		{ side: 'front', label: 'cad.front', short: 'cad.frontShort', keys: 'cad.front' },
		{ side: 'top', label: 'cad.top', short: 'cad.topShort', keys: 'cad.top' },
		{ side: 'side', label: 'cad.side', short: 'cad.sideShort', keys: 'cad.side' }
	];
	const LOOK_ICON: Record<Look, IconName> = { clay: 'cube', glossy: 'drop', normals: 'layers', wire: 'mesh' };

	function toggle(which: 'look' | 'zoom') {
		open = open === which ? '' : which;
	}

	function choose<T>(apply: (v: T) => void, value: T) {
		apply(value);
		open = '';
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = '')} />

<div class="tools" role="toolbar" aria-label={t('view.title')} aria-orientation="vertical" data-tip-side="left">
	{@render before?.()}
	<button class="tool" class:on={!pan} aria-pressed={!pan} title={t('view.rotate')} aria-label={t('view.rotate')} onclick={() => viewer?.setPan((pan = false))}><Icon name="cursor" size={16} /></button>
	<button class="tool" class:on={pan} aria-pressed={pan} title={t('view.pan')} aria-label={t('view.pan')} onclick={() => viewer?.setPan((pan = true))}><Icon name="hand" size={16} /></button>
	<hr />
	<button class="tool word" data-keys={keyed ? 'cad.fit' : undefined} title={t('cad.fit')} aria-label={t('cad.fit')} onclick={() => viewer?.fit()}>3D</button>
	{#each SIDES as s (s.side)}
		<button class="tool word" data-keys={keyed ? s.keys : undefined} title={t(s.label)} aria-label={t(s.label)} onclick={() => viewer?.view(s.side)}>{t(s.short)}</button>
	{/each}
	<hr />
	<button class="tool" class:on={spin} aria-pressed={spin} title={t(spin ? 'view.spin.on' : 'view.spin.off')} aria-label={t('view.spin')} onclick={() => viewer?.setSpin((spin = !spin))}><Icon name="orbit" size={16} /></button>
	<button class="tool" class:on={grid} aria-pressed={grid} title={t(grid ? 'view.grid.on' : 'view.grid.off')} aria-label={t('view.grid')} onclick={() => viewer?.setGrid((grid = !grid))}><Icon name="grid" size={16} /></button>
	{#if shadows}
		<button class="tool" class:on={shade} aria-pressed={shade} title={t(shade ? 'view.shadows.on' : 'view.shadows.off')} aria-label={t('view.shadows')} onclick={() => viewer?.setShadows?.((shade = !shade))}><Icon name="sun" size={16} /></button>
	{/if}
	<div class="anchor">
		<button class="tool" class:on={open === 'look'} aria-expanded={open === 'look'} title={`${t('view.look')}: ${t(`view.look.${look}` as Key).toLowerCase()}`} aria-label={t('view.look')} onclick={() => toggle('look')}><Icon name={LOOK_ICON[look]} size={16} /></button>
		{#if open === 'look'}
			<div class="menu" role="menu">
				{#each LOOKS as l (l)}
					<button role="menuitemradio" aria-checked={look === l} class:on={look === l} onclick={() => choose((v: Look) => viewer?.setLook((look = v)), l)}><Icon name={LOOK_ICON[l]} size={14} />{t(`view.look.${l}` as Key)}</button>
				{/each}
			</div>
		{/if}
	</div>
	<div class="anchor">
		<button class="tool word zoom" class:long={zoom >= 1000} aria-expanded={open === 'zoom'} title={t('view.zoom')} aria-label={t('view.zoom')} onclick={() => toggle('zoom')}>{zoom}%</button>
		{#if open === 'zoom'}
			<div class="menu" role="menu">
				{#each ZOOMS as z (z)}
					<button role="menuitem" onclick={() => choose((v: number) => viewer?.setZoom(v), z)}>{z}%</button>
				{/each}
				<button role="menuitem" onclick={() => choose(() => viewer?.fit(), null)}>{t('cad.fit')}</button>
			</div>
		{/if}
	</div>
	{#if facts.length}
		<hr />
		<button class="tool" class:on={info} aria-pressed={info} title={t('view.info')} aria-label={t('view.info')} onclick={() => (info = !info)}><Icon name="info" size={16} /></button>
	{/if}
</div>

{#if info && facts.length}
	<section class="facts" aria-label={t('view.info')}>
		<header>
			<strong>{t('view.info')}</strong>
			<button class="tool" title={t('window.close')} aria-label={t('window.close')} onclick={() => (info = false)}><Icon name="x" size={14} /></button>
		</header>
		<dl class="selectable">
			{#each facts as [label, value] (label)}
				<dt>{t(label)}</dt>
				<dd>{value}</dd>
			{/each}
		</dl>
	</section>
{/if}

<style>
	.tools {
		position: absolute;
		z-index: 2;
		top: 12px;
		right: 12px;
		max-height: calc(100% - 24px);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 4px;
		border: 1px solid var(--line);
		/* 12 outside, 4 of padding: the buttons' 8 inside */
		border-radius: var(--r);
		background: var(--surface-2);
	}

	/* every button of the bar, a page's own too, one size: as far from the edge on each side. Nothing in
	   it may be wider, or the bar grows and the sides with it */
	.tools :global(.tool) {
		width: 28px;
		height: 28px;
	}

	.tools :global(hr) {
		width: 16px;
		height: 1px;
		margin: 3px 0;
		border: 0;
		background: var(--line);
	}

	.word {
		font-size: 12px;
		font-weight: 600;
	}

	/* the zoom in the width of a button, up to 2000 % */
	.zoom {
		font-size: 10px;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.zoom.long {
		font-size: 8.5px;
	}

	.anchor {
		position: relative;
	}

	.menu {
		position: absolute;
		top: 0;
		right: calc(100% + 8px);
		min-width: 160px;
		display: grid;
		padding: 4px;
		border: 1px solid var(--line);
		border-radius: var(--r);
		background: var(--surface-2);
	}

	.menu button {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 10px;
		border-radius: var(--r-sm);
		font-size: 13px;
		text-align: left;
		white-space: nowrap;
	}

	.menu button:hover,
	.menu button.on {
		background: var(--surface-3);
	}

	/* beside the toolbar: a page's own notes stay free on the left */
	.facts {
		position: absolute;
		z-index: 2;
		top: 12px;
		right: 62px; /* the toolbar is 38 wide at 12 from the edge: 12 between them */
		width: min(280px, calc(100% - 82px));
		padding: 8px 12px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--surface-2);
		font-size: 13px;
	}

	.facts header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}

	.facts strong {
		font-weight: 600;
	}

	dl {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 16px;
	}

	dt {
		color: var(--ink-muted);
	}

	dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
