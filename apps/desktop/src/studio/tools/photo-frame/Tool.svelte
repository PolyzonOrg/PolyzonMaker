<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, TriangleAlert } from 'lucide-svelte';
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
	import { showToast } from '$lib/toast';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		PHOTO_FRAME_DEFAULTS,
		PHOTO_FRAME_PRESETS,
		photoFrameExtent,
		photoFrameHeader,
		photoFrameLayout,
		photoFrameModel,
		photoFrameParts,
		photoFrameSummary,
		type PhotoFrameParams,
		type PhotoSize
	} from './model';
	import { currentLocale, num } from '$lib/i18n/current';
	import { listJoin, quote, sentenceGap } from '$lib/i18n/locale';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/photo-frame';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<PhotoFrameParams>({ ...PHOTO_FRAME_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(photoFrameModel(drawn));
	const source = $derived(toScad(model, photoFrameHeader(drawn)));
	const longest = $derived(Math.ceil(Math.max(...photoFrameLayout(p).outer)));
	const extent = $derived(photoFrameExtent(p).map((v) => Math.ceil(v)));
	// All parts at once need a bigger bed than the frame alone: then they download one by one.
	const split = $derived(Math.max(...extent) > 220);
	const parts = $derived(photoFrameParts(drawn));
	let saving = $state(false);
	async function downloadPart(i: number) {
		if (saving) return;
		saving = true;
		try {
			const part = parts[i];
			const stl = await buildCsg(part.node, new AbortController().signal);
			downloadBytes(stl, `${m.t_photo_frame_filename()}-${p.size}-${part.file}.stl`, 'model/stl');
		} catch (e) {
			showToast(e instanceof Error ? e.message : m.t_photo_frame_stl_failed(), { kind: 'error' });
		} finally {
			saving = false;
		}
	}
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SIZES: { value: PhotoSize; label: string }[] = [
		{ value: '10x15', label: '10 × 15' },
		{ value: '13x18', label: '13 × 18' },
		{ value: '15x21', label: '15 × 21' },
		{ value: '10x10', label: '10 × 10' },
		{ value: 'instax-mini', label: 'Instax mini' },
		{ value: 'instax-square', label: 'Instax square' },
		{ value: 'instax-wide', label: 'Instax wide' },
		{ value: 'custom', label: m.t_photo_frame_size_custom() }
	];
	const SIDES: { value: 'portrait' | 'landscape'; label: string }[] = [
		{ value: 'portrait', label: m.t_photo_frame_side_portrait() },
		{ value: 'landscape', label: m.t_photo_frame_side_landscape() }
	];
	let side = $state<'portrait' | 'landscape'>('portrait');
	$effect(() => {
		p.landscape = side === 'landscape';
	});

	function applyPreset(params: Partial<PhotoFrameParams>) {
		p = { ...PHOTO_FRAME_DEFAULTS, ...params };
		side = p.landscape ? 'landscape' : 'portrait';
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
				downloadBytes(build.value, `${m.t_photo_frame_filename()}-${p.size}.stl`, 'model/stl')
		},
		...(split
			? parts.map((part, i) => ({
					label: part.name,
					icon: Download,
					onClick: () => void downloadPart(i)
				}))
			: [])
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each PHOTO_FRAME_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_photo_frame_group_photo()}>
			<ChoiceField label={tc.tc_size()} bind:value={p.size} options={SIZES} />
			{#if p.size === 'custom'}
				<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={30} max={250} />
				<NumberField label={tc.tc_height()} unit="mm" bind:value={p.height} min={30} max={250} />
			{:else}
				<ChoiceField label={m.t_photo_frame_side()} bind:value={side} options={SIDES} />
			{/if}
			<NumberField
				label={m.t_photo_frame_glass()}
				unit="mm"
				bind:value={p.glass}
				min={0}
				max={3}
				step={0.5}
				hint={m.t_photo_frame_glass_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_frame()}>
			<NumberField
				label={m.t_photo_frame_border()}
				unit="mm"
				bind:value={p.border}
				min={10}
				max={40}
			/>
			<NumberField
				label={m.t_photo_frame_overlap()}
				unit="mm"
				bind:value={p.overlap}
				min={1}
				max={6}
				step={0.5}
				hint={m.t_photo_frame_overlap_hint()}
			/>
			<ToggleField label={m.t_photo_frame_bevel()} bind:checked={p.bevel} />
			<TextField label={m.t_photo_frame_caption()} bind:value={p.caption} maxlength={40} />
			{#if p.caption}
				<FontField bind:value={p.font} />
			{/if}
			<ToggleField
				label={m.t_photo_frame_feet()}
				bind:checked={p.feet}
				hint={m.t_photo_frame_feet_hint()}
			/>
			<p class="text-xs text-neutral-400">
				{photoFrameSummary(p) + sentenceGap(currentLocale()) + m.t_photo_frame_print_note()}
			</p>
			{#if longest > 220}
				<div class="notice notice-warning">
					<TriangleAlert size={16} aria-hidden="true" />
					<span>{m.t_photo_frame_bed_too_small({ size: num(longest) })}</span>
				</div>
			{:else if split}
				<p class="hint">
					{m.t_photo_frame_split_hint({
						width: num(extent[0]),
						height: num(extent[1]),
						buttons: listJoin(
							parts.map((x) => quote(x.name, currentLocale())),
							currentLocale()
						)
					})}
				</p>
			{/if}
		</FieldGroup>
	{/snippet}
</ToolShell>
