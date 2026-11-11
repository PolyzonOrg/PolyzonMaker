<script lang="ts">
	/**
	 * «Картина слоями пластика»: a photo printed flat in a stack of filaments,
	 * changing filament on a few layers. The scene shows how it will look
	 * (the picture) or the relief in the filaments' colours.
	 */
	import { onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import { ArrowDownWideNarrow, Download, Plus, Trash2 } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import PartsViewport from '../booleans/PartsViewport.svelte';
	import type { Part } from '../booleans/parts';
	import { createBuild, ToolError } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { downloadBytes } from '$lib/tools/stl';
	import { PART_COLOURS } from '$lib/tools/shared/threemf';
	import { createWorkerRunner, type WorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import type { LithoLayout } from '$lib/tools/lithophane-generator/model';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		FILAMENT_STACKS,
		MAX_FILAMENTS,
		NEW_FILAMENT,
		PAINT_DEFAULTS,
		evenStarts,
		lightnessOf,
		paintLayout,
		paintPlan,
		type Filament,
		type PaintJob,
		type PaintParams,
		type PaintResult
	} from './model';
	import Rich from '$lib/components/Rich.svelte';
	import { num } from '$lib/i18n/current';
	import { slots } from '$lib/i18n/rich';
	import { workerName } from '$lib/i18n/worker';
	import * as m from '$msg/tools/filament-painting';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<PaintParams>(structuredClone(PAINT_DEFAULTS));
	let photo = $state.raw<ImageBitmap | null>(null);
	let fileName = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	type View = 'picture' | 'relief';
	let view = $state<View>('picture');
	const VIEWS: { value: View; label: string }[] = [
		{ value: 'picture', label: m.t_filament_painting_view_picture() },
		{ value: 'relief', label: m.t_filament_painting_view_relief() }
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
		} catch {
			if (fresh()) loadError = m.t_filament_painting_open_failed();
		}
	}

	function resample(image: ImageBitmap, layout: LithoLayout): Uint8ClampedArray {
		const canvas = document.createElement('canvas');
		canvas.width = layout.cols;
		canvas.height = layout.rows;
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) throw new ToolError(m.t_filament_painting_canvas_failed());
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(image, 0, 0, layout.cols, layout.rows);
		return ctx.getImageData(0, 0, layout.cols, layout.rows).data;
	}

	let runner: WorkerRunner<PaintJob, PaintResult> | null = null;
	const build = createBuild<
		{ params: PaintParams; image: ImageBitmap },
		PaintResult & { layout: LithoLayout }
	>(async ({ params, image }, signal) => {
		const layout = paintLayout(params, image.width / image.height);
		const rgba = resample(image, layout);
		runner ??= createWorkerRunner(
			() =>
				new Worker(new URL('./painting.worker.ts', import.meta.url), {
					type: 'module',
					name: workerName('painting')
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

	const result = $derived(build.value);
	const plan = $derived(paintPlan(p));

	// The look on the scene.
	let canvas = $state<HTMLCanvasElement>();
	$effect(() => {
		const r = result;
		if (!canvas || !r || view !== 'picture') return;
		canvas.width = r.layout.cols;
		canvas.height = r.layout.rows;
		canvas
			.getContext('2d')
			?.putImageData(new ImageData(new Uint8ClampedArray(r.preview), r.layout.cols), 0, 0);
	});
	const parts = $derived<Part[]>(
		(result?.bands ?? []).map((tris, i) => ({
			id: i + 1,
			name: p.filaments[i]?.name ?? m.t_filament_painting_filament_n({ n: i + 1 }),
			file: `${m.t_filament_painting_filament_filename()}-${i + 1}`,
			tris,
			volume: 0,
			color: p.filaments[i]?.colour ?? PART_COLOURS[1],
			visible: true,
			dir: [0, 0, 0]
		}))
	);
	const size = $derived<[number, number, number] | null>(
		result ? [result.layout.width, result.layout.height, plan.top] : null
	);

	function applyStack(id: string) {
		const stack = FILAMENT_STACKS.find((s) => s.id === id);
		if (stack) p.filaments = stack.filaments.map((f) => ({ ...f }));
	}
	function addFilament() {
		if (p.filaments.length >= MAX_FILAMENTS) return;
		const at = Math.max(1, p.filaments.length - 1);
		p.filaments.splice(at, 0, {
			...NEW_FILAMENT,
			name: m.t_filament_painting_filament_n({ n: p.filaments.length + 1 })
		});
	}
	function sortByLightness() {
		p.filaments = [...p.filaments].sort((a, b) => lightnessOf(a.colour) - lightnessOf(b.colour));
	}
	// Changing filaments by hand: start from what the picture asked for.
	$effect(() => {
		const want = p.filaments.length - 1;
		if (p.auto || p.starts.length === want) return;
		p.starts =
			result?.starts.length === want ? [...result.starts] : evenStarts(p.filaments, plan.steps);
	});

	const changeOf = (i: number) => result?.changes.find((c) => c.filament === i);
	const mm = (v: number) => num(v, 2);
	const likeness = $derived.by(() => {
		if (!result) return null;
		const e = result.error;
		const error = num(e, 1);
		return e < 5
			? m.t_filament_painting_likeness_very_close({ error })
			: e < 9
				? m.t_filament_painting_likeness_close({ error })
				: e < 14
					? m.t_filament_painting_likeness_noticeable({ error })
					: m.t_filament_painting_likeness_far({ error });
	});
	const name = $derived(
		(fileName ?? m.t_filament_painting_picture_filename()).replace(/\.[^.]+$/, '') ||
			m.t_filament_painting_picture_filename()
	);

	function downloadSteps() {
		if (!result) return;
		const lines: string[] = [
			m.t_filament_painting_steps_title({ title: tool.title, name }),
			m.t_filament_painting_steps_layers({
				first: mm(plan.firstLayer),
				layer: mm(plan.layer),
				top: mm(plan.top)
			}),
			'',
			...result.changes.map((c) => {
				const f: Filament | undefined = p.filaments[c.filament];
				const named = { name: f?.name ?? '', colour: f?.colour ?? '' };
				return c.layer === 1
					? m.t_filament_painting_steps_first(named)
					: m.t_filament_painting_steps_change({ ...named, layer: c.layer, z: mm(c.z) });
			})
		];
		downloadBytes(
			lines.join('\r\n') + '\r\n',
			`${name}-${m.t_filament_painting_steps_filename()}.txt`,
			'text/plain'
		);
	}
	const gcodeEdit = resolve('/workspace/tools/[slug]', { slug: 'gcode-edit' });
</script>

<ToolShell
	{tool}
	stl={result?.stl ?? null}
	{size}
	busy={build.busy}
	error={loadError ?? build.error}
	exports={result
		? [
				{
					label: tc.tc_download_stl(),
					icon: Download,
					primary: true,
					onClick: () => result && downloadBytes(result.stl, `${name}.stl`, 'model/stl')
				},
				{ label: m.t_filament_painting_download_steps(), icon: Download, onClick: downloadSteps }
			]
		: []}
>
	{#snippet controls()}
		<FieldGroup title={m.t_filament_painting_stacks()}>
			<div class="flex flex-wrap gap-2">
				{#each FILAMENT_STACKS as stack (stack.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyStack(stack.id)}>
						{stack.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_picture()}>
			<FileField
				label={m.t_filament_painting_upload()}
				accept="image/png,image/jpeg,image/webp"
				hint={m.t_filament_painting_upload_hint()}
				{fileName}
				maxBytes={40 * 1024 * 1024}
				onfile={open}
			/>
			<NumberField
				label={m.t_filament_painting_contrast()}
				unit="%"
				bind:value={p.contrast}
				min={-50}
				max={50}
			/>
			<NumberField
				label={m.t_filament_painting_gamma()}
				bind:value={p.gamma}
				min={0.4}
				max={2.5}
				step={0.05}
				hint={m.t_filament_painting_gamma_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_filament_painting_group_filaments()}>
			<ul class="flex flex-col gap-4">
				{#each p.filaments as filament, i (i)}
					{@const change = changeOf(i)}
					<li class="flex flex-col gap-3">
						<div class="flex items-center gap-3">
							<label class="swatch" style:background-color={filament.colour}>
								<input
									type="color"
									bind:value={filament.colour}
									aria-label={m.t_filament_painting_colour_of({ name: filament.name })}
								/>
							</label>
							<span class="min-w-0 flex-1 text-sm">
								<span class="block truncate font-medium">{filament.name}</span>
								<span class="block text-xs text-neutral-400">
									{#if i === 0}
										{m.t_filament_painting_base_from_first()}
									{:else if change}
										{m.t_filament_painting_from_layer({ layer: change.layer, z: mm(change.z) })}
									{:else}
										—
									{/if}
								</span>
							</span>
							{#if p.filaments.length > 2}
								<button
									type="button"
									class="icon-btn"
									aria-label={m.t_filament_painting_remove_named({ name: filament.name })}
									title={m.t_filament_painting_remove()}
									onclick={() => p.filaments.splice(i, 1)}
								>
									<Trash2 size={16} aria-hidden="true" />
								</button>
							{/if}
						</div>
						<NumberField
							label={m.t_filament_painting_td()}
							unit="mm"
							bind:value={filament.td}
							min={0.2}
							max={10}
							step={0.1}
						/>
						{#if !p.auto && i > 0 && p.starts.length === p.filaments.length - 1}
							<NumberField
								label={m.t_filament_painting_start_layer()}
								bind:value={p.starts[i - 1]}
								min={1}
								max={plan.steps}
							/>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="btn-ghost btn-s"
					disabled={p.filaments.length >= MAX_FILAMENTS}
					onclick={addFilament}
				>
					<Plus size={14} aria-hidden="true" />
					{m.t_filament_painting_add()}
				</button>
				<button type="button" class="btn-ghost btn-s" onclick={sortByLightness}>
					<ArrowDownWideNarrow size={14} aria-hidden="true" />
					{m.t_filament_painting_sort()}
				</button>
			</div>
			<p class="text-xs text-neutral-400">
				{m.t_filament_painting_td_note()}
			</p>
			<ToggleField
				label={m.t_filament_painting_auto()}
				bind:checked={p.auto}
				hint={m.t_filament_painting_auto_hint()}
			/>
			{#if likeness}<p class="text-xs text-neutral-400">{likeness}</p>{/if}
		</FieldGroup>
		<FieldGroup title={m.t_filament_painting_group_size_layers()}>
			<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={20} max={250} />
			<NumberField
				label={m.t_filament_painting_layer_height()}
				unit="mm"
				bind:value={p.layer}
				min={0.04}
				max={0.2}
				step={0.02}
				hint={m.t_filament_painting_layer_height_hint()}
			/>
			<NumberField
				label={m.t_filament_painting_first_layer()}
				unit="mm"
				bind:value={p.firstLayer}
				min={0.1}
				max={0.3}
				step={0.02}
			/>
			<NumberField
				label={m.t_filament_painting_base()}
				unit="mm"
				bind:value={p.base}
				min={0.3}
				max={2}
				step={0.08}
				hint={m.t_filament_painting_base_hint({
					base: mm(plan.base),
					layers: m.t_filament_painting_layers({
						count: plan.baseLayers,
						n: num(plan.baseLayers)
					})
				})}
			/>
			<NumberField
				label={m.t_filament_painting_height()}
				unit="mm"
				bind:value={p.height}
				min={1.5}
				max={6}
				step={0.1}
				hint={m.t_filament_painting_height_hint({
					layers: m.t_filament_painting_layers({ count: plan.steps, n: num(plan.steps) }),
					top: mm(plan.top)
				})}
			/>
			<NumberField
				label={tc.tc_grid_step()}
				unit="mm"
				bind:value={p.resolution}
				min={0.15}
				max={1}
				step={0.05}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<ChoiceField label={m.t_filament_painting_on_scene()} bind:value={view} options={VIEWS} />
			<p class="text-xs text-neutral-400">
				<Rich text={m.t_filament_painting_print_note(slots('link'))}>
					{#snippet link()}<a href={gcodeEdit} class="underline hover:text-neutral-100"
							>{m.t_filament_painting_gcode_edit_link()}</a
						>{/snippet}
				</Rich>
			</p>
		</FieldGroup>
	{/snippet}
	{#snippet viewport()}
		{#if view === 'picture'}
			<canvas
				bind:this={canvas}
				class="absolute inset-0 h-full w-full object-contain p-6"
				class:hidden={!result}
				aria-label={m.t_filament_painting_preview_label()}
			></canvas>
		{:else}
			<PartsViewport {parts} fitKey={fileName} />
		{/if}
	{/snippet}
	{#snippet empty()}
		<p>{m.t_filament_painting_empty()}</p>
		<p class="mt-1">{m.t_filament_painting_empty_private()}</p>
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
