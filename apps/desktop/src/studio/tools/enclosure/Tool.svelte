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
	import * as m from '$msg/tools/enclosure';
	import {
		ENCLOSURE_DEFAULTS,
		ENCLOSURE_PRESETS,
		enclosureHeader,
		enclosureModel,
		enclosureSummary,
		type BoardId,
		type EnclosureParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<EnclosureParams>({ ...ENCLOSURE_DEFAULTS });
	const model = $derived(enclosureModel(p));
	const source = $derived(toScad(model, enclosureHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const BOARD_CHOICES: readonly { value: BoardId; label: string }[] = [
		{ value: 'rpi5', label: 'Raspberry Pi 5' },
		{ value: 'rpi4', label: 'Raspberry Pi 4' },
		{ value: 'rpizero', label: 'Raspberry Pi Zero' },
		{ value: 'uno', label: 'Arduino Uno' },
		{ value: 'custom', label: m.t_enclosure_custom_board() }
	];

	function applyPreset(params: Partial<EnclosureParams>) {
		p = { ...ENCLOSURE_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_enclosure_filename()}-${p.board}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each ENCLOSURE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_enclosure_board_group()}>
			<ChoiceField
				label={m.t_enclosure_board()}
				bind:value={p.board}
				options={BOARD_CHOICES}
				hint={p.board === 'custom' ? m.t_enclosure_board_custom_hint() : m.t_enclosure_board_hint()}
			/>
			{#if p.board === 'custom'}
				<NumberField
					label={m.t_enclosure_board_length()}
					unit="mm"
					bind:value={p.width}
					min={15}
					max={300}
					step={0.5}
				/>
				<NumberField
					label={m.t_enclosure_board_width()}
					unit="mm"
					bind:value={p.depth}
					min={15}
					max={300}
					step={0.5}
				/>
				<NumberField
					label={m.t_enclosure_hole_inset()}
					unit="mm"
					bind:value={p.inset}
					min={1.5}
					max={Math.min(p.width, p.depth) / 3}
					step={0.1}
					hint={m.t_enclosure_hole_inset_hint()}
				/>
				<NumberField
					label={m.t_enclosure_hole_diameter()}
					unit="mm"
					bind:value={p.hole}
					min={1.5}
					max={5}
					step={0.1}
				/>
				<NumberField
					label={m.t_enclosure_parts()}
					unit="mm"
					bind:value={p.parts}
					min={1}
					max={120}
					step={0.5}
					hint={m.t_enclosure_parts_hint()}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_enclosure_case_group()}>
			<NumberField
				label={m.t_enclosure_standoff()}
				unit="mm"
				bind:value={p.standoff}
				min={2}
				max={30}
				step={0.5}
			/>
			<NumberField
				label={m.t_enclosure_margin()}
				unit="mm"
				bind:value={p.margin}
				min={0.5}
				max={15}
				step={0.5}
			/>
			<NumberField
				label={m.t_enclosure_headroom()}
				unit="mm"
				bind:value={p.headroom}
				min={0}
				max={40}
				step={0.5}
			/>
			<NumberField
				label={tc.tc_walls_thickness()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={5}
				step={0.1}
			/>
			<ToggleField label={m.t_enclosure_vents()} bind:checked={p.vents} />
			<ToggleField
				label={m.t_enclosure_ears()}
				bind:checked={p.ears}
				hint={m.t_enclosure_ears_hint()}
			/>
			<NumberField
				label={m.t_enclosure_lid_clearance()}
				unit="mm"
				bind:value={p.clearance}
				min={0}
				max={1}
				step={0.05}
				hint={m.t_enclosure_lid_clearance_hint()}
			/>
			<p class="text-xs text-neutral-400">{enclosureSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
