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
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/stamp';
	import {
		STAMP_DEFAULTS,
		STAMP_PRESETS,
		stampHeader,
		stampModel,
		stampSummary,
		type StampFace,
		type StampParams,
		type StampShape
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<StampParams>({ ...STAMP_DEFAULTS });
	const model = $derived(stampModel(p));
	const source = $derived(toScad(model, stampHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const FACES: readonly { value: StampFace; label: string }[] = [
		{ value: 'text', label: tc.tc_inscription() },
		{ value: 'heart', label: m.t_stamp_face_heart() },
		{ value: 'star', label: m.t_stamp_face_star() }
	];
	const SHAPES: readonly { value: StampShape; label: string }[] = [
		{ value: 'rect', label: m.t_stamp_shape_rect() },
		{ value: 'round', label: m.t_stamp_shape_round() }
	];

	function applyPreset(params: Partial<StampParams>) {
		p = { ...STAMP_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_stamp_filename()}-${p.face}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each STAMP_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_stamp_group_face()}>
			<ChoiceField label={m.t_stamp_face()} bind:value={p.face} options={FACES} />
			{#if p.face === 'text'}
				<TextField
					label={tc.tc_inscription()}
					bind:value={p.text}
					maxlength={24}
					hint={m.t_stamp_text_hint()}
				/>
			{/if}
			<NumberField
				label={m.t_stamp_relief()}
				unit="mm"
				bind:value={p.relief}
				min={0.6}
				max={5}
				step={0.1}
				hint={m.t_stamp_relief_hint()}
			/>
			<ToggleField
				label={m.t_stamp_border()}
				bind:checked={p.border}
				hint={m.t_stamp_border_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_stamp_group_stamp()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			<NumberField
				label={p.shape === 'round' ? tc.tc_diameter() : tc.tc_length()}
				unit="mm"
				bind:value={p.width}
				min={10}
				max={150}
				step={1}
			/>
			{#if p.shape === 'rect'}
				<NumberField
					label={tc.tc_height()}
					unit="mm"
					bind:value={p.height}
					min={8}
					max={150}
					step={1}
				/>
			{/if}
			<NumberField
				label={m.t_stamp_base()}
				unit="mm"
				bind:value={p.base}
				min={2}
				max={10}
				step={0.5}
			/>
			<ToggleField label={m.t_stamp_knob()} bind:checked={p.knob} hint={m.t_stamp_knob_hint()} />
			{#if p.knob}
				<NumberField
					label={m.t_stamp_knob_height()}
					unit="mm"
					bind:value={p.knobHeight}
					min={10}
					max={80}
					step={1}
				/>
			{/if}
			<p class="text-xs text-neutral-400">{stampSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
