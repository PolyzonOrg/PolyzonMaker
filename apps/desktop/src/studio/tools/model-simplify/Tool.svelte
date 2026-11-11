<script lang="ts">
	/**
	 * «Упростить модель»: a heavy mesh (an AI model, a scan) made light for
	 * the slicer, a marketplace upload or the web, within a tolerance the
	 * printer cannot see. The model never leaves the browser.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, readableError, SLOW_BUILD_MS } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { MODEL_ACCEPT, modelHint, readModelFile } from '$lib/tools/shared/model-file';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import { write3mf } from '$lib/tools/shared/threemf';
	import { downloadBytes, writeStl } from '$lib/tools/stl';
	import { formatBytes } from '$lib/generation-view';
	import type { ToolInfo } from '$lib/tools/registry';
	import { ToolWorker } from '../booleans/worker';
	import { writeObj } from '../model-convert/model';
	import { SIMPLIFY_DEFAULT, TOLERANCES, simplifySummary, stlBytes, trianglesText } from './model';
	import type { SimplifyJob, SimplifyReply } from './simplify.worker';
	import { num } from '$lib/i18n/current';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/model-simplify';

	let { tool }: { tool: ToolInfo } = $props();

	const worker = new ToolWorker(
		() =>
			new Worker(new URL('./simplify.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('simplify')
			})
	);

	let fileName = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let source = $state.raw<{ key: string; tris: Float32Array } | null>(null);
	let tolerance = $state(SIMPLIFY_DEFAULT);

	const build = createBuild<SimplifyJob, SimplifyReply>(
		(job, signal) => worker.run<SimplifyReply>(job, signal),
		300,
		{ manualAfterMs: SLOW_BUILD_MS }
	);
	$effect(() => {
		if (source) build.run({ key: source.key, tris: source.tris, tolerance });
	});
	onDestroy(() => {
		build.cancel();
		worker.dispose();
	});

	const stl = $derived(build.value ? writeStl(build.value.tris) : null);

	const opening = latestOnly();
	async function onfile(file: File) {
		const fresh = opening.next();
		fileError = null;
		try {
			const tris = await readModelFile(file);
			if (!fresh()) return; // a newer file was chosen meanwhile
			build.fresh();
			source = { key: `${file.name}:${file.size}:${file.lastModified}`, tris };
			fileName = file.name;
		} catch (e) {
			if (fresh()) fileError = readableError(e);
		}
	}

	// A model sent from a generation or another tool opens at once.
	onMount(() => {
		const handed = takeHandedOffMesh();
		if (handed) void onfile(handed);
	});

	const OPTIONS = TOLERANCES.map((value) => ({
		value,
		label: m.t_model_simplify_tolerance_option({ size: num(value, 2) })
	}));
	const base = $derived((fileName ?? 'model').replace(/\.[^.]+$/, ''));
	const name = $derived(`${base}-${m.t_model_simplify_filename()}`);
</script>

<ToolShell
	{tool}
	{stl}
	busy={build.busy}
	busyLabel={m.t_model_simplify_busy()}
	stale={build.stale}
	onrebuild={build.flush}
	error={fileError ?? build.error}
	exports={build.value && stl
		? [
				{
					label: tc.tc_download_stl(),
					icon: Download,
					primary: true,
					disabled: build.stale,
					onClick: () => stl && downloadBytes(stl, `${name}.stl`, 'model/stl')
				},
				{
					label: 'OBJ',
					icon: Download,
					disabled: build.stale,
					onClick: () =>
						build.value &&
						downloadBytes(writeObj(build.value.tris, name), `${name}.obj`, 'model/obj')
				},
				{
					label: '3MF',
					icon: Download,
					disabled: build.stale,
					onClick: () =>
						build.value &&
						downloadBytes(
							write3mf([{ name, tris: build.value.tris }], name),
							`${name}.3mf`,
							'model/3mf'
						)
				}
			]
		: []}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_file()}>
			<FileField
				label={tc.tc_open_model()}
				accept={MODEL_ACCEPT}
				hint={modelHint()}
				{fileName}
				onfile={(file) => void onfile(file)}
			/>
			{#if source}
				<p class="text-xs tabular-nums text-neutral-400">
					{m.t_model_simplify_file_info({
						triangles: trianglesText(source.tris.length / 9),
						size: formatBytes(stlBytes(source.tris.length / 9))
					})}
				</p>
			{/if}
		</FieldGroup>
		{#if source}
			<FieldGroup title={m.t_model_simplify_group()}>
				<ChoiceField
					label={m.t_model_simplify_tolerance()}
					bind:value={tolerance}
					options={OPTIONS}
					hint={m.t_model_simplify_tolerance_hint()}
				/>
				{#if build.value}
					<p class="text-sm text-neutral-300" role="status">
						{simplifySummary(
							build.value.before,
							build.value.after,
							build.value.volumeBefore,
							build.value.volumeAfter
						)}
					</p>
					<p class="text-xs tabular-nums text-neutral-400">
						STL: {formatBytes(stlBytes(build.value.before))} → {formatBytes(
							stlBytes(build.value.after)
						)}.
					</p>
					{#if build.value.note}<p class="hint" role="status">{build.value.note}</p>{/if}
				{/if}
			</FieldGroup>
		{/if}
	{/snippet}
	{#snippet empty()}
		{m.t_model_simplify_empty()}
	{/snippet}
</ToolShell>
