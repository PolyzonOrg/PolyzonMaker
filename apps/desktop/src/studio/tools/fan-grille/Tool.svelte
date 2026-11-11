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
	import { num } from '$lib/i18n/current';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/fan-grille';
	import {
		FAN_GRILLE_DEFAULTS,
		FAN_GRILLE_PRESETS,
		FAN_SIZES,
		fanGrilleHeader,
		fanGrilleModel,
		fanGrilleSummary,
		type FanGrilleParams,
		type GrillePattern
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<FanGrilleParams>({ ...FAN_GRILLE_DEFAULTS });
	const model = $derived(fanGrilleModel(p));
	const source = $derived(toScad(model, fanGrilleHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SIZES = FAN_SIZES.map((s) => ({
		value: s,
		label: m.t_fan_grille_size_option({ size: num(s) })
	}));
	const PATTERNS: readonly { value: GrillePattern; label: string }[] = [
		{ value: 'hex', label: m.t_fan_grille_pattern_hex() },
		{ value: 'rings', label: m.t_fan_grille_pattern_rings() },
		{ value: 'slots', label: m.t_fan_grille_pattern_slots() },
		{ value: 'grid', label: m.t_fan_grille_pattern_grid() }
	];

	function applyPreset(params: Partial<FanGrilleParams>) {
		p = { ...FAN_GRILLE_DEFAULTS, ...params };
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
					`${m.t_fan_grille_filename()}-${p.fan}-${p.pattern}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each FAN_GRILLE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_fan_grille_fan()}>
			<ChoiceField
				label={tc.tc_size()}
				bind:value={p.fan}
				options={SIZES}
				hint={m.t_fan_grille_size_hint()}
			/>
			<ToggleField
				label={m.t_fan_grille_countersink()}
				bind:checked={p.countersink}
				hint={m.t_fan_grille_countersink_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_pattern()}>
			<ChoiceField label={m.t_fan_grille_pattern()} bind:value={p.pattern} options={PATTERNS} />
			<NumberField
				label={tc.tc_step()}
				unit="mm"
				bind:value={p.pitch}
				min={p.bar + 1.5}
				max={30}
				step={0.5}
				hint={m.t_fan_grille_pitch_hint()}
			/>
			<NumberField
				label={m.t_fan_grille_bar_thickness()}
				unit="mm"
				bind:value={p.bar}
				min={0.8}
				max={6}
				step={0.1}
				hint={m.t_fan_grille_bar_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_fan_grille_plate()}>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1}
				max={6}
				step={0.2}
			/>
			<NumberField
				label={tc.tc_corner_rounding()}
				unit="mm"
				bind:value={p.corner}
				min={0}
				max={20}
				step={0.5}
			/>
			<p class="text-xs text-neutral-400">{fanGrilleSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
