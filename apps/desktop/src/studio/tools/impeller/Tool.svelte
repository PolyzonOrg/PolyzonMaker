<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/impeller';
	import {
		IMPELLER_DEFAULTS,
		IMPELLER_PRESETS,
		impellerHeader,
		impellerModel,
		impellerSummary,
		type BladeShape,
		type ImpellerParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<ImpellerParams>({ ...IMPELLER_DEFAULTS });
	const model = $derived(impellerModel(p));
	const source = $derived(toScad(model, impellerHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: { value: BladeShape; label: string }[] = [
		{ value: 'backward', label: m.t_impeller_shape_backward() },
		{ value: 'radial', label: m.t_impeller_shape_radial() },
		{ value: 'forward', label: m.t_impeller_shape_forward() }
	];
	const HINTS: Record<BladeShape, string> = {
		backward: m.t_impeller_shape_backward_hint(),
		radial: m.t_impeller_shape_radial_hint(),
		forward: m.t_impeller_shape_forward_hint()
	};

	function applyPreset(params: Partial<ImpellerParams>) {
		p = { ...IMPELLER_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_impeller_filename()}-${p.diameter}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each IMPELLER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_impeller_group_blades()}>
			<ChoiceField
				label={tc.tc_shape()}
				bind:value={p.shape}
				options={SHAPES}
				hint={HINTS[p.shape]}
			/>
			<NumberField label={tc.tc_diameter()} unit="mm" bind:value={p.diameter} min={20} max={200} />
			<NumberField label={m.t_impeller_blades()} bind:value={p.blades} min={3} max={40} />
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.height}
				min={3}
				max={80}
				step={0.5}
			/>
			<NumberField
				label={m.t_impeller_blade()}
				unit="mm"
				bind:value={p.blade}
				min={0.8}
				max={4}
				step={0.1}
			/>
			<NumberField
				label={m.t_impeller_eye()}
				unit="%"
				bind:value={p.eye}
				min={15}
				max={80}
				hint={m.t_impeller_eye_hint()}
			/>
			<NumberField
				label={m.t_impeller_disc()}
				unit="mm"
				bind:value={p.disc}
				min={1}
				max={5}
				step={0.1}
			/>
			<p class="text-xs text-neutral-400">{impellerSummary(p)}</p>
		</FieldGroup>
		<FieldGroup title={m.t_impeller_group_shaft()}>
			<NumberField
				label={m.t_impeller_bore()}
				unit="mm"
				bind:value={p.bore}
				min={1}
				max={30}
				step={0.1}
			/>
			<ToggleField label={m.t_impeller_d_flat()} bind:checked={p.dFlat} />
			<NumberField
				label={m.t_impeller_hub()}
				unit="mm"
				bind:value={p.hub}
				min={4}
				max={60}
				step={0.5}
			/>
			<NumberField
				label={m.t_impeller_hub_height()}
				unit="mm"
				bind:value={p.hubHeight}
				min={2}
				max={40}
				step={0.5}
			/>
		</FieldGroup>
	{/snippet}
</ToolShell>
