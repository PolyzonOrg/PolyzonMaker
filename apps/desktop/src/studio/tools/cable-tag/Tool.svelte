<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
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
		CABLE_TAG_DEFAULTS,
		CABLE_TAG_PRESETS,
		cableTagHeader,
		cableTagModel,
		cableTagSummary,
		type CableTagParams,
		type TagShape,
		type TagText
	} from './model';
	import { num } from '$lib/i18n/current';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/cable-tag';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<CableTagParams>({ ...CABLE_TAG_DEFAULTS });
	// Four lines in four fields; the model takes them joined.
	const fromText = (text: string) => [...text.split('\n'), '', '', '', ''].slice(0, 4);
	let lines = $state(fromText(CABLE_TAG_DEFAULTS.text));
	$effect(() => {
		p.text = lines.filter((l) => l.trim()).join('\n');
	});
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(cableTagModel(drawn));
	const source = $derived(toScad(model, cableTagHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 450);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: { value: TagShape; label: string }[] = [
		{ value: 'square', label: m.t_cable_tag_shape_square() },
		{ value: 'circle', label: m.t_cable_tag_shape_circle() },
		{ value: 'triangle', label: m.t_cable_tag_shape_triangle() },
		{ value: 'rect', label: m.t_cable_tag_shape_own() }
	];
	const STYLES: { value: TagText; label: string }[] = [
		{ value: 'raised', label: m.t_cable_tag_style_raised() },
		{ value: 'engraved', label: m.t_cable_tag_style_engraved() }
	];

	function applyPreset(params: Partial<CableTagParams>) {
		p = { ...CABLE_TAG_DEFAULTS, ...params };
		lines = fromText(p.text);
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
				downloadBytes(build.value, `${m.t_cable_tag_filename()}-${p.shape}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each CABLE_TAG_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_cable_tag_group_tag()}>
			<ChoiceField
				label={tc.tc_shape()}
				bind:value={p.shape}
				options={SHAPES}
				hint={m.t_cable_tag_shape_hint()}
			/>
			{#if p.shape === 'rect'}
				<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={20} max={150} />
				<NumberField label={tc.tc_height()} unit="mm" bind:value={p.height} min={10} max={150} />
			{/if}
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={0.8}
				max={4}
				step={0.1}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_cable_tag_group_marking()}>
			{#each lines as line, i (i)}
				{#if i === 0 || lines[i - 1].trim() || line.trim()}
					<TextField
						label={m.t_cable_tag_line({ n: i + 1 })}
						bind:value={lines[i]}
						maxlength={30}
					/>
				{/if}
			{/each}
			<p class="text-xs text-neutral-400">
				{m.t_cable_tag_number_hint()}
			</p>
			<ChoiceField
				label={tc.tc_inscription()}
				bind:value={p.style}
				options={STYLES}
				hint={p.style === 'raised'
					? m.t_cable_tag_style_raised_hint({ height: num(p.thickness) })
					: m.t_cable_tag_style_engraved_hint()}
			/>
			<FontField bind:value={p.font} />
		</FieldGroup>
		<FieldGroup title={m.t_cable_tag_group_set()}>
			<NumberField label={m.t_cable_tag_quantity()} bind:value={p.quantity} min={1} max={60} />
			<NumberField label={m.t_cable_tag_start()} bind:value={p.start} min={0} max={9999} />
			<p class="text-xs text-neutral-400">{cableTagSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
