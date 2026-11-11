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
	import * as m from '$msg/tools/washers';
	import {
		DIN125,
		DIN9021,
		WASHERS_DEFAULTS,
		WASHERS_PRESETS,
		washersHeader,
		washersModel,
		washersSummary,
		type RingSection,
		type WasherKind,
		type WashersParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<WashersParams>({ ...WASHERS_DEFAULTS });
	const model = $derived(washersModel(p));
	const source = $derived(toScad(model, washersHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: { value: WasherKind; label: string }[] = [
		{ value: 'din125', label: m.t_washers_kind_din125() },
		{ value: 'din9021', label: m.t_washers_kind_din9021() },
		{ value: 'spacer', label: m.t_washers_kind_spacer() },
		{ value: 'ring', label: m.t_washers_kind_ring() }
	];
	const SECTIONS: { value: RingSection; label: string }[] = [
		{ value: 'square', label: m.t_washers_section_square() },
		{ value: 'round', label: m.t_washers_section_round() }
	];
	const standard = $derived(p.kind === 'din125' ? DIN125 : p.kind === 'din9021' ? DIN9021 : null);
	const sizes = $derived(
		standard ? Object.keys(standard).map((value) => ({ value, label: value })) : []
	);
	// A size the other table lacks falls back to its first one.
	$effect(() => {
		if (standard && !(p.size in standard)) p.size = Object.keys(standard)[0];
	});

	function applyPreset(params: Partial<WashersParams>) {
		p = { ...WASHERS_DEFAULTS, ...params };
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
					`${p.kind}-${standard ? p.size.replace(',', '.') : `${p.inner}x${p.outer}`}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each WASHERS_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_washers_group_part()}>
			<ChoiceField label={m.t_washers_kind()} bind:value={p.kind} options={KINDS} />
			{#if standard}
				<ChoiceField
					label={m.t_washers_size()}
					bind:value={p.size}
					options={sizes}
					hint={m.t_washers_size_hint()}
				/>
			{:else}
				<NumberField
					label={m.t_washers_inner()}
					unit="mm"
					bind:value={p.inner}
					min={0.5}
					max={290}
					step={0.1}
				/>
				<NumberField
					label={m.t_washers_outer()}
					unit="mm"
					bind:value={p.outer}
					min={2}
					max={300}
					step={0.1}
				/>
				{#if p.kind === 'ring'}
					<ChoiceField
						label={m.t_washers_section()}
						bind:value={p.section}
						options={SECTIONS}
						hint={m.t_washers_section_hint()}
					/>
				{/if}
				{#if !(p.kind === 'ring' && p.section === 'round')}
					<NumberField
						label={p.kind === 'spacer' ? tc.tc_length() : tc.tc_thickness()}
						unit="mm"
						bind:value={p.thickness}
						min={0.6}
						max={100}
						step={0.1}
					/>
				{/if}
			{/if}
			<NumberField label={tc.tc_count()} bind:value={p.quantity} min={1} max={100} />
			<p class="text-xs text-neutral-400">{washersSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
