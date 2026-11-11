<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, Layers } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, buildCsg3mf, disposeCsg, measureTexts, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import { showToast } from '$lib/toast';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/medal';
	import {
		ARC_REF_CAP,
		arcLetters,
		MEDAL_DEFAULTS,
		MEDAL_PRESETS,
		medalHeader,
		medalModel,
		medalSummary,
		type ArcWidths,
		type MedalMount,
		type MedalParams,
		type MedalShape,
		medalColours
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<MedalParams>({ ...MEDAL_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	// The arcs follow the real letters: measure each one, then build.
	const build = createBuild<MedalParams, { stl: Uint8Array; root: Node; widths: ArcWidths }>(
		async (q, signal) => {
			const letters = arcLetters(q);
			const boxes = letters.length
				? await measureTexts(
						letters.map((l) => l.node),
						signal
					)
				: [];
			const widths: ArcWidths = {};
			letters.forEach(({ ch }, i) => {
				const b = boxes[i];
				if (b) widths[ch] = (b.x1 - b.x0) / ARC_REF_CAP;
			});
			const root = medalModel(q, widths);
			return { stl: await buildCsg(root, signal), root, widths };
		},
		450
	);
	$effect(() => build.run(drawn));
	onMount(preloadCsg);
	const source = $derived(build.value ? toScad(build.value.root, medalHeader(drawn)) : null);
	const colours = $derived(medalColours(drawn, build.value?.widths));
	let saving = $state(false);

	async function download3mf() {
		if (saving) return;
		saving = true;
		try {
			downloadBytes(await buildCsg3mf(colours, tool.title), 'medal.3mf', 'model/3mf');
		} catch (e) {
			showToast(e instanceof Error ? e.message : m.t_medal_3mf_failed(), { kind: 'error' });
		} finally {
			saving = false;
		}
	}

	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: readonly { value: MedalShape; label: string }[] = [
		{ value: 'round', label: m.t_medal_shape_round() },
		{ value: 'star', label: m.t_medal_shape_star() }
	];
	const MOUNTS: readonly { value: MedalMount; label: string }[] = [
		{ value: 'ribbon', label: m.t_medal_mount_ribbon() },
		{ value: 'loop', label: m.t_medal_mount_loop() },
		{ value: 'none', label: m.t_medal_mount_token() }
	];

	function applyPreset(params: Partial<MedalParams>) {
		p = { ...MEDAL_DEFAULTS, ...params };
	}
</script>

<ToolShell
	{tool}
	stl={build.value?.stl ?? null}
	busy={build.busy}
	error={build.error}
	scadSource={source}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () => build.value && downloadBytes(build.value.stl, 'medal.stl', 'model/stl')
		},
		...(colours.length > 1
			? [{ label: tc.tc_download_3mf_colours(), icon: Layers, onClick: () => void download3mf() }]
			: [])
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each MEDAL_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_medal_medal()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			<NumberField
				label={tc.tc_diameter()}
				unit="mm"
				bind:value={p.diameter}
				min={25}
				max={120}
				step={1}
			/>
			<ChoiceField label={tc.tc_mount()} bind:value={p.mount} options={MOUNTS} />
			{#if p.shape === 'round'}
				<ToggleField label={m.t_medal_laurel()} bind:checked={p.laurel} />
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_medal_inscriptions()}>
			<TextField
				label={m.t_medal_centre()}
				bind:value={p.centre}
				maxlength={12}
				hint={m.t_medal_centre_hint()}
			/>
			<TextField label={m.t_medal_under()} bind:value={p.under} maxlength={20} />
			{#if p.shape === 'round'}
				<TextField label={m.t_medal_arc_top()} bind:value={p.top} maxlength={40} />
				<TextField label={m.t_medal_arc_bottom()} bind:value={p.bottom} maxlength={40} />
			{/if}
			<FontField bind:value={p.font} />
			<ToggleField label={tc.tc_bolder()} bind:checked={p.bold} />
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.6}
				max={6}
				step={0.1}
			/>
			<NumberField
				label={tc.tc_relief_height()}
				unit="mm"
				bind:value={p.relief}
				min={0.4}
				max={3}
				step={0.1}
			/>
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={10} />
			<p class="text-xs text-neutral-400">{medalSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
