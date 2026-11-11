<script lang="ts">
	/**
	 * The toolpath on the tool's dark scene (ToolShell `viewport`). three.js
	 * loads after mount; the props drive what is drawn.
	 */
	import { onDestroy, onMount } from 'svelte';
	import type { Feature, Toolpath } from './parse';
	import type { ColorMode, GcodeViewer } from './viewer';

	let {
		toolpath,
		visible,
		from = 0,
		to = Number.POSITIVE_INFINITY,
		fitKey,
		colorBy = 'type'
	}: {
		toolpath: Toolpath | null;
		visible: Record<Feature, boolean>;
		from?: number;
		to?: number;
		/**
		 * The camera is fitted again only when this changes (a generator keeps
		 * the view while its values change). Without it, every new toolpath fits.
		 */
		fitKey?: string;
		/** Lines by extrusion type or by speed. */
		colorBy?: ColorMode;
	} = $props();

	let host = $state<HTMLDivElement>();
	let viewer = $state<GcodeViewer | null>(null);
	let shown: Toolpath | null = null;
	let fitted: string | null = null;

	onMount(async () => {
		const { GcodeViewer } = await import('./viewer');
		if (!host) return;
		viewer = await GcodeViewer.create(host);
	});
	onDestroy(() => viewer?.dispose());

	$effect(() => {
		const v = viewer;
		const tp = toolpath;
		if (!v || tp === shown) return;
		shown = tp;
		const key = fitKey ?? null;
		const fit = !tp || key === null || key !== fitted;
		v.setToolpath(tp, fit);
		if (tp) fitted = key;
	});
	$effect(() => {
		const v = viewer;
		const vis = { ...visible };
		// Re-applied after a new toolpath too (it resets the layer range).
		void toolpath;
		v?.setVisible(vis);
		v?.setLayers(from, to);
	});

	$effect(() => {
		const mode = colorBy;
		void toolpath;
		viewer?.setColorMode(mode);
	});

	export function resetCamera() {
		viewer?.resetCamera();
	}
</script>

<div class="absolute inset-0" bind:this={host}></div>
