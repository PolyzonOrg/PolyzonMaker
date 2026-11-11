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
	import * as m from '$msg/tools/bolt-gauge';
	import {
		BOLT_GAUGE_DEFAULTS,
		BOLT_GAUGE_PRESETS,
		GAUGE_SIZES,
		RULER_LENGTHS,
		boltGaugeHeader,
		boltGaugeModel,
		boltGaugeSummary,
		type BoltGaugeParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BoltGaugeParams>({ ...BOLT_GAUGE_DEFAULTS });
	const model = $derived(boltGaugeModel(p));
	const source = $derived(toScad(model, boltGaugeHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SIZES = GAUGE_SIZES.map((s) => ({ value: s.name, label: s.name }));
	const RULERS = RULER_LENGTHS.map((v) => ({
		value: v,
		label: v ? m.t_bolt_gauge_ruler_option({ length: num(v) }) : tc.tc_none()
	}));

	function applyPreset(params: Partial<BoltGaugeParams>) {
		p = { ...BOLT_GAUGE_DEFAULTS, play: p.play, ...params };
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
					`${m.t_bolt_gauge_filename()}-${p.from}-${p.to}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each BOLT_GAUGE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_bolt_gauge_thread_sizes()}>
			<ChoiceField label={m.t_bolt_gauge_from()} bind:value={p.from} options={SIZES} />
			<ChoiceField label={m.t_bolt_gauge_to()} bind:value={p.to} options={SIZES} />
		</FieldGroup>
		<FieldGroup title={m.t_bolt_gauge_on_plate()}>
			<ToggleField
				label={m.t_bolt_gauge_holes()}
				bind:checked={p.holes}
				hint={m.t_bolt_gauge_hole_rule()}
			/>
			<ToggleField
				label={m.t_bolt_gauge_nuts()}
				bind:checked={p.nuts}
				hint={m.t_bolt_gauge_nuts_hint()}
			/>
			<ChoiceField
				label={m.t_bolt_gauge_ruler()}
				bind:value={p.ruler}
				options={RULERS}
				hint={m.t_bolt_gauge_ruler_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.play}
				min={0}
				max={0.8}
				step={0.05}
				hint={m.t_bolt_gauge_play_hint()}
			/>
			<NumberField
				label={m.t_bolt_gauge_plate_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={3}
				max={8}
				step={0.5}
			/>
			<p class="text-xs text-neutral-400">{boltGaugeSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
