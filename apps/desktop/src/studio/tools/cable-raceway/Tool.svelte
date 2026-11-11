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
	import {
		RACEWAY_DEFAULTS,
		RACEWAY_PRESETS,
		racewayHeader,
		racewayModel,
		racewaySummary,
		type RacewayMount,
		type RacewayParams
	} from './model';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/cable-raceway';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<RacewayParams>({ ...RACEWAY_DEFAULTS });
	const model = $derived(racewayModel(p));
	const source = $derived(toScad(model, racewayHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const MOUNTS: { value: RacewayMount; label: string }[] = [
		{ value: 'tape', label: m.t_cable_raceway_mount_tape() },
		{ value: 'screws', label: m.t_cable_raceway_mount_screws() }
	];

	function applyPreset(params: Partial<RacewayParams>) {
		p = { ...RACEWAY_DEFAULTS, ...params };
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
				downloadBytes(
					build.value,
					`${m.t_cable_raceway_filename()}-${p.width}x${p.height}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each RACEWAY_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_size()}>
			<NumberField
				label={tc.tc_length()}
				unit="mm"
				bind:value={p.length}
				min={30}
				max={300}
				hint={m.t_cable_raceway_length_hint()}
			/>
			<NumberField
				label={m.t_cable_raceway_inner_width()}
				unit="mm"
				bind:value={p.width}
				min={6}
				max={80}
				step={0.5}
			/>
			<NumberField
				label={m.t_cable_raceway_inner_height()}
				unit="mm"
				bind:value={p.height}
				min={5}
				max={50}
				step={0.5}
			/>
			<NumberField
				label={tc.tc_wall()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={3}
				step={0.1}
				hint={m.t_cable_raceway_wall_hint()}
			/>
			<p class="text-xs text-neutral-400">{racewaySummary(p)}</p>
		</FieldGroup>
		<FieldGroup title={m.t_cable_raceway_mount_and_snap()}>
			<ChoiceField label={tc.tc_mount()} bind:value={p.mount} options={MOUNTS} />
			{#if p.mount === 'screws'}
				<NumberField
					label={m.t_cable_raceway_screw_step()}
					unit="mm"
					bind:value={p.screwStep}
					min={40}
					max={300}
					step={5}
					hint={m.t_cable_raceway_screw_step_hint()}
				/>
			{/if}
			<NumberField
				label={m.t_cable_raceway_clearance()}
				unit="mm"
				bind:value={p.clearance}
				min={0.1}
				max={0.5}
				step={0.05}
				hint={m.t_cable_raceway_clearance_hint()}
			/>
		</FieldGroup>
	{/snippet}
</ToolShell>
