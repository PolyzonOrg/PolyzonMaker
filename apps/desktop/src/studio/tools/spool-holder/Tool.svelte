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
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/spool-holder';
	import {
		SPOOL_HOLDER_DEFAULTS,
		SPOOL_HOLDER_PRESETS,
		spoolHolderHeader,
		spoolHolderModel,
		spoolHolderSummary,
		type BearingId,
		type SpoolHolderParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<SpoolHolderParams>({ ...SPOOL_HOLDER_DEFAULTS });
	const model = $derived(spoolHolderModel(p));
	const source = $derived(toScad(model, spoolHolderHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const BEARING_CHOICES: readonly { value: BearingId; label: string }[] = [
		{ value: '608', label: m.t_spool_holder_bearing_choice({ id: '608', size: 22 }) },
		{ value: '625', label: m.t_spool_holder_bearing_choice({ id: '625', size: 16 }) }
	];
	const COUNTS: readonly { value: 1 | 2; label: string }[] = [
		{ value: 2, label: m.t_spool_holder_count_two() },
		{ value: 1, label: m.t_spool_holder_count_one() }
	];

	function applyPreset(params: Partial<SpoolHolderParams>) {
		p = { ...SPOOL_HOLDER_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_spool_holder_filename()}-${p.spool}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each SPOOL_HOLDER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_spool_holder_group_spool()}>
			<NumberField
				label={m.t_spool_holder_spool()}
				unit="mm"
				bind:value={p.spool}
				min={100}
				max={400}
				step={1}
				hint={m.t_spool_holder_spool_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_spool_holder_group_cradles()}>
			<ChoiceField
				label={m.t_spool_holder_bearings()}
				bind:value={p.bearing}
				options={BEARING_CHOICES}
				hint={p.bearing === '608'
					? m.t_spool_holder_bearing_608_hint()
					: m.t_spool_holder_bearing_625_hint()}
			/>
			<ChoiceField label={m.t_spool_holder_count()} bind:value={p.count} options={COUNTS} />
			<NumberField
				label={m.t_spool_holder_base()}
				unit="mm"
				bind:value={p.base}
				min={2.5}
				max={10}
				step={0.5}
			/>
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.clearance}
				min={0.1}
				max={1}
				step={0.05}
				hint={m.t_spool_holder_clearance_hint()}
			/>
			<p class="text-xs text-neutral-400">{spoolHolderSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
