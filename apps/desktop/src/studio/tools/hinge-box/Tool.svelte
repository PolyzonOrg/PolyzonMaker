<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		HINGE_DEFAULTS,
		HINGE_PRESETS,
		clampHinge,
		hingeHeader,
		hingeModel,
		hingeSummary,
		type HingeBoxParams
	} from './model';
	import * as m from '$msg/tools/hinge-box';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<HingeBoxParams>({ ...HINGE_DEFAULTS });
	const model = $derived(hingeModel(p));
	const source = $derived(toScad(model, hingeHeader(p)));
	const minHeight = $derived(clampHinge({ ...p, height: 0 }).height);
	const minShown = $derived(Math.ceil(minHeight));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 450);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KNUCKLES: readonly { value: 3 | 5 | 7; label: string }[] = [
		{ value: 3, label: '3' },
		{ value: 5, label: '5' },
		{ value: 7, label: '7' }
	];

	function applyPreset(params: Partial<HingeBoxParams>) {
		p = { ...HINGE_DEFAULTS, ...params };
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
				downloadBytes(
					build.value,
					`${m.t_hinge_box_filename()}-${p.width}x${p.depth}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each HINGE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_hinge_box_group_inside()}>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={34}
				max={300}
				step={1}
			/>
			<NumberField
				label={tc.tc_depth()}
				unit="mm"
				bind:value={p.depth}
				min={15}
				max={300}
				step={1}
			/>
			<NumberField
				label={m.t_hinge_box_box_height()}
				unit="mm"
				bind:value={p.height}
				min={minHeight}
				max={200}
				step={1}
				hint={m.t_hinge_box_box_height_hint({ min: minShown })}
			/>
			<NumberField
				label={m.t_hinge_box_lid_height()}
				unit="mm"
				bind:value={p.lidHeight}
				min={3}
				max={80}
				step={1}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_hinge_box_group_walls_hinge()}>
			<NumberField
				label={tc.tc_walls_thickness()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={5}
				step={0.1}
			/>
			<NumberField
				label={tc.tc_corner_rounding()}
				unit="mm"
				bind:value={p.corner}
				min={0.5}
				max={20}
				step={0.5}
			/>
			<ChoiceField label={m.t_hinge_box_knuckles()} bind:value={p.knuckles} options={KNUCKLES} />
			<NumberField
				label={m.t_hinge_box_clearance()}
				unit="mm"
				bind:value={p.clearance}
				min={0.2}
				max={1}
				step={0.05}
				hint={m.t_hinge_box_clearance_hint()}
			/>
			<p class="text-xs text-neutral-400">{hingeSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
