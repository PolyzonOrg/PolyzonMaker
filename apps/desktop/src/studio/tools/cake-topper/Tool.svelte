<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, Layers } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, buildCsg3mf, disposeCsg, measureTexts, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import type { TextBox } from '$lib/tools/csg/evaluate';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import { showToast } from '$lib/toast';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/cake-topper';
	import {
		CAKE_TOPPER_DEFAULTS,
		CAKE_TOPPER_PRESETS,
		cakeTopperHeader,
		cakeTopperModel,
		cakeTopperSummary,
		cakeTopperTexts,
		type CakeTopperParams,
		cakeTopperColours
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<CakeTopperParams>({ ...CAKE_TOPPER_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	// The stakes and the line above follow the real lettering: measure, then build.
	const build = createBuild<
		CakeTopperParams,
		{ stl: Uint8Array; root: Node; boxes: (TextBox | null)[] }
	>(async (q, signal) => {
		const boxes = await measureTexts(cakeTopperTexts(q), signal);
		const root = cakeTopperModel(q, boxes);
		return { stl: await buildCsg(root, signal), root, boxes };
	}, 400);
	$effect(() => build.run(drawn));
	onMount(preloadCsg);
	const colours = $derived(cakeTopperColours(drawn, build.value?.boxes));
	let saving = $state(false);

	async function download3mf() {
		if (saving) return;
		saving = true;
		try {
			downloadBytes(await buildCsg3mf(colours, tool.title), 'topper.3mf', 'model/3mf');
		} catch (e) {
			showToast(e instanceof Error ? e.message : m.t_cake_topper_3mf_failed(), { kind: 'error' });
		} finally {
			saving = false;
		}
	}

	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const source = $derived(
		build.value ? toScad(build.value.root, cakeTopperHeader(drawn, build.value.boxes)) : null
	);

	function applyPreset(params: Partial<CakeTopperParams>) {
		p = { ...CAKE_TOPPER_DEFAULTS, ...params };
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
			onClick: () => build.value && downloadBytes(build.value.stl, 'topper.stl', 'model/stl')
		},
		...(colours.length > 1
			? [{ label: tc.tc_download_3mf_colours(), icon: Layers, onClick: () => void download3mf() }]
			: [])
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each CAKE_TOPPER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_inscription()}>
			<TextField
				label={m.t_cake_topper_big_line()}
				bind:value={p.title}
				maxlength={30}
				hint={m.t_cake_topper_big_line_hint()}
			/>
			<TextField
				label={m.t_cake_topper_top_line()}
				bind:value={p.top}
				maxlength={40}
				hint={m.t_cake_topper_top_line_hint()}
			/>
			<FontField bind:value={p.font} />
			<ToggleField
				label={tc.tc_bolder()}
				bind:checked={p.bold}
				hint={m.t_cake_topper_bolder_hint()}
			/>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={40}
				max={220}
				step={1}
				hint={m.t_cake_topper_width_hint()}
			/>
			<NumberField
				label={m.t_cake_topper_top_line_height()}
				unit="mm"
				bind:value={p.topCap}
				min={6}
				max={30}
				step={0.5}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_cake_topper_stakes_and_print()}>
			<NumberField label={m.t_cake_topper_stakes()} bind:value={p.stakes} min={1} max={3} />
			<NumberField
				label={m.t_cake_topper_stake_length()}
				unit="mm"
				bind:value={p.stakeLength}
				min={20}
				max={120}
				step={1}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.6}
				max={6}
				step={0.1}
			/>
			<ToggleField
				label={m.t_cake_topper_raised_letters()}
				bind:checked={p.relief}
				hint={m.t_cake_topper_raised_letters_hint()}
			/>
			<p class="text-xs text-neutral-400">{cakeTopperSummary(drawn, build.value?.boxes)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
