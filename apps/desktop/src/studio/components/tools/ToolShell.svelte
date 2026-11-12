<script lang="ts" module>
	import type { Component } from 'svelte';
	import type { Icon as LucideIcon } from 'lucide-svelte';

	export interface ToolExport {
		label: string;
		icon?: Component<Record<string, unknown>> | typeof LucideIcon;
		onClick: () => void;
		disabled?: boolean;
		primary?: boolean;
	}
</script>

<script lang="ts">
	/**
	 * Every 3D tool: its form on the left, the result on the right. The same parts and props as
	 * Studio's shell, in this app's design, with one action more: the model goes to the library,
	 * and from there to printing like any other. The tool's own markup stays inside `.studio`.
	 */
	import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
	import { Loader2, RefreshCw, Ruler } from 'lucide-svelte';
	import { openBench } from '$lib/agent';
	import { form as fields } from '$lib/fields';
	import { Memory } from '$lib/memory';
	import { dismissToast, showToast } from '$lib/toast';
	import { num } from '$lib/i18n/current';
	import type { ScadViewer } from '$lib/openscad/three-viewer';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import { core } from '../../../lib/core';
	import { lang, t, type Key } from '../../../lib/i18n.svelte';
	import { sceneView, type SceneView } from '../../../lib/view-scene';
	import ViewControls from '../../../parts/ViewControls.svelte';
	import { modelFile } from '../../../lib/plugins';
	import { app, go } from '../../../lib/state.svelte';
	import { areaWidth } from '../../../lib/menu';
	import AreaEdge from '../../../parts/AreaEdge.svelte';
	import Icon from '../../../parts/Icon.svelte';
	import FavoriteButton from './FavoriteButton.svelte';

	let {
		tool,
		controls,
		stl = null,
		marks = null,
		busy = false,
		busyLabel = tc.tc_building(),
		error = null,
		exports = [],
		scadSource = null,
		viewport,
		empty,
		size: sizeProp = null,
		stale = false,
		onrebuild
	}: {
		tool: ToolInfo;
		controls: Snippet;
		/** The result, binary or ASCII STL. */
		stl?: Uint8Array | null;
		/** Line segments drawn over the model, in the STL's coordinates. */
		marks?: Float32Array | null;
		busy?: boolean;
		busyLabel?: string;
		error?: string | null;
		exports?: ToolExport[];
		/** The tool's model as an OpenSCAD program: it opens in the editor. */
		scadSource?: string | null;
		/** Replaces the built-in viewer, as the G-code tools do. */
		viewport?: Snippet;
		/** On the scene while there is no result yet, such as «open a file». */
		empty?: Snippet;
		/** The size of a result in a custom viewport; the built-in one reads it from `stl`. */
		size?: readonly [number, number, number] | null;
		/** The fields changed since this result, and it waits for a rebuild. */
		stale?: boolean;
		onrebuild?: () => void;
	} = $props();

	let host = $state<HTMLDivElement>();
	let form = $state<HTMLDivElement>();
	let viewer: ScadViewer | null = null;
	let view = $state.raw<SceneView | null>(null);
	let viewerReady = $state(false);
	let stlSize = $state<readonly [number, number, number] | null>(null);
	let adding = $state(false);
	/** The page's width: the form's edge keeps the view at least its narrowest */
	let room = $state(0);
	const size = $derived(sizeProp ?? (stl ? stlSize : null));
	/** What the view's "About the model" says. */
	const facts = $derived.by((): [Key, string][] => {
		if (!stl || !size) return [];
		const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString(lang.value);
		return [
			['view.fact.triangles', Math.max(0, (stl.length - 84) / 50).toLocaleString(lang.value)],
			['view.fact.size', `${size.map(n).join(' × ')} ${t('scad.mm')}`]
		];
	});
	const waiting = $derived(stale && !busy && !!onrebuild);

	// the tool comes back as it was left: its fields register while the form renders, before these run
	const memory = new Memory(untrack(() => tool.slug));
	$effect(() => {
		const now = fields();
		untrack(() => memory.join(now));
	});
	$effect(() => memory.keep(fields()));
	const changed = $derived(memory.changed(fields()));
	let undo = 0;

	function reset() {
		const had = memory.reset(fields());
		dismissToast(undo);
		undo = showToast(t('tools.resetDone'), {
			action: {
				label: t('tools.undo'),
				onClick: () => {
					dismissToast(undo);
					memory.put(fields(), had);
				}
			}
		});
	}

	onDestroy(() => {
		memory.close();
		dismissToast(undo);
	});

	onMount(async () => {
		if (viewport || !host) return;
		const { ScadViewer } = await import('$lib/openscad/three-viewer');
		if (!host) return;
		viewer = await ScadViewer.create(host, { color: 0xc9c9cc });
		view = sceneView(viewer);
		viewerReady = true;
	});
	onDestroy(() => viewer?.dispose());

	$effect(() => {
		const bytes = stl;
		if (!viewerReady || !viewer || !bytes) return;
		viewer.setStl(bytes).then(
			(s) => {
				if (s) stlSize = s;
				view?.again();
			},
			() => (stlSize = null)
		);
	});

	$effect(() => {
		const lines = marks;
		if (viewerReady) viewer?.setMarks(lines);
	});

	async function finish() {
		const job = await core.importModel(tool.title, await modelFile(stl!));
		go('result', job.id);
		return job;
	}

	async function toLibrary() {
		adding = true;
		try {
			await finish();
		} finally {
			adding = false;
		}
	}

	openBench({
		// fixed now: the prop already names the next tool while this shell is on its way out
		slug: untrack(() => tool.slug),
		get busy() {
			return busy;
		},
		get error() {
			return error;
		},
		get stale() {
			return stale;
		},
		get ready() {
			return !!stl;
		},
		get size() {
			return size;
		},
		form: () => form,
		finish,
		snapshot: async () => viewer?.snapshot() ?? null,
		rebuild: () => onrebuild?.()
	});
