<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, Pause } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
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
	import * as m from '$msg/tools/nfc-tag';
	import * as tc from '$msg/tools/common';
	import {
		NFC_TAG_DEFAULTS,
		NFC_TAG_PRESETS,
		nfcPause,
		nfcTagHeader,
		nfcTagModel,
		nfcTagSummary,
		type NfcShape,
		type NfcTagParams,
		type NfcText
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<NfcTagParams>({ ...NFC_TAG_DEFAULTS });
	// Three lines in three fields; the model takes them joined.
	const fromText = (text: string) => [...text.split('\n'), '', '', ''].slice(0, 3);
	let lines = $state(fromText(NFC_TAG_DEFAULTS.text));
	$effect(() => {
		p.text = lines.filter((l) => l.trim()).join('\n');
	});
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(nfcTagModel(drawn));
	const source = $derived(toScad(model, nfcTagHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: { value: NfcShape; label: string }[] = [
		{ value: 'card', label: m.t_nfc_tag_shape_card() },
		{ value: 'stand', label: m.t_nfc_tag_shape_stand() },
		{ value: 'keychain', label: m.t_nfc_tag_shape_keychain() },
		{ value: 'round', label: m.t_nfc_tag_shape_round() }
	];
	const STYLES: { value: NfcText; label: string }[] = [
		{ value: 'raised', label: m.t_nfc_tag_style_raised() },
		{ value: 'engraved', label: m.t_nfc_tag_style_engraved() }
	];

	function applyPreset(params: Partial<NfcTagParams>) {
		p = { ...NFC_TAG_DEFAULTS, ...params };
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
			onClick: () => build.value && downloadBytes(build.value, `nfc-${p.shape}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each NFC_TAG_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_nfc_tag_group_tag()}>
			<ChoiceField
				label={m.t_nfc_tag_shape()}
				bind:value={p.shape}
				options={SHAPES}
				hint={p.shape === 'card'
					? m.t_nfc_tag_shape_card_hint()
					: p.shape === 'stand'
						? m.t_nfc_tag_shape_stand_hint()
						: undefined}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={1.2}
				max={8}
				step={0.1}
				hint={m.t_nfc_tag_thickness_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_nfc_tag_group_sticker()}>
			<NumberField
				label={tc.tc_diameter()}
				unit="mm"
				bind:value={p.tag}
				min={15}
				max={p.shape === 'card' ? 40 : 50}
				hint={m.t_nfc_tag_diameter_hint()}
			/>
			<NumberField
				label={m.t_nfc_tag_sticker_thickness()}
				unit="mm"
				bind:value={p.tagThickness}
				min={0.1}
				max={1.5}
				step={0.1}
				hint={m.t_nfc_tag_sticker_thickness_hint()}
			/>
			<div class="notice">
				<Pause size={16} aria-hidden="true" />
				<span>{nfcPause(p)}</span>
			</div>
			<p class="text-xs text-neutral-400">
				{m.t_nfc_tag_metal_note()}
			</p>
		</FieldGroup>
		<FieldGroup title={tc.tc_inscription()}>
			{#each lines as line, i (i)}
				{#if i === 0 || lines[i - 1].trim() || line.trim()}
					<TextField label={m.t_nfc_tag_line({ n: i + 1 })} bind:value={lines[i]} maxlength={32} />
				{/if}
			{/each}
			<ChoiceField label={tc.tc_inscription()} bind:value={p.style} options={STYLES} />
			<ToggleField
				label={m.t_nfc_tag_mark()}
				bind:checked={p.mark}
				hint={m.t_nfc_tag_mark_hint()}
			/>
			<FontField bind:value={p.font} />
			<p class="text-xs text-neutral-400">{nfcTagSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
