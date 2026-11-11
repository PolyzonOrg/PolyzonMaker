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
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/cable-clip';
	import {
		CABLE_CLIP_DEFAULTS,
		CABLE_CLIP_PRESETS,
		cableClipHeader,
		cableClipModel,
		cableClipSummary,
		type CableClipParams,
		type ClipKind
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<CableClipParams>({ ...CABLE_CLIP_DEFAULTS });
	const model = $derived(cableClipModel(p));
	const source = $derived(toScad(model, cableClipHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: readonly { value: ClipKind; label: string }[] = [
		{ value: 'saddle', label: m.t_cable_clip_choice_saddle() },
		{ value: 'tape', label: m.t_cable_clip_choice_tape() },
		{ value: 'comb', label: m.t_cable_clip_choice_comb() },
		{ value: 'desk', label: m.t_cable_clip_choice_desk() }
	];
	const many = $derived(p.kind === 'saddle' || p.kind === 'comb');
	const screws = $derived(p.kind === 'saddle' || p.kind === 'comb');

	function applyPreset(params: Partial<CableClipParams>) {
		p = { ...CABLE_CLIP_DEFAULTS, ...params };
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
					`${m.t_cable_clip_filename()}-${p.kind}-${p.cable}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each CABLE_CLIP_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup>
			<ChoiceField label={m.t_cable_clip_kind()} bind:value={p.kind} options={KINDS} />
		</FieldGroup>
		<FieldGroup title={m.t_cable_clip_group_cable()}>
			<NumberField
				label={m.t_cable_clip_cable()}
				unit="mm"
				bind:value={p.cable}
				min={2}
				max={40}
				step={0.5}
				hint={m.t_cable_clip_cable_hint()}
			/>
			{#if many}
				<NumberField label={m.t_cable_clip_count()} bind:value={p.count} min={1} max={12} />
				{#if p.count > 1}
					<NumberField
						label={m.t_cable_clip_gap()}
						unit="mm"
						bind:value={p.gap}
						min={0}
						max={20}
						step={0.5}
					/>
				{/if}
			{/if}
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.clearance}
				min={0}
				max={1.5}
				step={0.05}
				hint={m.t_cable_clip_clearance_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_cable_clip_group_clip()}>
			<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={4} max={60} step={1} />
			<NumberField
				label={tc.tc_wall_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.2}
				max={6}
				step={0.1}
				hint={m.t_cable_clip_thickness_hint()}
			/>
			{#if p.kind === 'desk'}
				<NumberField
					label={m.t_cable_clip_desk()}
					unit="mm"
					bind:value={p.desk}
					min={5}
					max={80}
					step={0.5}
				/>
			{/if}
			{#if screws}
				<NumberField
					label={m.t_cable_clip_screw()}
					unit="mm"
					bind:value={p.screw}
					min={2}
					max={6}
					step={0.1}
				/>
			{/if}
			<p class="text-xs text-neutral-400">{cableClipSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
