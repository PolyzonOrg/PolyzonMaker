<script lang="ts">
	/**
	 * «Конвертер форматов»: open STL, OBJ, 3MF or GLB, check the size, save as
	 * STL, OBJ or 3MF. The file never leaves the browser.
	 */
	import { onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { num } from '$lib/i18n/current';
	import { MODEL_ACCEPT, modelHint, readModelFile } from '$lib/tools/shared/model-file';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import { write3mf } from '$lib/tools/shared/threemf';
	import { downloadBytes, writeStl, type Triangles } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { latestOnly } from '$lib/latest';
	import * as m from '$msg/tools/model-convert';
	import * as tc from '$msg/tools/common';
	import { guessUnit, prepare, sizeOf, writeObj, type Unit } from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let source = $state.raw<Triangles | null>(null);
	let fileName = $state<string | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let unit = $state<Unit>('mm');
	let onBed = $state(true);

	const model = $derived(source ? prepare(source, unit, onBed) : null);
	const stl = $derived(model ? writeStl(model) : null);
	const size = $derived(model ? sizeOf(model) : null);
	const base = $derived((fileName ?? 'model').replace(/\.[^.]+$/, ''));
	const fmt = (v: number) => num(v, 1);

	const opening = latestOnly();
	async function open(file: File) {
		const fresh = opening.next();
		busy = true;
		error = null;
		try {
			const tris = await readModelFile(file);
			if (!fresh()) return; // a newer file was chosen meanwhile
			source = tris;
			fileName = file.name;
			unit = guessUnit(sizeOf(tris));
		} catch (e) {
			if (fresh()) error = e instanceof Error ? e.message : m.t_model_convert_read_failed();
		} finally {
			if (fresh()) busy = false;
		}
	}

	// A model sent from a generation opens at once.
	onMount(() => {
		const handed = takeHandedOffMesh();
		if (handed) void open(handed);
	});
</script>

<ToolShell
	{tool}
	{stl}
	{busy}
	error={null}
	exports={model
		? [
				{
					label: tc.tc_download_stl(),
					icon: Download,
					primary: true,
					onClick: () => stl && downloadBytes(stl, `${base}.stl`, 'model/stl')
				},
				{
					label: 'OBJ',
					icon: Download,
					onClick: () => model && downloadBytes(writeObj(model, base), `${base}.obj`, 'model/obj')
				},
				{
					label: '3MF',
					icon: Download,
					onClick: () =>
						model &&
						downloadBytes(write3mf([{ name: base, tris: model }], base), `${base}.3mf`, 'model/3mf')
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
				onfile={open}
			/>
			{#if error}<p class="field-error" role="alert">{error}</p>{/if}
		</FieldGroup>
		{#if model && size}
			<FieldGroup title={tc.tc_size()}>
				<ChoiceField
					label={m.t_model_convert_units()}
					bind:value={unit}
					options={[
						{ value: 'mm', label: tc.tc_unit_mm() },
						{ value: 'cm', label: m.t_model_convert_unit_cm() },
						{ value: 'm', label: tc.tc_unit_m() },
						{ value: 'in', label: m.t_model_convert_unit_in() }
					]}
					hint={m.t_model_convert_units_hint()}
				/>
				<ToggleField
					label={m.t_model_convert_on_bed()}
					bind:checked={onBed}
					hint={m.t_model_convert_on_bed_hint()}
				/>
				<p class="text-xs tabular-nums text-neutral-400">
					{m.t_model_convert_summary({
						count: model.length / 9,
						n: num(model.length / 9),
						x: fmt(size[0]),
						y: fmt(size[1]),
						z: fmt(size[2])
					})}
				</p>
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>
