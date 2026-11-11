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
	import * as m from '$msg/tools/mini-base';
	import {
		MINI_BASE_DEFAULTS,
		MINI_BASE_PRESETS,
		miniBaseHeader,
		miniBaseModel,
		miniBaseSummary,
		type BaseShape,
		type MiniBaseParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<MiniBaseParams>({ ...MINI_BASE_DEFAULTS });
	const model = $derived(miniBaseModel(p));
	const source = $derived(toScad(model, miniBaseHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: readonly { value: BaseShape; label: string }[] = [
		{ value: 'round', label: m.t_mini_base_shape_round() },
		{ value: 'oval', label: m.t_mini_base_shape_oval() },
		{ value: 'square', label: m.t_mini_base_shape_square() },
		{ value: 'hex', label: m.t_mini_base_shape_hex() }
	];

	function applyPreset(params: Partial<MiniBaseParams>) {
		p = { ...MINI_BASE_DEFAULTS, ...params };
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
					`${m.t_mini_base_filename()}-${p.shape}-${p.size}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each MINI_BASE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_mini_base_group_base()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			<NumberField
				label={p.shape === 'oval'
					? tc.tc_length()
					: p.shape === 'round'
						? tc.tc_diameter()
						: m.t_mini_base_side()}
				unit="mm"
				bind:value={p.size}
				min={10}
				max={200}
				step={1}
			/>
			{#if p.shape === 'oval'}
				<NumberField
					label={tc.tc_width()}
					unit="mm"
					bind:value={p.width}
					min={10}
					max={p.size}
					step={1}
				/>
			{/if}
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.height}
				min={1.5}
				max={15}
				step={0.5}
			/>
			<NumberField
				label={m.t_mini_base_bevel()}
				unit="mm"
				bind:value={p.bevel}
				min={0}
				max={Math.min(p.height, p.size / 6)}
				step={0.1}
				hint={m.t_mini_base_bevel_hint()}
			/>
			<ToggleField
				label={m.t_mini_base_hollow()}
				bind:checked={p.hollow}
				hint={m.t_mini_base_hollow_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_mini_base_group_magnet()}>
			<ToggleField label={m.t_mini_base_magnet()} bind:checked={p.magnet} />
			{#if p.magnet}
				<NumberField
					label={m.t_mini_base_magnet_d()}
					unit="mm"
					bind:value={p.magnetDiameter}
					min={2}
					max={Math.max(2, p.size * 0.6)}
					step={0.5}
				/>
				<NumberField
					label={m.t_mini_base_magnet_depth()}
					unit="mm"
					bind:value={p.magnetDepth}
					min={0.5}
					max={p.height - 0.8}
					step={0.1}
				/>
				<NumberField
					label={tc.tc_gap()}
					unit="mm"
					bind:value={p.clearance}
					min={0}
					max={0.8}
					step={0.05}
					hint={m.t_mini_base_clearance_hint()}
				/>
				{#if p.shape === 'oval'}
					<ToggleField label={m.t_mini_base_two_magnets()} bind:checked={p.twoMagnets} />
				{/if}
			{/if}
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<NumberField
				label={tc.tc_count()}
				bind:value={p.count}
				min={1}
				max={30}
				hint={m.t_mini_base_count_hint()}
			/>
			<p class="text-xs text-neutral-400">{miniBaseSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
