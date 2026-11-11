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
	import * as m from '$msg/tools/knob-generator';
	import * as tc from '$msg/tools/common';
	import {
		KNOB_DEFAULTS,
		KNOB_PRESETS,
		KNOB_SIZES,
		clampKnob,
		knobMinDiameter,
		knobHeader,
		knobModel,
		knobSummary,
		type KnobInsert,
		type KnobParams,
		type KnobShape
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<KnobParams>({ ...KNOB_DEFAULTS });
	const model = $derived(knobModel(p));
	const source = $derived(toScad(model, knobHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: readonly { value: KnobShape; label: string }[] = [
		{ value: 'star', label: m.t_knob_generator_shape_star() },
		{ value: 'wing', label: m.t_knob_generator_shape_wing() },
		{ value: 'knurled', label: m.t_knob_generator_shape_knurled() },
		{ value: 'round', label: m.t_knob_generator_shape_round() }
	];
	const INSERTS: readonly { value: KnobInsert; label: string }[] = [
		{ value: 'nut', label: m.t_knob_generator_insert_nut() },
		{ value: 'head', label: m.t_knob_generator_insert_head() },
		{ value: 'thread', label: m.t_knob_generator_insert_thread() },
		{ value: 'dshaft', label: m.t_knob_generator_insert_dshaft() },
		{ value: 'none', label: m.t_knob_generator_insert_none() }
	];
	const SIZES = KNOB_SIZES.map((s) => ({ value: s, label: s }));
	const metric = $derived(p.insert === 'nut' || p.insert === 'head' || p.insert === 'thread');

	function applyPreset(params: Partial<KnobParams>) {
		p = { ...KNOB_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_knob_generator_filename()}-${p.shape}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each KNOB_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_knob_generator_group_knob()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			<NumberField
				label={p.shape === 'wing' ? m.t_knob_generator_span() : tc.tc_diameter()}
				unit="mm"
				bind:value={p.diameter}
				min={knobMinDiameter(clampKnob(p))}
				max={120}
				step={1}
			/>
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.height}
				min={6}
				max={60}
				step={0.5}
			/>
			{#if p.shape === 'star'}
				<NumberField label={m.t_knob_generator_lobes()} bind:value={p.lobes} min={3} max={10} />
			{/if}
			{#if p.shape !== 'wing'}
				<ToggleField
					label={m.t_knob_generator_pointer()}
					bind:checked={p.pointer}
					hint={m.t_knob_generator_pointer_hint()}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={tc.tc_mount()}>
			<ChoiceField label={m.t_knob_generator_insert()} bind:value={p.insert} options={INSERTS} />
			{#if metric}
				<ChoiceField label={tc.tc_size()} bind:value={p.size} options={SIZES} />
			{/if}
			{#if p.insert === 'dshaft'}
				<NumberField
					label={m.t_knob_generator_shaft()}
					unit="mm"
					bind:value={p.shaft}
					min={2}
					max={12}
					step={0.1}
				/>
				<NumberField
					label={m.t_knob_generator_flat()}
					unit="mm"
					bind:value={p.flat}
					min={p.shaft / 2}
					max={p.shaft}
					step={0.1}
					hint={m.t_knob_generator_flat_hint()}
				/>
			{/if}
			{#if p.insert !== 'none'}
				<NumberField
					label={tc.tc_gap()}
					unit="mm"
					bind:value={p.clearance}
					min={0}
					max={1}
					step={0.05}
					hint={p.insert === 'thread'
						? m.t_knob_generator_clearance_thread_hint()
						: m.t_knob_generator_clearance_hint()}
				/>
			{/if}
			<p class="text-xs text-neutral-400">{knobSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
