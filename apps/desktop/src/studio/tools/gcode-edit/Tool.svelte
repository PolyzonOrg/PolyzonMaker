<script lang="ts">
	/**
	 * «Правка G-code»: open a sliced file, put commands at chosen layers (a
	 * colour change, a pause, temperature, fan, speed, flow, your own) or
	 * continue a failed print from a measured height, and save the new file.
	 * The file never leaves the browser.
	 */
	import { Download, Plus, TriangleAlert, X } from 'lucide-svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { latestOnly } from '$lib/latest';
	import ToolPage from '../print-kit/ToolPage.svelte';
	import {
		applyInserts,
		indexLayers,
		resumeFrom,
		stateBefore,
		type Firmware,
		type Insert,
		type InsertKind,
		type LayerIndex
	} from './model';
	import { num } from '$lib/i18n/current';
	import * as m from '$msg/tools/gcode-edit';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let text = $state.raw('');
	let fileName = $state<string | null>(null);
	let index = $state.raw<LayerIndex | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let firmware = $state<Firmware>('marlin');
	let mode = $state<'insert' | 'resume'>('insert');
	let inserts = $state<Insert[]>([]);
	let height = $state(10);
	// Heat to resume with: the file's last before that layer, as the person may correct them.
	let nozzleT = $state(200);
	let bedT = $state(60);
	$effect(() => {
		if (!index || mode !== 'resume') return;
		const next = index.layers.find((l) => l.z > height + 0.02);
		if (!next) return;
		const s = stateBefore(text, next.at);
		nozzleT = s.nozzle;
		bedT = s.bed;
	});

	const FIRMWARES: readonly { value: Firmware; label: string }[] = [
		{ value: 'marlin', label: 'Marlin' },
		{ value: 'prusa', label: 'Prusa' },
		{ value: 'klipper', label: 'Klipper' },
		{ value: 'bambu', label: 'Bambu Lab' }
	];
	const KINDS: readonly { value: InsertKind; label: string; unit: string }[] = [
		{ value: 'colour', label: m.t_gcode_edit_kind_colour(), unit: '' },
		{ value: 'pause', label: m.t_gcode_edit_kind_pause(), unit: '' },
		{ value: 'temp', label: m.t_gcode_edit_kind_temp(), unit: '°C' },
		{ value: 'fan', label: m.t_gcode_edit_kind_fan(), unit: '%' },
		{ value: 'speed', label: m.t_gcode_edit_kind_speed(), unit: '%' },
		{ value: 'flow', label: m.t_gcode_edit_kind_flow(), unit: '%' },
		{ value: 'custom', label: m.t_gcode_edit_kind_custom(), unit: '' }
	];
	const DEFAULT_VALUE: Record<InsertKind, number> = {
		colour: 0,
		pause: 0,
		temp: 210,
		fan: 100,
		speed: 100,
		flow: 100,
		custom: 0
	};

	const layers = $derived(index?.layers.length ?? 0);
	const top = $derived(index?.layers.at(-1)?.z ?? 0);
	const edited = $derived(
		index && mode === 'insert' ? applyInserts(text, index, inserts, firmware) : null
	);
	const resumed = $derived(
		index && mode === 'resume'
			? resumeFrom(text, index, height, firmware, { nozzle: nozzleT, bed: bedT })
			: null
	);
	const zOf = (layer: number) => index?.layers[layer - 1]?.z;
	const mm = (v: number) => num(Math.round(v * 100) / 100);

	const opening = latestOnly();
	async function open(file: File) {
		const fresh = opening.next();
		busy = true;
		error = null;
		try {
			const t = await file.text();
			if (!fresh()) return; // a newer file was chosen meanwhile
			const idx = indexLayers(t);
			if (idx.layers.length < 2) throw new Error(m.t_gcode_edit_no_layers());
			text = t;
			index = idx;
			fileName = file.name;
			firmware = idx.firmware;
			const mid = Math.max(1, Math.round(idx.layers.length / 2));
			inserts = [{ kind: 'colour', layer: mid, value: 0, code: '' }];
			height = Math.round(idx.layers[mid - 1].z * 10) / 10;
		} catch (e) {
			if (fresh()) error = e instanceof Error ? e.message : m.t_gcode_edit_unreadable();
		} finally {
			if (fresh()) busy = false;
		}
	}

	function add() {
		const last = inserts.at(-1)?.layer ?? 1;
		inserts = [
			...inserts,
			{ kind: 'colour', layer: Math.min(layers, last + 10), value: 0, code: '' }
		];
	}

	function save() {
		const out = mode === 'insert' ? edited?.text : resumed?.text;
		if (!out || !fileName) return;
		const base = fileName.replace(/\.(gcode|gco|g|gc)$/i, '');
		downloadBytes(
			out,
			`${base}-${mode === 'insert' ? m.t_gcode_edit_insert_filename() : m.t_gcode_edit_resume_filename()}.gcode`,
			'text/x-gcode'
		);
	}
</script>

