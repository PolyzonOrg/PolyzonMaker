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
	import {
		RACK_PANEL_DEFAULTS,
		RACK_PANEL_PRESETS,
		rackPanelHeader,
		rackPanelModel,
		rackPanelSummary,
		type RackFill,
		type RackPanelParams
	} from './model';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/rack-panel';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<RackPanelParams>({ ...RACK_PANEL_DEFAULTS });
	const model = $derived(rackPanelModel(p));
	const source = $derived(toScad(model, rackPanelHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const FILLS: { value: RackFill; label: string }[] = [
		{ value: 'keystone', label: m.t_rack_panel_fill_keystone() },
		{ value: 'vent', label: m.t_rack_panel_fill_vent() },
		{ value: 'blank', label: m.t_rack_panel_fill_blank() }
	];

	function applyPreset(params: Partial<RackPanelParams>) {
		p = { ...RACK_PANEL_DEFAULTS, ...params };
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
					`${m.t_rack_panel_filename()}-${p.units}u-${p.fill}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each RACK_PANEL_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_rack_panel_group_panel()}>
			<NumberField
				label={tc.tc_height()}
				unit="U"
				bind:value={p.units}
				min={1}
				max={4}
				hint={p.units === 1 ? m.t_rack_panel_units_hint_one() : m.t_rack_panel_units_hint_more()}
			/>
			<ChoiceField label={m.t_rack_panel_fill()} bind:value={p.fill} options={FILLS} />
			{#if p.fill === 'keystone'}
				<NumberField
					label={m.t_rack_panel_ports()}
					bind:value={p.ports}
					min={1}
					max={10}
					hint={m.t_rack_panel_ports_hint()}
				/>
				{#if p.units > 1}
					<NumberField label={tc.tc_rows()} bind:value={p.portRows} min={1} max={p.units} />
				{/if}
			{/if}
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={2.4}
				max={6}
				step={0.1}
			/>
			<ToggleField
				label={m.t_rack_panel_ribs()}
				bind:checked={p.ribs}
				hint={m.t_rack_panel_ribs_hint()}
			/>
			<p class="text-xs text-neutral-400">{rackPanelSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
