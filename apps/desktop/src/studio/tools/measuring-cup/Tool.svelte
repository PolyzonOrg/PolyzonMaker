<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		MEASURING_CUP_DEFAULTS,
		MEASURING_CUP_PRESETS,
		measuringCupHeader,
		measuringCupModel,
		measuringCupSummary,
		type MeasuringCupParams
	} from './model';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/measuring-cup';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<MeasuringCupParams>({ ...MEASURING_CUP_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(measuringCupModel(drawn));
	const source = $derived(toScad(model, measuringCupHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<MeasuringCupParams>) {
		p = { ...MEASURING_CUP_DEFAULTS, font: p.font, ...params };
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
				downloadBytes(build.value, `${m.t_measuring_cup_filename()}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each MEASURING_CUP_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_measuring_cup_group_volume()}>
			<TextField
				label={m.t_measuring_cup_volumes()}
				bind:value={p.volumes}
				maxlength={80}
				hint={m.t_measuring_cup_volumes_hint()}
			/>
			<NumberField
				label={m.t_measuring_cup_ratio()}
				bind:value={p.ratio}
				min={0.4}
				max={2}
				step={0.05}
				hint={m.t_measuring_cup_ratio_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<NumberField
				label={tc.tc_walls()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={4}
				step={0.1}
			/>
			<ToggleField
				label={m.t_measuring_cup_handle()}
				bind:checked={p.handle}
				hint={m.t_measuring_cup_handle_hint()}
			/>
			<FontField bind:value={p.font} />
			<p class="text-xs text-neutral-400">{measuringCupSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
