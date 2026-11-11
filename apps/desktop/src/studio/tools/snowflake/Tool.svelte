<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Dices, Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		SNOWFLAKE_DEFAULTS,
		SNOWFLAKE_PRESETS,
		snowflakeHeader,
		snowflakeModel,
		snowflakeSummary,
		type SnowflakeParams
	} from './model';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/snowflake';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<SnowflakeParams>({ ...SNOWFLAKE_DEFAULTS });
	const model = $derived(snowflakeModel(p));
	const source = $derived(toScad(model, snowflakeHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<SnowflakeParams>) {
		p = { ...SNOWFLAKE_DEFAULTS, ...params };
	}

	function shuffle() {
		let next = p.seed;
		while (next === p.seed) next = 1 + Math.floor(Math.random() * 999);
		p.seed = next;
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
				downloadBytes(build.value, `${m.t_snowflake_filename()}-${p.seed}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each SNOWFLAKE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_pattern()}>
			<NumberField
				label={m.t_snowflake_seed()}
				bind:value={p.seed}
				min={1}
				max={999}
				hint={m.t_snowflake_seed_hint()}
			/>
			<div>
				<button type="button" class="btn-ghost btn-s" onclick={shuffle}>
					<Dices size={14} aria-hidden="true" />
					{m.t_snowflake_shuffle()}
				</button>
			</div>
			<NumberField label={m.t_snowflake_branches()} bind:value={p.branches} min={1} max={5} />
			<ToggleField
				label={m.t_snowflake_relief()}
				bind:checked={p.relief}
				hint={m.t_snowflake_relief_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_size()}>
			<NumberField
				label={tc.tc_diameter()}
				unit="mm"
				bind:value={p.diameter}
				min={30}
				max={200}
				step={1}
			/>
			<NumberField
				label={m.t_snowflake_stroke()}
				unit="mm"
				bind:value={p.stroke}
				min={1.2}
				max={6}
				step={0.1}
				hint={m.t_snowflake_stroke_hint()}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.2}
				max={8}
				step={0.1}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<ToggleField label={m.t_snowflake_loop()} bind:checked={p.loop} />
			<NumberField
				label={tc.tc_count()}
				bind:value={p.count}
				min={1}
				max={9}
				hint={m.t_snowflake_count_hint()}
			/>
			<p class="text-xs text-neutral-400">{snowflakeSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
