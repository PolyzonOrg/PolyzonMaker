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
	import { num } from '$lib/i18n/current';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/lens-cap';
	import {
		FILTER_SIZES,
		LENS_CAP_DEFAULTS,
		LENS_CAP_PRESETS,
		lensCapHeader,
		lensCapModel,
		lensCapSummary,
		type LensCapParams,
		type LensFit
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<LensCapParams>({ ...LENS_CAP_DEFAULTS });
	const model = $derived(lensCapModel(p));
	const source = $derived(toScad(model, lensCapHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const FITS: readonly { value: LensFit; label: string }[] = [
		{ value: 'thread', label: m.t_lens_cap_fit_thread() },
		{ value: 'over', label: m.t_lens_cap_fit_over() }
	];
	const SIZES = FILTER_SIZES.map((s) => ({
		value: s as number,
		label: num(s)
	}));

	// In the thread mode the size is one of the filter sizes: snap to the nearest.
	$effect(() => {
		if (p.fit !== 'thread' || (FILTER_SIZES as readonly number[]).includes(p.diameter)) return;
		const d = p.diameter;
		p.diameter = FILTER_SIZES.reduce(
			(a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a),
			FILTER_SIZES[0]
		);
	});

	function applyPreset(params: Partial<LensCapParams>) {
		p = { ...LENS_CAP_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_lens_cap_filename()}-${p.diameter}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each LENS_CAP_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_lens_cap_group_lens()}>
			<ChoiceField label={m.t_lens_cap_fit()} bind:value={p.fit} options={FITS} />
			{#if p.fit === 'thread'}
				<ChoiceField
					label={m.t_lens_cap_thread()}
					bind:value={p.diameter}
					options={SIZES}
					hint={m.t_lens_cap_thread_hint()}
				/>
			{:else}
				<NumberField
					label={m.t_lens_cap_barrel()}
					unit="mm"
					bind:value={p.diameter}
					min={20}
					max={150}
					step={0.5}
					hint={m.t_lens_cap_barrel_hint()}
				/>
			{/if}
			<NumberField
				label={m.t_lens_cap_adjust()}
				unit="mm"
				bind:value={p.adjust}
				min={-1}
				max={1}
				step={0.05}
				hint={m.t_lens_cap_adjust_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_lens_cap_group_cap()}>
			<ToggleField label={m.t_lens_cap_loop()} bind:checked={p.loop} />
			<ToggleField label={m.t_lens_cap_label()} bind:checked={p.label} />
			<p class="text-xs text-neutral-400">{lensCapSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
