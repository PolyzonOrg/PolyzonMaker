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
	import * as m from '$msg/tools/kumiko';
	import {
		clampKumiko,
		KUMIKO_DEFAULTS,
		KUMIKO_PRESETS,
		kumikoHeader,
		kumikoModel,
		kumikoSummary,
		type KumikoParams,
		type KumikoPattern,
		type KumikoShape
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<KumikoParams>({ ...KUMIKO_DEFAULTS });
	const model = $derived(kumikoModel(p));
	const source = $derived(toScad(model, kumikoHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const PATTERNS: { value: KumikoPattern; label: string }[] = [
		{ value: 'asanoha', label: m.t_kumiko_pattern_asanoha() },
		{ value: 'kikko', label: m.t_kumiko_pattern_kikko() },
		{ value: 'mitsukude', label: m.t_kumiko_pattern_mitsukude() },
		{ value: 'hishi', label: m.t_kumiko_pattern_hishi() }
	];
	function patternHint(pattern: KumikoPattern): string {
		switch (pattern) {
			case 'asanoha':
				return m.t_kumiko_pattern_asanoha_hint();
			case 'kikko':
				return m.t_kumiko_pattern_kikko_hint();
			case 'mitsukude':
				return m.t_kumiko_pattern_mitsukude_hint();
			case 'hishi':
				return m.t_kumiko_pattern_hishi_hint();
		}
	}
	const SHAPES: { value: KumikoShape; label: string }[] = [
		{ value: 'square', label: m.t_kumiko_shape_square() },
		{ value: 'rect', label: m.t_kumiko_shape_rect() },
		{ value: 'hexagon', label: m.t_kumiko_shape_hexagon() },
		{ value: 'circle', label: m.t_kumiko_shape_circle() }
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
				build.value && downloadBytes(build.value, `kumiko-${p.pattern}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each KUMIKO_PRESETS as preset (preset.id)}
					<button
						type="button"
						class="btn-ghost btn-s"
						onclick={() => (p = { ...KUMIKO_DEFAULTS, ...preset.params })}
					>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_pattern()}>
			<ChoiceField
				label={tc.tc_pattern()}
				bind:value={p.pattern}
				options={PATTERNS}
				hint={patternHint(p.pattern)}
			/>
			<NumberField
				label={m.t_kumiko_cell()}
				unit="mm"
				bind:value={p.cell}
				min={8}
				max={60}
				hint={m.t_kumiko_cell_hint()}
			/>
			<NumberField
				label={m.t_kumiko_strip()}
				unit="mm"
				bind:value={p.strip}
				min={0.8}
				max={4}
				step={0.1}
				hint={m.t_kumiko_strip_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_kumiko_panel()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			<NumberField
				label={p.shape === 'hexagon'
					? m.t_kumiko_width_corners()
					: p.shape === 'circle'
						? tc.tc_diameter()
						: tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={40}
				max={250}
			/>
			{#if p.shape === 'rect'}
				<NumberField label={tc.tc_height()} unit="mm" bind:value={p.height} min={40} max={250} />
			{/if}
			<NumberField
				label={tc.tc_frame()}
				unit="mm"
				bind:value={p.frame}
				min={2}
				max={Math.max(2, Math.floor(clampKumiko({ ...p, frame: 30 }).frame))}
			/>
			<NumberField
				label={m.t_kumiko_frame_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.6}
				max={12}
				step={0.2}
			/>
			<NumberField
				label={m.t_kumiko_lattice_height()}
				unit="mm"
				bind:value={p.lattice}
				min={1}
				max={p.thickness}
				step={0.2}
				hint={m.t_kumiko_lattice_hint()}
			/>
			<p class="text-xs text-neutral-400">{kumikoSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
