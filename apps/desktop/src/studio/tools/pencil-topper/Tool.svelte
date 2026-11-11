<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, Layers } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, buildCsg3mf, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import { showToast } from '$lib/toast';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		PENCIL_TOPPER_DEFAULTS,
		PENCIL_TOPPER_PRESETS,
		pencilTopperHeader,
		pencilTopperModel,
		pencilTopperSummary,
		type HoleShape,
		type PencilTopperParams,
		pencilTopperColours
	} from './model';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/pencil-topper';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<PencilTopperParams>({ ...PENCIL_TOPPER_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(pencilTopperModel(drawn));
	const source = $derived(toScad(model, pencilTopperHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	const colours = $derived(pencilTopperColours(drawn));
	let saving = $state(false);

	async function download3mf() {
		if (saving) return;
		saving = true;
		try {
			downloadBytes(
				await buildCsg3mf(colours, tool.title),
				`${m.t_pencil_topper_filename()}.3mf`,
				'model/3mf'
			);
		} catch (e) {
			showToast(e instanceof Error ? e.message : m.t_pencil_topper_3mf_failed(), {
				kind: 'error'
			});
		} finally {
			saving = false;
		}
	}

	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const HOLES: readonly { value: HoleShape; label: string }[] = [
		{ value: 'hex', label: m.t_pencil_topper_hole_hex() },
		{ value: 'round', label: m.t_pencil_topper_hole_round() }
	];

	function applyPreset(params: Partial<PencilTopperParams>) {
		p = { ...PENCIL_TOPPER_DEFAULTS, names: p.names, font: p.font, ...params };
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
				downloadBytes(build.value, `${m.t_pencil_topper_filename()}.stl`, 'model/stl')
		},
		...(colours.length > 1
			? [{ label: tc.tc_download_3mf_colours(), icon: Layers, onClick: () => void download3mf() }]
			: [])
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each PENCIL_TOPPER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_inscription()}>
			<TextField
				label={m.t_pencil_topper_names()}
				bind:value={p.names}
				maxlength={400}
				hint={m.t_pencil_topper_names_hint()}
			/>
			<FontField bind:value={p.font} />
			<ToggleField label={tc.tc_bolder()} bind:checked={p.bold} />
			<NumberField
				label={tc.tc_letter_height()}
				unit="mm"
				bind:value={p.cap}
				min={8}
				max={30}
				step={0.5}
			/>
			<NumberField
				label={m.t_pencil_topper_max_width()}
				unit="mm"
				bind:value={p.maxWidth}
				min={30}
				max={160}
				step={1}
				hint={m.t_pencil_topper_max_width_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_view()}>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={2.4}
				max={10}
				step={0.1}
			/>
			<ToggleField
				label={m.t_pencil_topper_outline()}
				bind:checked={p.outline}
				hint={m.t_pencil_topper_outline_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_hole()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.hole} options={HOLES} />
			<NumberField
				label={p.hole === 'hex' ? m.t_pencil_topper_size_hex() : m.t_pencil_topper_size_round()}
				unit="mm"
				bind:value={p.size}
				min={4}
				max={14}
				step={0.1}
				hint={p.hole === 'hex'
					? m.t_pencil_topper_size_hex_hint()
					: m.t_pencil_topper_size_round_hint()}
			/>
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.clearance}
				min={0}
				max={1}
				step={0.05}
				hint={m.t_pencil_topper_clearance_hint()}
			/>
			<NumberField label={tc.tc_depth()} unit="mm" bind:value={p.depth} min={6} max={30} step={1} />
			<p class="text-xs text-neutral-400">{pencilTopperSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
