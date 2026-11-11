<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		BEARING_DEFAULTS,
		BEARING_SIZES,
		bearingHeader,
		bearingModel,
		bearingName,
		bearingSummary,
		type BearingParams
	} from './model';
	import * as m from '$msg/tools/bearing';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BearingParams>({ ...BEARING_DEFAULTS });
	const model = $derived(bearingModel(p));
	const source = $derived(toScad(model, bearingHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});
	const name = $derived(bearingName(p));
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
					`${m.t_bearing_filename()}-${name ?? `${p.bore}x${p.outer}x${p.width}`}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={m.t_bearing_sizes()}>
			<div class="flex flex-wrap gap-2">
				{#each BEARING_SIZES as s (s.id)}
					<button
						type="button"
						class="btn-ghost btn-s"
						aria-pressed={name === s.id}
						onclick={() => (p = { ...p, bore: s.d, outer: s.D, width: s.B })}
					>
						{s.id}
					</button>
				{/each}
			</div>
			<p class="text-xs text-neutral-400">
				{m.t_bearing_sizes_hint()}
			</p>
		</FieldGroup>
		<FieldGroup title={tc.tc_size()}>
			<NumberField label={tc.tc_hole()} unit="mm" bind:value={p.bore} min={2} max={80} step={0.5} />
			<NumberField
				label={m.t_bearing_outer()}
				unit="mm"
				bind:value={p.outer}
				min={10}
				max={150}
				step={0.5}
			/>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={3}
				max={40}
				step={0.5}
			/>
			<p class="text-xs text-neutral-400">{bearingSummary(p)}</p>
		</FieldGroup>
		<FieldGroup title={m.t_bearing_gaps()}>
			<NumberField
				label={m.t_bearing_clearance()}
				unit="mm"
				bind:value={p.clearance}
				min={0.15}
				max={0.6}
				step={0.05}
				hint={m.t_bearing_clearance_hint()}
			/>
			<NumberField
				label={m.t_bearing_fit()}
				unit="mm"
				bind:value={p.fit}
				min={0}
				max={0.5}
				step={0.05}
				hint={m.t_bearing_fit_hint()}
			/>
		</FieldGroup>
	{/snippet}
</ToolShell>
