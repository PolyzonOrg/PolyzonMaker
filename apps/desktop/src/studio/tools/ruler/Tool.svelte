<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		RULER_DEFAULTS,
		RULER_PRESETS,
		rulerHeader,
		rulerModel,
		rulerSummary,
		type RulerKind,
		type RulerParams
	} from './model';
	import * as m from '$msg/tools/ruler';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<RulerParams>({ ...RULER_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(rulerModel(drawn));
	const source = $derived(toScad(model, rulerHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: readonly { value: RulerKind; label: string }[] = [
		{ value: 'ruler', label: m.t_ruler_kind_ruler() },
		{ value: 'radius', label: m.t_ruler_kind_radius() }
	];

	function applyPreset(params: Partial<RulerParams>) {
		p = { ...RULER_DEFAULTS, font: p.font, ...params };
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
					p.kind === 'ruler'
						? `${m.t_ruler_filename()}-${p.length}.stl`
						: `${m.t_ruler_gauges_filename()}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each RULER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_ruler_group_what()}>
			<ChoiceField label={m.t_ruler_kind()} bind:value={p.kind} options={KINDS} />
			{#if p.kind === 'ruler'}
				<NumberField
					label={m.t_ruler_scale_length()}
					unit="mm"
					bind:value={p.length}
					min={30}
					max={300}
					step={10}
				/>
				<NumberField
					label={tc.tc_width()}
					unit="mm"
					bind:value={p.width}
					min={12}
					max={50}
					step={1}
				/>
				<ToggleField
					label={m.t_ruler_millimetres()}
					bind:checked={p.millimetres}
					hint={m.t_ruler_millimetres_hint()}
				/>
			{:else}
				<TextField
					label={m.t_ruler_radii()}
					bind:value={p.radii}
					maxlength={80}
					hint={m.t_ruler_radii_hint()}
				/>
			{/if}
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.6}
				max={5}
				step={0.1}
			/>
			<FontField bind:value={p.font} />
			<p class="text-xs text-neutral-400">{rulerSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
