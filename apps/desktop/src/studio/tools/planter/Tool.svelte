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
	import {
		PLANTER_DEFAULTS,
		PLANTER_PRESETS,
		planterHeader,
		planterModel,
		planterSummary,
		type PlanterParams,
		type PlanterShape
	} from './model';
	import * as m from '$msg/tools/planter';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<PlanterParams>({ ...PLANTER_DEFAULTS });
	const model = $derived(planterModel(p));
	const source = $derived(toScad(model, planterHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: readonly { value: PlanterShape; label: string }[] = [
		{ value: 'round', label: m.t_planter_shape_round() },
		{ value: 'square', label: m.t_planter_shape_square() }
	];

	function applyPreset(params: Partial<PlanterParams>) {
		p = { ...PLANTER_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_planter_filename()}-${p.top}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each PLANTER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_planter_planter()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			<NumberField
				label={m.t_planter_top()}
				unit="mm"
				bind:value={p.top}
				min={40}
				max={300}
				step={1}
			/>
			<NumberField
				label={m.t_planter_bottom()}
				unit="mm"
				bind:value={p.bottom}
				min={30}
				max={p.top}
				step={1}
				hint={m.t_planter_bottom_hint()}
			/>
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.height}
				min={30}
				max={300}
				step={1}
			/>
			<NumberField
				label={tc.tc_wall_thickness()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={5}
				step={0.1}
			/>
			<NumberField
				label={m.t_planter_floor()}
				unit="mm"
				bind:value={p.floor}
				min={1.5}
				max={8}
				step={0.5}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_planter_water()}>
			<NumberField
				label={m.t_planter_holes()}
				bind:value={p.holes}
				min={0}
				max={13}
				hint={m.t_planter_holes_hint()}
			/>
			{#if p.holes > 0}
				<NumberField
					label={m.t_planter_hole_diameter()}
					unit="mm"
					bind:value={p.holeDiameter}
					min={2}
					max={15}
					step={0.5}
				/>
			{/if}
			<ToggleField
				label={m.t_planter_saucer()}
				bind:checked={p.saucer}
				hint={m.t_planter_saucer_hint()}
			/>
			{#if p.saucer}
				<NumberField
					label={m.t_planter_saucer_height()}
					unit="mm"
					bind:value={p.saucerHeight}
					min={6}
					max={40}
					step={1}
				/>
			{/if}
			<p class="text-xs text-neutral-400">{planterSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
