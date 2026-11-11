<script lang="ts">
	/**
	 * The scene of a multi-part tool, for ToolShell's `viewport` slot: parts
	 * in their colours, «Раздвинуть», cut planes. three.js loads after
	 * mount (the page renders on the server first).
	 */
	import { onDestroy, onMount } from 'svelte';
	import { bounds } from '../stl';
	import type { Part } from './parts';
	import type { PartsViewer, ViewPlane } from './parts-viewer';
	import type { Vec3 } from './plane';

	let {
		parts,
		explode = 0,
		planes = [],
		fitKey,
		onpick = null
	}: {
		parts: readonly Part[];
		/** 0…1: how far the parts move apart. */
		explode?: number;
		planes?: readonly ViewPlane[];
		/** The camera re-fits when this changes (a new file, a new layout). */
		fitKey?: unknown;
		/** A click on a part: the point in model coordinates (null: clicks only turn the camera). */
		onpick?: ((point: Vec3) => void) | null;
	} = $props();

	let container = $state<HTMLDivElement>();
	let viewer = $state<PartsViewer | null>(null);
	let fitted: unknown = Symbol();
	let fittedSize = 0;

	onMount(async () => {
		const { PartsViewer } = await import('./parts-viewer');
		if (container) viewer = await PartsViewer.create(container);
	});
	onDestroy(() => viewer?.dispose());

	/** The largest side of all parts together. */
	const size = $derived.by(() => {
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (const p of parts) {
			const b = bounds(p.tris);
			for (let k = 0; k < 3; k++) {
				lo[k] = Math.min(lo[k], b.min[k]);
				hi[k] = Math.max(hi[k], b.max[k]);
			}
		}
		return parts.length ? Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) : 0;
	});

	$effect(() => {
		if (!viewer) return;
		const k = explode * size * 0.35;
		// Re-fit for a new key (once there is something to show) or a much bigger/smaller model.
		const fit =
			parts.length > 0 &&
			(fitted !== fitKey || Math.abs(size - fittedSize) > 0.25 * Math.max(fittedSize, 1));
		if (fit) {
			fitted = fitKey;
			fittedSize = size;
		}
		viewer.setParts(
			parts.map((p) => ({
				id: p.id,
				tris: p.tris,
				color: p.color,
				visible: p.visible,
				offset: [p.dir[0] * k, p.dir[1] * k, p.dir[2] * k]
			})),
			fit
		);
	});

	$effect(() => {
		viewer?.setPlanes(planes);
	});

	$effect(() => {
		viewer?.setPick(onpick);
	});
</script>

<div class="absolute inset-0" bind:this={container}></div>
