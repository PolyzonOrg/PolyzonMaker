<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		Box,
		CircleCheck,
		Crosshair,
		Ruler,
		SquareDashed,
		Triangle,
		TriangleAlert,
		Weight,
		Wrench
	} from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { createWorkerRunner, type WorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import { MODEL_ACCEPT, modelHint, modelForWorker } from '$lib/tools/shared/model-file';
	import { handOffMesh, takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import type { ToolInfo } from '$lib/tools/registry';
	import { MATERIALS, weightGrams, type AnalyzeJob, type AnalyzeResult } from './model';
	import Rich from '$lib/components/Rich.svelte';
	import { num } from '$lib/i18n/current';
	import { slots } from '$lib/i18n/rich';
	import { workerName } from '$lib/i18n/worker';
	import * as m from '$msg/tools/stl-viewer';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let file = $state.raw<File | null>(null);
	let material = $state('pla');
	// A model sent from another page (a generation) opens at once.
	onMount(() => {
		const handed = takeHandedOffMesh();
		if (handed) file = handed;
	});
	let showHoles = $state(true);
	let stage = $state<string | null>(null);

	let runner: WorkerRunner<AnalyzeJob, AnalyzeResult> | null = null;
	const build = createBuild<File, AnalyzeResult>(async (input, signal) => {
		const { name, bytes } = await modelForWorker(input);
		runner ??= createWorkerRunner(
			() =>
				new Worker(new URL('./analyze.worker.ts', import.meta.url), {
					type: 'module',
					name: workerName('analyze')
				})
		);
		try {
			return await runner.run({ name, bytes }, signal, {
				transfer: [bytes.buffer],
				onProgress: (s) => (stage = s)
			});
		} finally {
			stage = null;
		}
	}, 0);
	$effect(() => {
		if (file) build.run(file);
	});
	onDestroy(() => {
		build.cancel();
		runner?.dispose();
	});

	const stats = $derived(build.value?.stats ?? null);
	const density = $derived(MATERIALS.find((x) => x.id === material)?.density ?? 1.24);
	// Values that round to zero print as 0, not «-0».
	const fmt = (n: number, digits = 1) => num(Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n, digits);
	const int = (n: number) => num(n, 0);
	const precise = (n: number) => fmt(n, Math.abs(n) < 10 ? 2 : 1);
	const fileSize = $derived(
		file ? m.t_stl_viewer_file_size({ size: fmt(file.size / 1024 / 1024) }) : ''
	);
</script>

<ToolShell
	{tool}
	stl={build.value?.stl ?? null}
	marks={showHoles ? (build.value?.holes ?? null) : null}
	busy={build.busy}
	busyLabel={stage ? `${stage}…` : m.t_stl_viewer_busy()}
	error={build.error}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_model()}>
			<FileField
				label={m.t_stl_viewer_upload()}
				accept={MODEL_ACCEPT}
				hint={modelHint()}
				fileName={file?.name ?? null}
				maxBytes={300 * 1024 * 1024}
				onfile={(f) => (file = f)}
			/>
		</FieldGroup>
		{#if stats}
			<FieldGroup title={tc.tc_plastic()}>
				<ChoiceField
					label={m.t_stl_viewer_material()}
					bind:value={material}
					options={MATERIALS.map((x) => ({ value: x.id, label: x.label }))}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_stl_viewer_group_size_weight()}>
				<ul class="list">
					<li class="list-row">
						<Ruler size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">{m.t_stl_viewer_bounds()}</div>
							<div class="mt-1 text-xs text-neutral-400">
								{m.t_stl_viewer_diagonal({ value: fmt(Math.hypot(...stats.bounds.size)) })}
							</div>
						</div>
						<span class="text-right text-sm tabular-nums">
							{tc.tc_size_mm({
								x: fmt(stats.bounds.size[0]),
								y: fmt(stats.bounds.size[1]),
								z: fmt(stats.bounds.size[2])
							})}
						</span>
					</li>
					<li class="list-row">
						<Box size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
						<div class="min-w-0 flex-1 text-sm font-medium">{m.t_stl_viewer_volume()}</div>
						<span class="text-sm tabular-nums"
							>{m.t_stl_viewer_volume_value({ value: precise(stats.volume / 1000) })}</span
						>
					</li>
					<li class="list-row">
						<Weight size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">{m.t_stl_viewer_weight()}</div>
							<div class="mt-1 text-xs text-neutral-400">
								{m.t_stl_viewer_weight_note({ density: fmt(density, 2) })}
							</div>
						</div>
						<span class="text-sm tabular-nums"
							>{m.t_stl_viewer_weight_value({
								value: precise(weightGrams(stats.volume, density))
							})}</span
						>
					</li>
					<li class="list-row">
						<SquareDashed size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
						<div class="min-w-0 flex-1 text-sm font-medium">{m.t_stl_viewer_area()}</div>
						<span class="text-sm tabular-nums"
							>{m.t_stl_viewer_area_value({ value: precise(stats.area / 100) })}</span
						>
					</li>
					<li class="list-row">
						<Triangle size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">{m.t_stl_viewer_triangles()}</div>
							<div class="mt-1 truncate text-xs text-neutral-400">{file?.name}, {fileSize}</div>
						</div>
						<span class="text-sm tabular-nums">{int(stats.triangles)}</span>
					</li>
					<li class="list-row">
						<Crosshair size={16} class="shrink-0 text-neutral-500" aria-hidden="true" />
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">{m.t_stl_viewer_center_of_mass()}</div>
							<div class="mt-1 text-xs text-neutral-400">
								{m.t_stl_viewer_center_of_mass_note()}
							</div>
						</div>
						<span class="text-right text-sm tabular-nums">
							{m.t_stl_viewer_center_of_mass_value({
								x: fmt(stats.centerOfMass[0]),
								y: fmt(stats.centerOfMass[1]),
								z: fmt(stats.centerOfMass[2])
							})}
						</span>
					</li>
				</ul>
			</FieldGroup>
			<FieldGroup title={m.t_stl_viewer_group_surface()}>
				{#if stats.watertight && !stats.misoriented}
					<div class="notice notice-success">
						<CircleCheck size={16} aria-hidden="true" />
						<p>
							<Rich text={m.t_stl_viewer_watertight(slots('title'))}>
								{#snippet title()}<span class="font-medium text-neutral-100"
										>{m.t_stl_viewer_watertight_title()}</span
									>{/snippet}
							</Rich>
						</p>
					</div>
				{:else}
					<div class="notice notice-warning">
						<TriangleAlert size={16} aria-hidden="true" />
						<div class="space-y-1">
							<p class="font-medium text-neutral-100">{m.t_stl_viewer_flawed()}</p>
							{#if stats.openEdges}
								<p>{m.t_stl_viewer_open_edges({ count: int(stats.openEdges) })}</p>
							{/if}
							{#if stats.nonManifoldEdges}
								<p>
									{m.t_stl_viewer_non_manifold({ count: int(stats.nonManifoldEdges) })}
								</p>
							{/if}
							{#if stats.misoriented}
								<p>
									{m.t_stl_viewer_misoriented({
										count: stats.misoriented,
										n: int(stats.misoriented)
									})}
								</p>
							{/if}
							<p>
								{m.t_stl_viewer_approximate()}
							</p>
						</div>
					</div>
					{#if stats.openEdges}
						<ToggleField label={m.t_stl_viewer_show_holes()} bind:checked={showHoles} />
					{/if}
					<a
						href="/workspace/tools/stl-repair"
						class="btn-ghost btn-s"
						onclick={() => file && handOffMesh(file)}
					>
						<Wrench size={14} aria-hidden="true" />
						{m.t_stl_viewer_open_repair()}
					</a>
				{/if}
				{#if stats.degenerate}
					<p class="hint">
						{m.t_stl_viewer_degenerate({ count: int(stats.degenerate) })}
					</p>
				{/if}
			</FieldGroup>
		{/if}
	{/snippet}
	{#snippet empty()}
		<p>{m.t_stl_viewer_empty()}</p>
		<p class="mt-1">{m.t_stl_viewer_empty_private()}</p>
	{/snippet}
</ToolShell>
