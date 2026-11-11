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
	import * as m from '$msg/tools/furniture-handle';
	import * as tc from '$msg/tools/common';
	import {
		FURNITURE_HANDLE_DEFAULTS,
		FURNITURE_HANDLE_PRESETS,
		furnitureHandleHeader,
		furnitureHandleModel,
		furnitureHandleSummary,
		type FurnitureHandleParams,
		type HandleScrew,
		type HandleStyle
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<FurnitureHandleParams>({ ...FURNITURE_HANDLE_DEFAULTS });
	const model = $derived(furnitureHandleModel(p));
	const source = $derived(toScad(model, furnitureHandleHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const STYLES: readonly { value: HandleStyle; label: string }[] = [
		{ value: 'bar', label: m.t_furniture_handle_style_bar() },
		{ value: 'arch', label: m.t_furniture_handle_style_arch() }
	];
	const SCREWS: readonly { value: HandleScrew; label: string }[] = [
		{ value: 'm4', label: m.t_furniture_handle_screw_m4() },
		{ value: 'insert', label: m.t_furniture_handle_screw_insert() }
	];
	const CENTRES = [64, 96, 128, 160, 192, 224, 256, 288, 320];

	function applyPreset(params: Partial<FurnitureHandleParams>) {
		p = { ...FURNITURE_HANDLE_DEFAULTS, ...params };
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
					`${m.t_furniture_handle_filename()}-${p.centres}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each FURNITURE_HANDLE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_furniture_handle_group_handle()}>
			<ChoiceField label={m.t_furniture_handle_style()} bind:value={p.style} options={STYLES} />
			<ChoiceField
				label={m.t_furniture_handle_centres()}
				bind:value={p.centres}
				options={CENTRES.map((v) => ({
					value: v,
					label: m.t_furniture_handle_centres_option({ size: v })
				}))}
				hint={m.t_furniture_handle_centres_hint()}
			/>
			{#if p.style === 'bar'}
				<NumberField
					label={m.t_furniture_handle_overhang()}
					unit="mm"
					bind:value={p.overhang}
					min={0}
					max={60}
					step={1}
				/>
			{/if}
			<NumberField
				label={m.t_furniture_handle_projection()}
				unit="mm"
				bind:value={p.projection}
				min={18}
				max={60}
				step={1}
			/>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={8}
				max={30}
				step={0.5}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={6}
				max={20}
				step={0.5}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_mount()}>
			<ChoiceField label={m.t_furniture_handle_screw()} bind:value={p.screw} options={SCREWS} />
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={8} />
			<p class="text-xs text-neutral-400">{furnitureHandleSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
