<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, Shuffle } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/maze-box';
	import {
		MAZE_BOX_DEFAULTS,
		MAZE_BOX_PRESETS,
		mazeBoxHeader,
		mazeBoxModel,
		mazeBoxSummary,
		type MazeBoxParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<MazeBoxParams>({ ...MAZE_BOX_DEFAULTS });
	const model = $derived(mazeBoxModel(p));
	const source = $derived(toScad(model, mazeBoxHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 500);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<MazeBoxParams>) {
		p = { ...MAZE_BOX_DEFAULTS, seed: p.seed, ...params };
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
				downloadBytes(build.value, `${m.t_maze_box_filename()}-${p.seed}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each MAZE_BOX_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_maze_box_group_box()}>
			<NumberField
				label={m.t_maze_box_inner()}
				unit="mm"
				bind:value={p.inner}
				min={15}
				max={120}
				hint={m.t_maze_box_inner_hint()}
			/>
			<NumberField
				label={m.t_maze_box_height()}
				unit="mm"
				bind:value={p.height}
				min={30}
				max={150}
			/>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn-ghost btn-s"
					onclick={() => (p.seed = (p.seed % 9999) + 1)}
				>
					<Shuffle size={14} aria-hidden="true" />
					{m.t_maze_box_shuffle()}
				</button>
			</div>
			<p class="text-xs text-neutral-400">{mazeBoxSummary(p)}</p>
		</FieldGroup>
		<FieldGroup title={m.t_maze_box_group_grooves()}>
			<NumberField
				label={m.t_maze_box_groove()}
				unit="mm"
				bind:value={p.groove}
				min={3}
				max={8}
				step={0.5}
				hint={m.t_maze_box_groove_hint()}
			/>
			<NumberField
				label={tc.tc_depth()}
				unit="mm"
				bind:value={p.depth}
				min={1}
				max={3}
				step={0.1}
			/>
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.clearance}
				min={0.2}
				max={0.6}
				step={0.05}
				hint={m.t_maze_box_clearance_hint()}
			/>
		</FieldGroup>
	{/snippet}
</ToolShell>
