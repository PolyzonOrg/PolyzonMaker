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
	import * as m from '$msg/tools/item-holder';
	import {
		ITEMS,
		ITEM_HOLDER_DEFAULTS,
		ITEM_HOLDER_PRESETS,
		itemHolderHeader,
		itemHolderModel,
		itemHolderSummary,
		type ItemHolderParams,
		type ItemKind
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<ItemHolderParams>({ ...ITEM_HOLDER_DEFAULTS });
	const model = $derived(itemHolderModel(p));
	const source = $derived(toScad(model, itemHolderHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const CHOICES: readonly { value: ItemKind; label: string }[] = [
		...(Object.entries(ITEMS) as [ItemKind, { label: string }][]).map(([value, s]) => ({
			value,
			label: s.label
		})),
		{ value: 'round', label: m.t_item_holder_item_round() },
		{ value: 'square', label: m.t_item_holder_item_square() }
	];
	const custom = $derived(p.item === 'round' || p.item === 'square');

	function applyPreset(params: Partial<ItemHolderParams>) {
		p = { ...ITEM_HOLDER_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_item_holder_filename()}-${p.item}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each ITEM_HOLDER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_item_holder_group_item()}>
			<ChoiceField label={m.t_item_holder_item()} bind:value={p.item} options={CHOICES} />
			{#if custom}
				<NumberField
					label={p.item === 'round' ? tc.tc_diameter() : m.t_item_holder_side()}
					unit="mm"
					bind:value={p.size}
					min={2}
					max={60}
					step={0.1}
					hint={m.t_item_holder_size_hint()}
				/>
				<NumberField
					label={m.t_item_holder_length()}
					unit="mm"
					bind:value={p.length}
					min={5}
					max={200}
					step={1}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_item_holder_group_sockets()}>
			<NumberField label={m.t_item_holder_cols()} bind:value={p.cols} min={1} max={20} />
			<NumberField label={tc.tc_rows()} bind:value={p.rows} min={1} max={10} />
			<NumberField
				label={m.t_item_holder_depth()}
				unit="%"
				bind:value={p.depth}
				min={15}
				max={90}
				step={5}
				hint={m.t_item_holder_depth_hint()}
			/>
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.clearance}
				min={0}
				max={1.5}
				step={0.05}
				hint={m.t_item_holder_clearance_hint()}
			/>
			<NumberField
				label={tc.tc_walls()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={6}
				step={0.1}
			/>
			<p class="text-xs text-neutral-400">{itemHolderSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
