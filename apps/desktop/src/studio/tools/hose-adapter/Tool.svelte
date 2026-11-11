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
		HOSE_DEFAULTS,
		HOSE_PRESETS,
		hoseHeader,
		hoseModel,
		hoseSummary,
		type EndFit,
		type HoseKind,
		type HoseParams
	} from './model';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/hose-adapter';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<HoseParams>({ ...HOSE_DEFAULTS });
	const model = $derived(hoseModel(p));
	const source = $derived(toScad(model, hoseHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: readonly { value: HoseKind; label: string }[] = [
		{ value: 'straight', label: m.t_hose_adapter_kind_straight() },
		{ value: 'elbow', label: m.t_hose_adapter_kind_elbow() },
		{ value: 'funnel', label: m.t_hose_adapter_kind_funnel() }
	];
	const FITS: readonly { value: EndFit; label: string }[] = [
		{ value: 'inside', label: m.t_hose_adapter_fit_inside() },
		{ value: 'outside', label: m.t_hose_adapter_fit_outside() }
	];
	const fitHint = (fit: EndFit) =>
		fit === 'inside' ? m.t_hose_adapter_fit_inside_hint() : m.t_hose_adapter_fit_outside_hint();
	const anyInside = $derived(p.fitA === 'inside' || p.fitB === 'inside');

	function applyPreset(params: Partial<HoseParams>) {
		p = { ...HOSE_DEFAULTS, ...params };
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
					p.kind === 'funnel'
						? `${m.t_hose_adapter_funnel_filename()}-${p.mouth}.stl`
						: `${m.t_hose_adapter_filename()}-${p.diameterA}-${p.diameterB}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each HOSE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup>
			<ChoiceField label={tc.tc_what_to_print()} bind:value={p.kind} options={KINDS} />
		</FieldGroup>
		{#if p.kind === 'funnel'}
			<FieldGroup title={m.t_hose_adapter_group_funnel()}>
				<NumberField
					label={m.t_hose_adapter_mouth()}
					unit="mm"
					bind:value={p.mouth}
					min={30}
					max={250}
					step={1}
				/>
				<NumberField
					label={m.t_hose_adapter_spout()}
					unit="mm"
					bind:value={p.spout}
					min={4 + 2 * p.wall}
					max={p.mouth - 10}
					step={0.5}
					hint={m.t_hose_adapter_spout_hint()}
				/>
				<NumberField
					label={m.t_hose_adapter_spout_length()}
					unit="mm"
					bind:value={p.spoutLength}
					min={5}
					max={150}
					step={1}
				/>
			</FieldGroup>
		{:else}
			<FieldGroup title={m.t_hose_adapter_group_end_a()}>
				<ChoiceField
					label={m.t_hose_adapter_fit()}
					bind:value={p.fitA}
					options={FITS}
					hint={fitHint(p.fitA)}
				/>
				<NumberField
					label={tc.tc_diameter()}
					unit="mm"
					bind:value={p.diameterA}
					min={4}
					max={200}
					step={0.5}
				/>
				<NumberField
					label={tc.tc_length()}
					unit="mm"
					bind:value={p.lengthA}
					min={5}
					max={150}
					step={1}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_hose_adapter_group_end_b()}>
				<ChoiceField
					label={m.t_hose_adapter_fit()}
					bind:value={p.fitB}
					options={FITS}
					hint={fitHint(p.fitB)}
				/>
				<NumberField
					label={tc.tc_diameter()}
					unit="mm"
					bind:value={p.diameterB}
					min={4}
					max={200}
					step={0.5}
				/>
				<NumberField
					label={tc.tc_length()}
					unit="mm"
					bind:value={p.lengthB}
					min={5}
					max={150}
					step={1}
				/>
			</FieldGroup>
			{#if p.kind === 'elbow'}
				<FieldGroup title={m.t_hose_adapter_group_bend()}>
					<NumberField
						label={m.t_hose_adapter_angle()}
						unit="°"
						bind:value={p.angle}
						min={15}
						max={180}
						step={5}
					/>
					<NumberField
						label={m.t_hose_adapter_bend()}
						unit="mm"
						bind:value={p.bend}
						min={10}
						max={300}
						step={1}
						hint={m.t_hose_adapter_bend_hint()}
					/>
				</FieldGroup>
			{/if}
		{/if}
		<FieldGroup title={tc.tc_wall()}>
			<NumberField
				label={tc.tc_wall_thickness()}
				unit="mm"
				bind:value={p.wall}
				min={1.2}
				max={6}
				step={0.1}
			/>
			{#if p.kind !== 'funnel'}
				{#if anyInside}
					<ToggleField
						label={m.t_hose_adapter_barbs()}
						bind:checked={p.barbs}
						hint={m.t_hose_adapter_barbs_hint()}
					/>
					{#if p.kind !== 'elbow'}
						<ToggleField
							label={m.t_hose_adapter_collar()}
							bind:checked={p.collar}
							hint={m.t_hose_adapter_collar_hint()}
						/>
					{/if}
				{/if}
				{#if p.fitA === 'outside' || p.fitB === 'outside'}
					<NumberField
						label={m.t_hose_adapter_clearance()}
						unit="mm"
						bind:value={p.clearance}
						min={0}
						max={1.5}
						step={0.05}
						hint={m.t_hose_adapter_clearance_hint()}
					/>
				{/if}
			{/if}
			<p class="text-xs text-neutral-400">{hoseSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
