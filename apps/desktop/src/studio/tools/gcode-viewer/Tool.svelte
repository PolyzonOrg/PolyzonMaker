<script lang="ts">
	/**
	 * «Просмотр G-code»: the file is parsed in a worker and drawn as lines on
	 * the scene — by layer and by extrusion type — with the slicer's own time
	 * and filament (or our estimate when it wrote none). The filament can be
	 * written off a spool of «Учёт катушек» or taken to the calculator.
	 */
	import { onDestroy } from 'svelte';
	import { Calculator, ChevronDown, ChevronUp, RotateCcw } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import { readableError } from '$lib/tools/build.svelte';
	import type { ToolInfo } from '$lib/tools/registry';
	import { num } from '$lib/i18n/current';
	import * as m from '$msg/tools/gcode-viewer';
	import * as tc from '$msg/tools/common';
	import { duration, grams } from '../print-kit/format';
	import SpoolWriteOff from '../spool-tracker/SpoolWriteOff.svelte';
	import GcodeScene from './GcodeScene.svelte';
	import {
		FEATURES,
		FEATURE_INFO,
		filamentGrams,
		SPEED_GRADIENT,
		speedRange,
		type Feature,
		type Toolpath
	} from './parse';
	import type { ColorMode } from './viewer';

	let { tool }: { tool: ToolInfo } = $props();

	const DENSITIES: { value: number; label: string }[] = [
		{ value: 1.24, label: 'PLA' },
		{ value: 1.27, label: 'PETG' },
		{ value: 1.04, label: 'ABS' },
		{ value: 1.07, label: 'ASA' },
		{ value: 1.21, label: 'TPU' },
		{ value: 1.14, label: 'PA' },
		{ value: 1.2, label: 'PC' }
	];

	let toolpath = $state.raw<Toolpath | null>(null);
	let fileName = $state<string | null>(null);
	let fileSize = $state(0);
	let busy = $state(false);
	let progress = $state(0);
	let error = $state<string | null>(null);
	let layerTo = $state(1);
	let single = $state(false);
	let colorBy = $state<ColorMode>('type');
	let density = $state<number>(1.24);
	let diameter = $state<number>(1.75);
	let visible = $state<Record<Feature, boolean>>(
		Object.fromEntries(FEATURES.map((f) => [f, f !== 'travel'])) as Record<Feature, boolean>
	);
	let scene = $state<GcodeScene>();
	let controller: AbortController | null = null;

	const layers = $derived(toolpath?.layerZ.length ?? 0);
	const meta = $derived(toolpath?.meta ?? null);
	const shown = $derived(
		FEATURES.filter((f) => toolpath && toolpath.features[f].positions.length > 0)
	);
	const weight = $derived.by(() => {
		if (!toolpath) return 0;
		if (meta?.grams) return meta.grams;
		return filamentGrams(toolpath.filamentMm, meta?.diameter ?? diameter, density);
	});
	const time = $derived(meta?.timeSec ?? toolpath?.estimatedSec ?? 0);
	const size = $derived.by(() => {
		const b = toolpath?.bounds;
		return b ? [b[3] - b[0], b[4] - b[1], b[5]] : null;
	});
	const travelLength = $derived(toolpath?.features.travel.length ?? 0);
	const extrudeLength = $derived(
		toolpath
			? FEATURES.filter((f) => f !== 'travel').reduce((s, f) => s + toolpath!.features[f].length, 0)
			: 0
	);
	const current = $derived(Math.min(Math.max(1, layerTo), Math.max(1, layers)));
	const calcHref = $derived(
		`/workspace/tools/calculator?weight=${Math.round(weight * 10) / 10}&time=${Math.round(time)}`
	);

	async function open(file: File) {
		if (/\.bgcode$/i.test(file.name)) {
			error = m.t_gcode_viewer_bgcode();
			return;
		}
		controller?.abort();
		const own = new AbortController();
		controller = own;
		busy = true;
		progress = 0;
		error = null;
		try {
			const { parseGcodeFile } = await import('./load');
			const result = await parseGcodeFile(file, own.signal, (v) => (progress = v));
			if (own.signal.aborted) return;
			toolpath = result;
			fileName = file.name;
			fileSize = file.size;
			layerTo = result.layerZ.length;
			single = false;
			if (result.meta.diameter) diameter = result.meta.diameter;
		} catch (e) {
			if (own.signal.aborted) return;
			error = readableError(e);
		} finally {
			if (controller === own) {
				busy = false;
				controller = null;
			}
		}
	}

	onDestroy(() => controller?.abort());

	function step(delta: number) {
		layerTo = Math.min(layers, Math.max(1, current + delta));
	}
</script>

