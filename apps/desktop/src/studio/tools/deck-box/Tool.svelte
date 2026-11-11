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
	import * as m from '$msg/tools/deck-box';
	import {
		DECK_DEFAULTS,
		DECK_PRESETS,
		deckHeader,
		deckModel,
		deckSummary,
		type DeckBoxParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<DeckBoxParams>({ ...DECK_DEFAULTS });
	const model = $derived(deckModel(p));
	const source = $derived(toScad(model, deckHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<DeckBoxParams>) {
		p = { ...DECK_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_deck_box_filename()}-${p.count}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each DECK_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_deck_box_group_cards()}>
			<NumberField
				label={m.t_deck_box_card_width()}
				unit="mm"
				bind:value={p.cardWidth}
				min={20}
				max={200}
				step={0.5}
				hint={m.t_deck_box_card_width_hint()}
			/>
			<NumberField
				label={m.t_deck_box_card_height()}
				unit="mm"
				bind:value={p.cardHeight}
				min={20}
				max={250}
				step={0.5}
			/>
			<NumberField label={m.t_deck_box_count()} bind:value={p.count} min={1} max={500} />
			<NumberField
				label={m.t_deck_box_card_thickness()}
				unit="mm"
				bind:value={p.cardThickness}
				min={0.1}
				max={2}
				step={0.01}
				hint={m.t_deck_box_card_thickness_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_deck_box_group_box()}>
			<NumberField
				label={m.t_deck_box_clearance()}
				unit="mm"
				bind:value={p.clearance}
				min={0}
				max={4}
				step={0.1}
			/>
			<NumberField
				label={tc.tc_wall_thickness()}
				unit="mm"
				bind:value={p.wall}
				min={1}
				max={4}
				step={0.1}
			/>
			<NumberField
				label={m.t_deck_box_cap()}
				unit="%"
				bind:value={p.capPercent}
				min={15}
				max={60}
				step={5}
			/>
			<ToggleField
				label={m.t_deck_box_notch()}
				bind:checked={p.notch}
				hint={m.t_deck_box_notch_hint()}
			/>
			<p class="text-xs text-neutral-400">{deckSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
