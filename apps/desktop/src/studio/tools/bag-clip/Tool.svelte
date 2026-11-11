<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as m from '$msg/tools/bag-clip';
	import * as tc from '$msg/tools/common';
	import {
		BAG_CLIP_DEFAULTS,
		BAG_CLIP_PRESETS,
		bagClipHeader,
		bagClipModel,
		bagClipSummary,
		type BagClipParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BagClipParams>({ ...BAG_CLIP_DEFAULTS });
	const model = $derived(bagClipModel(p));
	const source = $derived(toScad(model, bagClipHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<BagClipParams>) {
		p = { ...BAG_CLIP_DEFAULTS, ...params };
	}
</script>

<ToolShell
	{tool}
	stl={build.value}
	busy={build.busy}
	error={build.error}
	scadSource={source}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () =>
				build.value &&
				downloadBytes(build.value, `${m.t_bag_clip_filename()}-${p.length}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each BAG_CLIP_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_bag_clip_group_clip()}>
			<NumberField
				label={tc.tc_length()}
				unit="mm"
				bind:value={p.length}
				min={40}
				max={300}
				step={5}
				hint={m.t_bag_clip_length_hint()}
			/>
			<NumberField
				label={m.t_bag_clip_rod()}
				unit="mm"
				bind:value={p.rod}
				min={5}
				max={16}
				step={0.5}
			/>
			<NumberField
				label={m.t_bag_clip_bag()}
				unit="mm"
				bind:value={p.bag}
				min={0.2}
				max={2}
				step={0.05}
				hint={m.t_bag_clip_bag_hint()}
			/>
			<NumberField
				label={m.t_bag_clip_sleeve_wall()}
				unit="mm"
				bind:value={p.wall}
				min={1.4}
				max={4}
				step={0.1}
			/>
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={8} />
			<p class="text-xs text-neutral-400">{bagClipSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
