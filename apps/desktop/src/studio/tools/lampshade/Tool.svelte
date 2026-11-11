<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import type { BasketPattern } from '../basket/model';
	import {
		LAMPSHADE_DEFAULTS,
		LAMPSHADE_PRESETS,
		lampshadeHeader,
		lampshadeModel,
		lampshadeSummary,
		type LampForm,
		type LampHolder,
		type LampKind,
		type LampshadeParams
	} from './model';
	import * as m from '$msg/tools/lampshade';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<LampshadeParams>({ ...LAMPSHADE_DEFAULTS });
	const model = $derived(lampshadeModel(p));
	const source = $derived(toScad(model, lampshadeHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 450);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: { value: LampKind; label: string }[] = [
		{ value: 'pendant', label: m.t_lampshade_kind_pendant() },
		{ value: 'lantern', label: m.t_lampshade_kind_lantern() }
	];
	const FORMS: { value: LampForm; label: string }[] = [
		{ value: 'twist', label: m.t_lampshade_form_twist() },
		{ value: 'drum', label: m.t_lampshade_form_drum() }
	];
	const HOLDERS: { value: LampHolder; label: string }[] = [
		{ value: 'E27', label: 'E27' },
		{ value: 'E14', label: 'E14' }
	];
	const PATTERNS: { value: BasketPattern; label: string }[] = [
		{ value: 'hex', label: m.t_lampshade_pattern_hex() },
		{ value: 'diamond', label: m.t_lampshade_pattern_diamond() },
		{ value: 'slots', label: m.t_lampshade_pattern_slots() },
		{ value: 'none', label: m.t_lampshade_pattern_none() }
	];
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
				build.value && downloadBytes(build.value, `${p.kind}-${p.form}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each LAMPSHADE_PRESETS as preset (preset.id)}
					<button
						type="button"
						class="btn-ghost btn-s"
						onclick={() => (p = { ...LAMPSHADE_DEFAULTS, ...preset.params })}
					>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_lampshade_what()}>
			<ChoiceField label={m.t_lampshade_kind()} bind:value={p.kind} options={KINDS} />
			{#if p.kind === 'pendant'}
				<ChoiceField
					label={m.t_lampshade_holder()}
					bind:value={p.holder}
					options={HOLDERS}
					hint={m.t_lampshade_holder_hint()}
				/>
			{:else}
				<p class="text-xs text-neutral-400">
					{m.t_lampshade_lantern_note()}
				</p>
			{/if}
			<div class="notice notice-warning">
				<TriangleAlert size={16} aria-hidden="true" />
				<span>
					{p.kind === 'pendant' ? m.t_lampshade_warning_pendant() : m.t_lampshade_warning_lantern()}
				</span>
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_shape()}>
			<ChoiceField label={tc.tc_wall()} bind:value={p.form} options={FORMS} />
			<NumberField
				label={p.kind === 'pendant'
					? m.t_lampshade_diameter_holder()
					: m.t_lampshade_diameter_floor()}
				unit="mm"
				bind:value={p.diameter}
				min={p.kind === 'pendant' ? 90 : 55}
				max={250}
			/>
			{#if p.form === 'twist'}
				<NumberField
					label={p.kind === 'pendant'
						? m.t_lampshade_diameter_bottom()
						: m.t_lampshade_diameter_top()}
					unit="mm"
					bind:value={p.diameterEnd}
					min={p.diameter}
					max={250}
					hint={m.t_lampshade_diameter_end_hint()}
				/>
			{/if}
			<NumberField label={tc.tc_height()} unit="mm" bind:value={p.height} min={40} max={300} />
			<NumberField
				label={tc.tc_wall()}
				unit="mm"
				bind:value={p.wall}
				min={0.8}
				max={4}
				step={0.1}
				hint={m.t_lampshade_wall_hint()}
			/>
			{#if p.form === 'twist'}
				<NumberField label={m.t_lampshade_sides()} bind:value={p.sides} min={3} max={24} />
				<NumberField
					label={m.t_lampshade_twist()}
					unit="°"
					bind:value={p.twist}
					min={-180}
					max={180}
					step={5}
				/>
			{:else}
				<ChoiceField label={tc.tc_pattern()} bind:value={p.pattern} options={PATTERNS} />
				{#if p.pattern !== 'none'}
					<NumberField label={tc.tc_hole()} unit="mm" bind:value={p.hole} min={4} max={30} />
					<NumberField
						label={m.t_lampshade_bar()}
						unit="mm"
						bind:value={p.bar}
						min={1.6}
						max={10}
						step={0.2}
					/>
				{/if}
			{/if}
			<p class="text-xs text-neutral-400">
				{lampshadeSummary(p)}
				{p.kind === 'pendant' ? m.t_lampshade_print_pendant() : m.t_lampshade_print_lantern()}
			</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
