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
	import * as m from '$msg/tools/box-master';
	import * as tc from '$msg/tools/common';
	import {
		BOX_MASTER_DEFAULTS,
		BOX_MASTER_PRESETS,
		LID_OPTIONS,
		boxMasterHeader,
		boxMasterModel,
		type BoxMasterParams,
		type LabelStyle
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BoxMasterParams>({ ...BOX_MASTER_DEFAULTS });
	const model = $derived(boxMasterModel(p));
	const source = $derived(toScad(model, boxMasterHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const LABEL_STYLES: readonly { value: LabelStyle; label: string }[] = [
		{ value: 'engrave', label: m.t_box_master_label_engrave() },
		{ value: 'emboss', label: m.t_box_master_label_emboss() }
	];

	function applyPreset(params: Partial<BoxMasterParams>) {
		p = { ...BOX_MASTER_DEFAULTS, ...params };
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
				build.value && downloadBytes(build.value, `${m.t_box_master_filename()}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={m.t_box_master_group_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each BOX_MASTER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_box_master_group_inner()}>
			<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={10} max={300} />
			<NumberField label={tc.tc_depth()} unit="mm" bind:value={p.depth} min={10} max={300} />
			<NumberField label={tc.tc_height()} unit="mm" bind:value={p.height} min={5} max={200} />
		</FieldGroup>
		<FieldGroup title={m.t_box_master_group_walls()}>
			<NumberField
				label={tc.tc_wall()}
				unit="mm"
				bind:value={p.wall}
				min={0.8}
				max={6}
				step={0.1}
			/>
			<NumberField
				label={m.t_box_master_floor()}
				unit="mm"
				bind:value={p.floor}
				min={0.8}
				max={6}
				step={0.1}
			/>
			<NumberField
				label={tc.tc_corner_rounding()}
				unit="mm"
				bind:value={p.radius}
				min={0}
				max={30}
				step={0.5}
			/>
			<NumberField label={m.t_box_master_cols()} bind:value={p.cols} min={1} max={12} />
			<NumberField label={m.t_box_master_rows()} bind:value={p.rows} min={1} max={12} />
			<ToggleField
				label={m.t_box_master_scoop()}
				bind:checked={p.scoop}
				hint={m.t_box_master_scoop_hint()}
			/>
			{#if p.scoop}
				<NumberField
					label={m.t_box_master_scoop_radius()}
					unit="mm"
					bind:value={p.scoopRadius}
					min={2}
					max={30}
					step={0.5}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={tc.tc_lid()}>
			<ChoiceField
				label={m.t_box_master_lid_kind()}
				bind:value={p.lid}
				options={LID_OPTIONS}
				hint={p.lid === 'snap'
					? m.t_box_master_lid_snap_hint()
					: p.lid === 'cap'
						? m.t_box_master_lid_cap_hint()
						: p.lid === 'inset'
							? m.t_box_master_lid_inset_hint()
							: p.lid === 'slide'
								? m.t_box_master_lid_slide_hint()
								: undefined}
			/>
			{#if p.lid !== 'none'}
				<NumberField
					label={m.t_box_master_clearance()}
					unit="mm"
					bind:value={p.clearance}
					min={0}
					max={1}
					step={0.05}
					hint={m.t_box_master_clearance_hint()}
				/>
				{#if p.lid !== 'slide'}
					<NumberField
						label={p.lid === 'cap' ? m.t_box_master_skirt() : m.t_box_master_rim()}
						unit="mm"
						bind:value={p.rim}
						min={2}
						max={20}
						step={0.5}
					/>
				{/if}
			{/if}
		</FieldGroup>
		{#if p.lid !== 'none'}
			<FieldGroup title={m.t_box_master_group_label()}>
				<TextField
					label={tc.tc_text()}
					bind:value={p.label}
					maxlength={40}
					placeholder={m.t_box_master_label_placeholder()}
				/>
				{#if p.label.trim()}
					<ChoiceField
						label={m.t_box_master_label_style()}
						bind:value={p.labelStyle}
						options={LABEL_STYLES}
						hint={p.labelStyle === 'emboss'
							? p.lid === 'slide'
								? m.t_box_master_emboss_slide_hint()
								: m.t_box_master_emboss_hint()
							: m.t_box_master_engrave_hint()}
					/>
					<NumberField
						label={m.t_box_master_label_size()}
						unit="mm"
						bind:value={p.labelSize}
						min={3}
						max={40}
					/>
				{/if}
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>
