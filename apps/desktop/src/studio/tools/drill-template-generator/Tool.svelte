<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, FileImage, TriangleAlert } from 'lucide-svelte';
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
	import { num } from '$lib/i18n/current';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/drill-template-generator';
	import {
		DRILL_DEFAULTS,
		DRILL_KIND_DEFAULTS,
		DRILL_PRESETS,
		HANDLE_CENTERS,
		drillHeader,
		drillLayout,
		drillModel,
		drillSvg,
		type DrillKind,
		type DrillParams,
		type StopKind
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<DrillParams>({ ...DRILL_DEFAULTS });
	const model = $derived(drillModel(p));
	const source = $derived(toScad(model, drillHeader(p)));
	const layout = $derived(drillLayout(p));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	// Another layout starts from its own distances.
	let lastKind: DrillKind = DRILL_DEFAULTS.kind;
	$effect(() => {
		if (p.kind === lastKind) return;
		lastKind = p.kind;
		Object.assign(p, DRILL_KIND_DEFAULTS[p.kind]);
	});

	function applyPreset(params: Partial<DrillParams>) {
		if (params.kind) lastKind = params.kind;
		p = { ...DRILL_DEFAULTS, ...params };
	}

	const KINDS: readonly { value: DrillKind; label: string }[] = [
		{ value: 'handle', label: m.t_drill_template_generator_kind_handle() },
		{ value: 'shelf', label: m.t_drill_template_generator_kind_shelf() },
		{ value: 'hinge', label: m.t_drill_template_generator_kind_hinge() },
		{ value: 'grid', label: m.t_drill_template_generator_kind_grid() },
		{ value: 'custom', label: m.t_drill_template_generator_kind_custom() }
	];
	const STOPS: readonly { value: StopKind; label: string }[] = [
		{ value: 'edge', label: m.t_drill_template_generator_stop_edge() },
		{ value: 'corner', label: m.t_drill_template_generator_stop_corner() },
		{ value: 'none', label: m.t_drill_template_generator_stop_none() }
	];
	const CENTERS = HANDLE_CENTERS.map((v) => ({ value: v as number, label: String(v) }));

	const edgeLabel = $derived(
		p.kind === 'shelf'
			? m.t_drill_template_generator_edge_shelf()
			: p.kind === 'hinge'
				? m.t_drill_template_generator_edge_hinge()
				: m.t_drill_template_generator_edge()
	);
	const startLabel = $derived(
		p.kind === 'hinge'
			? m.t_drill_template_generator_start_hinge()
			: m.t_drill_template_generator_start()
	);
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
					`${m.t_drill_template_generator_filename()}-${p.kind}.stl`,
					'model/stl'
				)
		},
		{
			label: 'SVG 1:1',
			icon: FileImage,
			onClick: () =>
				downloadBytes(
					drillSvg(p),
					`${m.t_drill_template_generator_filename()}-${p.kind}.svg`,
					'image/svg+xml'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={m.t_drill_template_generator_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each DRILL_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup>
			<ChoiceField
				label={m.t_drill_template_generator_kind()}
				bind:value={p.kind}
				options={KINDS}
			/>
		</FieldGroup>

		<FieldGroup title={m.t_drill_template_generator_group_holes()}>
			{#if p.kind === 'handle'}
				<ChoiceField
					label={m.t_drill_template_generator_centers_choice()}
					bind:value={p.centers}
					options={CENTERS}
				/>
				<NumberField
					label={m.t_drill_template_generator_centers()}
					unit="mm"
					bind:value={p.centers}
					min={16}
					max={640}
					step={0.5}
					hint={m.t_drill_template_generator_centers_hint()}
				/>
			{:else if p.kind === 'shelf'}
				<NumberField
					label={m.t_drill_template_generator_count()}
					bind:value={p.count}
					min={1}
					max={30}
				/>
				<NumberField
					label={tc.tc_step()}
					unit="mm"
					bind:value={p.pitch}
					min={8}
					max={200}
					step={0.5}
					hint={m.t_drill_template_generator_pitch_hint()}
				/>
			{:else if p.kind === 'hinge'}
				<ToggleField
					label={m.t_drill_template_generator_hinge_screws()}
					bind:checked={p.hingeScrews}
					hint={m.t_drill_template_generator_hinge_screws_hint()}
				/>
				<p class="text-xs text-neutral-400">
					{m.t_drill_template_generator_hinge_cup()}
				</p>
			{:else if p.kind === 'grid'}
				<NumberField
					label={m.t_drill_template_generator_cols()}
					bind:value={p.cols}
					min={1}
					max={12}
				/>
				<NumberField label={tc.tc_rows()} bind:value={p.rows} min={1} max={12} />
				{#if p.cols > 1}
					<NumberField
						label={m.t_drill_template_generator_step_x()}
						unit="mm"
						bind:value={p.stepX}
						min={5}
						max={500}
						step={0.5}
					/>
				{/if}
				{#if p.rows > 1}
					<NumberField
						label={m.t_drill_template_generator_step_y()}
						unit="mm"
						bind:value={p.stepY}
						min={5}
						max={500}
						step={0.5}
					/>
				{/if}
			{:else}
				<TextField
					label={m.t_drill_template_generator_points()}
					bind:value={p.points}
					maxlength={400}
					placeholder="0, 20; 50, 20"
					hint={m.t_drill_template_generator_points_hint()}
				/>
			{/if}
			{#if p.kind !== 'hinge'}
				<NumberField
					label={m.t_drill_template_generator_hole()}
					unit="mm"
					bind:value={p.hole}
					min={1}
					max={40}
					step={0.1}
					hint={m.t_drill_template_generator_hole_hint()}
				/>
			{/if}
		</FieldGroup>

		{#if p.kind !== 'custom'}
			<FieldGroup title={m.t_drill_template_generator_group_position()}>
				<NumberField label={edgeLabel} unit="mm" bind:value={p.edge} min={0} max={300} step={0.5} />
				{#if p.stop === 'corner'}
					<NumberField
						label={startLabel}
						unit="mm"
						bind:value={p.start}
						min={0}
						max={1000}
						step={0.5}
					/>
				{/if}
			</FieldGroup>
		{/if}

		<FieldGroup title={m.t_drill_template_generator_group_jig()}>
			<ChoiceField
				label={m.t_drill_template_generator_stop()}
				bind:value={p.stop}
				options={STOPS}
				hint={p.stop === 'none'
					? m.t_drill_template_generator_stop_none_hint()
					: p.stop === 'corner'
						? m.t_drill_template_generator_stop_corner_hint()
						: m.t_drill_template_generator_stop_edge_hint()}
			/>
			{#if p.stop !== 'none'}
				<NumberField
					label={m.t_drill_template_generator_stop_depth()}
					unit="mm"
					bind:value={p.stopDepth}
					min={3}
					max={30}
					step={0.5}
				/>
			{/if}
			<NumberField
				label={m.t_drill_template_generator_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={3}
				max={30}
				step={0.5}
				hint={m.t_drill_template_generator_thickness_hint()}
			/>
			<ToggleField
				label={m.t_drill_template_generator_lighten()}
				bind:checked={p.lighten}
				hint={m.t_drill_template_generator_lighten_hint()}
			/>
			<ToggleField
				label={m.t_drill_template_generator_marks()}
				bind:checked={p.marks}
				hint={m.t_drill_template_generator_marks_hint()}
			/>
			<ToggleField label={m.t_drill_template_generator_labels()} bind:checked={p.labels} />
			<p class="text-xs text-neutral-400">
				{m.t_drill_template_generator_summary({
					count: layout.holes.length,
					n: num(layout.holes.length),
					width: num(layout.plate[2] - layout.plate[0], 1),
					height: num(layout.plate[3] - layout.plate[1], 1)
				})}
			</p>
			{#if layout.crowded}
				<div class="notice notice-warning">
					<TriangleAlert size={16} aria-hidden="true" />
					<span>{m.t_drill_template_generator_crowded()}</span>
				</div>
			{/if}
		</FieldGroup>
	{/snippet}
</ToolShell>
