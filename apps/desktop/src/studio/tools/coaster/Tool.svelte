<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as m from '$msg/tools/coaster';
	import * as tc from '$msg/tools/common';
	import {
		COASTER_DEFAULTS,
		COASTER_PRESETS,
		coasterHeader,
		coasterModel,
		coasterSummary,
		type CoasterBottom,
		type CoasterParams,
		type CoasterShape,
		type CoasterTop
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<CoasterParams>({ ...COASTER_DEFAULTS });
	const model = $derived(coasterModel(p));
	const source = $derived(toScad(model, coasterHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: readonly { value: CoasterShape; label: string }[] = [
		{ value: 'round', label: m.t_coaster_shape_round() },
		{ value: 'square', label: m.t_coaster_shape_square() },
		{ value: 'hex', label: m.t_coaster_shape_hex() }
	];
	const TOPS: readonly { value: CoasterTop; label: string }[] = [
		{ value: 'rings', label: m.t_coaster_top_rings() },
		{ value: 'honeycomb', label: m.t_coaster_top_honeycomb() },
		{ value: 'text', label: m.t_coaster_top_text() },
		{ value: 'plain', label: m.t_coaster_top_plain() }
	];
	const BOTTOMS: readonly { value: CoasterBottom; label: string }[] = [
		{ value: 'feet', label: m.t_coaster_bottom_feet() },
		{ value: 'cork', label: m.t_coaster_bottom_cork() },
		{ value: 'none', label: m.t_coaster_bottom_none() }
	];

	function applyPreset(params: Partial<CoasterParams>) {
		p = { ...COASTER_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_coaster_filename()}-${p.shape}-${p.top}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each COASTER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_coaster_group_coaster()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			<NumberField
				label={p.shape === 'round' ? tc.tc_diameter() : m.t_coaster_side()}
				unit="mm"
				bind:value={p.size}
				min={50}
				max={200}
				step={1}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={2.4}
				max={10}
				step={0.2}
			/>
			<ToggleField label={m.t_coaster_rim()} bind:checked={p.rim} hint={m.t_coaster_rim_hint()} />
		</FieldGroup>
		<FieldGroup title={m.t_coaster_group_top()}>
			<ChoiceField label={tc.tc_pattern()} bind:value={p.top} options={TOPS} />
			{#if p.top === 'text'}
				<TextField
					label={m.t_coaster_letters()}
					bind:value={p.text}
					maxlength={3}
					hint={m.t_coaster_letters_hint()}
				/>
			{/if}
			{#if p.top !== 'plain'}
				<NumberField
					label={m.t_coaster_relief()}
					unit="mm"
					bind:value={p.relief}
					min={0.4}
					max={3}
					step={0.2}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_coaster_group_bottom()}>
			<ChoiceField label={m.t_coaster_bottom()} bind:value={p.bottom} options={BOTTOMS} />
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={8} />
			<p class="text-xs text-neutral-400">{coasterSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