{#snippet emptyHint()}
	<p>
		{m.t_gcode_viewer_empty()}
	</p>
	<p class="mt-2 text-xs">{m.t_gcode_viewer_empty_local()}</p>
{/snippet}

{#snippet viewport()}
	<GcodeScene
		bind:this={scene}
		{toolpath}
		{visible}
		from={single ? current - 1 : 0}
		to={current - 1}
		{colorBy}
	/>
	{#if toolpath && !error}
		<div class="absolute right-3 top-3 z-10 flex items-center gap-1">
			<span class="caption-inverse min-h-9 px-3 tabular-nums">
				{m.t_gcode_viewer_layer_caption({
					current,
					layers,
					z: num(toolpath.layerZ[current - 1] ?? 0, 2)
				})}
			</span>
			<button
				type="button"
				class="icon-btn-inverse"
				aria-label={m.t_gcode_viewer_layer_down()}
				title={m.t_gcode_viewer_layer_down()}
				disabled={current <= 1}
				onclick={() => step(-1)}
			>
				<ChevronDown size={20} aria-hidden="true" />
			</button>
			<button
				type="button"
				class="icon-btn-inverse"
				aria-label={m.t_gcode_viewer_layer_up()}
				title={m.t_gcode_viewer_layer_up()}
				disabled={current >= layers}
				onclick={() => step(1)}
			>
				<ChevronUp size={20} aria-hidden="true" />
			</button>
			<button
				type="button"
				class="icon-btn-inverse"
				aria-label={m.t_gcode_viewer_fit()}
				title={m.t_gcode_viewer_fit()}
				onclick={() => scene?.resetCamera()}
			>
				<RotateCcw size={20} aria-hidden="true" />
			</button>
		</div>
	{/if}
{/snippet}

<ToolShell
	{tool}
	{busy}
	busyLabel={m.t_gcode_viewer_parsing({ percent: Math.round(progress * 100) })}
	{error}
	{viewport}
	empty={toolpath ? undefined : emptyHint}
>
	{#snippet controls()}
		<FieldGroup>
			<FileField
				label={m.t_gcode_viewer_open()}
				accept=".gcode,.gco,.g,.gc,.bgcode"
				hint={m.t_gcode_viewer_open_hint()}
				maxBytes={200 * 1024 * 1024}
				fileName={fileName
					? m.t_gcode_viewer_file_size({ name: fileName, mb: num(fileSize / 1024 / 1024, 1) })
					: null}
				onfile={open}
			/>
			{#if busy}
				<p class="text-sm text-neutral-400 md:hidden" role="status">
					{m.t_gcode_viewer_parsing({ percent: Math.round(progress * 100) })}
				</p>
			{/if}
		</FieldGroup>

		{#if toolpath && meta}
			<FieldGroup title={m.t_gcode_viewer_group_height()}>
				<NumberField
					label={m.t_gcode_viewer_layers_to()}
					bind:value={layerTo}
					min={1}
					max={layers}
				/>
				<ToggleField
					label={m.t_gcode_viewer_single()}
					hint={m.t_gcode_viewer_single_hint()}
					bind:checked={single}
				/>
			</FieldGroup>

			<FieldGroup title={m.t_gcode_viewer_group_show()}>
				<ChoiceField
					label={m.t_gcode_viewer_color_by()}
					bind:value={colorBy}
					options={[
						{ value: 'type', label: m.t_gcode_viewer_color_type() },
						{ value: 'speed', label: m.t_gcode_viewer_color_speed() }
					]}
				/>
				{#if colorBy === 'speed'}
					{@const [slow, fast] = speedRange(toolpath)}
					<div>
						<div
							class="speed-scale"
							style:background-image={SPEED_GRADIENT}
							aria-hidden="true"
						></div>
						<div class="mt-1 flex justify-between text-xs tabular-nums text-neutral-400">
							<span>{m.t_gcode_viewer_speed({ speed: num(slow, 0) })}</span>
							<span>{m.t_gcode_viewer_speed({ speed: num(fast, 0) })}</span>
						</div>
						<p class="hint">
							{m.t_gcode_viewer_speed_hint()}
						</p>
					</div>
				{/if}
				{#if !toolpath.typed}
					<p class="text-xs text-neutral-400">
						{m.t_gcode_viewer_untyped()}
					</p>
				{/if}
				<div class="space-y-1">
					{#each shown as f (f)}
						<label class="flex min-h-11 cursor-pointer items-start gap-3">
							<input type="checkbox" class="checkbox mt-px" bind:checked={visible[f]} />
							<span class="min-w-0 flex-1">
								<span class="flex items-center gap-2 text-sm font-medium">
									<span
										class="size-3 shrink-0 rounded-full"
										style:background-color={FEATURE_INFO[f].color}
										aria-hidden="true"
									></span>
									{!toolpath.typed && f === 'other'
										? m.t_gcode_viewer_feature_all()
										: FEATURE_INFO[f].label}
								</span>
								<span class="mt-1 block text-xs text-neutral-400">
									{m.t_gcode_viewer_meters({ n: num(toolpath.features[f].length / 1000, 1) })}
								</span>
							</span>
						</label>
					{/each}
				</div>
			</FieldGroup>

			<FieldGroup title={m.t_gcode_viewer_group_about()}>
				<dl class="list">
					<div class="list-row">
						<dt class="min-w-0 flex-1">
							<span class="block text-sm font-medium">{m.t_gcode_viewer_duration()}</span>
							<span class="mt-1 block text-xs text-neutral-400">
								{meta.timeSec ? m.t_gcode_viewer_by_slicer() : m.t_gcode_viewer_time_estimate()}
							</span>
						</dt>
						<dd class="text-sm tabular-nums">{duration(time)}</dd>
					</div>
					<div class="list-row">
						<dt class="min-w-0 flex-1">
							<span class="block text-sm font-medium">{m.t_gcode_viewer_filament()}</span>
							<span class="mt-1 block text-xs text-neutral-400">
								{meta.grams
									? m.t_gcode_viewer_by_slicer()
									: m.t_gcode_viewer_filament_estimate({
											length: num(toolpath.filamentMm / 1000, 2)
										})}
							</span>
						</dt>
						<dd class="text-sm tabular-nums">{grams(weight)}</dd>
					</div>
					<div class="list-row">
						<dt class="min-w-0 flex-1 text-sm font-medium">{m.t_gcode_viewer_layers()}</dt>
						<dd class="text-sm tabular-nums">{layers}</dd>
					</div>
					{#if size}
						<div class="list-row">
							<dt class="min-w-0 flex-1">
								<span class="block text-sm font-medium">{m.t_gcode_viewer_part_size()}</span>
								<span class="mt-1 block text-xs text-neutral-400"
									>{m.t_gcode_viewer_part_size_hint()}</span
								>
							</dt>
							<dd class="text-sm tabular-nums">
								{tc.tc_size_mm({ x: num(size[0], 1), y: num(size[1], 1), z: num(size[2], 1) })}
							</dd>
						</div>
					{/if}
					<div class="list-row">
						<dt class="min-w-0 flex-1">
							<span class="block text-sm font-medium">{m.t_gcode_viewer_nozzle_path()}</span>
							<span class="mt-1 block text-xs text-neutral-400">
								{m.t_gcode_viewer_nozzle_path_hint()}
							</span>
						</dt>
						<dd class="text-sm tabular-nums">
							{m.t_gcode_viewer_nozzle_path_value({
								printed: num(extrudeLength / 1000, 1),
								travel: num(travelLength / 1000, 1)
							})}
						</dd>
					</div>
					{#if meta.slicer}
						<div class="list-row">
							<dt class="min-w-0 flex-1 text-sm font-medium">{m.t_gcode_viewer_slicer()}</dt>
							<dd class="text-sm">{meta.slicer}</dd>
						</div>
					{/if}
					{#if toolpath.toolChanges}
						<div class="list-row">
							<dt class="min-w-0 flex-1 text-sm font-medium">{m.t_gcode_viewer_tool_changes()}</dt>
							<dd class="text-sm tabular-nums">{toolpath.toolChanges}</dd>
						</div>
					{/if}
				</dl>
				<a href={calcHref} class="btn-ghost btn-s">
					<Calculator size={14} aria-hidden="true" />
					{m.t_gcode_viewer_to_calculator()}
				</a>
			</FieldGroup>

			{#if meta.filaments.length > 1}
				<FieldGroup title={m.t_gcode_viewer_group_extruders()}>
					<ul class="list">
						{#each meta.filaments as fil, i (i)}
							<li class="list-row">
								<span
									class="size-4 shrink-0 rounded-full border border-border"
									style:background-color={fil.color ?? 'transparent'}
									aria-hidden="true"
								></span>
								<span class="min-w-0 flex-1 text-sm font-medium">
									{fil.type
										? m.t_gcode_viewer_extruder_type({ n: i + 1, type: fil.type })
										: m.t_gcode_viewer_extruder({ n: i + 1 })}
								</span>
								<span class="text-sm tabular-nums">
									{fil.grams
										? grams(fil.grams)
										: m.t_gcode_viewer_meters({ n: num((fil.mm ?? 0) / 1000, 2) })}
								</span>
							</li>
						{/each}
					</ul>
				</FieldGroup>
			{/if}

			{#if !meta.grams}
				<FieldGroup title={m.t_gcode_viewer_group_material()}>
					<ChoiceField label={tc.tc_plastic()} bind:value={density} options={DENSITIES} />
					{#if !meta.diameter}
						<ChoiceField
							label={m.t_gcode_viewer_diameter()}
							bind:value={diameter}
							options={[
								{ value: 1.75, label: m.t_gcode_viewer_diameter_option({ size: num(1.75) }) },
								{ value: 2.85, label: m.t_gcode_viewer_diameter_option({ size: num(2.85) }) }
							]}
						/>
					{/if}
				</FieldGroup>
			{/if}

			<FieldGroup title={m.t_gcode_viewer_group_spool()}>
				<SpoolWriteOff grams={weight} note={fileName ?? ''} source="gcode" />
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>

<style>
	/* The speed scale (DESIGN_CODE §9): the lines' own hues, scene data. */
	.speed-scale {
		height: var(--pz-space-2);
		border-radius: var(--pz-radius-pill);
	}
</style>
