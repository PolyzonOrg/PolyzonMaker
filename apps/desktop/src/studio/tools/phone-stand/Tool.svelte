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
	import * as m from '$msg/tools/phone-stand';
	import {
		PHONE_STAND_DEFAULTS,
		PHONE_STAND_PRESETS,
		phoneStandHeader,
		phoneStandModel,
		phoneStandSummary,
		type PhoneStandParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<PhoneStandParams>({ ...PHONE_STAND_DEFAULTS });
	const model = $derived(phoneStandModel(p));
	const source = $derived(toScad(model, phoneStandHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<PhoneStandParams>) {
		p = { ...PHONE_STAND_DEFAULTS, ...params };
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
				build.value && downloadBytes(build.value, `${m.t_phone_stand_filename()}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each PHONE_STAND_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_phone_stand_device()}>
			<NumberField
				label={m.t_phone_stand_device_thickness()}
				unit="mm"
				bind:value={p.device}
				min={5}
				max={30}
				step={0.5}
				hint={m.t_phone_stand_device_hint()}
			/>
			<NumberField
				label={m.t_phone_stand_angle()}
				unit="°"
				bind:value={p.angle}
				min={45}
				max={85}
				step={1}
			/>
			<NumberField
				label={m.t_phone_stand_back_height()}
				unit="mm"
				bind:value={p.height}
				min={40}
				max={200}
				step={1}
			/>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={30}
				max={200}
				step={1}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_stand()}>
			<NumberField
				label={m.t_phone_stand_lip()}
				unit="mm"
				bind:value={p.lip}
				min={4}
				max={30}
				step={1}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={2.4}
				max={8}
				step={0.1}
			/>
			<ToggleField
				label={m.t_phone_stand_cable()}
				bind:checked={p.cable}
				hint={m.t_phone_stand_cable_hint()}
			/>
			<p class="text-xs text-neutral-400">{phoneStandSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