<ToolPage {tool} lead={m.t_gcode_edit_lead()}>
	{#snippet action()}
		{#if index}
			<button
				type="button"
				class="btn-primary"
				onclick={save}
				disabled={mode === 'insert' ? !edited?.placed.length : !resumed}
			>
				<Download size={16} aria-hidden="true" />
				{m.t_gcode_edit_download()}
			</button>
		{/if}
	{/snippet}

	<section class="space-y-4">
		<h2 class="section-title">{tc.tc_file()}</h2>
		<FileField
			label={m.t_gcode_edit_file_label()}
			accept=".gcode,.gco,.g,.gc"
			hint={m.t_gcode_edit_file_hint()}
			maxBytes={400 * 1024 * 1024}
			{fileName}
			onfile={open}
		/>
		{#if busy}<p class="text-sm text-neutral-400" role="status">{m.t_gcode_edit_reading()}</p>{/if}
		{#if error}<p class="field-error" role="alert">{error}</p>{/if}
		{#if index}
			<p class="text-sm tabular-nums text-neutral-300">
				{index.slicer
					? m.t_gcode_edit_file_info_slicer({
							layers: m.t_gcode_edit_layers({ count: layers, n: num(layers) }),
							height: mm(top),
							slicer: index.slicer
						})
					: m.t_gcode_edit_file_info({
							layers: m.t_gcode_edit_layers({ count: layers, n: num(layers) }),
							height: mm(top)
						})}
			</p>
			<ChoiceField
				label={m.t_gcode_edit_firmware()}
				bind:value={firmware}
				options={FIRMWARES}
				hint={m.t_gcode_edit_firmware_hint()}
			/>
			<ChoiceField
				label={m.t_gcode_edit_mode()}
				bind:value={mode}
				options={[
					{ value: 'insert', label: m.t_gcode_edit_mode_insert() },
					{ value: 'resume', label: m.t_gcode_edit_mode_resume() }
				]}
			/>
		{/if}
	</section>

	{#if index && mode === 'insert'}
		<section class="space-y-4">
			<h2 class="section-title">{m.t_gcode_edit_inserts()}</h2>
			<ul class="list">
				{#each inserts as ins, i (i)}
					<li class="list-row flex-wrap">
						<select
							class="input input-s w-auto min-w-0"
							aria-label={m.t_gcode_edit_kind()}
							bind:value={ins.kind}
							onchange={() => (ins.value = DEFAULT_VALUE[ins.kind])}
						>
							{#each KINDS as k (k.value)}<option value={k.value}>{k.label}</option>{/each}
						</select>
						<label class="flex items-center gap-2 text-sm">
							<span class="text-neutral-400">{m.t_gcode_edit_layer()}</span>
							<input
								class="input input-s w-20 text-right tabular-nums"
								type="number"
								inputmode="numeric"
								min="1"
								max={layers}
								bind:value={ins.layer}
							/>
						</label>
						{#if ins.kind !== 'colour' && ins.kind !== 'pause' && ins.kind !== 'custom'}
							<label class="flex items-center gap-2 text-sm">
								<input
									class="input input-s w-20 text-right tabular-nums"
									type="number"
									inputmode="numeric"
									bind:value={ins.value}
									aria-label={m.t_gcode_edit_value()}
								/>
								<span class="text-neutral-400">{KINDS.find((k) => k.value === ins.kind)?.unit}</span
								>
							</label>
						{/if}
						<span class="min-w-0 flex-1 text-xs tabular-nums text-neutral-400">
							{zOf(ins.layer) !== undefined
								? m.t_gcode_edit_layer_z({ z: mm(zOf(ins.layer)!) })
								: m.t_gcode_edit_no_layer({ layer: ins.layer })}
						</span>
						<button
							type="button"
							class="icon-btn"
							aria-label={m.t_gcode_edit_remove()}
							onclick={() => (inserts = inserts.filter((_, j) => j !== i))}
						>
							<X size={16} aria-hidden="true" />
						</button>
						{#if ins.kind === 'custom'}
							<textarea
								class="input w-full"
								rows="2"
								bind:value={ins.code}
								aria-label={m.t_gcode_edit_kind_custom()}
								placeholder={m.t_gcode_edit_custom_placeholder()}></textarea>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="flex flex-wrap gap-2">
				<button type="button" class="btn-ghost btn-s" onclick={add} disabled={inserts.length >= 30}>
					<Plus size={14} aria-hidden="true" />
					{m.t_gcode_edit_add()}
				</button>
			</div>
			{#if edited}
				<p class="hint" role="status">
					{edited.placed.length
						? m.t_gcode_edit_placed({ count: num(edited.placed.length) })
						: m.t_gcode_edit_placed_none()}
				</p>
			{/if}
			{#if firmware === 'klipper' && inserts.some((i) => i.kind === 'colour')}
				<p class="notice notice-warning">
					<TriangleAlert size={16} aria-hidden="true" />
					<span>{m.t_gcode_edit_klipper_m600()}</span>
				</p>
			{/if}
		</section>
	{/if}

	{#if index && mode === 'resume'}
		<section class="space-y-4">
			<h2 class="section-title">{m.t_gcode_edit_resume()}</h2>
			<NumberField
				label={m.t_gcode_edit_height()}
				unit="mm"
				bind:value={height}
				min={0.1}
				max={Math.max(0.2, top)}
				step={0.05}
				hint={m.t_gcode_edit_height_hint()}
			/>
			<div class="grid grid-cols-2 gap-3">
				<NumberField
					label={m.t_gcode_edit_nozzle()}
					unit="°C"
					bind:value={nozzleT}
					min={150}
					max={320}
				/>
				<NumberField label={m.t_gcode_edit_bed()} unit="°C" bind:value={bedT} min={0} max={130} />
			</div>
			{#if resumed}
				<p class="text-sm tabular-nums text-neutral-300">
					{m.t_gcode_edit_resume_at({ layer: resumed.layer, z: mm(resumed.z) })}
				</p>
			{:else}
				<p class="field-error" role="alert">{m.t_gcode_edit_resume_done()}</p>
			{/if}
			<div class="notice notice-warning">
				<TriangleAlert size={16} aria-hidden="true" />
				<div class="space-y-1">
					<p class="font-medium text-neutral-100">{m.t_gcode_edit_before_start()}</p>
					<p>
						{m.t_gcode_edit_before_start_text()}
						{firmware === 'bambu' ? m.t_gcode_edit_before_start_bambu() : ''}
					</p>
				</div>
			</div>
		</section>
	{/if}
</ToolPage>
