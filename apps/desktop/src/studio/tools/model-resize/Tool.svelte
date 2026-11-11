<script lang="ts">
	/**
	 * «Размер и поворот»: open a model, lay it on its flat side, turn it,
	 * mirror it and give it an exact size, then save it for the slicer. All
	 * in the browser; the mesh is not rebuilt, so any model works.
	 */
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, readableError } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { MODEL_ACCEPT, modelHint, readModelFile } from '$lib/tools/shared/model-file';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import { write3mf } from '$lib/tools/shared/threemf';
	import { bounds, downloadBytes, writeStl, type Triangles } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { writeObj } from '../model-convert/model';
	import {
		RESIZE_DEFAULTS,
		layFlat,
		resize,
		valueFor,
		type Mat3,
		type ResizeParams,
		type SizeBy,
		type Turn
	} from './model';
	import { num } from '$lib/i18n/current';
	import * as m from '$msg/tools/model-resize';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let source = $state.raw<Triangles | null>(null);
	let fileName = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let p = $state<ResizeParams>({ ...RESIZE_DEFAULTS });

	// Finding the flat side reads every triangle: once per model.
	const flats = new WeakMap<Triangles, Mat3 | null>();
	const flat = $derived.by(() => {
		if (!source || !p.flat) return null;
		if (!flats.has(source)) flats.set(source, layFlat(source));
		return flats.get(source) ?? null;
	});

	interface Input {
		tris: Triangles;
		p: ResizeParams;
		flat: Mat3 | null;
	}
	interface Result {
		tris: Triangles;
		stl: Uint8Array;
		scale: number;
		size: [number, number, number];
	}
	const build = createBuild<Input, Result>(async (input) => {
		const { tris, scale } = resize(input.tris, input.p, input.flat);
		return { tris, scale, stl: writeStl(tris), size: bounds(tris).size };
	}, 250);
	$effect(() => {
		if (source) build.run({ tris: source, p: $state.snapshot(p), flat });
	});
	onDestroy(() => build.cancel());

	// Another measure shows what the model measures now, so nothing jumps.
	let lastBy: SizeBy = RESIZE_DEFAULTS.by;
	$effect(() => {
		const by = p.by;
		if (by === lastBy) return;
		lastBy = by;
		untrack(() => {
			const r = build.value;
			if (r)
				p.value = valueFor(
					r.size.map((v) => v / r.scale),
					by,
					r.scale
				);
		});
	});

	const opening = latestOnly();
	async function onfile(file: File) {
		const fresh = opening.next();
		fileError = null;
		try {
			const tris = await readModelFile(file);
			if (!fresh()) return; // a newer file was chosen meanwhile
			build.fresh();
			p = { ...RESIZE_DEFAULTS };
			lastBy = p.by;
			source = tris;
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

	const TURNS: readonly { value: Turn; label: string }[] = [
		{ value: 0, label: '0°' },
		{ value: 90, label: '90°' },
		{ value: 180, label: '180°' },
		{ value: 270, label: '270°' }
	];
	const MEASURES: readonly { value: SizeBy; label: string }[] = [
		{ value: 'scale', label: m.t_model_resize_scale() },
		{ value: 'z', label: tc.tc_height() },
		{ value: 'x', label: tc.tc_width() },
		{ value: 'y', label: tc.tc_depth() },
		{ value: 'max', label: m.t_model_resize_max() }
	];

	const base = $derived((fileName ?? 'model').replace(/\.[^.]+$/, ''));
	const name = $derived(build.value ? `${base}-${Math.round(build.value.scale * 100)}` : base);
	const fmt = (v: number) => num(v, 1);
	const BED = 250;
</script>

<ToolShell
	{tool}
	stl={build.value?.stl ?? null}
	busy={build.busy}
	error={fileError ?? build.error}
	exports={build.value
		? [
				{
					label: tc.tc_download_stl(),
					icon: Download,
					primary: true,
					onClick: () => build.value && downloadBytes(build.value.stl, `${name}.stl`, 'model/stl')
				},
				{
					label: 'OBJ',
					icon: Download,
					onClick: () =>
						build.value &&
						downloadBytes(writeObj(build.value.tris, name), `${name}.obj`, 'model/obj')
				},
				{
					label: '3MF',
					icon: Download,
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
		</FieldGroup>
		{#if source}
			<FieldGroup title={m.t_model_resize_position()}>
				<ToggleField
					label={m.t_model_resize_flat()}
					bind:checked={p.flat}
					hint={m.t_model_resize_flat_hint()}
				/>
				{#if p.flat && !flat}
					<p class="hint" role="status">{m.t_model_resize_no_flat()}</p>
				{/if}
				<ChoiceField
					label={m.t_model_resize_turn({ axis: 'X' })}
					bind:value={p.turnX}
					options={TURNS}
				/>
				<ChoiceField
					label={m.t_model_resize_turn({ axis: 'Y' })}
					bind:value={p.turnY}
					options={TURNS}
				/>
				<ChoiceField
					label={m.t_model_resize_turn({ axis: 'Z' })}
					bind:value={p.turnZ}
					options={TURNS}
				/>
				<ToggleField
					label={m.t_model_resize_mirror()}
					bind:checked={p.mirror}
					hint={m.t_model_resize_mirror_hint()}
				/>
			</FieldGroup>
			<FieldGroup title={tc.tc_size()}>
				<ChoiceField label={m.t_model_resize_by()} bind:value={p.by} options={MEASURES} />
				<NumberField
					label={MEASURES.find((x) => x.value === p.by)?.label ?? m.t_model_resize_scale()}
					unit={p.by === 'scale' ? '%' : 'mm'}
					bind:value={p.value}
					min={1}
					max={1000}
					step={p.by === 'scale' ? 1 : 0.1}
					hint={m.t_model_resize_value_hint()}
				/>
				{#if build.value}
					{@const [x, y, z] = build.value.size}
					<p class="text-xs tabular-nums text-neutral-400">
						{m.t_model_resize_size({
							x: fmt(x),
							y: fmt(y),
							z: fmt(z),
							scale: fmt(build.value.scale * 100)
						})}
					</p>
					{#if Math.max(x, y, z) > BED}
						<p class="hint" role="status">
							{m.t_model_resize_too_big({ bed: num(BED) })}
						</p>
					{/if}
				{/if}
			</FieldGroup>
		{/if}
	{/snippet}
	{#snippet empty()}
		{m.t_model_resize_empty()}
	{/snippet}
</ToolShell>
