<script lang="ts" module>
	import type { TagMount, TagParams, TagPreset } from './tag';

	/** What differs between «Таблички» and «Брелки». */
	export interface TagToolConfig {
		/** Latin prefix of the downloaded files. */
		filePrefix: string;
		defaults: TagParams;
		presets: readonly TagPreset[];
		mounts: readonly TagMount[];
		maxLines: number;
		/** Offer the recess for adhesive tape. */
		adhesive: boolean;
	}
</script>

<script lang="ts">
	/**
	 * The form shared by the nameplate and keychain tools. OpenSCAD draws the
	 * letters only when the text changes; the shape, mounts, QR code and
	 * pockets are rebuilt in the tag worker (manifold) at once.
	 */
	import { onDestroy } from 'svelte';
	import {
		CircleCheck,
		Download,
		FileArchive,
		Layers,
		LayoutGrid,
		Palette,
		TriangleAlert
	} from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, readableError } from '$lib/tools/build.svelte';
	import { downloadBytes, packOnBeds, parseStl, writeStl } from '$lib/tools/stl';
	import { zipStore } from '$lib/tools/shared/zip';
	import { num } from '$lib/i18n/current';
	import { workerName } from '$lib/i18n/worker';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/nameplate-generator';
	import { fileSlug, partCount, type Layer } from '$lib/tools/shared/relief';
	import { createReliefClient } from '$lib/tools/shared/relief-client';
	import { BOLD_GROW, boldSpacing, usableFont } from '$lib/tools/shared/fonts';
	import FontField from '$lib/components/tools/FontField.svelte';
	import type { ReliefResult } from '$lib/tools/shared/relief-worker';
	import {
		fmt,
		TAG_LIMITS,
		tagLines,
		type LoopShape,
		type ReliefMode,
		type TagBase,
		type TagInfo,
		type TagJob,
		type TagPlacement,
		type TagShape,
		type TextWeight
	} from './tag';
	import { batchNames, uniqueNames } from './batch';

	let { tool, config }: { tool: ToolInfo; config: TagToolConfig } = $props();

	const BATCH_MAX = 50;

	// The form starts from the tool's defaults; a preset replaces them as a whole.
	const start = (): TagParams => structuredClone(config.defaults);
	let p = $state<TagParams>(start());

	type Result = ReliefResult<TagInfo> & { name: string };

	const client = createReliefClient<TagJob, TagInfo>(
		() =>
			new Worker(new URL('./tag.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('tag')
			})
	);
	/** The font to draw with and its step: bold letters are set wider (boldSpacing). */
	function lettering(params: TagParams): [string, number] {
		const font = usableFont(params.font);
		return [font, boldSpacing(params.weight === 'bold' ? BOLD_GROW : 0, font)];
	}

	const build = createBuild<TagParams, Result>(async (params, signal) => {
		const lines = tagLines(params, config.maxLines);
		const job: TagJob = { params, maxLines: config.maxLines, mounts: [...config.mounts] };
		const result = await client.build(job, lines, signal, ...lettering(params));
		return {
			...result,
			name: `${config.filePrefix}-${fileSlug(lines[0] ?? '', m.t_nameplate_generator_untitled_filename())}`
		};
	}, 350);
	$effect(() => build.run($state.snapshot(p)));
	onDestroy(() => {
		build.cancel();
		client.dispose();
	});

	const result = $derived(build.value);
	const parts = $derived(result ? partCount(result.layers) : 0);

	function applyPreset(params: Partial<TagParams>) {
		p = { ...start(), ...structuredClone(params) };
	}

	async function downloadParts() {
		const r = result;
		if (!r) return;
		const zip = await client.parts(
			$state.snapshot(r.layers) as Layer[],
			r.name,
			r.info.colorChange
		);
		downloadBytes(
			zip,
			`${r.name}-${m.t_nameplate_generator_colours_filename()}.zip`,
			'application/zip'
		);
	}

	async function download3mf() {
		const r = result;
		if (!r) return;
		const file = await client.parts3mf($state.snapshot(r.layers) as Layer[], r.name);
		downloadBytes(file, `${r.name}.3mf`, 'model/3mf');
	}

	async function downloadSvg() {
		const r = result;
		if (!r) return;
		downloadBytes(
			await client.svg($state.snapshot(r.layers) as Layer[]),
			`${r.name}.svg`,
			'image/svg+xml'
		);
	}

	// «Набор»: the same tag for each name of a list, built in a worker of its own.
	let batch = $state('');
	const names = $derived(batchNames(batch, BATCH_MAX));
	let bed = $state(220);
	let batchDone = $state<number | null>(null);
	let batchNote = $state<string | null>(null);
	let batchError = $state<string | null>(null);

	/** The tags laid out on beds of `bed` mm: one STL for one bed, an archive for more. How many beds. */
	function downloadBeds(files: { stl: Uint8Array }[], set: string): number {
		const beds = packOnBeds(
			files.map((f) => parseStl(f.stl)),
			bed
		);
		if (beds.length === 1) downloadBytes(writeStl(beds[0]), `${set}.stl`, 'model/stl');
		else
			downloadBytes(
				zipStore(
					beds.map((t, i) => ({
						name: `${m.t_nameplate_generator_bed_filename()}-${i + 1}.stl`,
						data: writeStl(t)
					}))
				),
				`${set}.zip`,
				'application/zip'
			);
		return beds.length;
	}

	async function downloadBatch(kind: 'zip' | 'beds') {
		if (batchDone !== null || !names.length) return;
		batchDone = 0;
		batchNote = batchError = null;
		const runner = createReliefClient<TagJob, TagInfo>(
			() =>
				new Worker(new URL('./tag.worker.ts', import.meta.url), {
					type: 'module',
					name: workerName('tag')
				})
		);
		const signal = new AbortController().signal;
		const fileNames = uniqueNames(
			names.map(
				(name) =>
					`${config.filePrefix}-${fileSlug(name, m.t_nameplate_generator_untitled_filename())}`
			)
		);
		try {
			const files: { name: string; stl: Uint8Array }[] = [];
			for (const [i, name] of names.entries()) {
				const params = $state.snapshot(p) as TagParams;
				params.lines = [name, ...params.lines.slice(1)];
				const lines = tagLines(params, config.maxLines);
				const job: TagJob = { params, maxLines: config.maxLines, mounts: [...config.mounts] };
				const r = await runner.build(job, lines, signal, ...lettering(params));
				files.push({ name: fileNames[i], stl: r.stl });
				batchDone = files.length;
			}
			const what = m.t_nameplate_generator_batch_parts({
				count: files.length,
				n: num(files.length)
			});
			const set = `${config.filePrefix}-${m.t_nameplate_generator_set_filename()}`;
			if (kind === 'zip') {
				const entries = files.map((f) => ({ name: `${f.name}.stl`, data: f.stl }));
				downloadBytes(zipStore(entries), `${set}.zip`, 'application/zip');
				batchNote = m.t_nameplate_generator_batch_done_zip({ parts: what });
			} else {
				const beds = downloadBeds(files, set);
				batchNote = m.t_nameplate_generator_batch_done_beds({
					parts: what,
					beds: m.t_nameplate_generator_batch_beds({ count: beds, n: num(beds) }),
					size: num(bed)
				});
			}
		} catch (e) {
			batchError = readableError(e);
		} finally {
			runner.dispose();
			batchDone = null;
		}
	}

	const L = TAG_LIMITS;
	const bases: { value: TagBase; label: string }[] = [
		{ value: 'tile', label: m.t_nameplate_generator_base_tile() },
		{ value: 'contour', label: m.t_nameplate_generator_base_contour() }
	];
	const shapes: { value: TagShape; label: string }[] = [
		{ value: 'rounded', label: m.t_nameplate_generator_shape_rounded() },
		{ value: 'circle', label: m.t_nameplate_generator_shape_circle() },
		{ value: 'oval', label: m.t_nameplate_generator_shape_oval() },
		{ value: 'hexagon', label: m.t_nameplate_generator_shape_hexagon() },
		{ value: 'dogtag', label: m.t_nameplate_generator_shape_dogtag() },
		{ value: 'heart', label: m.t_nameplate_generator_shape_heart() },
		{ value: 'bone', label: m.t_nameplate_generator_shape_bone() }
	];
	const MOUNT_LABELS: Record<TagMount, string> = {
		loop: m.t_nameplate_generator_mount_loop(),
		hole: m.t_nameplate_generator_mount_hole(),
		holes2: m.t_nameplate_generator_mount_holes2(),
		holes4: m.t_nameplate_generator_mount_holes4(),
		none: m.t_nameplate_generator_mount_none()
	};
	const contour = $derived(p.base === 'contour');
	const mountOptions = $derived(
		config.mounts
			.filter((mount) => !contour || mount === 'loop' || mount === 'none')
			.map((mount) => ({ value: mount, label: MOUNT_LABELS[mount] }))
	);
	const placements: { value: TagPlacement; label: string }[] = [
		{ value: 'left', label: m.t_nameplate_generator_placement_left() },
		{ value: 'right', label: m.t_nameplate_generator_placement_right() },
		{ value: 'top', label: m.t_nameplate_generator_placement_top() },
		{ value: 'top-left', label: m.t_nameplate_generator_placement_top_left() },
		{ value: 'top-right', label: m.t_nameplate_generator_placement_top_right() }
	];
	const loopShapes: { value: LoopShape; label: string }[] = [
		{ value: 'pill', label: m.t_nameplate_generator_loop_pill() },
		{ value: 'flat', label: m.t_nameplate_generator_loop_flat() }
	];
	const weights: { value: TextWeight; label: string }[] = [
		{ value: 'regular', label: m.t_nameplate_generator_weight_regular() },
		{ value: 'bold', label: m.t_nameplate_generator_weight_bold() }
	];
	const modes: { value: ReliefMode; label: string }[] = [
		{ value: 'raised', label: m.t_nameplate_generator_mode_raised() },
		{ value: 'engraved', label: m.t_nameplate_generator_mode_engraved() }
	];
	const magnetCounts: { value: 0 | 1 | 2; label: string }[] = [
		{ value: 0, label: tc.tc_none() },
		{ value: 1, label: m.t_nameplate_generator_magnets_one() },
		{ value: 2, label: m.t_nameplate_generator_magnets_two() }
	];
	const lineLabels = [1, 2, 3].map((n) => m.t_nameplate_generator_line({ n }));
	const linePlaceholders = [
		m.t_nameplate_generator_line1_placeholder(),
		m.t_nameplate_generator_line2_placeholder(),
		m.t_nameplate_generator_line3_placeholder()
	];
	// The outline of the letters has no room for holes: only the loop stays.
	$effect(() => {
		if (contour && p.mount !== 'loop' && p.mount !== 'none') p.mount = 'loop';
	});
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
		...(parts > 1
			? [
					{
						label: tc.tc_download_3mf_colours(),
						icon: Layers,
						onClick: () => void download3mf()
					},
					{
						label: m.t_nameplate_generator_download_parts(),
						icon: Download,
						onClick: () => void downloadParts()
					}
				]
			: []),
		{
			label: m.t_nameplate_generator_download_svg(),
			icon: Download,
			onClick: () => void downloadSvg()
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each config.presets as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>

		<FieldGroup title={tc.tc_shape()}>
			<ChoiceField
				label={m.t_nameplate_generator_base()}
				bind:value={p.base}
				options={bases}
				hint={contour ? m.t_nameplate_generator_base_contour_hint() : undefined}
			/>
			{#if contour}
				<NumberField
					label={m.t_nameplate_generator_contour_pad()}
					unit="mm"
					bind:value={p.contourPad}
					min={L.contourPad[0]}
					max={L.contourPad[1]}
					step={0.5}
				/>
			{:else}
				<ChoiceField
					label={m.t_nameplate_generator_outline()}
					bind:value={p.shape}
					options={shapes}
				/>
				<NumberField
					label={p.shape === 'circle' ? tc.tc_diameter() : tc.tc_width()}
					unit="mm"
					bind:value={p.width}
					min={L.width[0]}
					max={L.width[1]}
				/>
				{#if p.shape !== 'circle'}
					<NumberField
						label={tc.tc_height()}
						unit="mm"
						bind:value={p.height}
						min={L.height[0]}
						max={L.height[1]}
					/>
				{/if}
				{#if p.shape === 'rounded' || p.shape === 'hexagon'}
					<NumberField
						label={tc.tc_corner_radius()}
						unit="mm"
						bind:value={p.radius}
						min={L.radius[0]}
						max={L.radius[1]}
						step={0.5}
					/>
				{/if}
			{/if}
			<NumberField
				label={m.t_nameplate_generator_base_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={L.thickness[0]}
				max={L.thickness[1]}
				step={0.2}
				hint={m.t_nameplate_generator_base_thickness_hint()}
			/>
		</FieldGroup>

		<FieldGroup title={tc.tc_text()}>
			{#each lineLabels.slice(0, config.maxLines) as label, i (label)}
				<TextField
					{label}
					bind:value={p.lines[i]}
					maxlength={28}
					placeholder={linePlaceholders[i]}
				/>
			{/each}
			<NumberField
				label={m.t_nameplate_generator_cap_height()}
				unit="mm"
				bind:value={p.textHeight}
				min={L.textHeight[0]}
				max={L.textHeight[1]}
				step={0.5}
				hint={m.t_nameplate_generator_cap_height_hint()}
			/>
			<ChoiceField
				label={m.t_nameplate_generator_weight()}
				bind:value={p.weight}
				options={weights}
			/>
			<FontField bind:value={p.font} />
			<ChoiceField label={m.t_nameplate_generator_mode()} bind:value={p.mode} options={modes} />
			<NumberField
				label={p.mode === 'engraved' ? tc.tc_depth() : m.t_nameplate_generator_relief_raised()}
				unit="mm"
				bind:value={p.relief}
				min={L.relief[0]}
				max={L.relief[1]}
				step={0.1}
			/>
		</FieldGroup>

		{#if !contour}
			<FieldGroup title={m.t_nameplate_generator_qr_and_frame()}>
				<ToggleField
					label={m.t_nameplate_generator_qr()}
					bind:checked={p.qr}
					hint={m.t_nameplate_generator_qr_hint()}
				/>
				{#if p.qr}
					<TextField
						label={m.t_nameplate_generator_qr_text()}
						bind:value={p.qrText}
						maxlength={160}
						placeholder={m.t_nameplate_generator_qr_text_placeholder()}
					/>
					<NumberField
						label={m.t_nameplate_generator_qr_size()}
						unit="mm"
						bind:value={p.qrSize}
						min={L.qrSize[0]}
						max={L.qrSize[1]}
						hint={m.t_nameplate_generator_qr_size_hint()}
					/>
				{/if}
				<ToggleField
					label={tc.tc_frame()}
					bind:checked={p.frame}
					hint={m.t_nameplate_generator_frame_hint()}
				/>
				{#if p.frame}
					<NumberField
						label={m.t_nameplate_generator_frame_width()}
						unit="mm"
						bind:value={p.frameWidth}
						min={L.frameWidth[0]}
						max={L.frameWidth[1]}
						step={0.1}
					/>
				{/if}
			</FieldGroup>
		{/if}

		<FieldGroup title={tc.tc_mount()}>
			<ChoiceField
				label={m.t_nameplate_generator_mount()}
				bind:value={p.mount}
				options={mountOptions}
			/>
			{#if p.mount === 'loop' || p.mount === 'hole'}
				<ChoiceField
					label={m.t_nameplate_generator_placement()}
					bind:value={p.placement}
					options={placements}
				/>
			{/if}
			{#if p.mount === 'loop'}
				<ChoiceField
					label={m.t_nameplate_generator_loop_shape()}
					bind:value={p.loopShape}
					options={loopShapes}
				/>
			{/if}
			{#if p.mount !== 'none'}
				<NumberField
					label={tc.tc_hole_diameter()}
					unit="mm"
					bind:value={p.holeDiameter}
					min={L.holeDiameter[0]}
					max={L.holeDiameter[1]}
					step={0.5}
				/>
				<NumberField
					label={p.mount === 'loop'
						? m.t_nameplate_generator_ring_loop()
						: m.t_nameplate_generator_ring_holes()}
					unit="mm"
					bind:value={p.ringWidth}
					min={L.ringWidth[0]}
					max={L.ringWidth[1]}
					step={0.5}
				/>
			{/if}
			{#if p.mount === 'loop'}
				<ToggleField
					label={m.t_nameplate_generator_both_sides()}
					bind:checked={p.bothSides}
					hint={m.t_nameplate_generator_both_sides_hint()}
				/>
			{/if}
			{#if p.mount === 'holes2' || p.mount === 'holes4'}
				<ToggleField
					label={m.t_nameplate_generator_countersink()}
					bind:checked={p.countersink}
					hint={m.t_nameplate_generator_countersink_hint()}
				/>
			{/if}
		</FieldGroup>

		{#if !contour}
			<FieldGroup title={m.t_nameplate_generator_back()}>
				<ChoiceField
					label={m.t_nameplate_generator_magnets()}
					bind:value={p.magnets}
					options={magnetCounts}
				/>
				{#if p.magnets > 0}
					<NumberField
						label={m.t_nameplate_generator_magnet_diameter()}
						unit="mm"
						bind:value={p.magnetDiameter}
						min={L.magnetDiameter[0]}
						max={L.magnetDiameter[1]}
						step={0.5}
						hint={m.t_nameplate_generator_magnet_diameter_hint()}
					/>
					<NumberField
						label={m.t_nameplate_generator_magnet_depth()}
						unit="mm"
						bind:value={p.magnetDepth}
						min={L.magnetDepth[0]}
						max={L.magnetDepth[1]}
						step={0.2}
					/>
				{/if}
				{#if config.adhesive}
					<ToggleField
						label={m.t_nameplate_generator_adhesive()}
						bind:checked={p.adhesive}
						hint={m.t_nameplate_generator_adhesive_hint()}
					/>
					{#if p.adhesive}
						<NumberField
							label={m.t_nameplate_generator_adhesive_depth()}
							unit="mm"
							bind:value={p.adhesiveDepth}
							min={L.adhesiveDepth[0]}
							max={L.adhesiveDepth[1]}
							step={0.1}
						/>
					{/if}
				{/if}
			</FieldGroup>
		{/if}

		<FieldGroup title={m.t_nameplate_generator_batch()}>
			<div>
				<label for="tag-batch" class="label">{m.t_nameplate_generator_batch_names()}</label>
				<textarea
					id="tag-batch"
					class="input"
					rows="5"
					bind:value={batch}
					placeholder={m.t_nameplate_generator_batch_placeholder()}
					aria-describedby="tag-batch-hint"></textarea>
				<p id="tag-batch-hint" class="hint">
					{m.t_nameplate_generator_batch_hint({ max: BATCH_MAX })}
				</p>
			</div>
			{#if names.length}
				<NumberField
					label={m.t_nameplate_generator_bed()}
					unit="mm"
					bind:value={bed}
					min={100}
					max={400}
					step={10}
					hint={m.t_nameplate_generator_bed_hint()}
				/>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						class="btn-ghost btn-s"
						disabled={batchDone !== null}
						onclick={() => void downloadBatch('zip')}
					>
						<FileArchive size={14} aria-hidden="true" />
						{m.t_nameplate_generator_batch_zip()}
					</button>
					<button
						type="button"
						class="btn-ghost btn-s"
						disabled={batchDone !== null}
						onclick={() => void downloadBatch('beds')}
					>
						<LayoutGrid size={14} aria-hidden="true" />
						{m.t_nameplate_generator_batch_beds_button()}
					</button>
				</div>
			{/if}
			{#if batchDone !== null}
				<p class="hint" role="status">
					{m.t_nameplate_generator_batch_progress({ n: batchDone + 1, total: names.length })}
				</p>
			{:else if batchNote}
				<p class="hint" role="status">{batchNote}</p>
			{/if}
			{#if batchError}<p class="field-error" role="alert">{batchError}</p>{/if}
		</FieldGroup>

		{#if result}
			{@const info = result.info}
			<FieldGroup title={m.t_nameplate_generator_before_print()}>
				{#if info.colorChange !== null}
					{@const height = fmt(info.colorChange)}
					{@const frame = p.frame && !contour}
					<div class="notice">
						<Palette size={16} aria-hidden="true" />
						<p>
							{#if p.mode === 'engraved'}
								{m.t_nameplate_generator_colour_engraved({ height })}
							{:else if info.qr && frame}
								{m.t_nameplate_generator_colour_raised_qr_frame({ height })}
							{:else if info.qr}
								{m.t_nameplate_generator_colour_raised_qr({ height })}
							{:else if frame}
								{m.t_nameplate_generator_colour_raised_frame({ height })}
							{:else}
								{m.t_nameplate_generator_colour_raised({ height })}
							{/if}
							{#if parts > 1}{m.t_nameplate_generator_colour_3mf({
									button: tc.tc_download_3mf_colours()
								})}{/if}
						</p>
					</div>
				{/if}
				{#if info.qr}
					<p class="text-xs text-neutral-400">
						{m.t_nameplate_generator_qr_info({
							side: fmt(info.qr.side),
							size: num(info.qr.size),
							module: fmt(info.qr.module)
						})}
					</p>
				{/if}
				{#each info.warnings as warning (warning)}
					<div class="notice notice-warning" role="status">
						<TriangleAlert size={16} aria-hidden="true" />
						<p>{warning}</p>
					</div>
				{:else}
					<div class="notice notice-success">
						<CircleCheck size={16} aria-hidden="true" />
						<p>{m.t_nameplate_generator_no_problems()}</p>
					</div>
				{/each}
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>
