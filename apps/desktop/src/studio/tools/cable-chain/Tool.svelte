<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/cable-chain';
	import {
		CABLE_CHAIN_DEFAULTS,
		CABLE_CHAIN_PRESETS,
		cableChainHeader,
		cableChainModel,
		cableChainSummary,
		type CableChainParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<CableChainParams>({ ...CABLE_CHAIN_DEFAULTS });
	const model = $derived(cableChainModel(p));
	const source = $derived(toScad(model, cableChainHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 450);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<CableChainParams>) {
		p = { ...CABLE_CHAIN_DEFAULTS, ...params };
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
					`${m.t_cable_chain_filename()}-${p.innerWidth}x${p.innerHeight}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each CABLE_CHAIN_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_cable_chain_inside()}>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.innerWidth}
				min={5}
				max={80}
				step={0.5}
				hint={m.t_cable_chain_width_hint()}
			/>
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.innerHeight}
				min={5}
				max={40}
				step={0.5}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_cable_chain_chain()}>
			<NumberField label={m.t_cable_chain_links()} bind:value={p.links} min={1} max={60} />
			<NumberField
				label={tc.tc_walls_thickness()}
				unit="mm"
				bind:value={p.plate}
				min={1.6}
				max={4}
				step={0.1}
			/>
			<ToggleField
				label={m.t_cable_chain_assembled()}
				bind:checked={p.assembled}
				hint={m.t_cable_chain_assembled_hint()}
			/>
			<NumberField
				label={m.t_cable_chain_pin_clearance()}
				unit="mm"
				bind:value={p.clearance}
				min={p.assembled ? 0.3 : 0.1}
				max={0.6}
				step={0.05}
			/>
			<p class="text-xs text-neutral-400">{cableChainSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
