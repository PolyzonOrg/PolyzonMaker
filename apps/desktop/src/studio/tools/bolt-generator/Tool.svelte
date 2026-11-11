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
		BOLT_DEFAULTS,
		BOLT_PRESETS,
		METRIC,
		METRIC_SIZES,
		boltHeader,
		boltModel,
		boltSpec,
		boltSummary,
		type BoltKind,
		type BoltParams,
		type HeadKind,
		type SpacerShape
	} from './model';
	import { num } from '$lib/i18n/current';
	import * as m from '$msg/tools/bolt-generator';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BoltParams>({ ...BOLT_DEFAULTS });
	const model = $derived(boltModel(p));
	const source = $derived(toScad(model, boltHeader(p)));
	const spec = $derived(boltSpec(p));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: readonly { value: BoltKind; label: string }[] = [
		{ value: 'bolt', label: m.t_bolt_generator_kind_bolt() },
		{ value: 'nut', label: m.t_bolt_generator_kind_nut() },
		{ value: 'pair', label: m.t_bolt_generator_kind_pair() },
		{ value: 'washer', label: m.t_bolt_generator_kind_washer() },
		{ value: 'spacer', label: m.t_bolt_generator_kind_spacer() },
		{ value: 'rod', label: m.t_bolt_generator_kind_rod() }
	];
	const SIZES: { value: string; label: string }[] = [
		...METRIC_SIZES.map((s) => ({ value: s, label: s })),
		{ value: 'custom', label: m.t_bolt_generator_size_custom() }
	];
	const HEADS: readonly { value: HeadKind; label: string }[] = [
		{ value: 'hex', label: m.t_bolt_generator_head_hex() },
		{ value: 'socket', label: m.t_bolt_generator_head_socket() },
		{ value: 'countersunk', label: m.t_bolt_generator_head_countersunk() }
	];
	const SPACERS: readonly { value: SpacerShape; label: string }[] = [
		{ value: 'round', label: m.t_bolt_generator_spacer_round() },
		{ value: 'hex', label: m.t_bolt_generator_spacer_hex() }
	];
	const threaded = $derived(p.kind === 'bolt' || p.kind === 'pair' || p.kind === 'rod');
	const hasFine = $derived(p.size !== 'custom' && !!METRIC[p.size]?.fine);
	const small = $derived(spec.size.d <= 5 && p.kind !== 'washer' && p.kind !== 'spacer');
	const fileName = $derived(
		`${p.kind === 'pair' ? 'bolt-nut' : p.kind}-${spec.name.split(' ')[0].toLowerCase()}.stl`
	);

	function applyPreset(params: Partial<BoltParams>) {
		p = { ...BOLT_DEFAULTS, ...params };
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
			onClick: () => build.value && downloadBytes(build.value, fileName, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each BOLT_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup>
			<ChoiceField label={tc.tc_what_to_print()} bind:value={p.kind} options={KINDS} />
		</FieldGroup>
		<FieldGroup title={m.t_bolt_generator_group_thread()}>
			<ChoiceField label={tc.tc_size()} bind:value={p.size} options={SIZES} />
			{#if p.size === 'custom'}
				<NumberField
					label={tc.tc_diameter()}
					unit="mm"
					bind:value={p.diameter}
					min={3}
					max={120}
					step={0.5}
				/>
				<NumberField
					label={m.t_bolt_generator_pitch()}
					unit="mm"
					bind:value={p.pitch}
					min={0.5}
					max={Math.max(0.5, p.diameter / 4)}
					step={0.05}
					hint={m.t_bolt_generator_pitch_hint()}
				/>
			{:else if hasFine}
				<ToggleField
					label={m.t_bolt_generator_fine()}
					bind:checked={p.fine}
					hint={m.t_bolt_generator_fine_hint({
						fine: num(METRIC[p.size].fine ?? 0, 4),
						coarse: num(METRIC[p.size].pitch, 4)
					})}
				/>
			{/if}
			{#if small}
				<p class="hint">
					{m.t_bolt_generator_small_hint()}
				</p>
			{/if}
		</FieldGroup>
		{#if p.kind === 'bolt' || p.kind === 'pair'}
			<FieldGroup title={m.t_bolt_generator_group_head()}>
				<ChoiceField label={tc.tc_shape()} bind:value={p.head} options={HEADS} />
			</FieldGroup>
		{/if}
		{#if threaded || p.kind === 'spacer'}
			<FieldGroup title={m.t_bolt_generator_group_dimensions()}>
				<NumberField
					label={p.kind === 'spacer' ? tc.tc_length() : m.t_bolt_generator_thread_length()}
					unit="mm"
					bind:value={p.length}
					min={2}
					max={300}
					step={1}
				/>
				{#if p.kind === 'spacer'}
					<ChoiceField label={tc.tc_shape()} bind:value={p.spacerShape} options={SPACERS} />
					<NumberField
						label={p.spacerShape === 'hex'
							? m.t_bolt_generator_spacer_across_flats()
							: m.t_bolt_generator_spacer_outer()}
						unit="mm"
						bind:value={p.spacerOuter}
						min={4}
						max={150}
						step={0.5}
					/>
				{/if}
			</FieldGroup>
		{/if}
		{#if p.kind === 'washer'}
			<FieldGroup title={m.t_bolt_generator_group_dimensions()}>
				<NumberField
					label={tc.tc_thickness()}
					unit="mm"
					bind:value={p.washerThickness}
					min={0.4}
					max={20}
					step={0.2}
					hint={m.t_bolt_generator_washer_thickness_hint({ value: num(spec.size.w[2], 4) })}
				/>
			</FieldGroup>
		{/if}
		<FieldGroup title={tc.tc_print()}>
			<NumberField
				label={p.kind === 'washer' || p.kind === 'spacer'
					? m.t_bolt_generator_hole_clearance()
					: m.t_bolt_generator_thread_clearance()}
				unit="mm"
				bind:value={p.clearance}
				min={0}
				max={1}
				step={0.05}
				hint={p.kind === 'washer' || p.kind === 'spacer'
					? m.t_bolt_generator_hole_clearance_hint()
					: m.t_bolt_generator_thread_clearance_hint()}
			/>
			<p class="text-xs text-neutral-400">{boltSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
