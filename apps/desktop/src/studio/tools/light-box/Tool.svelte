<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Download, FileArchive, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, ToolError } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { createWorkerRunner, type WorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import type { ToolInfo } from '$lib/tools/registry';
	import { num } from '$lib/i18n/current';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/light-box';
	import PartsViewport from '../booleans/PartsViewport.svelte';
	import PartsList from '../booleans/PartsList.svelte';
	import { downloadAll, downloadZip, partColor, partsSize, type Part } from '../booleans/parts';
	import {
		LIGHT_BOX_DEFAULTS,
		lightBoxLayout,
		litPreview,
		type LightBoxLayout,
		type LightBoxParams
	} from './model';
	import type { LightBoxJob, LightBoxReply } from './light-box.worker';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<LightBoxParams>({ ...LIGHT_BOX_DEFAULTS });
	let photo = $state.raw<ImageBitmap | null>(null);
	let fileName = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let hiddenParts = $state<number[]>([]);

	type View = 'picture' | 'parts';
	let view = $state<View>('picture');
	const VIEWS: { value: View; label: string }[] = [
		{ value: 'picture', label: m.t_light_box_view_picture() },
		{ value: 'parts', label: m.t_light_box_view_parts() }
	];

	const opening = latestOnly();
	async function open(file: File) {
		const fresh = opening.next();
		try {
			const next = await createImageBitmap(file);
			if (!fresh()) return next.close(); // a newer picture was chosen meanwhile
			photo?.close();
			photo = next;
			fileName = file.name;
			loadError = null;
			hiddenParts = [];
		} catch {
			if (fresh()) loadError = m.t_light_box_open_failed();
		}
	}

	/** The picture in grey at the plates' grid (luminance, Rec. 709). */
	function greyOf(image: ImageBitmap, L: LightBoxLayout): Uint8Array {
		const canvas = document.createElement('canvas');
		canvas.width = L.cols;
		canvas.height = L.rows;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new ToolError(m.t_light_box_canvas_failed());
		ctx.imageSmoothingQuality = 'high';
		// The plate's height stops at 40–240 mm: a picture taller or wider than
		// that is cut to the plate round its middle, not squashed.
		const want = L.width / L.height;
		const have = image.width / image.height;
		const sw = have > want ? image.height * want : image.width;
		const sh = have > want ? image.height : image.width / want;
		ctx.drawImage(
			image,
			(image.width - sw) / 2,
			(image.height - sh) / 2,
			sw,
			sh,
			0,
			0,
			L.cols,
			L.rows
		);
		const rgba = ctx.getImageData(0, 0, L.cols, L.rows).data;
		const grey = new Uint8Array(L.cols * L.rows);
		for (let i = 0; i < grey.length; i++) {
			const a = rgba[i * 4 + 3] / 255;
			// Transparent counts as white: no plastic there.
			const y = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
			grey[i] = Math.round(y * a + 255 * (1 - a));
		}
		return grey;
	}

	let runner: WorkerRunner<LightBoxJob, LightBoxReply> | null = null;
	const build = createBuild<
		{ params: LightBoxParams; image: ImageBitmap },
		LightBoxReply & { layout: LightBoxLayout; preview: Uint8ClampedArray }
	>(async ({ params, image }, signal) => {
		const layout = lightBoxLayout(params, image.width / image.height);
		const gray = greyOf(image, layout);
		const preview = litPreview(gray, layout.cols, layout.rows, params);
		runner ??= createWorkerRunner(
			() =>
				new Worker(new URL('./light-box.worker.ts', import.meta.url), {
					type: 'module',
					name: workerName('light-box')
				})
		);
		const reply = await runner.run({ params, layout, gray }, signal, {
			transfer: [gray.buffer]
		});
		return { ...reply, layout, preview };
	}, 450);
	$effect(() => {
		const params = $state.snapshot(p);
		if (photo) build.run({ params, image: photo });
	});
	onDestroy(() => {
		build.cancel();
		runner?.dispose();
		photo?.close();
	});

	const result = $derived(build.value);

	// The lit stack on the scene: white light through the plates.
	let canvas = $state<HTMLCanvasElement>();
	$effect(() => {
		const r = result;
		if (!canvas || !r || view !== 'picture') return;
		const { cols, rows } = r.layout;
		const rgba = new Uint8ClampedArray(cols * rows * 4);
		for (let i = 0; i < cols * rows; i++) {
			// A warm LED: a touch less blue.
			const v = r.preview[i];
			rgba.set([v, Math.round(v * 0.96), Math.round(v * 0.86), 255], i * 4);
		}
		canvas.width = cols;
		canvas.height = rows;
		canvas.getContext('2d')?.putImageData(new ImageData(rgba, cols), 0, 0);
	});

	const boxFile = m.t_light_box_box_filename();
	const parts = $derived<Part[]>(
		(result?.parts ?? []).map((part, i) => ({
			id: i + 1,
			name: part.name,
			file: part.file,
			tris: part.scene,
			printTris: part.print,
			volume: part.volume,
			color: partColor(part.file === boxFile ? 1 : 0),
			visible: !hiddenParts.includes(i + 1),
			dir: [0, part.file === boxFile ? 0 : -1, 0]
		}))
	);
	const name = $derived(
		(fileName ?? m.t_light_box_filename()).replace(/\.[^.]+$/, '') || m.t_light_box_filename()
	);
	const mm = (v: number) => num(v, 1);
</script>

<ToolShell
	{tool}
	size={result ? (result.layout.box as [number, number, number]) : partsSize(parts)}
	busy={build.busy}
	error={loadError ?? build.error}
	exports={parts.length
		? [
				{
					label: tc.tc_zip_archive(),
					icon: FileArchive,
					primary: true,
					onClick: () => downloadZip(parts, name)
				},
				{
					label: m.t_light_box_download_all(),
					icon: Download,
					onClick: () => downloadAll(parts, name)
				}
			]
		: []}
	empty={photo ? undefined : emptyHint}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_picture()}>
			<FileField
				label={m.t_light_box_upload()}
				accept="image/png,image/jpeg,image/webp"
				hint={m.t_light_box_upload_hint()}
				{fileName}
				maxBytes={40 * 1024 * 1024}
				onfile={open}
			/>
			<ToggleField
				label={m.t_light_box_invert()}
				bind:checked={p.invert}
				hint={m.t_light_box_invert_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_light_box_group_plates()}>
			<NumberField
				label={m.t_light_box_layers()}
				bind:value={p.layers}
				min={3}
				max={8}
				hint={m.t_light_box_layers_hint()}
			/>
			<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={60} max={240} />
			<NumberField
				label={m.t_light_box_plate()}
				unit="mm"
				bind:value={p.plate}
				min={0.6}
				max={2.4}
				step={0.2}
				hint={m.t_light_box_plate_hint()}
			/>
			<ToggleField
				label={m.t_light_box_film()}
				bind:checked={p.film}
				hint={p.film ? m.t_light_box_film_on_hint() : m.t_light_box_film_off_hint()}
			/>
			<NumberField
				label={m.t_light_box_detail()}
				unit="px"
				bind:value={p.detail}
				min={120}
				max={480}
				step={20}
			/>
			<NumberField
				label={m.t_light_box_smooth()}
				bind:value={p.smooth}
				min={0}
				max={4}
				step={0.5}
			/>
			{#if result && result.dropped > 0}
				<div class="notice notice-warning" role="status">
					<TriangleAlert size={16} aria-hidden="true" />
					<p>
						{m.t_light_box_dropped({ count: result.dropped })}
					</p>
				</div>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_light_box_group_box()}>
			<ToggleField
				label={m.t_light_box_box()}
				bind:checked={p.box}
				hint={m.t_light_box_box_hint()}
			/>
			<NumberField label={m.t_light_box_gap()} unit="mm" bind:value={p.gap} min={3} max={12} />
			{#if p.box}
				<NumberField
					label={m.t_light_box_led()}
					unit="mm"
					bind:value={p.led}
					min={8}
					max={30}
					hint={m.t_light_box_led_hint()}
				/>
			{/if}
			{#if result}
				<p class="text-xs text-neutral-400">
					{p.box
						? m.t_light_box_summary_box({
								width: mm(result.layout.width),
								height: mm(result.layout.height),
								boxWidth: mm(result.layout.box[0]),
								boxDepth: mm(result.layout.box[1]),
								boxHeight: mm(result.layout.box[2])
							})
						: m.t_light_box_summary({
								width: mm(result.layout.width),
								height: mm(result.layout.height)
							})}
				</p>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_light_box_group_view()}>
			<ChoiceField label={m.t_light_box_view()} bind:value={view} options={VIEWS} />
			{#if parts.length && view === 'parts'}
				<PartsList
					{parts}
					onvisible={(id, visible) =>
						(hiddenParts = visible ? hiddenParts.filter((h) => h !== id) : [...hiddenParts, id])}
				/>
			{/if}
		</FieldGroup>
	{/snippet}
	{#snippet viewport()}
		{#if view === 'picture'}
			<canvas
				bind:this={canvas}
				class="absolute inset-0 h-full w-full object-contain p-6"
				class:hidden={!result}
				aria-label={m.t_light_box_canvas_label()}
			></canvas>
		{:else}
			<PartsViewport {parts} fitKey={fileName} />
		{/if}
	{/snippet}
</ToolShell>

{#snippet emptyHint()}
	<p>{m.t_light_box_empty_upload()}</p>
	<p class="mt-1">{m.t_light_box_empty_private()}</p>
{/snippet}
