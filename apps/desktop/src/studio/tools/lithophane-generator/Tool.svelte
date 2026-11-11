<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, ToolError } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { downloadBytes } from '$lib/tools/stl';
	import { createWorkerRunner, type WorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import type { ToolInfo } from '$lib/tools/registry';
	import { num } from '$lib/i18n/current';
	import { workerName } from '$lib/i18n/worker';
	import * as m from '$msg/tools/lithophane-generator';
	import * as tc from '$msg/tools/common';
	import {
		LITHO_DEFAULTS,
		isFlat,
		lithoFileName,
		lithoLayout,
		type LithoBottom,
		type LithoJob,
		type LithoLayout,
		type LithoParams,
		type LithoResult,
		type LithoShape
	} from './model';
	import { moonMap } from './moon';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<LithoParams>({ ...LITHO_DEFAULTS });
	let photo = $state.raw<ImageBitmap | null>(null);
	let fileName = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let drawing = $state(false);

	// The Moon and a photo opened meanwhile both become the photo: the last chosen wins.
	const opening = latestOnly();

	/** The drawn Moon map as the photo, for a ball. */
	async function useMoon() {
		const fresh = opening.next();
		drawing = true;
		try {
			// Let the button show it is busy before the map takes its half a second.
			await new Promise((r) => setTimeout(r, 30));
			const w = 1024;
			const next = await createImageBitmap(new ImageData(moonMap(w, w / 2), w, w / 2));
			if (!fresh()) return next.close(); // a photo was chosen meanwhile
			photo?.close();
			photo = next;
			fileName = m.t_lithophane_generator_moon_file();
			loadError = null;
		} finally {
			drawing = false;
		}
	}

	// A ball stands on its opening: start it wide enough to stand and take a light.
	let shapeWas = p.shape;
	$effect(() => {
		const shape = p.shape;
		if (shape === shapeWas) return;
		if (shape === 'sphere' && p.holeDiameter === LITHO_DEFAULTS.holeDiameter) p.holeDiameter = 40;
		shapeWas = shape;
	});

	async function openPhoto(file: File) {
		const fresh = opening.next();
		try {
			const next = await createImageBitmap(file);
			if (!fresh()) return next.close(); // a newer picture was chosen meanwhile
			photo?.close();
			photo = next;
			fileName = file.name;
			loadError = null;
		} catch {
			if (fresh()) loadError = m.t_lithophane_generator_photo_unreadable();
		}
	}

	/** The photo resampled to the grid on a canvas; outlines crop it to cover. */
	function resample(image: ImageBitmap, layout: LithoLayout): Uint8ClampedArray {
		const canvas = document.createElement('canvas');
		canvas.width = layout.cols;
		canvas.height = layout.rows;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new ToolError(m.t_lithophane_generator_canvas_failed());
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		let sx = 0;
		let sy = 0;
		let sw = image.width;
		let sh = image.height;
		if (layout.cover) {
			const target = layout.width / layout.height;
			if (sw / sh > target) {
				sw = sh * target;
				sx = (image.width - sw) / 2;
			} else {
				sh = sw / target;
				sy = (image.height - sh) / 2;
			}
		}
		ctx.drawImage(image, sx, sy, sw, sh, 0, 0, layout.cols, layout.rows);
		return ctx.getImageData(0, 0, layout.cols, layout.rows).data;
	}

	let runner: WorkerRunner<LithoJob, LithoResult> | null = null;
	const build = createBuild<
		{ params: LithoParams; image: ImageBitmap },
		LithoResult & { layout: LithoLayout }
	>(async ({ params, image }, signal) => {
		const layout = lithoLayout(params, image.width / image.height);
		const rgba = resample(image, layout);
		runner ??= createWorkerRunner(
			() =>
				new Worker(new URL('./lithophane.worker.ts', import.meta.url), {
					type: 'module',
					name: workerName('lithophane')
				})
		);
		const result = await runner.run({ params, layout, rgba }, signal, { transfer: [rgba.buffer] });
		return { ...result, layout };
	}, 400);
	$effect(() => {
		const params = $state.snapshot(p);
		if (photo) build.run({ params, image: photo });
	});
	onDestroy(() => {
		build.cancel();
		runner?.dispose();
		photo?.close();
	});

	const SHAPES: { value: LithoShape; label: string }[] = [
		{ value: 'panel', label: m.t_lithophane_generator_shape_panel() },
		{ value: 'arc', label: m.t_lithophane_generator_shape_arc() },
		{ value: 'cylinder', label: m.t_lithophane_generator_shape_cylinder() },
		{ value: 'sphere', label: m.t_lithophane_generator_shape_sphere() },
		{ value: 'circle', label: m.t_lithophane_generator_shape_circle() },
		{ value: 'hexagon', label: tc.tc_shape_hexagon() },
		{ value: 'heart', label: m.t_lithophane_generator_shape_heart() },
		{ value: 'star', label: m.t_lithophane_generator_shape_star() }
	];
	const BOTTOMS: { value: LithoBottom; label: string }[] = [
		{ value: 'none', label: m.t_lithophane_generator_bottom_none() },
		{ value: 'closed', label: m.t_lithophane_generator_bottom_closed() },
		{ value: 'hole', label: m.t_lithophane_generator_bottom_hole() }
	];

	const heightHint = $derived.by(() => {
		if (!photo) return m.t_lithophane_generator_height_hint();
		const layout = lithoLayout(p, photo.width / photo.height);
		const frame = p.shape === 'panel' && p.frame ? 2 * p.frameWidth : 0;
		return m.t_lithophane_generator_height_hint_mm({ height: num(layout.height + frame, 1) });
	});
	const qualityHint = $derived.by(() => {
		const r = build.value;
		if (!r) return m.t_lithophane_generator_quality_hint();
		const size = r.stl.byteLength / 1024 / 1024;
		return m.t_lithophane_generator_quality_now({
			cols: num(r.layout.cols, 0),
			rows: num(r.layout.rows, 0),
			triangles: m.t_lithophane_generator_triangles({
				count: r.triangles,
				n: num(r.triangles, 0)
			}),
			size: num(size, 1)
		});
	});
</script>

<ToolShell
	{tool}
	stl={build.value?.stl ?? null}
	busy={build.busy}
	error={loadError ?? build.error}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () => build.value && downloadBytes(build.value.stl, lithoFileName(p), 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={m.t_lithophane_generator_photo()}>
			<FileField
				label={m.t_lithophane_generator_photo_label()}
				accept="image/png,image/jpeg,image/webp"
				hint={m.t_lithophane_generator_photo_hint()}
				{fileName}
				maxBytes={40 * 1024 * 1024}
				onfile={openPhoto}
			/>
			{#if p.shape === 'sphere'}
				<div class="flex flex-wrap gap-2">
					<button type="button" class="btn-ghost btn-s" disabled={drawing} onclick={useMoon}>
						{m.t_lithophane_generator_moon()}
					</button>
				</div>
				<p class="text-xs text-neutral-400">
					{m.t_lithophane_generator_moon_hint()}
				</p>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_lithophane_generator_shape_and_size()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={SHAPES} />
			{#if p.shape === 'panel' || p.shape === 'arc'}
				<NumberField
					label={tc.tc_width()}
					unit="mm"
					bind:value={p.width}
					min={20}
					max={250}
					hint={heightHint}
				/>
			{/if}
			{#if p.shape === 'arc'}
				<NumberField
					label={m.t_lithophane_generator_arc_angle()}
					unit="°"
					bind:value={p.arcAngle}
					min={20}
					max={180}
				/>
			{:else if p.shape === 'cylinder'}
				<NumberField
					label={m.t_lithophane_generator_inner_diameter()}
					unit="mm"
					bind:value={p.diameter}
					min={30}
					max={250}
				/>
				<NumberField
					label={tc.tc_height()}
					unit="mm"
					bind:value={p.height}
					min={30}
					max={250}
					hint={m.t_lithophane_generator_cylinder_height_hint()}
				/>
				<NumberField
					label={m.t_lithophane_generator_wrap()}
					unit="°"
					bind:value={p.wrap}
					min={45}
					max={360}
					step={5}
					hint={m.t_lithophane_generator_wrap_hint()}
				/>
				{#if p.wrap >= 360}
					<ChoiceField label={tc.tc_bottom()} bind:value={p.bottom} options={BOTTOMS} />
					{#if p.bottom === 'hole'}
						<NumberField
							label={tc.tc_hole()}
							unit="mm"
							bind:value={p.holeDiameter}
							min={5}
							max={80}
							hint={m.t_lithophane_generator_hole_hint()}
						/>
					{/if}
				{/if}
			{:else if p.shape === 'sphere'}
				<NumberField
					label={m.t_lithophane_generator_inner_diameter()}
					unit="mm"
					bind:value={p.diameter}
					min={30}
					max={250}
				/>
				<NumberField
					label={m.t_lithophane_generator_sphere_hole()}
					unit="mm"
					bind:value={p.holeDiameter}
					min={5}
					max={80}
					hint={m.t_lithophane_generator_sphere_hole_hint()}
				/>
			{:else if p.shape !== 'panel'}
				<NumberField
					label={tc.tc_diameter()}
					unit="mm"
					bind:value={p.diameter}
					min={30}
					max={250}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_lithophane_generator_relief()}>
			<NumberField
				label={m.t_lithophane_generator_light()}
				unit="mm"
				bind:value={p.minThickness}
				min={0.3}
				max={3}
				step={0.05}
			/>
			<NumberField
				label={m.t_lithophane_generator_dark()}
				unit="mm"
				bind:value={p.maxThickness}
				min={1.5}
				max={8}
				step={0.05}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_lithophane_generator_image()}>
			<NumberField
				label={m.t_lithophane_generator_brightness()}
				unit="%"
				bind:value={p.brightness}
				min={-50}
				max={50}
			/>
			<NumberField
				label={m.t_lithophane_generator_contrast()}
				unit="%"
				bind:value={p.contrast}
				min={-50}
				max={50}
			/>
			<NumberField
				label={m.t_lithophane_generator_gamma()}
				bind:value={p.gamma}
				min={0.4}
				max={2.5}
				step={0.05}
				hint={m.t_lithophane_generator_gamma_hint()}
			/>
			<ToggleField
				label={m.t_lithophane_generator_negative()}
				bind:checked={p.negative}
				hint={m.t_lithophane_generator_negative_hint()}
			/>
			<ToggleField
				label={m.t_lithophane_generator_mirror()}
				bind:checked={p.mirror}
				hint={m.t_lithophane_generator_mirror_hint()}
			/>
		</FieldGroup>
		{#if isFlat(p.shape)}
			<FieldGroup title={m.t_lithophane_generator_edge_and_stand()}>
				<ToggleField
					label={m.t_lithophane_generator_frame()}
					bind:checked={p.frame}
					hint={m.t_lithophane_generator_frame_hint()}
				/>
				{#if p.frame}
					<NumberField
						label={m.t_lithophane_generator_frame_width()}
						unit="mm"
						bind:value={p.frameWidth}
						min={1.5}
						max={12}
						step={0.5}
					/>
					<NumberField
						label={m.t_lithophane_generator_frame_height()}
						unit="mm"
						bind:value={p.frameHeight}
						min={0}
						max={6}
						step={0.5}
					/>
				{/if}
				<ToggleField
					label={tc.tc_stand()}
					bind:checked={p.stand}
					hint={m.t_lithophane_generator_stand_hint()}
				/>
				<ToggleField
					label={m.t_lithophane_generator_hang()}
					bind:checked={p.hang}
					hint={m.t_lithophane_generator_hang_hint()}
				/>
			</FieldGroup>
		{/if}
		<FieldGroup title={m.t_lithophane_generator_quality()}>
			<NumberField
				label={tc.tc_grid_step()}
				unit="mm"
				bind:value={p.resolution}
				min={0.15}
				max={1}
				step={0.05}
				hint={qualityHint}
			/>
		</FieldGroup>
	{/snippet}
	{#snippet empty()}
		<p>{m.t_lithophane_generator_empty()}</p>
		<p class="mt-1">{m.t_lithophane_generator_empty_private()}</p>
	{/snippet}
</ToolShell>
