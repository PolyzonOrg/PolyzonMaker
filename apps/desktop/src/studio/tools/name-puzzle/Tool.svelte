<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, Layers } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, buildCsg3mf, disposeCsg, measureTexts, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import type { TextBox } from '$lib/tools/csg/evaluate';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import { showToast } from '$lib/toast';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		NAME_PUZZLE_DEFAULTS,
		NAME_PUZZLE_PRESETS,
		namePuzzleColours,
		namePuzzleHeader,
		namePuzzleModel,
		namePuzzleSummary,
		namePuzzleTexts,
		type NamePuzzleParams
	} from './model';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/name-puzzle';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<NamePuzzleParams>({ ...NAME_PUZZLE_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	// Letters stand side by side by their real widths: measure, then build.
	const build = createBuild<
		NamePuzzleParams,
		{ stl: Uint8Array; root: Node; boxes: (TextBox | null)[] }
	>(async (q, signal) => {
		const boxes = await measureTexts(namePuzzleTexts(q), signal);
		const root = namePuzzleModel(q, boxes);
		return { stl: await buildCsg(root, signal), root, boxes };
	}, 400);
	$effect(() => build.run(drawn));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const colours = $derived(namePuzzleColours(drawn, build.value?.boxes));
	const source = $derived(build.value ? toScad(build.value.root, namePuzzleHeader(drawn)) : null);
	let saving = $state(false);

	async function download3mf() {
		if (saving) return;
		saving = true;
		try {
			downloadBytes(
				await buildCsg3mf(colours, tool.title),
				`${m.t_name_puzzle_filename()}.3mf`,
				'model/3mf'
			);
		} catch (e) {
			showToast(e instanceof Error ? e.message : m.t_name_puzzle_3mf_failed(), { kind: 'error' });
		} finally {
			saving = false;
		}
	}

	function applyPreset(params: Partial<NamePuzzleParams>) {
		p = { ...NAME_PUZZLE_DEFAULTS, name: p.name, ...params };
	}
</script>

<ToolShell
	{tool}
	stl={build.value?.stl ?? null}
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
				downloadBytes(build.value.stl, `${m.t_name_puzzle_filename()}.stl`, 'model/stl')
		},
		...(colours.length > 1
			? [{ label: tc.tc_download_3mf_colours(), icon: Layers, onClick: () => void download3mf() }]
			: [])
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each NAME_PUZZLE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_name_puzzle_group_name()}>
			<TextField
				label={m.t_name_puzzle_name()}
				bind:value={p.name}
				maxlength={16}
				hint={m.t_name_puzzle_name_hint()}
			/>
			<FontField bind:value={p.font} />
			<ToggleField label={tc.tc_bolder()} bind:checked={p.bold} />
			<NumberField
				label={tc.tc_letter_height()}
				unit="mm"
				bind:value={p.cap}
				min={15}
				max={80}
				hint={m.t_name_puzzle_cap_hint()}
			/>
			<NumberField
				label={m.t_name_puzzle_spacing()}
				unit="mm"
				bind:value={p.spacing}
				min={2}
				max={20}
				step={0.5}
			/>
			<p class="text-xs text-neutral-400">{namePuzzleSummary(drawn, build.value?.boxes)}</p>
		</FieldGroup>
		<FieldGroup title={m.t_name_puzzle_group_pieces()}>
			<NumberField
				label={m.t_name_puzzle_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={4}
				max={20}
				step={0.5}
			/>
			<NumberField
				label={m.t_name_puzzle_depth()}
				unit="mm"
				bind:value={p.depth}
				min={2}
				max={15}
				step={0.5}
				hint={m.t_name_puzzle_depth_hint()}
			/>
			<NumberField
				label={m.t_name_puzzle_floor()}
				unit="mm"
				bind:value={p.floor}
				min={1.6}
				max={6}
				step={0.2}
			/>
			<NumberField
				label={m.t_name_puzzle_gap()}
				unit="mm"
				bind:value={p.gap}
				min={0.2}
				max={1.2}
				step={0.05}
				hint={m.t_name_puzzle_gap_hint()}
			/>
		</FieldGroup>
	{/snippet}
</ToolShell>
