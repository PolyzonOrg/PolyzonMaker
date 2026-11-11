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
	import { buildCsg, buildCsg3mf, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import { showToast } from '$lib/toast';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/letter-beads';
	import {
		LETTER_BEADS_DEFAULTS,
		LETTER_BEADS_PRESETS,
		letterBeadsHeader,
		letterBeadsModel,
		letterBeadsSummary,
		type BeadLetter,
		type BeadShape,
		type LetterBeadsParams,
		letterBeadsColours
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<LetterBeadsParams>({ ...LETTER_BEADS_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(letterBeadsModel(drawn));
	const source = $derived(toScad(model, letterBeadsHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	const colours = $derived(letterBeadsColours(drawn));
	let saving = $state(false);

	async function download3mf() {
		if (saving) return;
		saving = true;
		try {
			downloadBytes(
				await buildCsg3mf(colours, tool.title),
				`${m.t_letter_beads_filename()}.3mf`,
				'model/3mf'
			);
		} catch (e) {
			showToast(e instanceof Error ? e.message : m.t_letter_beads_3mf_failed(), {
				kind: 'error'
			});
		} finally {
			saving = false;
		}
	}

	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: readonly { value: BeadShape; label: string }[] = [
		{ value: 'square', label: m.t_letter_beads_shape_square() },
		{ value: 'round', label: m.t_letter_beads_shape_round() },
		{ value: 'hex', label: m.t_letter_beads_shape_hex() },
		{ value: 'heart', label: m.t_letter_beads_shape_heart() }
	];
	const LETTERS: readonly { value: BeadLetter; label: string }[] = [
		{ value: 'raised', label: m.t_letter_beads_letter_raised() },
		{ value: 'engraved', label: m.t_letter_beads_letter_engraved() }
	];

	function applyPreset(params: Partial<LetterBeadsParams>) {
		p = { ...LETTER_BEADS_DEFAULTS, ...params };
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
				build.value && downloadBytes(build.value, `${m.t_letter_beads_filename()}.stl`, 'model/stl')
		},
		...(colours.length > 1
			? [
					{
						label: tc.tc_download_3mf_colours(),
						icon: Layers,
						onClick: () => void download3mf()
					}
				]
			: [])
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each LETTER_BEADS_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_letter_beads_letters()}>
			<TextField
				label={tc.tc_text()}
				bind:value={p.text}
				maxlength={60}
				hint={m.t_letter_beads_text_hint()}
			/>
			<ToggleField label={m.t_letter_beads_upper()} bind:checked={p.upper} />
			<FontField bind:value={p.font} />
			<ToggleField label={tc.tc_bolder()} bind:checked={p.bold} />
			<ChoiceField label={m.t_letter_beads_letter()} bind:value={p.letter} options={LETTERS} />
		</FieldGroup>
		<FieldGroup title={m.t_letter_beads_bead()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			<NumberField label={tc.tc_size()} unit="mm" bind:value={p.size} min={6} max={25} step={0.5} />
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={3}
				max={15}
				step={0.5}
			/>
			<NumberField
				label={tc.tc_hole()}
				unit="mm"
				bind:value={p.hole}
				min={1}
				max={8}
				step={0.1}
				hint={m.t_letter_beads_hole_hint()}
			/>
			<NumberField label={m.t_letter_beads_sets()} bind:value={p.sets} min={1} max={10} />
			<p class="text-xs text-neutral-400">{letterBeadsSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
