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
		NOZZLE_DEFAULTS,
		NOZZLE_PRESETS,
		nozzleHeader,
		nozzleModel,
		nozzleSummary,
		type NozzleKind,
		type NozzleParams
	} from './model';
	import * as m from '$msg/tools/vacuum-nozzle';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<NozzleParams>({ ...NOZZLE_DEFAULTS });
	const model = $derived(nozzleModel(p));
	const source = $derived(toScad(model, nozzleHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: { value: NozzleKind; label: string }[] = [
		{ value: 'crevice', label: m.t_vacuum_nozzle_kind_crevice() },
		{ value: 'wide', label: m.t_vacuum_nozzle_kind_wide() },
		{ value: 'round', label: m.t_vacuum_nozzle_kind_round() }
	];
	const TUBES = [
		{ value: 32, label: m.t_vacuum_nozzle_tube_option({ value: 32 }) },
		{ value: 35, label: m.t_vacuum_nozzle_tube_option({ value: 35 }) }
	];

	function applyPreset(params: Partial<NozzleParams>) {
		p = { ...NOZZLE_DEFAULTS, ...params };
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
					`${m.t_vacuum_nozzle_filename()}-${p.kind}-${p.tube}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each NOZZLE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_vacuum_nozzle_group_tube()}>
			<ChoiceField
				label={m.t_vacuum_nozzle_tube()}
				bind:value={p.tube}
				options={TUBES}
				hint={m.t_vacuum_nozzle_tube_hint()}
			/>
			<NumberField
				label={m.t_vacuum_nozzle_tube_custom()}
				unit="mm"
				bind:value={p.tube}
				min={15}
				max={60}
				step={0.1}
				hint={m.t_vacuum_nozzle_tube_custom_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_vacuum_nozzle_group_nozzle()}>
			<ChoiceField label={m.t_vacuum_nozzle_kind()} bind:value={p.kind} options={KINDS} />
			<NumberField
				label={p.kind === 'round'
					? m.t_vacuum_nozzle_tip_diameter()
					: m.t_vacuum_nozzle_tip_width()}
				unit="mm"
				bind:value={p.tipWidth}
				min={6}
				max={200}
			/>
			{#if p.kind !== 'round'}
				<NumberField
					label={m.t_vacuum_nozzle_slot_height()}
					unit="mm"
					bind:value={p.tipHeight}
					min={3}
					max={60}
					step={0.5}
				/>
			{/if}
			<NumberField
				label={m.t_vacuum_nozzle_transition()}
				unit="mm"
				bind:value={p.length}
				min={20}
				max={300}
				hint={m.t_vacuum_nozzle_transition_hint()}
			/>
			<NumberField
				label={m.t_vacuum_nozzle_tip_length()}
				unit="mm"
				bind:value={p.tipLength}
				min={0}
				max={200}
			/>
			{#if p.kind !== 'wide'}
				<NumberField
					label={m.t_vacuum_nozzle_slant()}
					unit="°"
					bind:value={p.slant}
					min={0}
					max={60}
					hint={m.t_vacuum_nozzle_slant_hint()}
				/>
			{/if}
			<NumberField
				label={tc.tc_wall()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={4}
				step={0.1}
			/>
			<p class="text-xs text-neutral-400">{nozzleSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
