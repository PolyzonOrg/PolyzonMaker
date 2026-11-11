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
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/desk-grommet';
	import {
		GROMMET_DEFAULTS,
		GROMMET_PRESETS,
		grommetHeader,
		grommetModel,
		grommetSummary,
		type GrommetParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<GrommetParams>({ ...GROMMET_DEFAULTS });
	const model = $derived(grommetModel(p));
	const source = $derived(toScad(model, grommetHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<GrommetParams>) {
		p = { ...GROMMET_DEFAULTS, count: p.count, play: p.play, ...params };
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
				downloadBytes(build.value, `${m.t_desk_grommet_filename()}-${p.hole}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each GROMMET_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_desk_grommet_desk_hole()}>
			<NumberField
				label={tc.tc_hole_diameter()}
				unit="mm"
				bind:value={p.hole}
				min={25}
				max={100}
				step={1}
				hint={m.t_desk_grommet_hole_hint()}
			/>
			<NumberField
				label={m.t_desk_grommet_depth()}
				unit="mm"
				bind:value={p.depth}
				min={8}
				max={40}
				step={1}
				hint={m.t_desk_grommet_depth_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_desk_grommet_grommet()}>
			<NumberField
				label={m.t_desk_grommet_rim()}
				unit="mm"
				bind:value={p.rim}
				min={3}
				max={15}
				step={0.5}
			/>
			<NumberField
				label={m.t_desk_grommet_slot()}
				unit="mm"
				bind:value={p.slot}
				min={0}
				max={Math.round(p.hole * 0.5)}
				step={1}
				hint={m.t_desk_grommet_slot_hint()}
			/>
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.play}
				min={0}
				max={0.8}
				step={0.05}
			/>
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={4} />
			<p class="text-xs text-neutral-400">{grommetSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
