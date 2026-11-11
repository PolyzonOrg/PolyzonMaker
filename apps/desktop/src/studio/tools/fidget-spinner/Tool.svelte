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
		SPINNER_DEFAULTS,
		SPINNER_PRESETS,
		spinnerCoins,
		spinnerHeader,
		spinnerModel,
		spinnerSummary,
		type SpinnerParams,
		type SpinnerWeight
	} from './model';
	import { currentLocale, num } from '$lib/i18n/current';
	import { listJoin } from '$lib/i18n/locale';
	import * as m from '$msg/tools/fidget-spinner';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<SpinnerParams>({ ...SPINNER_DEFAULTS });
	const model = $derived(spinnerModel(p));
	const source = $derived(toScad(model, spinnerHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const WEIGHTS: { value: SpinnerWeight; label: string }[] = [
		{ value: 'bearing608', label: m.t_fidget_spinner_weight_bearing() },
		{ value: 'nutM8', label: m.t_fidget_spinner_weight_nut() },
		{ value: 'coin', label: m.t_fidget_spinner_weight_coin() },
		{ value: 'none', label: m.t_fidget_spinner_weight_none() }
	];
	// The coins of the page language, a list rather than a sentence.
	const coinHint = m.t_fidget_spinner_coin_hint({
		coins: listJoin(
			spinnerCoins().map((c) => m.t_fidget_spinner_coin_size({ coin: c.name, d: num(c.d) })),
			currentLocale()
		)
	});

	function applyPreset(params: Partial<SpinnerParams>) {
		p = { ...SPINNER_DEFAULTS, ...params };
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
				build.value && downloadBytes(build.value, `spinner-${p.lobes}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each SPINNER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_fidget_spinner_group_spinner()}>
			<NumberField label={m.t_fidget_spinner_lobes()} bind:value={p.lobes} min={2} max={6} />
			<ChoiceField
				label={m.t_fidget_spinner_weights()}
				bind:value={p.weight}
				options={WEIGHTS}
				hint={m.t_fidget_spinner_weights_hint()}
			/>
			{#if p.weight === 'coin'}
				<NumberField
					label={m.t_fidget_spinner_coin()}
					unit="mm"
					bind:value={p.coin}
					min={12}
					max={32}
					step={0.1}
					hint={coinHint}
				/>
			{/if}
			<NumberField
				label={tc.tc_wall()}
				unit="mm"
				bind:value={p.wall}
				min={1.6}
				max={5}
				step={0.1}
			/>
			<p class="text-xs text-neutral-400">{spinnerSummary(p)}</p>
		</FieldGroup>
		<FieldGroup title={m.t_fidget_spinner_group_bearing()}>
			<NumberField
				label={m.t_fidget_spinner_clearance()}
				unit="mm"
				bind:value={p.clearance}
				min={0.2}
				max={0.5}
				step={0.05}
				hint={m.t_fidget_spinner_clearance_hint()}
			/>
			<ToggleField
				label={m.t_fidget_spinner_caps()}
				bind:checked={p.caps}
				hint={m.t_fidget_spinner_caps_hint()}
			/>
		</FieldGroup>
	{/snippet}
</ToolShell>
