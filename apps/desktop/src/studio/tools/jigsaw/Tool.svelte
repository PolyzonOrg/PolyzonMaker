<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, Shuffle } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
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
		JIGSAW_DEFAULTS,
		JIGSAW_PRESETS,
		jigsawHeader,
		jigsawModel,
		jigsawSummary,
		type JigsawParams
	} from './model';
	import * as m from '$msg/tools/jigsaw';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<JigsawParams>({ ...JIGSAW_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(jigsawModel(drawn));
	const source = $derived(toScad(model, jigsawHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 450);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<JigsawParams>) {
		p = { ...JIGSAW_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_jigsaw_filename()}-${p.cols}x${p.rows}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each JIGSAW_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_jigsaw_puzzle()}>
			<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={30} max={300} />
			<NumberField label={tc.tc_height()} unit="mm" bind:value={p.height} min={30} max={300} />
			<NumberField label={m.t_jigsaw_cols()} bind:value={p.cols} min={2} max={15} />
			<NumberField label={m.t_jigsaw_rows()} bind:value={p.rows} min={2} max={15} />
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.6}
				max={15}
				step={0.2}
			/>
			<NumberField
				label={m.t_jigsaw_knob()}
				unit="%"
				bind:value={p.knob}
				min={15}
				max={25}
				hint={m.t_jigsaw_knob_hint()}
			/>
			<NumberField
				label={m.t_jigsaw_gap()}
				unit="mm"
				bind:value={p.gap}
				min={0.2}
				max={1}
				step={0.05}
				hint={m.t_jigsaw_gap_hint()}
			/>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn-ghost btn-s"
					onclick={() => (p.seed = (p.seed % 9999) + 1)}
				>
					<Shuffle size={14} aria-hidden="true" />
					{m.t_jigsaw_reshuffle()}
				</button>
			</div>
			<p class="text-xs text-neutral-400">{jigsawSummary(p)}</p>
		</FieldGroup>
		<FieldGroup title={m.t_jigsaw_text_and_tray()}>
			<TextField
				label={m.t_jigsaw_text()}
				bind:value={p.text}
				maxlength={40}
				placeholder={m.t_jigsaw_text_placeholder()}
				hint={m.t_jigsaw_text_hint()}
			/>
			{#if p.text.trim()}
				<FontField bind:value={p.font} />
			{/if}
			<ToggleField label={m.t_jigsaw_tray()} bind:checked={p.tray} hint={m.t_jigsaw_tray_hint()} />
		</FieldGroup>
	{/snippet}
</ToolShell>
