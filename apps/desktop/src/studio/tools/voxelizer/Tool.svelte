<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, readableError, SLOW_BUILD_MS } from '$lib/tools/build.svelte';
	import { downloadBytes, parseStl, writeStl, type Triangles } from '$lib/tools/stl';
	import { formatBytes } from '$lib/generation-view';
	import { num } from '$lib/i18n/current';
	import { workerName } from '$lib/i18n/worker';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/voxelizer';
	import { VOXEL_DEFAULTS, VOXEL_LIMITS, toObj, type VoxelParams } from './model';
	import { MODEL_ACCEPT, modelHint, readModelFile } from '../shared/model-file';
	import { runJob } from './run-job';
	import type { VoxelResult } from './voxel.worker';

	let { tool }: { tool: ToolInfo } = $props();

	interface Loaded {
		id: number;
		name: string;
		tris: Triangles;
		stl: Uint8Array;
	}

	const PLA_DENSITY = 1.24; // г/см³
	const int = (n: number) => num(n, 0);
	const dec = (n: number) => num(n, 2);

	let model = $state.raw<Loaded | null>(null);
	let reading = $state(false);
	let fileError = $state<string | null>(null);
	let p = $state<VoxelParams>({ ...VOXEL_DEFAULTS });
	let view = $state<'voxels' | 'original'>('voxels');
	let stage = $state<string>(m.t_voxelizer_stage_layout());

	type Job = { model: Loaded; params: VoxelParams };
	const build = createBuild<Job, VoxelResult & { modelId: number }>(
		async (job, signal) => {
			stage = m.t_voxelizer_stage_layout();
			const { default: VoxelWorker } = await import('./voxel.worker.ts?worker');
			const result = await runJob<VoxelResult>(
				() => new VoxelWorker({ name: workerName('voxel') }),
				{ tris: job.model.tris, params: job.params },
				signal,
				(label, percent) => (stage = m.t_voxelizer_stage_progress({ label, percent }))
			);
			return { ...result, modelId: job.model.id };
		},
		400,
		{ manualAfterMs: SLOW_BUILD_MS }
	);
	$effect(() => {
		if (model) build.run({ model, params: { ...p } });
	});
	onDestroy(() => build.cancel());

	// The last result belongs to this file only; a new file shows itself first.
	const result = $derived(build.value?.modelId === model?.id ? build.value : null);
	const shown = $derived(model && (view === 'voxels' && result ? result.stl : model.stl));
	const volume = $derived(result ? (result.voxels * result.grid.size ** 3) / 1000 : 0);

	let nextId = 0;
	async function upload(file: File) {
		reading = true;
		fileError = null;
		try {
			const tris = await readModelFile(file);
			build.fresh();
			model = { id: ++nextId, name: file.name, tris, stl: writeStl(tris) };
			view = 'voxels';
		} catch (e) {
			fileError = readableError(e);
		} finally {
			reading = false;
		}
	}

	const fileBase = () =>
		`${m.t_voxelizer_filename()}-${result ? Math.max(...result.grid.n) : p.resolution}`;
	let saving = $state(false);
	async function save(kind: 'stl' | 'obj' | 'glb') {
		if (!result) return;
		if (kind === 'stl') return downloadBytes(result.stl, `${fileBase()}.stl`, 'model/stl');
		saving = true;
		try {
			const tris = parseStl(result.stl);
			if (kind === 'obj') downloadBytes(toObj(tris), `${fileBase()}.obj`, 'model/obj');
			else {
				const { toGlb } = await import('./glb');
				downloadBytes(await toGlb(tris), `${fileBase()}.glb`, 'model/gltf-binary');
			}
		} catch (e) {
			fileError = readableError(e);
		} finally {
			saving = false;
		}
	}
</script>

