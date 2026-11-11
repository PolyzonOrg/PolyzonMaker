<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { CircleCheck, Download, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { downloadBytes, type MeshStats } from '$lib/tools/stl';
	import { createWorkerRunner, type WorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import { MODEL_ACCEPT, modelHint, modelForWorker } from '$lib/tools/shared/model-file';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import type { RepairMode } from '$lib/tools/shared/mesh-repair';
	import type { ToolInfo } from '$lib/tools/registry';
	import { num } from '$lib/i18n/current';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/stl-repair';
	import { REPAIR_MODES, repairedFileName, type RepairJob, type RepairResult } from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let file = $state.raw<File | null>(null);
	let fileId = 0;
	let mode = $state<RepairMode>('standard');
	let removeShells = $state(false);
	let view = $state<'before' | 'after'>('after');
	let stage = $state<string | null>(null);

	function open(next: File) {
		fileId++;
		file = next;
		view = 'after';
	}
	onMount(() => {
		const handed = takeHandedOffMesh();
		if (handed) open(handed);
	});

	interface Params {
		file: File;
		fileId: number;
		mode: RepairMode;
		removeShells: boolean;
	}
	let runner: WorkerRunner<RepairJob, RepairResult> | null = null;
	const build = createBuild<Params, RepairResult>(async (p, signal) => {
		const { name, bytes } = await modelForWorker(p.file);
		runner ??= createWorkerRunner(
			() =>
				new Worker(new URL('./repair.worker.ts', import.meta.url), {
					type: 'module',
					name: workerName('repair')
				})
		);
		try {
			return await runner.run(
				{
					fileId: p.fileId,
					name,
					bytes,
					options: { mode: p.mode, removeShells: p.removeShells }
				},
				signal,
				{ transfer: [bytes.buffer], onProgress: (s) => (stage = s) }
			);
		} finally {
			stage = null;
		}
	}, 300);
	$effect(() => {
		const params = { mode, removeShells };
		if (file) build.run({ file, fileId, ...params });
	});
	onDestroy(() => {
		build.cancel();
		runner?.dispose();
	});

	const result = $derived(build.value);
	const modeHint = $derived(REPAIR_MODES.find((o) => o.value === mode)?.hint ?? '');
	const n = (v: number) => num(v, 0);

	const rows = $derived.by(() => {
		if (!result) return [];
		const { before, after, report } = result;
		const pair = (label: string, key: keyof MeshStats) => ({
			label,
			value: `${n(before[key] as number)} → ${n(after[key] as number)}`,
			meta: ''
		});
		const count = (label: string, v: number, meta = '') => ({ label, value: n(v), meta });
		return [
			pair(m.t_stl_repair_row_triangles(), 'triangles'),
			pair(m.t_stl_repair_row_open_edges(), 'openEdges'),
			pair(m.t_stl_repair_row_non_manifold(), 'nonManifoldEdges'),
			count(
				m.t_stl_repair_row_holes(),
				report.holesFilled,
				report.holeTriangles
					? m.t_stl_repair_row_hole_triangles({ count: n(report.holeTriangles) })
					: ''
			),
			// «Только мусор» leaves the winding alone: nothing to report there.
			...(mode === 'minimal'
				? []
				: [count(m.t_stl_repair_row_flipped(), report.flipped, m.t_stl_repair_row_flipped_meta())]),
			count(
				m.t_stl_repair_row_degenerate(),
				report.degenerate,
				m.t_stl_repair_row_degenerate_meta()
			),
			count(m.t_stl_repair_row_duplicates(), report.duplicates),
			...(mode === 'aggressive'
				? [count(m.t_stl_repair_row_non_manifold_cut(), report.nonManifold)]
				: []),
			...(removeShells ? [count(m.t_stl_repair_row_shells(), report.shellsRemoved)] : []),
			count(m.t_stl_repair_row_welded(), report.weldedVertices, m.t_stl_repair_row_welded_meta())
		];
	});
</script>

<ToolShell
	{tool}
	stl={result ? (view === 'before' ? result.original : result.repaired) : null}
	busy={build.busy}
	busyLabel={stage ? `${stage}…` : m.t_stl_repair_busy()}
	error={build.error}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () =>
				result && file && downloadBytes(result.repaired, repairedFileName(file.name), 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_model()}>
			<FileField
				label={m.t_stl_repair_upload()}
				accept={MODEL_ACCEPT}
				hint={modelHint()}
				fileName={file?.name ?? null}
				maxBytes={300 * 1024 * 1024}
				onfile={open}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_stl_repair_group_repair()}>
			<ChoiceField
				label={m.t_stl_repair_mode()}
				bind:value={mode}
				options={REPAIR_MODES}
				hint={modeHint}
			/>
			<ToggleField
				label={m.t_stl_repair_remove_shells()}
				bind:checked={removeShells}
				hint={m.t_stl_repair_remove_shells_hint()}
			/>
		</FieldGroup>
		{#if result}
			<FieldGroup title={tc.tc_result()}>
				{#if result.after.watertight}
					<div class="notice notice-success">
						<CircleCheck size={16} aria-hidden="true" />
						<p>
							<span class="font-medium text-neutral-100">{m.t_stl_repair_watertight()}</span>
							{result.before.watertight
								? m.t_stl_repair_watertight_before()
								: m.t_stl_repair_watertight_fixed()}
						</p>
					</div>
				{:else}
					<div class="notice notice-warning">
						<TriangleAlert size={16} aria-hidden="true" />
						<p>
							<span class="font-medium text-neutral-100">{m.t_stl_repair_flaws_left()}</span>
							{mode === 'minimal' ? m.t_stl_repair_flaws_minimal() : m.t_stl_repair_flaws_other()}
						</p>
					</div>
				{/if}
				<ChoiceField
					label={m.t_stl_repair_show()}
					bind:value={view}
					options={[
						{ value: 'before', label: m.t_stl_repair_show_before() },
						{ value: 'after', label: m.t_stl_repair_show_after() }
					]}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_stl_repair_group_compare()}>
				<ul class="list">
					{#each rows as row (row.label)}
						<li class="list-row">
							<div class="min-w-0 flex-1">
								<div class="text-sm font-medium">{row.label}</div>
								{#if row.meta}<div class="mt-1 text-xs text-neutral-400">{row.meta}</div>{/if}
							</div>
							<span class="shrink-0 text-sm tabular-nums">{row.value}</span>
						</li>
					{/each}
				</ul>
			</FieldGroup>
		{/if}
	{/snippet}
	{#snippet empty()}
		<p>{m.t_stl_repair_empty_upload()}</p>
		<p class="mt-1">{m.t_stl_repair_empty_private()}</p>
	{/snippet}
</ToolShell>
