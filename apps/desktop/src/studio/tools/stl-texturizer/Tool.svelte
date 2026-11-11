<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Download, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, readableError, SLOW_BUILD_MS } from '$lib/tools/build.svelte';
	import { downloadBytes, writeStl, type Triangles } from '$lib/tools/stl';
	import { formatBytes } from '$lib/generation-view';
	import type { ToolInfo } from '$lib/tools/registry';
	import { num } from '$lib/i18n/current';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/stl-texturizer';
	import { MODEL_ACCEPT, modelHint, readModelFile } from '$lib/tools/shared/model-file';
	import { runJob } from '$lib/tools/voxelizer/run-job';
	import {
		TEXTURE_DEFAULTS,
		TEXTURE_LIMITS,
		type Projection,
		type ReliefSide,
		type TextureParams
	} from './model';
	import { PATTERNS, type HeightImage } from './patterns';
	import { readHeightImage } from './image';
	import type { TextureJobResult } from './texture.worker';

	let { tool }: { tool: ToolInfo } = $props();

	interface Loaded {
		id: number;
		name: string;
		tris: Triangles;
		stl: Uint8Array;
	}

	const patternOptions = [
		...PATTERNS.map((pattern) => ({ value: pattern.id, label: pattern.label })),
		{ value: 'image' as const, label: m.t_stl_texturizer_pattern_image() }
	];
	const projections: { value: Projection; label: string; hint: string }[] = [
		{
			value: 'auto',
			label: m.t_stl_texturizer_projection_auto(),
			hint: m.t_stl_texturizer_projection_auto_hint()
		},
		{
			value: 'around',
			label: m.t_stl_texturizer_projection_around(),
			hint: m.t_stl_texturizer_projection_around_hint()
		},
		{
			value: 'radial',
			label: m.t_stl_texturizer_projection_radial(),
			hint: m.t_stl_texturizer_projection_radial_hint()
		},
		...(['top', 'front', 'side'] as const).map((value, i) => ({
			value,
			label: [
				m.t_stl_texturizer_projection_top(),
				m.t_stl_texturizer_projection_front(),
				m.t_stl_texturizer_projection_side()
			][i],
			hint: m.t_stl_texturizer_projection_straight_hint()
		}))
	];
	const sides: { value: ReliefSide; label: string; hint: string }[] = [
		{
			value: 'out',
			label: m.t_stl_texturizer_side_out(),
			hint: m.t_stl_texturizer_side_out_hint()
		},
		{
			value: 'in',
			label: m.t_stl_texturizer_side_in(),
			hint: m.t_stl_texturizer_side_in_hint()
		},
		{
			value: 'both',
			label: m.t_stl_texturizer_side_both(),
			hint: m.t_stl_texturizer_side_both_hint()
		}
	];

	let model = $state.raw<Loaded | null>(null);
	let image = $state.raw<{ name: string; data: HeightImage } | null>(null);
	let reading = $state(false);
	let fileError = $state<string | null>(null);
	let p = $state<TextureParams>({ ...TEXTURE_DEFAULTS });
	let stage = $state<string>(m.t_stl_texturizer_stage_split());

	type Job = { model: Loaded; params: TextureParams; image: HeightImage | null };
	const build = createBuild<Job, TextureJobResult & { modelId: number; pattern: string }>(
		async (job, signal) => {
			stage = m.t_stl_texturizer_stage_split();
			const { default: TextureWorker } = await import('./texture.worker.ts?worker');
			const result = await runJob<TextureJobResult>(
				() => new TextureWorker({ name: workerName('texture') }),
				{ tris: job.model.tris, params: job.params, image: job.image },
				signal,
				(label, percent) => (stage = m.t_stl_texturizer_stage_percent({ stage: label, percent }))
			);
			return { ...result, modelId: job.model.id, pattern: job.params.pattern };
		},
		500,
		{ manualAfterMs: SLOW_BUILD_MS }
	);
	$effect(() => {
		const params = { ...p };
		const picture = params.pattern === 'image' ? (image?.data ?? null) : null;
		// A custom pattern waits for its picture.
		if (model && (params.pattern !== 'image' || picture))
			build.run({ model, params, image: picture });
	});
	onDestroy(() => build.cancel());

	const result = $derived(build.value?.modelId === model?.id ? build.value : null);
	const waiting = $derived(p.pattern === 'image' && !image);
	const shown = $derived(model && (result && !waiting ? result.stl : model.stl));
	const projectionHint = $derived(projections.find((o) => o.value === p.projection)?.hint);
	const sideHint = $derived(sides.find((o) => o.value === p.side)?.hint);

	let nextId = 0;
	async function upload(file: File) {
		reading = true;
		fileError = null;
		try {
			const tris = await readModelFile(file);
			build.fresh();
			model = { id: ++nextId, name: file.name, tris, stl: writeStl(tris) };
		} catch (e) {
			fileError = readableError(e);
		} finally {
			reading = false;
		}
	}

	async function uploadImage(file: File) {
		fileError = null;
		try {
			image = { name: file.name, data: await readHeightImage(file) };
		} catch (e) {
			fileError = readableError(e);
		}
	}
</script>

