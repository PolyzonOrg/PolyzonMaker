<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/braille-sign';
	import {
		BRAILLE_SIGN_DEFAULTS,
		BRAILLE_SIGN_PRESETS,
		brailleSignHeader,
		brailleSignModel,
		brailleSignSummary,
		type BrailleSignParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BrailleSignParams>({ ...BRAILLE_SIGN_DEFAULTS });
	// Three lines in three fields; the model takes them joined.
	const fromText = (text: string) => [...text.split('\n'), '', '', ''].slice(0, 3);
	let lines = $state(fromText(BRAILLE_SIGN_DEFAULTS.text));
	$effect(() => {
		p.text = lines.filter((l) => l.trim()).join('\n');
	});
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(brailleSignModel(drawn));
	const source = $derived(toScad(model, brailleSignHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	function applyPreset(params: Partial<BrailleSignParams>) {
		p = { ...BRAILLE_SIGN_DEFAULTS, ...params };
		lines = fromText(p.text);
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
				build.value && downloadBytes(build.value, `${m.t_braille_sign_filename()}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each BRAILLE_SIGN_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_inscription()}>
			<TextField label={m.t_braille_sign_line({ n: 1 })} bind:value={lines[0]} maxlength={40} />
			{#if lines[0].trim() || lines[1].trim()}
				<TextField label={m.t_braille_sign_line({ n: 2 })} bind:value={lines[1]} maxlength={40} />
			{/if}
			{#if lines[1].trim() || lines[2].trim()}
				<TextField label={m.t_braille_sign_line({ n: 3 })} bind:value={lines[2]} maxlength={40} />
			{/if}
			<p class="text-xs text-neutral-400">{m.t_braille_sign_braille_note()}</p>
			<FontField bind:value={p.font} />
			<NumberField
				label={tc.tc_letter_height()}
				unit="mm"
				bind:value={p.cap}
				min={8}
				max={50}
				hint={m.t_braille_sign_letters_hint()}
			/>
			<NumberField
				label={m.t_braille_sign_letter_relief()}
				unit="mm"
				bind:value={p.relief}
				min={0.6}
				max={2}
				step={0.1}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_braille_sign_plate()}>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={40}
				max={300}
				hint={m.t_braille_sign_width_hint()}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.6}
				max={8}
				step={0.2}
			/>
			<NumberField
				label={m.t_braille_sign_rounding()}
				unit="mm"
				bind:value={p.radius}
				min={0}
				max={20}
				step={0.5}
			/>
			<ToggleField
				label={m.t_braille_sign_screw_holes()}
				bind:checked={p.holes}
				hint={m.t_braille_sign_screw_holes_hint()}
			/>
			<p class="text-xs text-neutral-400">{brailleSignSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
