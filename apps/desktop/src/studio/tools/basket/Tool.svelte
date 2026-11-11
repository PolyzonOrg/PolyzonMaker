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
	import {
		BASKET_DEFAULTS,
		BASKET_PRESETS,
		basketHeader,
		basketModel,
		basketSummary,
		type BasketParams,
		type BasketPattern,
		type BasketShape
	} from './model';
	import * as m from '$msg/tools/basket';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BasketParams>({ ...BASKET_DEFAULTS });
	const model = $derived(basketModel(p));
	const source = $derived(toScad(model, basketHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 500);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: { value: BasketShape; label: string }[] = [
		{ value: 'rect', label: m.t_basket_shape_rect() },
		{ value: 'round', label: m.t_basket_shape_round() }
	];
	const PATTERNS: { value: BasketPattern; label: string }[] = [
		{ value: 'hex', label: m.t_basket_pattern_hex() },
		{ value: 'diamond', label: m.t_basket_pattern_diamond() },
		{ value: 'slots', label: m.t_basket_pattern_slots() },
		{ value: 'none', label: m.t_basket_pattern_none() }
	];

	function applyPreset(params: Partial<BasketParams>) {
		p = { ...BASKET_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_basket_filename()}-${p.shape}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each BASKET_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_basket_group_shape_size()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			{#if p.shape === 'round'}
				<NumberField label={tc.tc_diameter()} unit="mm" bind:value={p.width} min={40} max={300} />
			{:else}
				<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={40} max={300} />
				<NumberField label={tc.tc_depth()} unit="mm" bind:value={p.depth} min={40} max={300} />
				<NumberField
					label={tc.tc_corner_rounding()}
					unit="mm"
					bind:value={p.radius}
					min={1}
					max={60}
					step={0.5}
				/>
			{/if}
			<NumberField label={tc.tc_height()} unit="mm" bind:value={p.height} min={20} max={300} />
			<NumberField
				label={tc.tc_wall()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={4}
				step={0.1}
			/>
			<NumberField
				label={tc.tc_bottom()}
				unit="mm"
				bind:value={p.floor}
				min={1}
				max={5}
				step={0.1}
			/>
			<p class="text-xs text-neutral-400">{basketSummary(p)}</p>
		</FieldGroup>
		<FieldGroup title={tc.tc_pattern()}>
			<ChoiceField
				label={tc.tc_walls()}
				bind:value={p.pattern}
				options={PATTERNS}
				hint={m.t_basket_pattern_hint()}
			/>
			{#if p.pattern !== 'none'}
				<NumberField
					label={tc.tc_hole()}
					unit="mm"
					bind:value={p.hole}
					min={4}
					max={30}
					step={0.5}
				/>
				<NumberField
					label={m.t_basket_bar()}
					unit="mm"
					bind:value={p.bar}
					min={1.6}
					max={10}
					step={0.1}
					hint={m.t_basket_bar_hint()}
				/>
				<NumberField
					label={m.t_basket_rim()}
					unit="mm"
					bind:value={p.rim}
					min={3}
					max={60}
					step={0.5}
				/>
				<NumberField
					label={m.t_basket_band()}
					unit="mm"
					bind:value={p.band}
					min={2}
					max={60}
					step={0.5}
				/>
			{/if}
			<ToggleField
				label={m.t_basket_floor_holes()}
				bind:checked={p.floorHoles}
				hint={m.t_basket_floor_holes_hint()}
			/>
		</FieldGroup>
	{/snippet}
</ToolShell>
