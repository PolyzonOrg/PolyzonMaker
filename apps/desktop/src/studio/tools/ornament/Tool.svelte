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
		ORNAMENT_DEFAULTS,
		ORNAMENT_PRESETS,
		ornamentHeader,
		ornamentModel,
		ornamentSummary,
		type OrnamentParams,
		type OrnamentShape,
		ornamentColours
	} from './model';
	import * as m from '$msg/tools/ornament';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<OrnamentParams>({ ...ORNAMENT_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(ornamentModel(drawn));
	const source = $derived(toScad(model, ornamentHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	const colours = $derived(ornamentColours(drawn));
	let saving = $state(false);

	async function download3mf() {
		if (saving) return;
		saving = true;
		try {
			downloadBytes(
				await buildCsg3mf(colours, tool.title),
				`${m.t_ornament_filename()}-${p.shape}.3mf`,
				'model/3mf'
			);
		} catch (e) {
			showToast(e instanceof Error ? e.message : m.t_ornament_3mf_failed(), { kind: 'error' });
		} finally {
			saving = false;
		}
	}

	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: readonly { value: OrnamentShape; label: string }[] = [
		{ value: 'ball', label: m.t_ornament_shape_ball() },
		{ value: 'star', label: m.t_ornament_shape_star() },
		{ value: 'tree', label: m.t_ornament_shape_tree() },
		{ value: 'bell', label: m.t_ornament_shape_bell() },
		{ value: 'heart', label: m.t_ornament_shape_heart() }
	];

	function applyPreset(params: Partial<OrnamentParams>) {
		p = { ...ORNAMENT_DEFAULTS, name: p.name, font: p.font, ...params };
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
				downloadBytes(build.value, `${m.t_ornament_filename()}-${p.shape}.stl`, 'model/stl')
		},
		...(colours.length > 1
			? [{ label: tc.tc_download_3mf_colours(), icon: Layers, onClick: () => void download3mf() }]
			: [])
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each ORNAMENT_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_ornament_ornament()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.size}
				min={40}
				max={160}
				step={1}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_inscription()}>
			<TextField label={m.t_ornament_name()} bind:value={p.name} maxlength={24} />
			<TextField
				label={p.shape === 'tree' ? m.t_ornament_line_above() : m.t_ornament_line_below()}
				bind:value={p.line}
				maxlength={30}
				hint={m.t_ornament_line_hint()}
			/>
			<FontField bind:value={p.font} />
			<ToggleField label={tc.tc_bolder()} bind:checked={p.bold} />
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.6}
				max={6}
				step={0.1}
			/>
			<NumberField
				label={tc.tc_relief_height()}
				unit="mm"
				bind:value={p.relief}
				min={0.4}
				max={3}
				step={0.1}
				hint={m.t_ornament_relief_hint()}
			/>
			<ToggleField label={m.t_ornament_rim()} bind:checked={p.rim} />
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={6} />
			<p class="text-xs text-neutral-400">{ornamentSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