</script>

<div class="shell" bind:clientWidth={room} style:--form="{areaWidth('tool', room, app.areas.tool)}px">
	<AreaEdge area="tool" {room} />
	<aside>
		<header>
			<button class="tool" aria-label={t('tools.all')} title={t('tools.all')} onclick={() => go('tools')}><Icon name="back" size={16} /></button>
			<h2>{tool.title}</h2>
			<span class="ends">
				{#if changed}<button class="tool" aria-label={t('tools.reset')} data-tip={t('tools.reset')} onclick={reset}><Icon name="reset" size={16} /></button>{/if}
				<FavoriteButton slug={tool.slug} />
			</span>
		</header>
		<div class="form studio" bind:this={form}>{@render controls()}</div>
	</aside>

	<section class="scene">
		{#if view}<ViewControls viewer={view} {facts} grid />{/if}
		{#if viewport}
			<div class="host studio">{@render viewport()}</div>
		{:else}
			<div class="host" bind:this={host}></div>
		{/if}

		{#if !stl && !busy && !error && empty}
			<div class="empty studio">{@render empty()}</div>
		{/if}

		<div class="status">
			{#if busy}
				<span class="chip" role="status"><Loader2 size={14} class="turn" aria-hidden="true" />{busyLabel}</span>
			{:else if waiting}
				<span class="chip" role="status">{tc.tc_params_changed()}</span>
				<button class="btn small" onclick={onrebuild}><RefreshCw size={14} aria-hidden="true" />{tc.tc_rebuild()}</button>
			{:else if size && !error}
				<span class="chip"><Ruler size={14} aria-hidden="true" />{tc.tc_size_mm({ x: num(size[0], 1), y: num(size[1], 1), z: num(size[2], 1) })}</span>
			{/if}
			{#if error}<p class="note" role="alert">{error}</p>{/if}
		</div>

		<div class="actions">
			{#if stl}
				<button class="btn small primary" disabled={stale || busy || adding} title={stale ? tc.tc_rebuild_first() : undefined} onclick={toLibrary}><Icon name="library" size={14} />{t('tools.toLibrary')}</button>
			{/if}
			{#if scadSource}
				<button class="btn small" disabled={stale} onclick={() => { app.scad = { title: tool.title, code: scadSource, program: '' }; go('openscad'); }}><Icon name="code" size={14} />{t('scad.edit')}</button>
			{/if}
			{#each exports as action (action.label)}
				<button class="btn small" disabled={action.disabled || (!stl && !viewport) || stale} title={stale ? tc.tc_rebuild_first() : undefined} onclick={action.onClick}>
					{#if action.icon}<action.icon size={14} aria-hidden="true" />{/if}
					{action.label}
				</button>
			{/each}
		</div>
	</section>
</div>

<style>
	/* the form as wide as it was pulled by its edge */
	.shell {
		position: relative;
		height: 100%;
		display: grid;
		grid-template-columns: var(--form) minmax(0, 1fr);
	}

	/* no room beside the form: the model stays in sight under it */
	@container (max-width: 640px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) minmax(220px, 40%);
		}

		/* the form above the view: no border beside it to pull */
		.shell > :global(.edge) {
			display: none;
		}

		aside {
			border-right: 0;
			border-bottom: 1px solid var(--line);
		}
	}

	aside {
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--line);
	}

	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px 12px 12px;
		border-bottom: 1px solid var(--line);
	}

	.ends {
		display: flex;
		gap: 2px;
		margin-left: auto;
	}

	h2 {
		min-width: 0;
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* positioned, so what a field hides for screen readers (absolute, 1 px) stays inside the scrolling form:
	   placed by the window instead, it made the whole window scrollable once the form was taller than it.
	   The scrollbar's room is always kept (its track is clear, with nothing to scroll it shows nothing): a form
	   that only just fitted wrapped onto more lines once a scrollbar came, and kept it after the window grew
	   back. scrollbar-gutter would say this, but WebKit leaves no room for a styled scrollbar with it. */
	.form {
		position: relative;
		min-height: 0;
		flex: 1;
		padding: 16px;
		overflow-y: scroll;
	}

	.scene {
		position: relative;
		min-width: 0;
		background: var(--viewer);
	}

	.host {
		position: absolute;
		inset: 0;
	}

	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 24px;
		text-align: center;
		color: var(--ink-muted);
		pointer-events: none;
	}

	.status {
		position: absolute;
		top: 12px;
		left: 12px;
		right: 64px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}

	.status > * {
		pointer-events: auto;
	}

	.status .chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.status :global(.turn) {
		animation: turn 0.9s linear infinite;
	}

	@keyframes turn {
		to {
			transform: rotate(360deg);
		}
	}

	.actions {
		position: absolute;
		left: 12px;
		right: 12px;
		bottom: 12px;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		pointer-events: none;
	}

	.actions .btn {
		pointer-events: auto;
	}
</style>