<ToolShell
	{tool}
	stl={shown}
	busy={reading || build.busy}
	busyLabel={reading ? m.t_voxelizer_reading() : stage}
	error={fileError ?? (model ? build.error : null)}
	stale={build.stale}
	onrebuild={build.flush}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			disabled: !result,
			onClick: () => void save('stl')
		},
		{
			label: m.t_voxelizer_download_obj(),
			disabled: !result || saving,
			onClick: () => void save('obj')
		},
		{
			label: m.t_voxelizer_download_glb(),
			disabled: !result || saving,
			onClick: () => void save('glb')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_model()}>
			<div>
				<FileField
					label={m.t_voxelizer_pick_file()}
					accept={MODEL_ACCEPT}
					hint={modelHint()}
					fileName={model?.name ?? null}
					onfile={(file) => void upload(file)}
				/>
				{#if model}<p class="hint">
						{m.t_voxelizer_triangles_count({
							count: model.tris.length / 9,
							n: int(model.tris.length / 9)
						})}
					</p>{/if}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_voxelizer_cubes()}>
			<ChoiceField
				label={m.t_voxelizer_sizing()}
				bind:value={p.sizing}
				options={[
					{ value: 'resolution', label: m.t_voxelizer_sizing_resolution() },
					{ value: 'size', label: m.t_voxelizer_sizing_size() }
				]}
			/>
			{#if p.sizing === 'resolution'}
				<NumberField
					label={m.t_voxelizer_resolution()}
					bind:value={p.resolution}
					min={VOXEL_LIMITS.resolution[0]}
					max={VOXEL_LIMITS.resolution[1]}
					hint={m.t_voxelizer_resolution_hint()}
				/>
			{:else}
				<NumberField
					label={m.t_voxelizer_voxel_size()}
					unit="mm"
					bind:value={p.voxelSize}
					min={VOXEL_LIMITS.voxelSize[0]}
					max={VOXEL_LIMITS.voxelSize[1]}
					step={0.1}
				/>
			{/if}
			<ToggleField
				label={m.t_voxelizer_hollow()}
				bind:checked={p.hollow}
				hint={m.t_voxelizer_hollow_hint()}
			/>
		</FieldGroup>
		{#if model}
			<FieldGroup title={m.t_voxelizer_scene()}>
				<ChoiceField
					label={m.t_voxelizer_show()}
					bind:value={view}
					options={[
						{ value: 'voxels', label: tc.tc_result() },
						{ value: 'original', label: m.t_voxelizer_show_original() }
					]}
				/>
			</FieldGroup>
		{/if}
		{#if result}
			<FieldGroup title={tc.tc_result()}>
				<dl class="card grid grid-cols-2 gap-4">
					<div>
						<dt class="text-xs text-neutral-400">{m.t_voxelizer_total()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">{int(result.voxels)}</dd>
					</div>
					<div>
						<dt class="text-xs text-neutral-400">{m.t_voxelizer_voxel_size()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">
							{m.t_voxelizer_edge_value({ size: dec(result.grid.size) })}
						</dd>
					</div>
					<div>
						<dt class="text-xs text-neutral-400">{m.t_voxelizer_grid()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">{result.grid.n.join(' × ')}</dd>
					</div>
					<div>
						<dt class="text-xs text-neutral-400">{m.t_voxelizer_triangles()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">{int(result.triangles)}</dd>
					</div>
					<div>
						<dt class="text-xs text-neutral-400">{m.t_voxelizer_volume()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">
							{m.t_voxelizer_volume_value({ volume: dec(volume) })}
						</dd>
					</div>
					<div>
						<dt class="text-xs text-neutral-400">{m.t_voxelizer_mass()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">
							{m.t_voxelizer_mass_value({ mass: int(Math.round(volume * PLA_DENSITY)) })}
						</dd>
					</div>
					<div>
						<dt class="text-xs text-neutral-400">{m.t_voxelizer_stl_size()}</dt>
						<dd class="mt-1 text-sm font-medium tabular-nums">
							{formatBytes(result.stl.byteLength)}
						</dd>
					</div>
				</dl>
			</FieldGroup>
		{/if}
	{/snippet}
	{#snippet empty()}
		{m.t_voxelizer_empty()}
	{/snippet}
</ToolShell>
