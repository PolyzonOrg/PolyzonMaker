<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/print-hinge';
	import {
		PRINT_HINGE_DEFAULTS,
		PRINT_HINGE_PRESETS,
		printHingeHeader,
		printHingeModel,
		printHingeSummary,
		type PrintHingeParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<PrintHingeParams>({ ...PRINT_HINGE_DEFAULTS });
	const model = $derived(printHingeModel(p));
	const source = $derived(toScad(model, printHingeHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<PrintHingeParams>) {
		p = { ...PRINT_HINGE_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_print_hinge_filename()}-${p.length}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each PRINT_HINGE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_print_hinge_group_hinge()}>
			<NumberField
				label={tc.tc_length()}
				unit="mm"
				bind:value={p.length}
				min={15}
				max={200}
				step={1}
			/>
			<NumberField
				label={m.t_print_hinge_leaf()}
				unit="mm"
				bind:value={p.leaf}
				min={8}
				max={80}
				step={1}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.6}
				max={8}
				step={0.1}
			/>
			<NumberField
				label={m.t_print_hinge_knuckles()}
				bind:value={p.knuckles}
				min={3}
				max={11}
				step={2}
				hint={m.t_print_hinge_knuckles_hint()}
			/>
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.clearance}
				min={0.15}
				max={0.8}
				step={0.05}
				hint={m.t_print_hinge_clearance_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_print_hinge_group_fasteners()}>
			<NumberField
				label={m.t_print_hinge_screw()}
				unit="mm"
				bind:value={p.screw}
				min={2}
				max={6}
				step={0.5}
			/>
			<NumberField label={m.t_print_hinge_holes()} bind:value={p.holes} min={1} max={5} />
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={8} />
			<p class="text-xs text-neutral-400">{printHingeSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