<ToolShell
	{tool}
	stl={shown}
	busy={reading || build.busy}
	busyLabel={reading ? m.t_stl_texturizer_reading() : stage}
	error={fileError ?? (model ? build.error : null)}
	stale={build.stale}
	onrebuild={build.flush}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			disabled: !result || waiting,
			onClick: () =>
				result && downloadBytes(result.stl, `texture-${result.pattern}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_model()}>
			<div>
				<FileField
					label={m.t_stl_texturizer_pick_model()}
					accept={MODEL_ACCEPT}
					hint={modelHint()}
					fileName={model?.name ?? null}
					onfile={(file) => void upload(file)}
				/>
				{#if model}<p class="hint">
						{m.t_stl_texturizer_triangles({
							count: model.tris.length / 9,
							n: num(model.tris.length / 9)
						})}
					</p>{/if}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_pattern()}>
			<ChoiceField
				label={m.t_stl_texturizer_pattern()}
				bind:value={p.pattern}
				options={patternOptions}
			/>
			{#if p.pattern === 'image'}
				<FileField
					label={m.t_stl_texturizer_pick_image()}
					accept="image/png,image/jpeg,image/webp"
					hint={m.t_stl_texturizer_pick_image_hint()}
					fileName={image?.name ?? null}
					maxBytes={20 * 1024 * 1024}
					onfile={(file) => void uploadImage(file)}
				/>
				{#if model && waiting}
					<div class="notice">
						<TriangleAlert size={16} aria-hidden="true" />
						<p>{m.t_stl_texturizer_waiting_image()}</p>
					</div>
				{/if}
			{/if}
			<NumberField
				label={m.t_stl_texturizer_tile()}
				unit="mm"
				bind:value={p.tile}
				min={TEXTURE_LIMITS.tile[0]}
				max={TEXTURE_LIMITS.tile[1]}
				step={0.5}
				hint={m.t_stl_texturizer_tile_hint()}
			/>
			<NumberField
				label={m.t_stl_texturizer_rotation()}
				unit="°"
				bind:value={p.rotation}
				min={TEXTURE_LIMITS.rotation[0]}
				max={TEXTURE_LIMITS.rotation[1]}
				step={5}
			/>
			<ToggleField label={m.t_stl_texturizer_invert()} bind:checked={p.invert} />
		</FieldGroup>
		<FieldGroup title={m.t_stl_texturizer_group_relief()}>
			<NumberField
				label={tc.tc_relief_height()}
				unit="mm"
				bind:value={p.depth}
				min={TEXTURE_LIMITS.depth[0]}
				max={TEXTURE_LIMITS.depth[1]}
				step={0.05}
			/>
			<ChoiceField
				label={m.t_stl_texturizer_side()}
				bind:value={p.side}
				options={sides}
				hint={sideHint}
			/>
			<ChoiceField
				label={m.t_stl_texturizer_projection()}
				bind:value={p.projection}
				options={projections}
				hint={projectionHint}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_stl_texturizer_group_keep()}>
			<ToggleField
				label={tc.tc_bottom()}
				bind:checked={p.smoothBottom}
				hint={m.t_stl_texturizer_smooth_bottom_hint()}
			/>
			<ToggleField
				label={m.t_stl_texturizer_smooth_top()}
				bind:checked={p.smoothTop}
				hint={m.t_stl_texturizer_smooth_top_hint()}
			/>
			{#if p.smoothBottom || p.smoothTop}
				<NumberField
					label={m.t_stl_texturizer_flat_tolerance()}
					unit="°"
					bind:value={p.flatTolerance}
					min={TEXTURE_LIMITS.flatTolerance[0]}
					max={TEXTURE_LIMITS.flatTolerance[1]}
					hint={m.t_stl_texturizer_flat_tolerance_hint()}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_stl_texturizer_group_mesh()}>
			<NumberField
				label={m.t_stl_texturizer_edge()}
				unit="mm"
				bind:value={p.edge}
				min={TEXTURE_LIMITS.edge[0]}
				max={TEXTURE_LIMITS.edge[1]}
				step={0.05}
				hint={m.t_stl_texturizer_edge_hint()}
			/>
		</FieldGroup>
		{#if result}
			<FieldGroup title={tc.tc_result()}>
				{#each result.warnings as warning (warning)}
					<div class="notice notice-warning">
						<TriangleAlert size={16} aria-hidden="true" />
						<p>{warning}</p>
					</div>
				{/each}
				<dl class="card grid grid-cols-2 gap-4">
					<div>
						<dt class="text-xs text-neutral-400">{m.t_stl_texturizer_result_triangles()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">{num(result.triangles, 0)}</dd>
					</div>
					<div>
						<dt class="text-xs text-neutral-400">{m.t_stl_texturizer_edge()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">
							{m.t_stl_texturizer_edge_value({ edge: num(result.edge, 2) })}
						</dd>
					</div>
					<div>
						<dt class="text-xs text-neutral-400">{m.t_stl_texturizer_result_stl_size()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">
							{formatBytes(result.stl.byteLength)}
						</dd>
					</div>
				</dl>
			</FieldGroup>
		{/if}
	{/snippet}
	{#snippet empty()}
		{m.t_stl_texturizer_empty()}
	{/snippet}
</ToolShell>
