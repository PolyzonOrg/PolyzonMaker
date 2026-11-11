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
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/flat-spring';
	import {
		SPRING_DEFAULTS,
		SPRING_PRESETS,
		springHeader,
		springModel,
		springSummary,
		type SpringKind,
		type SpringParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<SpringParams>({ ...SPRING_DEFAULTS });
	const model = $derived(springModel(p));
	const source = $derived(toScad(model, springHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: { value: SpringKind; label: string }[] = [
		{ value: 'zigzag', label: m.t_flat_spring_kind_zigzag() },
		{ value: 'spiral', label: m.t_flat_spring_kind_spiral() }
	];

	function applyPreset(params: Partial<SpringParams>) {
		p = { ...SPRING_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_flat_spring_filename()}-${p.kind}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each SPRING_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_flat_spring_spring()}>
			<ChoiceField
				label={m.t_flat_spring_kind()}
				bind:value={p.kind}
				options={KINDS}
				hint={m.t_flat_spring_kind_hint()}
			/>
			<NumberField
				label={m.t_flat_spring_strip()}
				unit="mm"
				bind:value={p.strip}
				min={0.8}
				max={4}
				step={0.1}
				hint={m.t_flat_spring_strip_hint()}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1}
				max={30}
				step={0.5}
			/>
			{#if p.kind === 'zigzag'}
				<NumberField label={tc.tc_length()} unit="mm" bind:value={p.length} min={10} max={200} />
				<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={6} max={150} />
				<NumberField label={m.t_flat_spring_turns()} bind:value={p.turns} min={2} max={60} />
				<NumberField
					label={m.t_flat_spring_pad_holes()}
					unit="mm"
					bind:value={p.hole}
					min={0}
					max={8}
					step={0.1}
					hint={m.t_flat_spring_pad_holes_hint()}
				/>
			{:else}
				<NumberField
					label={m.t_flat_spring_outer()}
					unit="mm"
					bind:value={p.outer}
					min={20}
					max={200}
				/>
				<NumberField
					label={m.t_flat_spring_hub()}
					unit="mm"
					bind:value={p.hub}
					min={4}
					max={60}
					step={0.5}
				/>
				<NumberField
					label={m.t_flat_spring_bore()}
					unit="mm"
					bind:value={p.bore}
					min={1}
					max={58}
					step={0.1}
				/>
				<NumberField
					label={m.t_flat_spring_turns()}
					bind:value={p.spiralTurns}
					min={1}
					max={30}
					step={0.5}
				/>
			{/if}
			<p class="text-xs text-neutral-400">{springSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
