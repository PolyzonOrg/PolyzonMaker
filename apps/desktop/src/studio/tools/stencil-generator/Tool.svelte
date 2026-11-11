<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Download, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TraceFields from '$lib/tools/shared/TraceFields.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/stencil-generator';
	import { cleanText, fileSlug, stackLines, WEIGHT_OPTIONS } from '$lib/tools/shared/glyphs';
	import { createWorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import { imageShape, svgShape, textLines } from '$lib/tools/shared/shape-input';
	import { usableFont } from '$lib/tools/shared/fonts';
	import FontField from '$lib/components/tools/FontField.svelte';
	import { shapeById, SHAPES } from '$lib/tools/shared/shapes';
	import { dropSmall, fitRings } from '$lib/tools/shared/trace';
	import {
		STENCIL_DEFAULTS,
		STENCIL_LIMITS as L,
		STENCIL_PRESETS,
		type StencilJob,
		type StencilParams,
		type StencilSource
	} from './model';
	import type { StencilOutput } from './stencil.worker';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<StencilParams>(structuredClone(STENCIL_DEFAULTS));
	let svgFile = $state.raw<File | null>(null);
	let imageFile = $state.raw<File | null>(null);

	interface Input {
		p: StencilParams;
		svgFile: File | null;
		imageFile: File | null;
	}
	interface Output extends StencilOutput {
		negative: boolean;
		name: string;
	}

	const baseName = (file: File) => file.name.replace(/\.\w+$/, '');

	/** The drawing for the chosen source; null while there is nothing to draw. */
	async function drawingRings({ p, svgFile, imageFile }: Input, signal: AbortSignal) {
		if (p.source === 'text') {
			const lines = [cleanText(p.text, 24), cleanText(p.line2, 24)];
			const rings = stackLines(await textLines(lines, signal, usableFont(p.font), p.weight));
			return rings.length
				? { rings, name: fileSlug(lines.join(' '), m.t_stencil_generator_text_filename()) }
				: null;
		}
		if (p.source === 'shape') return { rings: shapeById(p.shape).rings(), name: p.shape };
		if (p.source === 'svg') {
			if (!svgFile) return null;
			const rings = fitRings(await svgShape(svgFile, signal), p.size);
			return { rings, name: fileSlug(baseName(svgFile), 'svg') };
		}
		if (!imageFile) return null;
		const traced = fitRings(await imageShape(imageFile, p.trace, signal), p.size);
		return {
			rings: dropSmall(traced, p.minDetail),
			name: fileSlug(baseName(imageFile), m.t_stencil_generator_picture_filename())
		};
	}

	const worker = createWorkerRunner<StencilJob, StencilOutput>(
		() =>
			new Worker(new URL('./stencil.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('stencil')
			})
	);
	const build = createBuild<Input, Output | null>(async (input, signal) => {
		const drawing = await drawingRings(input, signal);
		if (!drawing) return null;
		const { p } = input;
		const kind = p.source === 'text' ? 'glyphs' : p.source === 'shape' ? 'shape' : 'outline';
		const out = await worker.run({ p, rings: drawing.rings, kind }, signal);
		return {
			...out,
			negative: p.negative,
			name: `${m.t_stencil_generator_filename()}-${drawing.name}`
		};
	}, 400);
	$effect(() => build.run({ p: $state.snapshot(p), svgFile, imageFile }));
	onDestroy(() => {
		build.cancel();
		worker.dispose();
	});

	const result = $derived(build.value);
	const sources: { value: StencilSource; label: string }[] = [
		{ value: 'text', label: tc.tc_inscription() },
		{ value: 'shape', label: m.t_stencil_generator_source_shape() },
		{ value: 'svg', label: m.t_stencil_generator_source_svg() },
		{ value: 'image', label: tc.tc_picture() }
	];
	const shapeOptions = SHAPES.map((s) => ({ value: s.id, label: s.label }));

	function applyPreset(params: Partial<StencilParams>) {
		p = { ...structuredClone(STENCIL_DEFAULTS), ...params };
	}
</script>

<ToolShell
	{tool}
	stl={result?.stl ?? null}
	busy={build.busy}
	error={build.error}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () => result && downloadBytes(result.stl, `${result.name}.stl`, 'model/stl')
		},
		{
			label: m.t_stencil_generator_download_svg(),
			icon: Download,
			onClick: () => result && downloadBytes(result.svg, `${result.name}.svg`, 'image/svg+xml')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={m.t_stencil_generator_group_examples()}>
			<div class="flex flex-wrap gap-2">
				{#each STENCIL_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>

		<FieldGroup title={m.t_stencil_generator_group_drawing()}>
			<ChoiceField label={m.t_stencil_generator_source()} bind:value={p.source} options={sources} />
			{#if p.source === 'text'}
				<TextField
					label={tc.tc_inscription()}
					bind:value={p.text}
					maxlength={24}
					placeholder={m.t_stencil_generator_text_placeholder()}
				/>
				<TextField
					label={m.t_stencil_generator_line2()}
					bind:value={p.line2}
					maxlength={24}
					placeholder={m.t_stencil_generator_line2_placeholder()}
				/>
				<ChoiceField
					label={m.t_stencil_generator_weight()}
					bind:value={p.weight}
					options={WEIGHT_OPTIONS}
					hint={m.t_stencil_generator_weight_hint()}
				/>
				<FontField bind:value={p.font} />
				<NumberField
					label={m.t_stencil_generator_letter_height()}
					unit="mm"
					bind:value={p.letterHeight}
					min={L.letterHeight[0]}
					max={L.letterHeight[1]}
					step={L.letterHeight[2]}
				/>
			{:else if p.source === 'shape'}
				<ChoiceField
					label={m.t_stencil_generator_shape()}
					bind:value={p.shape}
					options={shapeOptions}
				/>
			{:else if p.source === 'svg'}
				<FileField
					label={m.t_stencil_generator_svg_pick()}
					accept=".svg,image/svg+xml"
					hint={m.t_stencil_generator_svg_hint()}
					fileName={svgFile?.name ?? null}
					onfile={(f) => (svgFile = f)}
				/>
			{:else}
				<FileField
					label={m.t_stencil_generator_image_pick()}
					accept="image/png,image/jpeg,image/webp,image/bmp"
					hint={m.t_stencil_generator_image_hint()}
					fileName={imageFile?.name ?? null}
					onfile={(f) => (imageFile = f)}
				/>
				<TraceFields bind:value={p.trace} bind:minDetail={p.minDetail} />
			{/if}
			{#if p.source !== 'text'}
				<NumberField
					label={m.t_stencil_generator_size()}
					unit="mm"
					bind:value={p.size}
					min={L.size[0]}
					max={L.size[1]}
					step={L.size[2]}
				/>
			{/if}
			<ToggleField
				label={m.t_stencil_generator_mirror()}
				bind:checked={p.mirror}
				hint={m.t_stencil_generator_mirror_hint()}
			/>
		</FieldGroup>

		<FieldGroup title={m.t_stencil_generator_group_bridges()}>
			<ChoiceField
				label={m.t_stencil_generator_bridges()}
				bind:value={p.bridges}
				options={[
					{ value: 'none', label: tc.tc_none() },
					{ value: 'top', label: m.t_stencil_generator_bridges_top() },
					{ value: 'both', label: m.t_stencil_generator_bridges_both() }
				]}
				hint={p.negative
					? m.t_stencil_generator_bridges_negative_hint()
					: m.t_stencil_generator_bridges_hint()}
			/>
			{#if p.bridges !== 'none'}
				<NumberField
					label={m.t_stencil_generator_bridge_width()}
					unit="mm"
					bind:value={p.bridgeWidth}
					min={L.bridgeWidth[0]}
					max={L.bridgeWidth[1]}
					step={L.bridgeWidth[2]}
				/>
			{/if}
			{#if result}
				<p class="text-xs text-neutral-400">
					{p.negative
						? m.t_stencil_generator_islands_negative({
								islands: result.islands,
								bridges: result.bridges
							})
						: m.t_stencil_generator_islands({ islands: result.islands, bridges: result.bridges })}
				</p>
				{#if result.islands > 0 && result.bridges === 0}
					<div class="notice notice-warning" role="status">
						<TriangleAlert size={16} aria-hidden="true" />
						<p>
							{p.negative
								? m.t_stencil_generator_no_bridges_negative()
								: m.t_stencil_generator_no_bridges()}
						</p>
					</div>
				{/if}
			{/if}
			<ToggleField
				label={m.t_stencil_generator_negative()}
				bind:checked={p.negative}
				hint={m.t_stencil_generator_negative_hint()}
			/>
			{#if p.negative}
				<NumberField
					label={tc.tc_frame()}
					unit="mm"
					bind:value={p.frame}
					min={L.frame[0]}
					max={L.frame[1]}
					step={L.frame[2]}
				/>
			{/if}
		</FieldGroup>

		<FieldGroup title={m.t_stencil_generator_group_sheet()}>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={L.thickness[0]}
				max={L.thickness[1]}
				step={L.thickness[2]}
			/>
			<NumberField
				label={m.t_stencil_generator_margin()}
				unit="mm"
				bind:value={p.margin}
				min={L.margin[0]}
				max={L.margin[1]}
				step={L.margin[2]}
			/>
			<ChoiceField
				label={tc.tc_shape()}
				bind:value={p.plate}
				options={[
					{ value: 'rect', label: m.t_stencil_generator_plate_rect() },
					{ value: 'circle', label: m.t_stencil_generator_plate_circle() },
					{ value: 'oval', label: m.t_stencil_generator_plate_oval() }
				]}
			/>
			{#if p.plate === 'rect'}
				<NumberField
					label={tc.tc_corner_radius()}
					unit="mm"
					bind:value={p.radius}
					min={L.radius[0]}
					max={L.radius[1]}
					step={L.radius[2]}
				/>
			{/if}
			<ToggleField label={m.t_stencil_generator_hangers()} bind:checked={p.hangers} />
			{#if p.hangers}
				<NumberField
					label={tc.tc_hole_diameter()}
					unit="mm"
					bind:value={p.hangerDiameter}
					min={L.hangerDiameter[0]}
					max={L.hangerDiameter[1]}
					step={L.hangerDiameter[2]}
				/>
			{/if}
			<p class="hint">{m.t_stencil_generator_print_note()}</p>
		</FieldGroup>
	{/snippet}
	{#snippet empty()}
		{#if p.source === 'text'}
			{m.t_stencil_generator_empty_text()}
		{:else if p.source === 'svg'}
			{m.t_stencil_generator_empty_svg()}
		{:else}
			{m.t_stencil_generator_empty_image()}
		{/if}
	{/snippet}
</ToolShell>
