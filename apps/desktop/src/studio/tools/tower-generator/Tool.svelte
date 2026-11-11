<script lang="ts">
	/**
	 * «Калибровка принтера»: pick a test, the printer and the material — get
	 * G-code generated right here (no pre-sliced files), previewed as a
	 * toolpath, with a table of what each segment prints with. PID and
	 * E-steps are console commands, not files. The form is kept in this
	 * browser between visits.
	 */
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Copy, Download, RotateCcw, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, ToolError } from '$lib/tools/build.svelte';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { showToast } from '$lib/toast';
	import { manualCopyHint } from '$lib/clipboard';
	import { unitLabel } from '$lib/components/tools/units';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/tower-generator';
	import { duration, grams, num, readStored, writeStored } from '../print-kit/format';
	import GcodeScene from '../gcode-viewer/GcodeScene.svelte';
	import {
		FEATURES,
		filamentGrams,
		parseGcode,
		type Feature,
		type Toolpath
	} from '../gcode-viewer/parse';
	import {
		CalibrationError,
		MATERIALS,
		PRINTER_PRESETS,
		RETRACTION_PLANS,
		TESTS,
		TOWER_DEFAULTS,
		applyPreset,
		eSteps,
		eStepsCommands,
		flowCorrection,
		generateCalibration,
		pidCommands,
		type MaterialId,
		type TowerParams,
		type TowerResult,
		type TowerTest
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	const STORAGE_KEY = 'polyzon:tools:tower-generator:v1';
	const fresh = (): TowerParams => structuredClone(TOWER_DEFAULTS);
	let p = $state<TowerParams>(fresh());

	// Values that bring their own defaults when changed by hand.
	let lastMaterial = untrack(() => p.material);
	let lastNozzle = untrack(() => p.nozzle);
	let lastVary = untrack(() => p.retractVary);

	onMount(() => {
		const saved = readStored<Partial<TowerParams>>(STORAGE_KEY);
		if (!saved || typeof saved !== 'object') return;
		const base = fresh();
		const next: TowerParams = {
			...base,
			...saved,
			plans: { ...base.plans, ...saved.plans },
			pa: { ...base.pa, ...saved.pa },
			pid: { ...base.pid, ...saved.pid },
			esteps: { ...base.esteps, ...saved.esteps }
		};
		lastMaterial = next.material;
		lastNozzle = next.nozzle;
		lastVary = next.retractVary;
		p = next;
	});

	$effect(() => {
		const material = p.material;
		if (material === lastMaterial) return;
		lastMaterial = material;
		const mat = MATERIALS[material];
		p.nozzleTemp = mat.temp;
		p.bedTemp = mat.bedTemp;
		p.fan = mat.fan;
		p.pid.temp = mat.temp;
		p.plans.temperature.start = Math.min(mat.nozzle[1], mat.temp + 15);
		p.plans.temperature.step = -5;
	});
	$effect(() => {
		const n = p.nozzle;
		if (n === lastNozzle) return;
		lastNozzle = n;
		p.lineWidth = Math.round(n * 1.125 * 100) / 100;
		p.layerHeight = Math.round(n * 0.5 * 100) / 100;
	});
	$effect(() => {
		const v = p.retractVary;
		if (v === lastVary) return;
		lastVary = v;
		Object.assign(p.plans.retraction, RETRACTION_PLANS[v]);
	});

	interface Built {
		result: TowerResult;
		toolpath: Toolpath;
	}
	const key = $derived(JSON.stringify(p));
	const build = createBuild<string, Built | null>(async (json) => {
		writeStored(STORAGE_KEY, JSON.parse(json));
		const params = JSON.parse(json) as TowerParams;
		if (params.test === 'pid' || params.test === 'esteps') return null;
		try {
			const result = generateCalibration(params);
			return { result, toolpath: parseGcode(result.gcode) };
		} catch (e) {
			if (e instanceof CalibrationError) throw new ToolError(e.message);
			throw e;
		}
	}, 300);
	$effect(() => build.run(key));
	onDestroy(() => build.cancel());

	const isTower = $derived(
		p.test === 'temperature' ||
			p.test === 'retraction' ||
			p.test === 'flow' ||
			p.test === 'speed' ||
			p.test === 'acceleration' ||
			p.test === 'corner' ||
			p.test === 'shaper'
	);
	const plan = $derived(isTower ? p.plans[p.test as TowerTest] : null);
	const fileTest = $derived(p.test !== 'pid' && p.test !== 'esteps');
	const result = $derived(build.value?.result ?? null);
	const toolpath = $derived(fileTest ? (build.value?.toolpath ?? null) : null);
	const preset = $derived(PRINTER_PRESETS.find((x) => x.id === p.preset) ?? null);
	const fitKey = $derived(
		`${p.test}:${plan?.size ?? 0}:${plan?.count ?? 0}:${p.bedX}:${p.bedY}:${p.pa.start}:${p.pa.end}:${p.pa.step}`
	);
	const visible = Object.fromEntries(FEATURES.map((f) => [f, f !== 'travel'])) as Record<
		Feature,
		boolean
	>;
	const klipper = $derived(p.firmware === 'klipper');

	const HINTS: Record<string, string> = {
		temperature: m.t_tower_generator_hint_temperature(),
		retraction: m.t_tower_generator_hint_retraction(),
		flow: m.t_tower_generator_hint_flow(),
		speed: m.t_tower_generator_hint_speed(),
		acceleration: m.t_tower_generator_hint_acceleration(),
		corner: m.t_tower_generator_hint_corner(),
		shaper: m.t_tower_generator_hint_shaper(),
		pa: m.t_tower_generator_hint_pa(),
		pid: m.t_tower_generator_hint_pid(),
		esteps: m.t_tower_generator_hint_esteps()
	};

	/** Unit codes of NumberField (units.ts). */
	const UNITS: Record<string, string> = {
		temperature: '°C',
		flow: '%',
		speed: 'mm/s',
		acceleration: 'mm/s2',
		corner: 'mm/s',
		shaper: 'Hz'
	};
	const unit = $derived(
		p.test === 'retraction' ? (p.retractVary === 'length' ? 'mm' : 'mm/s') : (UNITS[p.test] ?? '')
	);
	const stepLimits = $derived.by(
		(): { min: number; max: number; step: number; s: [number, number, number] } => {
			switch (p.test) {
				case 'temperature':
					return { min: 150, max: 320, step: 1, s: [-20, 20, 1] };
				case 'retraction':
					return p.retractVary === 'length'
						? { min: 0, max: 15, step: 0.05, s: [-3, 3, 0.05] }
						: { min: 5, max: 150, step: 1, s: [-50, 50, 1] };
				case 'flow':
					return { min: 50, max: 150, step: 0.5, s: [-20, 20, 0.5] };
				case 'speed':
					return { min: 5, max: 600, step: 1, s: [-100, 200, 1] };
				case 'corner':
					return { min: 0.5, max: 60, step: 0.5, s: [-10, 20, 0.5] };
				case 'shaper':
					return { min: 5, max: 200, step: 1, s: [-20, 40, 1] };
				default:
					return { min: 100, max: 50000, step: 50, s: [-10000, 10000, 50] };
			}
		}
	);

	// Calculators.
	const pid = $derived(pidCommands(p.firmware, p.pid.heater, p.pid.temp, p.pid.cycles));
	const es = $derived(
		eSteps(p.firmware, p.esteps.current, p.esteps.requested, p.esteps.mark, p.esteps.left)
	);
	const esCommands = $derived(
		eStepsCommands(p.firmware, p.nozzleTemp, p.esteps.requested, es?.value)
	);
	let flowPick = $state(100);
	let wall = $state(0.9);
	const expectedWall = $derived(Math.round(p.lineWidth * 2 * 100) / 100);
	const newFlow = $derived(flowCorrection(flowPick, expectedWall, wall));

	const time = $derived(toolpath ? duration(toolpath.estimatedSec) : '');
	const weight = $derived(
		toolpath ? filamentGrams(toolpath.filamentMm, p.filament, MATERIALS[p.material].density) : 0
	);

	function download() {
		if (!result || build.error) return;
		downloadBytes(result.gcode, result.filename, 'text/x-gcode');
	}

	/** `list` is the shown command list: selected for Ctrl+C when the clipboard refuses. */
	async function copy(lines: string[], list: Element | null) {
		const text = lines.join('\n');
		try {
			await navigator.clipboard.writeText(text);
			showToast(m.t_tower_generator_commands_copied(), { kind: 'success' });
		} catch {
			if (list) getSelection()?.selectAllChildren(list);
			showToast(manualCopyHint(m.t_tower_generator_commands_selected()), { kind: 'error' });
		}
	}

	function reset() {
		const base = fresh();
		lastMaterial = base.material;
		lastNozzle = base.nozzle;
		lastVary = base.retractVary;
		p = { ...base, test: p.test };
	}

	const rowValue = (v: number) =>
		p.test === 'pa'
			? `K ${num(v, 4)}`
			: `${num(v, p.test === 'retraction' ? 2 : 1)} ${unitLabel(unit)}`;
</script>

{#snippet emptyHint()}
	{#if fileTest}
		<p>{m.t_tower_generator_empty_file()}</p>
	{:else}
		<p>{m.t_tower_generator_empty_console()}</p>
	{/if}
{/snippet}

{#snippet viewport()}
	<GcodeScene {toolpath} {visible} {fitKey} />
	{#if toolpath && result && !build.error}
		<div class="pointer-events-none absolute right-3 top-3 z-10">
			<span class="caption-inverse min-h-9 px-3 tabular-nums">
				{m.t_tower_generator_caption({
					count: result.layers,
					n: num(result.layers, 0),
					height: num(result.height, 1),
					time,
					weight: grams(weight)
				})}
			</span>
		</div>
	{/if}
{/snippet}

{#snippet commandList(lines: string[])}
	<ul class="list">
		{#each lines as line, i (i)}
			<li class="list-row min-h-11 py-2">
				<span class="min-w-0 flex-1 break-all text-sm font-medium">{line}</span>
			</li>
		{/each}
	</ul>
	<button
		type="button"
		class="btn-ghost btn-s"
		onclick={(e) => copy(lines, e.currentTarget.previousElementSibling)}
	>
		<Copy size={14} aria-hidden="true" />
		{m.t_tower_generator_copy_commands()}
	</button>
{/snippet}

<ToolShell
	{tool}
	busy={build.busy}
	busyLabel={m.t_tower_generator_generating()}
	error={fileTest ? build.error : null}
	{viewport}
	empty={toolpath ? undefined : emptyHint}
	exports={fileTest
		? [
				{
					label: m.t_tower_generator_download_gcode(),
					icon: Download,
					primary: true,
					disabled: !result || !!build.error,
					onClick: download
				}
			]
		: []}
>
	{#snippet controls()}
		<FieldGroup title={m.t_tower_generator_group_test()}>
			<ChoiceField
				label={m.t_tower_generator_test()}
				bind:value={p.test}
				options={TESTS.map((t) => ({ value: t.id, label: t.label }))}
				hint={HINTS[p.test]}
			/>
		</FieldGroup>

		{#if isTower && plan}
			<FieldGroup title={m.t_tower_generator_group_steps()}>
				{#if p.test === 'retraction'}
					<ChoiceField
						label={m.t_tower_generator_retract_vary()}
						bind:value={p.retractVary}
						options={[
							{ value: 'length', label: tc.tc_length() },
							{ value: 'speed', label: m.t_tower_generator_retract_vary_speed() }
						]}
						hint={m.t_tower_generator_retract_vary_hint()}
					/>
				{/if}
				<NumberField
					label={m.t_tower_generator_first_step()}
					{unit}
					bind:value={plan.start}
					min={stepLimits.min}
					max={stepLimits.max}
					step={stepLimits.step}
					hint={p.test === 'retraction' && p.retractVary === 'length'
						? m.t_tower_generator_first_step_retraction_hint()
						: undefined}
				/>
				<NumberField
					label={m.t_tower_generator_step_increment()}
					{unit}
					bind:value={plan.step}
					min={stepLimits.s[0]}
					max={stepLimits.s[1]}
					step={stepLimits.s[2]}
					hint={p.test === 'temperature' ? m.t_tower_generator_step_temperature_hint() : undefined}
				/>
				<NumberField
					label={m.t_tower_generator_step_count()}
					bind:value={plan.count}
					min={2}
					max={12}
				/>
				<NumberField
					label={m.t_tower_generator_step_height()}
					unit="mm"
					bind:value={plan.height}
					min={2}
					max={20}
					step={0.5}
				/>
				<NumberField
					label={m.t_tower_generator_tower_side()}
					unit="mm"
					bind:value={plan.size}
					min={8}
					max={60}
				/>
			</FieldGroup>
		{:else if p.test === 'pa'}
			<FieldGroup title={m.t_tower_generator_group_k()}>
				<NumberField
					label={m.t_tower_generator_k_start()}
					bind:value={p.pa.start}
					min={0}
					max={2}
					step={0.001}
				/>
				<NumberField
					label={m.t_tower_generator_k_end()}
					bind:value={p.pa.end}
					min={0}
					max={2}
					step={0.001}
				/>
				<NumberField
					label={m.t_tower_generator_k_step()}
					bind:value={p.pa.step}
					min={0.001}
					max={0.5}
					step={0.001}
					hint={m.t_tower_generator_k_step_hint()}
				/>
			</FieldGroup>
		{:else if p.test === 'pid'}
			<FieldGroup title={m.t_tower_generator_group_pid()}>
				<ChoiceField
					label={m.t_tower_generator_firmware()}
					bind:value={p.firmware}
					options={[
						{ value: 'marlin', label: 'Marlin' },
						{ value: 'klipper', label: 'Klipper' }
					]}
				/>
				<ChoiceField
					label={m.t_tower_generator_heater()}
					bind:value={p.pid.heater}
					options={[
						{ value: 'nozzle', label: m.t_tower_generator_heater_nozzle() },
						{ value: 'bed', label: m.t_tower_generator_heater_bed() }
					]}
				/>
				<NumberField
					label={m.t_tower_generator_target_temp()}
					unit="°C"
					bind:value={p.pid.temp}
					min={p.pid.heater === 'nozzle' ? 150 : 40}
					max={p.pid.heater === 'nozzle' ? 300 : 120}
					hint={m.t_tower_generator_target_temp_hint()}
				/>
				{#if !klipper}
					<NumberField
						label={m.t_tower_generator_pid_cycles()}
						bind:value={p.pid.cycles}
						min={3}
						max={15}
					/>
				{/if}
				{@render commandList(pid)}
				<p class="text-xs text-neutral-400">
					{klipper ? m.t_tower_generator_pid_klipper_note() : m.t_tower_generator_pid_marlin_note()}
				</p>
			</FieldGroup>
		{:else if p.test === 'esteps'}
			<FieldGroup title={m.t_tower_generator_test_esteps()}>
				<ChoiceField
					label={m.t_tower_generator_firmware()}
					bind:value={p.firmware}
					options={[
						{ value: 'marlin', label: 'Marlin' },
						{ value: 'klipper', label: 'Klipper' }
					]}
				/>
				<ol class="list-decimal space-y-2 pl-5 text-sm text-neutral-300">
					<li>{m.t_tower_generator_esteps_mark_step({ mark: num(p.esteps.mark, 0) })}</li>
					<li>
						{m.t_tower_generator_esteps_send_step({ length: num(p.esteps.requested, 0) })}
					</li>
					<li>{m.t_tower_generator_esteps_measure_step()}</li>
				</ol>
				<NumberField
					label={m.t_tower_generator_nozzle_temp()}
					unit="°C"
					bind:value={p.nozzleTemp}
					min={170}
					max={300}
					hint={m.t_tower_generator_esteps_temp_hint()}
				/>
				{@render commandList(esCommands.before)}
				<NumberField
					label={klipper
						? m.t_tower_generator_esteps_current_klipper()
						: m.t_tower_generator_esteps_current_marlin()}
					bind:value={p.esteps.current}
					min={1}
					max={klipper ? 100 : 5000}
					step={0.01}
				/>
				<NumberField
					label={m.t_tower_generator_esteps_requested()}
					unit="mm"
					bind:value={p.esteps.requested}
					min={20}
					max={150}
				/>
				<NumberField
					label={m.t_tower_generator_esteps_mark()}
					unit="mm"
					bind:value={p.esteps.mark}
					min={30}
					max={200}
				/>
				<NumberField
					label={m.t_tower_generator_esteps_left()}
					unit="mm"
					bind:value={p.esteps.left}
					min={0}
					max={200}
					step={0.1}
				/>
				{#if es}
					<div class="card">
						<div class="text-xs text-neutral-400">
							{klipper
								? m.t_tower_generator_esteps_result_klipper()
								: m.t_tower_generator_esteps_result_marlin()}
						</div>
						<div class="mt-1 text-2xl font-semibold tabular-nums">
							{num(es.value, klipper ? 3 : 2)}
						</div>
						<p class="mt-1 text-sm text-neutral-300">
							{Math.abs(es.error) < 0.005
								? m.t_tower_generator_esteps_exact({
										actual: num(es.actual, 1),
										requested: num(p.esteps.requested, 0)
									})
								: es.error > 0
									? m.t_tower_generator_esteps_under({
											actual: num(es.actual, 1),
											requested: num(p.esteps.requested, 0),
											percent: num(es.error * 100, 1)
										})
									: m.t_tower_generator_esteps_over({
											actual: num(es.actual, 1),
											requested: num(p.esteps.requested, 0),
											percent: num(-es.error * 100, 1)
										})}
						</p>
					</div>
					{@render commandList(esCommands.after)}
					{#if klipper}
						<p class="text-xs text-neutral-400">{m.t_tower_generator_esteps_klipper_note()}</p>
					{/if}
				{:else}
					<p class="field-error">{m.t_tower_generator_esteps_invalid()}</p>
				{/if}
			</FieldGroup>
		{/if}

		{#if fileTest}
			{#if result && !build.error && result.rows.length}
				<FieldGroup
					title={p.test === 'pa'
						? m.t_tower_generator_rows_lines()
						: m.t_tower_generator_rows_steps()}
				>
					<ul class="list">
						{#each result.rows as row (row.index)}
							<li class="list-row min-h-11 py-2">
								<span class="min-w-0 flex-1">
									<span class="block text-sm font-medium">
										{p.test === 'pa'
											? m.t_tower_generator_row_line({ n: row.index })
											: m.t_tower_generator_row_step({ n: row.index })}
									</span>
									<span class="mt-1 block text-xs tabular-nums text-neutral-400">
										{#if p.test === 'pa'}
											{m.t_tower_generator_row_y({ y: num(row.y ?? 0, 1) })}
										{:else if row.flow}
											{m.t_tower_generator_row_z_flow({
												from: num(row.zFrom, 2),
												to: num(row.zTo, 2),
												flow: num(row.flow, 1)
											})}
										{:else}
											{m.t_tower_generator_row_z({ from: num(row.zFrom, 2), to: num(row.zTo, 2) })}
										{/if}
									</span>
								</span>
								<span class="text-sm tabular-nums">{rowValue(row.value)}</span>
							</li>
						{/each}
					</ul>
				</FieldGroup>
			{/if}
			{#if result && !build.error && result.warnings.length}
				<div class="notice notice-warning mt-6" role="status">
					<TriangleAlert size={16} aria-hidden="true" />
					<div class="space-y-1">
						{#each result.warnings as w (w)}<p>{w}</p>{/each}
					</div>
				</div>
			{/if}

			{#if p.test === 'flow'}
				<FieldGroup title={m.t_tower_generator_group_flow()}>
					<NumberField
						label={m.t_tower_generator_flow_pick()}
						unit="%"
						bind:value={flowPick}
						min={50}
						max={150}
						step={0.5}
					/>
					<NumberField
						label={m.t_tower_generator_wall_measured()}
						unit="mm"
						bind:value={wall}
						min={0.2}
						max={3}
						step={0.01}
						hint={m.t_tower_generator_wall_hint({
							expected: num(expectedWall, 2),
							line: num(p.lineWidth, 2)
						})}
					/>
					{#if newFlow}
						<div class="card">
							<div class="text-xs text-neutral-400">{m.t_tower_generator_flow_result()}</div>
							<div class="mt-1 text-2xl font-semibold tabular-nums">{num(newFlow, 1)} %</div>
						</div>
					{/if}
				</FieldGroup>
			{/if}

			<FieldGroup title={m.t_tower_generator_group_printer()}>
				<div class="flex flex-wrap gap-2">
					{#each PRINTER_PRESETS as pr (pr.id)}
						<button
							type="button"
							class="btn-ghost btn-s"
							aria-pressed={p.preset === pr.id}
							onclick={() => (p = applyPreset(p, pr.id))}
						>
							{pr.label}
						</button>
					{/each}
				</div>
				{#if preset}<p class="text-xs text-neutral-400">{preset.note}</p>{/if}
				<NumberField
					label={m.t_tower_generator_bed_x()}
					unit="mm"
					bind:value={p.bedX}
					min={50}
					max={1000}
				/>
				<NumberField
					label={m.t_tower_generator_bed_y()}
					unit="mm"
					bind:value={p.bedY}
					min={50}
					max={1000}
				/>
				<NumberField
					label={m.t_tower_generator_max_z()}
					unit="mm"
					bind:value={p.maxZ}
					min={20}
					max={1000}
				/>
				<ChoiceField
					label={m.t_tower_generator_nozzle_diameter()}
					bind:value={p.nozzle}
					options={[0.2, 0.4, 0.6, 0.8].map((v) => ({
						value: v,
						label: m.t_tower_generator_size_mm({ size: num(v, 1) })
					}))}
				/>
				<ChoiceField
					label={m.t_tower_generator_filament_diameter()}
					bind:value={p.filament}
					options={[1.75, 2.85].map((v) => ({
						value: v,
						label: m.t_tower_generator_size_mm({ size: num(v, 2) })
					}))}
				/>
				<ChoiceField
					label={m.t_tower_generator_firmware()}
					bind:value={p.firmware}
					options={[
						{ value: 'marlin', label: 'Marlin' },
						{ value: 'klipper', label: 'Klipper' }
					]}
				/>
				<ToggleField
					label={m.t_tower_generator_relative_e()}
					hint={m.t_tower_generator_relative_e_hint()}
					bind:checked={p.relativeE}
				/>
				<ToggleField
					label={m.t_tower_generator_prime_line()}
					hint={m.t_tower_generator_prime_line_hint()}
					bind:checked={p.primeLine}
				/>
			</FieldGroup>

			<FieldGroup title={m.t_tower_generator_group_material()}>
				<ChoiceField
					label={m.t_tower_generator_material()}
					bind:value={p.material}
					options={(Object.keys(MATERIALS) as MaterialId[]).map((id) => ({
						value: id,
						label: MATERIALS[id].label
					}))}
					hint={m.t_tower_generator_material_hint({
						material: MATERIALS[p.material].label,
						nozzleMin: num(MATERIALS[p.material].nozzle[0], 0),
						nozzleMax: num(MATERIALS[p.material].nozzle[1], 0),
						bedMin: num(MATERIALS[p.material].bed[0], 0),
						bedMax: num(MATERIALS[p.material].bed[1], 0)
					})}
				/>
				{#if p.test !== 'temperature'}
					<NumberField
						label={m.t_tower_generator_nozzle_temp()}
						unit="°C"
						bind:value={p.nozzleTemp}
						min={150}
						max={300}
					/>
				{/if}
				<NumberField
					label={m.t_tower_generator_bed_temp()}
					unit="°C"
					bind:value={p.bedTemp}
					min={0}
					max={120}
				/>
				<NumberField
					label={m.t_tower_generator_fan()}
					unit="%"
					bind:value={p.fan}
					min={0}
					max={100}
					step={5}
				/>
				<NumberField
					label={m.t_tower_generator_fan_layer()}
					bind:value={p.fanLayer}
					min={1}
					max={10}
				/>
			</FieldGroup>

			<FieldGroup title={m.t_tower_generator_group_layer()}>
				<NumberField
					label={m.t_tower_generator_layer_height()}
					unit="mm"
					bind:value={p.layerHeight}
					min={0.05}
					max={Math.round(p.nozzle * 0.8 * 100) / 100}
					step={0.01}
				/>
				<NumberField
					label={m.t_tower_generator_line_width()}
					unit="mm"
					bind:value={p.lineWidth}
					min={Math.round(p.nozzle * 0.8 * 100) / 100}
					max={Math.round(p.nozzle * 1.8 * 100) / 100}
					step={0.01}
				/>
				{#if p.test !== 'speed'}
					<NumberField
						label={m.t_tower_generator_print_speed()}
						unit="mm/s"
						bind:value={p.printSpeed}
						min={5}
						max={600}
					/>
				{/if}
				<NumberField
					label={m.t_tower_generator_first_layer_speed()}
					unit="mm/s"
					bind:value={p.firstLayerSpeed}
					min={5}
					max={100}
				/>
				<NumberField
					label={m.t_tower_generator_travel_speed()}
					unit="mm/s"
					bind:value={p.travelSpeed}
					min={20}
					max={600}
				/>
			</FieldGroup>

			<FieldGroup title={m.t_tower_generator_group_retraction()}>
				{#if !(p.test === 'retraction' && p.retractVary === 'length')}
					<NumberField
						label={m.t_tower_generator_retract_length()}
						unit="mm"
						bind:value={p.retractLength}
						min={0}
						max={15}
						step={0.05}
					/>
				{/if}
				{#if !(p.test === 'retraction' && p.retractVary === 'speed')}
					<NumberField
						label={m.t_tower_generator_retract_speed()}
						unit="mm/s"
						bind:value={p.retractSpeed}
						min={5}
						max={150}
					/>
				{/if}
				<NumberField
					label={m.t_tower_generator_z_hop()}
					unit="mm"
					bind:value={p.zHop}
					min={0}
					max={3}
					step={0.05}
					hint={m.t_tower_generator_z_hop_hint()}
				/>
			</FieldGroup>

			<FieldGroup title={m.t_tower_generator_group_gcode()}>
				<div class="notice notice-warning" role="note">
					<TriangleAlert size={16} aria-hidden="true" />
					<p>{m.t_tower_generator_start_code_warning()}</p>
				</div>
				<div>
					<label for="tower-start" class="label">{m.t_tower_generator_start_code()}</label>
					<textarea
						id="tower-start"
						class="input"
						rows="7"
						spellcheck="false"
						bind:value={p.startGcode}
						aria-describedby="tower-start-hint"></textarea>
					<p id="tower-start-hint" class="hint">
						{m.t_tower_generator_start_code_hint({
							nozzle: '{nozzle}',
							bed: '{bed}',
							bedX: '{bed_x}',
							bedY: '{bed_y}'
						})}
					</p>
				</div>
				<div>
					<label for="tower-end" class="label">{m.t_tower_generator_end_code()}</label>
					<textarea id="tower-end" class="input" rows="6" spellcheck="false" bind:value={p.endGcode}
					></textarea>
				</div>
			</FieldGroup>
		{/if}

		<FieldGroup>
			<button type="button" class="btn-ghost btn-s" onclick={reset}>
				<RotateCcw size={14} aria-hidden="true" />
				{m.t_tower_generator_reset()}
			</button>
		</FieldGroup>
	{/snippet}
</ToolShell>
