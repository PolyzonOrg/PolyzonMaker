<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { downloadBytes } from '$lib/tools/stl';
	import { createWorkerRunner, type WorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import type { ToolInfo } from '$lib/tools/registry';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/vase-generator';
	import {
		VASE_DEFAULTS,
		VASE_PRESETS,
		vaseFileName,
		type VaseParams,
		type VaseRibSide,
		type VaseRibs,
		type VaseSection
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<VaseParams>(structuredClone(VASE_DEFAULTS));

	let runner: WorkerRunner<VaseParams, Uint8Array> | null = null;
	const build = createBuild<VaseParams, Uint8Array>((params, signal) => {
		runner ??= createWorkerRunner(
			() =>
				new Worker(new URL('./vase.worker.ts', import.meta.url), {
					type: 'module',
					name: workerName('vase')
				})
		);
		return runner.run(params, signal);
	}, 350);
	$effect(() => build.run($state.snapshot(p)));
	onDestroy(() => {
		build.cancel();
		runner?.dispose();
	});

	function applyPreset(params: Partial<VaseParams>) {
		p = { ...structuredClone(VASE_DEFAULTS), ...structuredClone(params) };
	}

	const SECTIONS: { value: VaseSection; label: string }[] = [
		{ value: 'circle', label: m.t_vase_generator_section_circle() },
		{ value: 'polygon', label: m.t_vase_generator_section_polygon() },
		{ value: 'star', label: m.t_vase_generator_section_star() },
		{ value: 'flower', label: m.t_vase_generator_section_flower() },
		{ value: 'heart', label: m.t_vase_generator_section_heart() }
	];
	const RIBS: { value: VaseRibs; label: string }[] = [
		{ value: 'none', label: m.t_vase_generator_ribs_none() },
		{ value: 'wave', label: m.t_vase_generator_ribs_wave() },
		{ value: 'triangle', label: m.t_vase_generator_ribs_triangle() },
		{ value: 'square', label: m.t_vase_generator_ribs_square() },
		{ value: 'gear', label: m.t_vase_generator_ribs_gear() }
	];
	const RIB_SIDES: { value: VaseRibSide; label: string }[] = [
		{ value: 'outside', label: m.t_vase_generator_rib_side_outside() },
		{ value: 'inside', label: m.t_vase_generator_rib_side_inside() },
		{ value: 'both', label: m.t_vase_generator_rib_side_both() }
	];
	// The profile is edited top to bottom, the way the vase stands.
	const LEVELS = [
		{ i: 4, label: m.t_vase_generator_level_neck() },
		{ i: 3, label: m.t_vase_generator_level_shoulders() },
		{ i: 2, label: m.t_vase_generator_level_middle() },
		{ i: 1, label: m.t_vase_generator_level_lower() },
		{ i: 0, label: m.t_vase_generator_level_base() }
	];
</script>

<ToolShell
	{tool}
	stl={build.value}
	busy={build.busy}
	error={build.error}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () => build.value && downloadBytes(build.value, vaseFileName(p), 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each VASE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_size()}>
			<NumberField label={tc.tc_height()} unit="mm" bind:value={p.height} min={20} max={350} />
		</FieldGroup>
		<FieldGroup title={m.t_vase_generator_group_profile()}>
			{#each LEVELS as level (level.i)}
				<NumberField
					label={level.label}
					unit={m.t_vase_generator_unit_diameter()}
					bind:value={p.profile[level.i]}
					min={10}
					max={300}
				/>
			{/each}
			<ToggleField
				label={m.t_vase_generator_smooth()}
				bind:checked={p.smooth}
				hint={m.t_vase_generator_smooth_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_vase_generator_group_section()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.section} options={SECTIONS} />
			{#if p.section === 'circle'}
				<NumberField
					label={m.t_vase_generator_ellipse()}
					bind:value={p.ellipse}
					min={0.3}
					max={1}
					step={0.05}
					hint={m.t_vase_generator_ellipse_hint()}
				/>
			{:else if p.section === 'polygon'}
				<NumberField
					label={m.t_vase_generator_polygon_count()}
					bind:value={p.count}
					min={3}
					max={16}
				/>
			{:else if p.section === 'star'}
				<NumberField
					label={m.t_vase_generator_star_count()}
					bind:value={p.count}
					min={3}
					max={16}
				/>
				<NumberField
					label={m.t_vase_generator_star_depth()}
					unit="%"
					bind:value={p.depth}
					min={10}
					max={80}
				/>
			{:else if p.section === 'flower'}
				<NumberField
					label={m.t_vase_generator_flower_count()}
					bind:value={p.count}
					min={3}
					max={16}
				/>
				<NumberField
					label={m.t_vase_generator_flower_depth()}
					unit="%"
					bind:value={p.depth}
					min={10}
					max={80}
				/>
			{/if}
			<NumberField
				label={tc.tc_corner_rounding()}
				unit="%"
				bind:value={p.rounding}
				min={0}
				max={100}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_vase_generator_group_ribs()}>
			<ChoiceField label={tc.tc_pattern()} bind:value={p.ribs} options={RIBS} />
			{#if p.ribs !== 'none'}
				<NumberField
					label={m.t_vase_generator_rib_count()}
					bind:value={p.ribCount}
					min={4}
					max={72}
				/>
				<NumberField
					label={m.t_vase_generator_rib_depth()}
					unit="mm"
					bind:value={p.ribDepth}
					min={-5}
					max={15}
					step={0.5}
					hint={m.t_vase_generator_rib_depth_hint()}
				/>
				{#if !p.vaseMode}
					<ChoiceField
						label={m.t_vase_generator_rib_side()}
						bind:value={p.ribSide}
						options={RIB_SIDES}
					/>
				{/if}
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_vase_generator_group_twist()}>
			<NumberField
				label={m.t_vase_generator_twist()}
				unit="°"
				bind:value={p.twist}
				min={-360}
				max={360}
				step={5}
				hint={m.t_vase_generator_twist_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<ToggleField
				label={m.t_vase_generator_vase_mode()}
				bind:checked={p.vaseMode}
				hint={m.t_vase_generator_vase_mode_hint()}
			/>
			{#if !p.vaseMode}
				<NumberField
					label={tc.tc_wall()}
					unit="mm"
					bind:value={p.wall}
					min={0.8}
					max={10}
					step={0.1}
					hint={m.t_vase_generator_wall_hint()}
				/>
				<ToggleField
					label={m.t_vase_generator_bottom()}
					bind:checked={p.bottom}
					hint={m.t_vase_generator_bottom_hint()}
				/>
				{#if p.bottom}
					<NumberField
						label={m.t_vase_generator_bottom_thickness()}
						unit="mm"
						bind:value={p.bottomThickness}
						min={0.8}
						max={20}
						step={0.1}
					/>
				{/if}
				<ToggleField label={m.t_vase_generator_round_rim()} bind:checked={p.roundRim} />
			{/if}
		</FieldGroup>
	{/snippet}
</ToolShell>
