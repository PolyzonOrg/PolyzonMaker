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
	import {
		SOAP_DISH_DEFAULTS,
		SOAP_DISH_PRESETS,
		soapDishHeader,
		soapDishModel,
		soapDishSummary,
		type SoapDishParams,
		type SoapDishStyle
	} from './model';
	import * as m from '$msg/tools/soap-dish';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<SoapDishParams>({ ...SOAP_DISH_DEFAULTS });
	const model = $derived(soapDishModel(p));
	const source = $derived(toScad(model, soapDishHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const STYLES: readonly { value: SoapDishStyle; label: string }[] = [
		{ value: 'drain', label: m.t_soap_dish_style_drain() },
		{ value: 'tray', label: m.t_soap_dish_style_tray() }
	];

	function applyPreset(params: Partial<SoapDishParams>) {
		p = { ...SOAP_DISH_DEFAULTS, ...params };
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
				build.value && downloadBytes(build.value, `${m.t_soap_dish_filename()}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each SOAP_DISH_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_soap_dish_soap_dish()}>
			<ChoiceField label={m.t_soap_dish_style()} bind:value={p.style} options={STYLES} />
			<NumberField
				label={tc.tc_length()}
				unit="mm"
				bind:value={p.length}
				min={50}
				max={220}
				step={1}
			/>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={40}
				max={160}
				step={1}
			/>
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.height}
				min={10}
				max={50}
				step={1}
			/>
			<NumberField
				label={tc.tc_walls()}
				unit="mm"
				bind:value={p.wall}
				min={1.6}
				max={5}
				step={0.1}
			/>
			<NumberField
				label={m.t_soap_dish_pitch()}
				unit="mm"
				bind:value={p.pitch}
				min={6}
				max={20}
				step={0.5}
			/>
			<p class="text-xs text-neutral-400">{soapDishSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
