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
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/pipe-cover';
	import {
		PIPES,
		PIPE_COVER_DEFAULTS,
		PIPE_COVER_PRESETS,
		pipeCoverHeader,
		pipeCoverModel,
		pipeCoverSummary,
		type PipeCoverParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<PipeCoverParams>({ ...PIPE_COVER_DEFAULTS });
	const model = $derived(pipeCoverModel(p));
	const source = $derived(toScad(model, pipeCoverHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<PipeCoverParams>) {
		p = { ...PIPE_COVER_DEFAULTS, count: p.count, ...params };
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
				downloadBytes(build.value, `${m.t_pipe_cover_filename()}-${p.pipe}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each PIPE_COVER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_pipe_cover_pipe()}>
			<ChoiceField
				label={m.t_pipe_cover_pipe()}
				bind:value={p.pipe}
				options={PIPES.map((pipe) => ({ value: pipe.d, label: pipe.label }))}
			/>
			<NumberField
				label={m.t_pipe_cover_pipe_diameter()}
				unit="mm"
				bind:value={p.pipe}
				min={8}
				max={110}
				step={0.1}
				hint={m.t_pipe_cover_pipe_diameter_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_pipe_cover_cover()}>
			<NumberField
				label={m.t_pipe_cover_cover_diameter()}
				unit="mm"
				bind:value={p.diameter}
				min={p.pipe + 16}
				max={p.pipe + 150}
				step={1}
			/>
			<NumberField
				label={m.t_pipe_cover_rim()}
				unit="mm"
				bind:value={p.rim}
				min={3}
				max={40}
				step={1}
				hint={m.t_pipe_cover_rim_hint()}
			/>
			<ToggleField
				label={m.t_pipe_cover_split()}
				bind:checked={p.split}
				hint={m.t_pipe_cover_split_hint()}
			/>
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={8} />
			<p class="text-xs text-neutral-400">{pipeCoverSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
