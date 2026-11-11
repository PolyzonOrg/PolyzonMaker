<script lang="ts">
	/**
	 * «Логотип по цветам» and «Пиксельная мозаика»: a picture in a few colours
	 * becomes a plate with a part per colour — for a multi-colour printer
	 * (3MF by colour) or a single nozzle with colour changes by layer.
	 */
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { Download, Layers } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import PartsViewport from '../booleans/PartsViewport.svelte';
	import { partsSize, type Part } from '../booleans/parts';
	import { createBuild, ToolError } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { downloadBytes, writeStl } from '$lib/tools/stl';
	import { createWorkerRunner, type WorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import { PART_COLOURS, write3mf } from '$lib/tools/shared/threemf';
	import { zipStore } from '$lib/tools/shared/zip';
	import {
		PICTURE_DEFAULTS,
		clampPicture,
		pictureGrid,
		type CellShape,
		type PictureJob,
		type PictureKind,
		type PictureParams,
		type Relief,
		type Background
	} from '$lib/tools/shared/colour-picture';
	import type { PictureOutput } from '$lib/tools/shared/colour-picture.worker';
	import type { ToolInfo } from '$lib/tools/registry';
	import Rich from '$lib/components/Rich.svelte';
	import { num } from '$lib/i18n/current';
	import { slots } from '$lib/i18n/rich';
	import { workerName } from '$lib/i18n/worker';
	import * as m from '$msg/tools/colour-logo';
	import * as tc from '$msg/tools/common';

	let { tool, kind }: { tool: ToolInfo; kind: PictureKind } = $props();

	const mosaic = $derived(kind === 'mosaic');
	let p = $state<PictureParams>({ ...PICTURE_DEFAULTS });
	let picture = $state.raw<ImageBitmap | null>(null);
	let fileName = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	/** Colours the user picked for the parts, by palette index (and 'base'). */
	let custom = $state<Record<string, string>>({});

	/** SVG has no pixels: drawn on a canvas, 1600 px on its long side. */
	async function readPicture(file: File): Promise<ImageBitmap> {
		if (!(file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)))
			return createImageBitmap(file);
		const text = await file.text();
		const box = /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i.exec(
			text
		);
		const aspect = box && +box[2] > 0 ? +box[1] / +box[2] : 1;
		const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
		try {
			const img = new Image();
			img.src = url;
			await img.decode();
			const canvas = document.createElement('canvas');
			canvas.width = aspect >= 1 ? 1600 : Math.round(1600 * aspect);
			canvas.height = aspect >= 1 ? Math.round(1600 / aspect) : 1600;
			canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
			return createImageBitmap(canvas);
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	const opening = latestOnly();
	async function open(file: File) {
		const fresh = opening.next();
		try {
			const next = await readPicture(file);
			if (!fresh()) return next.close(); // a newer picture was chosen meanwhile
			picture?.close();
			picture = next;
			fileName = file.name;
			loadError = null;
			custom = {};
			// Pixel art: one cell per pixel of the picture.
			if (mosaic && next.width <= 160) p.pixels = next.width;
		} catch {
			if (fresh()) loadError = m.t_colour_logo_open_failed();
		}
	}

	/** The picture on the grid; small pictures (pixel art) without blending. */
	function resample(image: ImageBitmap, cols: number, rows: number): Uint8ClampedArray {
		const canvas = document.createElement('canvas');
		canvas.width = cols;
		canvas.height = rows;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new ToolError(m.t_colour_logo_canvas_failed());
		ctx.imageSmoothingEnabled = image.width > 256;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(image, 0, 0, cols, rows);
		return ctx.getImageData(0, 0, cols, rows).data;
	}

	let runner: WorkerRunner<PictureJob, PictureOutput> | null = null;
	const build = createBuild<{ params: PictureParams; image: ImageBitmap }, PictureOutput>(
		async ({ params, image }, signal) => {
			const { cols, rows } = pictureGrid(params, kind, image.width / image.height);
			const rgba = resample(image, cols, rows);
			runner ??= createWorkerRunner(
				() =>
					new Worker(new URL('../shared/colour-picture.worker.ts', import.meta.url), {
						type: 'module',
						name: workerName('colour-picture')
					})
			);
			return runner.run({ params, kind, rgba, w: cols, h: rows }, signal, {
				transfer: [rgba.buffer]
			});
		},
		400
	);
	$effect(() => {
		const params = $state.snapshot(p);
		if (picture) build.run({ params, image: picture });
	});
	onDestroy(() => {
		build.cancel();
		runner?.dispose();
		picture?.close();
	});

	const result = $derived(build.value);
	// New colours (another picture, another count): the picks no longer fit.
	let paletteWas = '';
	$effect(() => {
		const key = result?.palette.join() ?? '';
		if (key !== paletteWas) {
			paletteWas = key;
			custom = {};
		}
	});
	const baseColour = $derived(
		custom.base ??
			(result && result.background !== null && result.background >= 0
				? result.palette[result.background]
				: PART_COLOURS[0])
	);
	const colourOf = (key: 'base' | number) =>
		key === 'base' ? baseColour : (custom[key] ?? result?.palette[key] ?? PART_COLOURS[1]);

	const parts = $derived<Part[]>(
		(result?.parts ?? []).map((part, i) => ({
			id: i + 1,
			name: part.name,
			file:
				part.key === 'base'
					? m.t_colour_logo_base_filename()
					: `${m.t_colour_logo_colour_filename()}-${i}`,
			tris: part.tris,
			volume: 0,
			color: colourOf(part.key),
			visible: true,
			dir: [0, 0, 0]
		}))
	);
	const base = $derived(
		(fileName ?? m.t_colour_logo_picture_filename()).replace(/\.[^.]+$/, '') ||
			m.t_colour_logo_picture_filename()
	);

	function download3mf() {
		if (!parts.length) return;
		const file = write3mf(
			parts.map((part) => ({ name: part.name, tris: part.tris, colour: part.color })),
			tool.title
		);
		downloadBytes(file, `${base}.3mf`, 'model/3mf');
	}
	function downloadParts() {
		const files = parts.map((part) => ({
			name: `${base}-${part.file}.stl`,
			data: writeStl(part.tris)
		}));
		downloadBytes(
			zipStore(files),
			`${base}-${m.t_colour_logo_by_colours_filename()}.zip`,
			'application/zip'
		);
	}

	const RELIEFS: { value: Relief; label: string }[] = [
		{ value: 'flat', label: m.t_colour_logo_relief_flat() },
		{ value: 'raised', label: m.t_colour_logo_relief_raised() },
		{ value: 'layers', label: m.t_colour_logo_relief_layers() }
	];
	const RELIEF_HINTS: Record<Relief, string> = {
		flat: m.t_colour_logo_relief_flat_hint(),
		raised: m.t_colour_logo_relief_raised_hint(),
		layers: m.t_colour_logo_relief_layers_hint()
	};
	const BACKGROUNDS: { value: Background; label: string }[] = [
		{ value: 'base', label: m.t_colour_logo_background_plate() },
		{ value: 'remove', label: m.t_colour_logo_background_outline() }
	];
	const CELLS: { value: CellShape; label: string }[] = [
		{ value: 'square', label: m.t_colour_logo_cell_square() },
		{ value: 'gap', label: m.t_colour_logo_cell_gap() },
		{ value: 'round', label: m.t_colour_logo_cell_round() }
	];

	const mm = (v: number) => num(v, 1);
	const grid = $derived(picture ? pictureGrid(p, kind, picture.width / picture.height) : null);
	const sizeHint = $derived.by(() => {
		if (!grid) return m.t_colour_logo_size_hint_empty();
		const c = clampPicture(p);
		const height = (c.width / grid.cols) * grid.rows;
		if (!mosaic) return m.t_colour_logo_size_hint_logo({ height: mm(height) });
		return m.t_colour_logo_size_hint_mosaic({
			count: grid.rows,
			cols: num(grid.cols),
			rows: num(grid.rows),
			cell: mm(c.width / grid.cols),
			height: mm(height)
		});
	});
	const topLabel = $derived(
		p.relief === 'flat'
			? m.t_colour_logo_top_flat()
			: p.relief === 'raised'
				? m.t_colour_logo_top_raised()
				: m.t_colour_logo_top_layers()
	);
	const changeOf = (key: 'base' | number) => result?.changes.find((c) => c.key === key);
	const gcodeEdit = resolve('/workspace/tools/[slug]', { slug: 'gcode-edit' });
</script>

<ToolShell
	{tool}
	stl={result?.stl ?? null}
	size={partsSize(parts)}
	busy={build.busy}
	error={loadError ?? build.error}
	exports={parts.length
		? p.relief === 'layers'
			? [
					{
						label: tc.tc_download_stl(),
						icon: Download,
						primary: true,
						onClick: () => result && downloadBytes(result.stl, `${base}.stl`, 'model/stl')
					}
				]
			: [
					{
						label: tc.tc_download_3mf_colours(),
						icon: Layers,
						primary: true,
						onClick: download3mf
					},
					{ label: m.t_colour_logo_download_stl_parts(), icon: Download, onClick: downloadParts },
					{
						label: m.t_colour_logo_download_one_stl(),
						icon: Download,
						onClick: () => result && downloadBytes(result.stl, `${base}.stl`, 'model/stl')
					}
				]
		: []}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_picture()}>
			<FileField
				label={m.t_colour_logo_upload()}
				accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
				hint={mosaic ? m.t_colour_logo_upload_hint_mosaic() : m.t_colour_logo_upload_hint_logo()}
				{fileName}
				maxBytes={30 * 1024 * 1024}
				onfile={open}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_colour_logo_group_colours()}>
			<NumberField
				label={m.t_colour_logo_colours()}
				bind:value={p.colours}
				min={2}
				max={8}
				hint={m.t_colour_logo_colours_hint()}
			/>
			{#if result}
				<ul class="flex flex-col gap-2">
					{#each result.parts as part (part.key)}
						{@const change = changeOf(part.key)}
						<li class="flex items-center gap-3">
							<label class="swatch" style:background-color={colourOf(part.key)}>
								<input
									type="color"
									value={colourOf(part.key)}
									oninput={(e) => (custom = { ...custom, [part.key]: e.currentTarget.value })}
									aria-label={m.t_colour_logo_colour_of({ name: part.name })}
								/>
							</label>
							<span class="min-w-0 text-sm">
								<span class="font-medium">{part.name}</span>
								<span class="block text-xs text-neutral-400">
									{#if part.key === 'base'}
										{p.background === 'base'
											? m.t_colour_logo_part_background()
											: m.t_colour_logo_part_margin()}
									{:else}
										{m.t_colour_logo_part_share({
											percent: num(result.shares[part.key] * 100, 0)
										})}
									{/if}
									{#if change}
										{m.t_colour_logo_part_change({ layer: change.layer, z: mm(change.z) })}
									{/if}
								</span>
							</span>
						</li>
					{/each}
				</ul>
				<p class="text-xs text-neutral-400">
					{m.t_colour_logo_swatch_note()}
				</p>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_colour_logo_group_size_shape()}>
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={20}
				max={300}
				hint={sizeHint}
			/>
			{#if mosaic}
				<NumberField
					label={m.t_colour_logo_pixels_across()}
					bind:value={p.pixels}
					min={8}
					max={160}
				/>
				<ChoiceField label={m.t_colour_logo_cells()} bind:value={p.cell} options={CELLS} />
				{#if p.cell !== 'square'}
					<NumberField
						label={tc.tc_gap()}
						unit="mm"
						bind:value={p.gap}
						min={0.2}
						max={2}
						step={0.1}
						hint={m.t_colour_logo_gap_hint()}
					/>
				{/if}
			{:else}
				<NumberField
					label={m.t_colour_logo_detail()}
					unit={m.t_colour_logo_detail_unit()}
					bind:value={p.detail}
					min={200}
					max={1000}
					step={50}
					hint={m.t_colour_logo_detail_hint()}
				/>
			{/if}
			<ChoiceField
				label={m.t_colour_logo_background()}
				bind:value={p.background}
				options={BACKGROUNDS}
				hint={p.background === 'base'
					? m.t_colour_logo_background_plate_hint()
					: m.t_colour_logo_background_outline_hint()}
			/>
			{#if p.background === 'base'}
				<NumberField
					label={tc.tc_corner_rounding()}
					unit="mm"
					bind:value={p.corner}
					min={0}
					max={30}
					step={0.5}
				/>
			{:else}
				<NumberField
					label={m.t_colour_logo_margin()}
					unit="mm"
					bind:value={p.border}
					min={0}
					max={15}
					step={0.5}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<ChoiceField
				label={m.t_colour_logo_how_to_print()}
				bind:value={p.relief}
				options={RELIEFS}
				hint={RELIEF_HINTS[p.relief]}
			/>
			<NumberField
				label={m.t_colour_logo_base()}
				unit="mm"
				bind:value={p.base}
				min={0.6}
				max={6}
				step={0.2}
			/>
			<NumberField label={topLabel} unit="mm" bind:value={p.top} min={0.2} max={3} step={0.2} />
			<NumberField
				label={m.t_colour_logo_layer_height()}
				unit="mm"
				bind:value={p.layer}
				min={0.08}
				max={0.32}
				step={0.02}
				hint={m.t_colour_logo_layer_height_hint()}
			/>
			{#if p.relief === 'layers' && result?.changes.length}
				<p class="text-xs text-neutral-400">
					<Rich text={m.t_colour_logo_colour_change_note(slots('link'))}>
						{#snippet link()}<a href={gcodeEdit} class="underline hover:text-neutral-100"
								>{m.t_colour_logo_gcode_edit_link()}</a
							>{/snippet}
					</Rich>
				</p>
			{/if}
		</FieldGroup>
	{/snippet}
	{#snippet viewport()}
		<PartsViewport {parts} fitKey="{fileName}:{kind}" />
	{/snippet}
	{#snippet empty()}
		<p>{m.t_colour_logo_empty()}</p>
		<p class="mt-1">{m.t_colour_logo_empty_private()}</p>
	{/snippet}
</ToolShell>

<style>
	.swatch {
		position: relative;
		flex: none;
		width: 42px;
		height: 42px;
		border: 1px solid var(--pz-color-border);
		border-radius: var(--pz-radius-sm);
		cursor: pointer;
	}
	.swatch input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
	.swatch:has(input:focus-visible) {
		outline: 2px solid var(--pz-color-focus);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.swatch {
			width: 44px;
			height: 44px;
		}
	}
</style>
