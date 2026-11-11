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
	import {
		JAR_DEFAULTS,
		JAR_PRESETS,
		jarHeader,
		jarModel,
		jarSummary,
		type JarKind,
		type JarParams
	} from './model';
	import * as m from '$msg/tools/jar-generator';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<JarParams>({ ...JAR_DEFAULTS });
	const model = $derived(jarModel(p));
	const source = $derived(toScad(model, jarHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 450);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: readonly { value: JarKind; label: string }[] = [
		{ value: 'both', label: m.t_jar_generator_kind_both() },
		{ value: 'jar', label: m.t_jar_generator_kind_jar() },
		{ value: 'lid', label: m.t_jar_generator_kind_lid() }
	];
	const STARTS: readonly { value: 1 | 2; label: string }[] = [
		{ value: 1, label: m.t_jar_generator_starts_one() },
		{ value: 2, label: m.t_jar_generator_starts_two() }
	];

	function applyPreset(params: Partial<JarParams>) {
		p = { ...JAR_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_jar_generator_filename()}-${p.kind}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each JAR_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup>
			<ChoiceField label={tc.tc_what_to_print()} bind:value={p.kind} options={KINDS} />
		</FieldGroup>
		<FieldGroup title={m.t_jar_generator_jar()}>
			<NumberField
				label={m.t_jar_generator_inner()}
				unit="mm"
				bind:value={p.inner}
				min={15}
				max={250}
				step={1}
			/>
			<NumberField
				label={m.t_jar_generator_height()}
				unit="mm"
				bind:value={p.height}
				min={15}
				max={400}
				step={1}
			/>
			<NumberField
				label={tc.tc_wall_thickness()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={6}
				step={0.1}
			/>
			<NumberField
				label={m.t_jar_generator_bottom()}
				unit="mm"
				bind:value={p.bottom}
				min={0.8}
				max={8}
				step={0.2}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_jar_generator_thread()}>
			<NumberField
				label={m.t_jar_generator_pitch()}
				unit="mm"
				bind:value={p.pitch}
				min={1.5}
				max={10}
				step={0.5}
				hint={m.t_jar_generator_pitch_hint()}
			/>
			<ChoiceField
				label={m.t_jar_generator_starts()}
				bind:value={p.starts}
				options={STARTS}
				hint={p.starts === 2 ? m.t_jar_generator_starts_two_hint() : undefined}
			/>
			<NumberField
				label={m.t_jar_generator_turns()}
				bind:value={p.turns}
				min={1}
				max={5}
				step={0.5}
			/>
			<NumberField
				label={tc.tc_gap()}
				unit="mm"
				bind:value={p.clearance}
				min={0}
				max={1.5}
				step={0.05}
				hint={m.t_jar_generator_clearance_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_lid()}>
			<NumberField
				label={m.t_jar_generator_lid_top()}
				unit="mm"
				bind:value={p.lidTop}
				min={1.2}
				max={8}
				step={0.2}
			/>
			<NumberField
				label={tc.tc_wall_thickness()}
				unit="mm"
				bind:value={p.lidWall}
				min={1.2}
				max={6}
				step={0.1}
			/>
			<ToggleField
				label={m.t_jar_generator_ribs()}
				bind:checked={p.ribs}
				hint={m.t_jar_generator_ribs_hint()}
			/>
			<p class="text-xs text-neutral-400">{jarSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
