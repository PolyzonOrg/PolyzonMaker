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
	import * as m from '$msg/tools/tube-cap';
	import {
		TUBE_CAP_DEFAULTS,
		TUBE_CAP_PRESETS,
		tubeCapHeader,
		tubeCapModel,
		tubeCapSummary,
		type TubeCapParams,
		type TubeProfile
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<TubeCapParams>({ ...TUBE_CAP_DEFAULTS });
	const model = $derived(tubeCapModel(p));
	const source = $derived(toScad(model, tubeCapHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const PROFILES: readonly { value: TubeProfile; label: string }[] = [
		{ value: 'square', label: m.t_tube_cap_profile_square() },
		{ value: 'rect', label: m.t_tube_cap_profile_rect() },
		{ value: 'round', label: m.t_tube_cap_profile_round() }
	];

	function applyPreset(params: Partial<TubeCapParams>) {
		p = { ...TUBE_CAP_DEFAULTS, count: p.count, ...params };
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
					`${m.t_tube_cap_filename()}-${p.width}x${p.height}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each TUBE_CAP_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_tube_cap_tube()}>
			<ChoiceField label={m.t_tube_cap_profile()} bind:value={p.profile} options={PROFILES} />
			<NumberField
				label={p.profile === 'round' ? m.t_tube_cap_outer_diameter() : m.t_tube_cap_outer_width()}
				unit="mm"
				bind:value={p.width}
				min={8}
				max={120}
				step={0.5}
			/>
			{#if p.profile === 'rect'}
				<NumberField
					label={m.t_tube_cap_outer_height()}
					unit="mm"
					bind:value={p.height}
					min={8}
					max={120}
					step={0.5}
				/>
			{/if}
			<NumberField
				label={m.t_tube_cap_tube_wall()}
				unit="mm"
				bind:value={p.wall}
				min={0.8}
				max={10}
				step={0.1}
				hint={m.t_tube_cap_tube_wall_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_tube_cap_cap()}>
			<NumberField
				label={m.t_tube_cap_plug_depth()}
				unit="mm"
				bind:value={p.depth}
				min={4}
				max={40}
				step={1}
			/>
			<NumberField
				label={m.t_tube_cap_cap_thickness()}
				unit="mm"
				bind:value={p.cap}
				min={1.6}
				max={15}
				step={0.1}
				hint={m.t_tube_cap_cap_thickness_hint()}
			/>
			<ToggleField
				label={m.t_tube_cap_felt()}
				bind:checked={p.felt}
				hint={m.t_tube_cap_felt_hint()}
			/>
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.clearance}
				min={0}
				max={1}
				step={0.05}
			/>
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={16} />
			<p class="text-xs text-neutral-400">{tubeCapSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
