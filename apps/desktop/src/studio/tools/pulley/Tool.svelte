<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { currentLocale, num } from '$lib/i18n/current';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { listJoin } from '$lib/i18n/locale';
	import * as m from '$msg/tools/pulley';
	import * as tc from '$msg/tools/common';
	import {
		BELTS,
		PULLEY_DEFAULTS,
		PULLEY_PRESETS,
		pulleyHeader,
		pulleyModel,
		pulleySummary,
		type BeltProfile,
		type PulleyParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<PulleyParams>({ ...PULLEY_DEFAULTS });
	const model = $derived(pulleyModel(p));
	const source = $derived(toScad(model, pulleyHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const PROFILES = (Object.keys(BELTS) as BeltProfile[]).map((value) => ({
		value,
		label: BELTS[value].label
	}));
	const belts = $derived(
		listJoin(
			BELTS[p.profile].belts.map((w) => num(w)),
			currentLocale()
		)
	);

	function applyPreset(params: Partial<PulleyParams>) {
		p = { ...PULLEY_DEFAULTS, ...params };
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
					`${m.t_pulley_filename()}-${p.profile}-${p.teeth}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each PULLEY_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_pulley_group_belt()}>
			<ChoiceField
				label={m.t_pulley_belt()}
				bind:value={p.profile}
				options={PROFILES}
				hint={m.t_pulley_belt_hint()}
			/>
			<NumberField label={m.t_pulley_teeth()} bind:value={p.teeth} min={10} max={150} />
			<NumberField
				label={m.t_pulley_belt_width()}
				unit="mm"
				bind:value={p.beltWidth}
				min={3}
				max={50}
				step={0.5}
				hint={m.t_pulley_belt_width_hint({ belts })}
			/>
			<NumberField
				label={m.t_pulley_play()}
				unit="mm"
				bind:value={p.play}
				min={0}
				max={0.3}
				step={0.01}
				hint={m.t_pulley_play_hint()}
			/>
			<ToggleField
				label={m.t_pulley_flanges()}
				bind:checked={p.flanges}
				hint={m.t_pulley_flanges_hint()}
			/>
			<p class="text-xs text-neutral-400">{pulleySummary(p)}</p>
		</FieldGroup>
		<FieldGroup title={m.t_pulley_group_shaft()}>
			<NumberField
				label={m.t_pulley_bore()}
				unit="mm"
				bind:value={p.bore}
				min={1}
				max={40}
				step={0.1}
			/>
			<ToggleField
				label={m.t_pulley_d_flat()}
				bind:checked={p.dFlat}
				hint={m.t_pulley_d_flat_hint()}
			/>
			<ToggleField label={m.t_pulley_hub()} bind:checked={p.hub} />
			{#if p.hub}
				<NumberField
					label={m.t_pulley_hub_diameter()}
					unit="mm"
					bind:value={p.hubDiameter}
					min={8}
					max={80}
					step={0.5}
				/>
				<NumberField
					label={m.t_pulley_hub_height()}
					unit="mm"
					bind:value={p.hubHeight}
					min={3}
					max={30}
					step={0.5}
				/>
				<ToggleField
					label={m.t_pulley_set_screw()}
					bind:checked={p.setScrew}
					hint={m.t_pulley_set_screw_hint()}
				/>
			{/if}
		</FieldGroup>
	{/snippet}
</ToolShell>
