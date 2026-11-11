<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as m from '$msg/tools/filament-swatch';
	import * as tc from '$msg/tools/common';
	import {
		FILAMENT_SWATCH_DEFAULTS,
		FILAMENT_SWATCH_PRESETS,
		filamentSwatchHeader,
		filamentSwatchModel,
		filamentSwatchSummary,
		type FilamentSwatchParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<FilamentSwatchParams>({ ...FILAMENT_SWATCH_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(filamentSwatchModel(drawn));
	const source = $derived(toScad(model, filamentSwatchHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<FilamentSwatchParams>) {
		// A shape preset keeps what the card says about the plastic; a material preset sets it.
		p = {
			...FILAMENT_SWATCH_DEFAULTS,
			maker: p.maker,
			colour: p.colour,
			material: p.material,
			temps: p.temps,
			...params
		};
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
					`${m.t_filament_swatch_filename()}-${p.material || m.t_filament_swatch_plastic_filename()}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each FILAMENT_SWATCH_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_filament_swatch_group_label()}>
			<TextField label={tc.tc_plastic()} bind:value={p.material} maxlength={16} />
			<TextField label={m.t_filament_swatch_maker()} bind:value={p.maker} maxlength={24} />
			<TextField label={m.t_filament_swatch_colour()} bind:value={p.colour} maxlength={24} />
			<TextField
				label={m.t_filament_swatch_temps()}
				bind:value={p.temps}
				maxlength={24}
				hint={m.t_filament_swatch_temps_hint()}
			/>
			<FontField bind:value={p.font} />
		</FieldGroup>
		<FieldGroup title={m.t_filament_swatch_group_card()}>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={40}
				max={100}
				step={1}
			/>
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.height}
				min={25}
				max={60}
				step={1}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.2}
				max={4}
				step={0.1}
			/>
			<NumberField label={m.t_filament_swatch_steps()} bind:value={p.steps} min={2} max={10} />
			<NumberField
				label={m.t_filament_swatch_step()}
				unit="mm"
				bind:value={p.step}
				min={0.1}
				max={Math.max(0.1, Math.floor((p.thickness / p.steps) * 100) / 100)}
				step={0.05}
				hint={m.t_filament_swatch_step_hint()}
			/>
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={12} />
			<p class="text-xs text-neutral-400">{filamentSwatchSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
