<script lang="ts">
	/**
	 * «Калькуляторы принтера»: the sums of tuning a printer, each section on
	 * its own (steps, corners, layers, flow, filament, size, Vref, belt). The
	 * belt section listens through the microphone, only when asked.
	 */
	import { onDestroy } from 'svelte';
	import { Mic, MicOff } from 'lucide-svelte';
	import Collapsible from '$lib/components/Collapsible.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import type { ToolInfo } from '$lib/tools/registry';
	import ToolPage from '../print-kit/ToolPage.svelte';
	import NumberInput from '../print-kit/NumberInput.svelte';
	import { unitLabel } from '$lib/components/tools/units';
	import { currentLocale, num } from '$lib/i18n/current';
	import { listJoin, sentenceGap } from '$lib/i18n/locale';
	import * as m from '$msg/tools/printer-calcs';
	import * as tc from '$msg/tools/common';
	import {
		beltDistance,
		extruderFix,
		gramsOf,
		holeFix,
		jdFromJerk,
		jdFromScv,
		jerkFromJd,
		metresOf,
		pitchOf,
		rotationDistance,
		scaleFix,
		scvFromJd,
		screwDistance,
		stepsPerMm,
		topSpeed,
		volumetricFlow,
		vrefOf,
		wholeStepLayers,
		type Driver
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	// Steps.
	let fullSteps = $state(200);
	let microsteps = $state(16);
	let axis = $state<'belt' | 'screw' | 'known'>('belt');
	let pitch = $state(2);
	let teeth = $state(20);
	let lead = $state(2);
	let starts = $state(4);
	let knownSteps = $state(80);
	const rd = $derived(
		axis === 'belt'
			? beltDistance(pitch, teeth)
			: axis === 'screw'
				? screwDistance(lead, starts)
				: rotationDistance(fullSteps, microsteps, knownSteps)
	);
	const spm = $derived(rd > 0 ? stepsPerMm(fullSteps, microsteps, rd) : 0);
	let eSteps = $state(93);
	let eAsked = $state(100);
	let eGot = $state(95);
	const eFix = $derived(extruderFix(eSteps, eAsked, eGot));

	// Corners.
	let accel = $state(2000);
	let cornerKnown = $state<'jerk' | 'jd' | 'scv'>('jerk');
	let cornerValue = $state(8);
	const jd = $derived(
		cornerKnown === 'jerk'
			? jdFromJerk(cornerValue, accel)
			: cornerKnown === 'scv'
				? jdFromScv(cornerValue, accel)
				: cornerValue
	);

	// Layers.
	let zLead = $state(8);
	let zSteps = $state(200);
	const layers = $derived(wholeStepLayers(zLead, zSteps));

	// Flow.
	let width = $state(0.45);
	let height = $state(0.2);
	let speed = $state(100);
	let limit = $state(15);

	// Filament.
	let diameter = $state(1.75);
	let density = $state(1.24);
	let grams = $state(1000);
	let metres = $state(10);

	// Size.
	let nominal = $state(20);
	let measured = $state(19.9);
	let holeNominal = $state(5);
	let holeMeasured = $state(4.7);

	// Vref.
	let driver = $state<Driver>('tmc');
	let current = $state(0.8);
	let rsense = $state(0.1);

	const DENSITIES = [
		{ value: 1.24, label: 'PLA' },
		{ value: 1.27, label: 'PETG' },
		{ value: 1.04, label: 'ABS' },
		{ value: 1.07, label: 'ASA' },
		{ value: 1.21, label: 'TPU' }
	];

	// Belt: microphone, only while listening.
	let listening = $state(false);
	let micError = $state<string | null>(null);
	let pitchNow = $state<number | null>(null);
	let beltA = $state<number | null>(null);
	let beltB = $state<number | null>(null);
	let target = $state(110);
	let stream: MediaStream | null = null;
	let context: AudioContext | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;

	async function listen() {
		micError = null;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: false, noiseSuppression: false }
			});
			context = new AudioContext();
			const source = context.createMediaStreamSource(stream);
			const analyser = context.createAnalyser();
			analyser.fftSize = 8192;
			source.connect(analyser);
			const buf = new Float32Array(analyser.fftSize);
			const rate = context.sampleRate;
			listening = true;
			timer = setInterval(() => {
				analyser.getFloatTimeDomainData(buf);
				const f = pitchOf(buf, rate, 30, 400);
				if (f) pitchNow = Math.round(f * 10) / 10;
			}, 150);
		} catch {
			micError = m.t_printer_calcs_mic_error();
			stop();
		}
	}

	function stop() {
		if (timer) clearInterval(timer);
		timer = null;
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		void context?.close();
		context = null;
		listening = false;
	}
	onDestroy(stop);

	const f = (v: number, d = 2) => num(v, d);
	// Units of the fields, written the page language's way.
	const MM = unitLabel('mm');

	// The belt's verdict and, when the two CoreXY belts differ, a second sentence.
	const beltNote = $derived.by(() => {
		if (!pitchNow) return '';
		const verdict =
			Math.abs(pitchNow - target) < 3
				? m.t_printer_calcs_belt_ok()
				: pitchNow < target
					? m.t_printer_calcs_belt_loose({ hz: f(target - pitchNow, 0) })
					: m.t_printer_calcs_belt_tight({ hz: f(pitchNow - target, 0) });
		if (!(beltA && beltB && Math.abs(beltA - beltB) > 3)) return verdict;
		const pair = m.t_printer_calcs_belt_corexy({ hz: f(Math.abs(beltA - beltB), 0) });
		return verdict + sentenceGap(currentLocale()) + pair;
	});
</script>

<ToolPage {tool} lead={m.t_printer_calcs_lead()}>
	<Collapsible
		variant="section"
		title={m.t_printer_calcs_steps_title()}
		lead={m.t_printer_calcs_steps_lead()}
	>
		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<ChoiceField
					label={m.t_printer_calcs_motor_steps()}
					bind:value={fullSteps}
					options={[
						{ value: 200, label: `200 (${f(1.8, 1)}°)` },
						{ value: 400, label: `400 (${f(0.9, 1)}°)` }
					]}
				/>
				<ChoiceField
					label={m.t_printer_calcs_microsteps()}
					bind:value={microsteps}
					options={[8, 16, 32, 64].map((v) => ({ value: v, label: String(v) }))}
				/>
			</div>
			<ChoiceField
				label={m.t_printer_calcs_axis()}
				bind:value={axis}
				options={[
					{ value: 'belt', label: m.t_printer_calcs_axis_belt() },
					{ value: 'screw', label: m.t_printer_calcs_axis_screw() },
					{ value: 'known', label: m.t_printer_calcs_axis_known() }
				]}
			/>
			<div class="grid gap-4 sm:grid-cols-2">
				{#if axis === 'belt'}
					<NumberInput
						label={m.t_printer_calcs_belt_pitch()}
						unit={MM}
						bind:value={pitch}
						max={20}
						hint={m.t_printer_calcs_belt_pitch_hint()}
					/>
					<NumberInput
						label={m.t_printer_calcs_pulley_teeth()}
						bind:value={teeth}
						max={200}
						digits={0}
					/>
				{:else if axis === 'screw'}
					<NumberInput
						label={m.t_printer_calcs_screw_pitch()}
						unit={MM}
						bind:value={lead}
						max={20}
						hint={m.t_printer_calcs_screw_pitch_hint()}
					/>
					<NumberInput
						label={m.t_printer_calcs_screw_starts()}
						bind:value={starts}
						max={8}
						digits={0}
						hint={m.t_printer_calcs_screw_starts_hint()}
					/>
				{:else}
					<NumberInput
						label={m.t_printer_calcs_known_steps()}
						bind:value={knownSteps}
						max={10000}
					/>
				{/if}
			</div>
			<div class="card grid gap-4 sm:grid-cols-2">
				<div>
					<div class="text-xs text-neutral-400">{m.t_printer_calcs_marlin_steps()}</div>
					<div class="text-2xl font-semibold tabular-nums">{f(spm, 3)}</div>
				</div>
				<div>
					<div class="text-xs text-neutral-400">Klipper, rotation_distance</div>
					<div class="text-2xl font-semibold tabular-nums">{f(rd, 3)}</div>
				</div>
			</div>
			<h3 class="text-sm font-semibold">{m.t_printer_calcs_extruder_title()}</h3>
			<div class="grid gap-4 sm:grid-cols-3">
				<NumberInput label={m.t_printer_calcs_extruder_steps()} bind:value={eSteps} max={10000} />
				<NumberInput
					label={m.t_printer_calcs_extruder_asked()}
					unit={MM}
					bind:value={eAsked}
					max={1000}
				/>
				<NumberInput
					label={m.t_printer_calcs_extruder_got()}
					unit={MM}
					bind:value={eGot}
					max={1000}
					hint={m.t_printer_calcs_extruder_got_hint()}
				/>
			</div>
			{#if eFix}
				<p class="text-sm tabular-nums text-neutral-300">
					{m.t_printer_calcs_extruder_fix({ steps: f(eFix.steps, 2), factor: f(eFix.factor, 4) })}
				</p>
			{/if}
		</div>
	</Collapsible>

	<Collapsible
		variant="section"
		title={m.t_printer_calcs_corners_title()}
		lead={m.t_printer_calcs_corners_lead()}
	>
		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<NumberInput
					label={m.t_printer_calcs_accel()}
					unit={unitLabel('mm/s2')}
					bind:value={accel}
					max={100000}
					digits={0}
				/>
				<ChoiceField
					label={m.t_printer_calcs_known()}
					bind:value={cornerKnown}
					options={[
						{ value: 'jerk', label: m.t_printer_calcs_jerk() },
						{ value: 'jd', label: 'Junction deviation' },
						{ value: 'scv', label: 'Square corner velocity' }
					]}
				/>
			</div>
			<NumberInput
				label={cornerKnown === 'jd'
					? 'Junction deviation'
					: cornerKnown === 'scv'
						? 'Square corner velocity'
						: m.t_printer_calcs_jerk_xy()}
				unit={cornerKnown === 'jd' ? MM : unitLabel('mm/s')}
				bind:value={cornerValue}
				max={1000}
				digits={4}
			/>
			{#if accel > 0 && cornerValue > 0}
				<div class="card grid gap-4 sm:grid-cols-3">
					<div>
						<div class="text-xs text-neutral-400">{m.t_printer_calcs_jerk_marlin()}</div>
						<div class="text-2xl font-semibold tabular-nums">{f(jerkFromJd(jd, accel), 1)}</div>
					</div>
					<div>
						<div class="text-xs text-neutral-400">Junction deviation (M205 J)</div>
						<div class="text-2xl font-semibold tabular-nums">{f(jd, 4)}</div>
					</div>
					<div>
						<div class="text-xs text-neutral-400">square_corner_velocity</div>
						<div class="text-2xl font-semibold tabular-nums">{f(scvFromJd(jd, accel), 1)}</div>
					</div>
				</div>
			{/if}
		</div>
	</Collapsible>

	<Collapsible
		variant="section"
		title={m.t_printer_calcs_layers_title()}
		lead={m.t_printer_calcs_layers_lead()}
	>
		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<NumberInput
					label={m.t_printer_calcs_z_lead()}
					unit={MM}
					bind:value={zLead}
					max={40}
					hint={m.t_printer_calcs_z_lead_hint()}
				/>
				<NumberInput
					label={m.t_printer_calcs_z_steps()}
					bind:value={zSteps}
					max={1000}
					digits={0}
				/>
			</div>
			<p class="text-sm tabular-nums text-neutral-300">
				{layers.length
					? m.t_printer_calcs_layers_list({
							layers: listJoin(
								layers.map((l) => f(l, 4)),
								currentLocale()
							)
						})
					: m.t_printer_calcs_layers_none()}
			</p>
		</div>
	</Collapsible>

	<Collapsible
		variant="section"
		title={m.t_printer_calcs_flow_title()}
		lead={m.t_printer_calcs_flow_lead()}
	>
		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-3">
				<NumberInput
					label={m.t_printer_calcs_line_width()}
					unit={MM}
					bind:value={width}
					max={3}
					digits={3}
				/>
				<NumberInput
					label={m.t_printer_calcs_layer_height()}
					unit={MM}
					bind:value={height}
					max={2}
					digits={3}
				/>
				<NumberInput
					label={m.t_printer_calcs_speed()}
					unit={unitLabel('mm/s')}
					bind:value={speed}
					max={2000}
					digits={0}
				/>
			</div>
			<NumberInput
				label={m.t_printer_calcs_hotend_limit()}
				unit={unitLabel('mm3/s')}
				bind:value={limit}
				max={200}
				hint={m.t_printer_calcs_hotend_limit_hint()}
			/>
			{#if width > 0 && height > 0}
				<div class="card grid gap-4 sm:grid-cols-2">
					<div>
						<div class="text-xs text-neutral-400">{m.t_printer_calcs_flow_now()}</div>
						<div class="text-2xl font-semibold tabular-nums">
							{m.t_printer_calcs_flow_value({ value: f(volumetricFlow(width, height, speed), 1) })}
						</div>
					</div>
					<div>
						<div class="text-xs text-neutral-400">{m.t_printer_calcs_top_speed()}</div>
						<div class="text-2xl font-semibold tabular-nums">
							{m.t_printer_calcs_speed_value({ value: f(topSpeed(limit, width, height), 0) })}
						</div>
					</div>
				</div>
			{/if}
		</div>
	</Collapsible>

	<Collapsible
		variant="section"
		title={m.t_printer_calcs_filament_title()}
		lead={m.t_printer_calcs_filament_lead()}
	>
		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<ChoiceField
					label={tc.tc_diameter()}
					bind:value={diameter}
					options={[
						{ value: 1.75, label: m.t_printer_calcs_diameter_option({ value: f(1.75) }) },
						{ value: 2.85, label: m.t_printer_calcs_diameter_option({ value: f(2.85) }) }
					]}
				/>
				<ChoiceField label={tc.tc_plastic()} bind:value={density} options={DENSITIES} />
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<NumberInput
					label={m.t_printer_calcs_mass()}
					unit={unitLabel('g')}
					bind:value={grams}
					max={100000}
				/>
				<NumberInput
					label={tc.tc_length()}
					unit={unitLabel('m')}
					bind:value={metres}
					max={100000}
				/>
			</div>
			<div class="card grid gap-4 sm:grid-cols-2">
				<div>
					<div class="text-xs text-neutral-400">
						{m.t_printer_calcs_grams_are({ grams: f(grams, 0) })}
					</div>
					<div class="text-2xl font-semibold tabular-nums">
						{m.t_printer_calcs_metres_value({ value: f(metresOf(grams, diameter, density), 1) })}
					</div>
				</div>
				<div>
					<div class="text-xs text-neutral-400">
						{m.t_printer_calcs_metres_weigh({ count: metres, n: f(metres, 1) })}
					</div>
					<div class="text-2xl font-semibold tabular-nums">
						{m.t_printer_calcs_grams_value({ value: f(gramsOf(metres, diameter, density), 1) })}
					</div>
				</div>
			</div>
		</div>
	</Collapsible>

	<Collapsible
		variant="section"
		title={m.t_printer_calcs_size_title()}
		lead={m.t_printer_calcs_size_lead()}
	>
		<div class="space-y-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<NumberInput
					label={m.t_printer_calcs_nominal()}
					unit={MM}
					bind:value={nominal}
					max={1000}
				/>
				<NumberInput
					label={m.t_printer_calcs_measured()}
					unit={MM}
					bind:value={measured}
					max={1000}
				/>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<NumberInput
					label={m.t_printer_calcs_hole_nominal()}
					unit={MM}
					bind:value={holeNominal}
					max={500}
				/>
				<NumberInput
					label={m.t_printer_calcs_hole_measured()}
					unit={MM}
					bind:value={holeMeasured}
					max={500}
				/>
			</div>
			{#if (nominal > 0 && measured > 0) || (holeNominal > 0 && holeMeasured > 0)}
				<div class="card grid gap-4 sm:grid-cols-2">
					{#if nominal > 0 && measured > 0}
						<div>
							<div class="text-xs text-neutral-400">{m.t_printer_calcs_slicer_scale()}</div>
							<div class="text-2xl font-semibold tabular-nums">
								{m.t_printer_calcs_scale_value({ value: f(scaleFix(nominal, measured), 2) })}
							</div>
						</div>
					{/if}
					{#if holeNominal > 0 && holeMeasured > 0}
						<div>
							<div class="text-xs text-neutral-400">{m.t_printer_calcs_hole_compensation()}</div>
							<div class="text-2xl font-semibold tabular-nums">
								{m.t_printer_calcs_mm_value({ value: f(holeFix(holeNominal, holeMeasured), 3) })}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</Collapsible>

	<Collapsible
		variant="section"
		title={m.t_printer_calcs_vref_title()}
		lead={m.t_printer_calcs_vref_lead()}
	>
		<div class="space-y-4">
			<ChoiceField
				label={m.t_printer_calcs_driver()}
				bind:value={driver}
				options={[
					{ value: 'tmc', label: 'TMC2208 / 2209' },
					{ value: 'a4988', label: 'A4988' },
					{ value: 'drv8825', label: 'DRV8825' }
				]}
			/>
			<div class="grid gap-4 sm:grid-cols-2">
				<NumberInput
					label={driver === 'tmc'
						? m.t_printer_calcs_current_rms()
						: m.t_printer_calcs_current_peak()}
					unit={unitLabel('A')}
					bind:value={current}
					max={3}
					digits={2}
					hint={m.t_printer_calcs_current_hint()}
				/>
				{#if driver === 'a4988'}
					<NumberInput
						label={m.t_printer_calcs_rsense()}
						unit={unitLabel('Ohm')}
						bind:value={rsense}
						max={1}
						digits={3}
						hint={m.t_printer_calcs_rsense_hint()}
					/>
				{/if}
			</div>
			<div class="card">
				<div class="text-xs text-neutral-400">Vref</div>
				<div class="text-2xl font-semibold tabular-nums">
					{m.t_printer_calcs_volts_value({ value: f(vrefOf(driver, current, rsense), 3) })}
				</div>
				{#if driver === 'tmc'}<p class="mt-1 text-sm text-neutral-300">
						{m.t_printer_calcs_vref_tmc_note()}
					</p>{/if}
			</div>
		</div>
	</Collapsible>

	<Collapsible
		variant="section"
		title={m.t_printer_calcs_belt_title()}
		lead={m.t_printer_calcs_belt_lead()}
	>
		<div class="space-y-4">
			<div class="flex flex-wrap gap-2">
				{#if listening}
					<button type="button" class="btn-ghost btn-s" onclick={stop}
						><MicOff size={14} aria-hidden="true" /> {m.t_printer_calcs_stop()}</button
					>
				{:else}
					<button type="button" class="btn-ghost btn-s" onclick={listen}
						><Mic size={14} aria-hidden="true" /> {m.t_printer_calcs_listen()}</button
					>
				{/if}
				<button
					type="button"
					class="btn-ghost btn-s"
					disabled={!pitchNow}
					onclick={() => (beltA = pitchNow)}>{m.t_printer_calcs_remember_a()}</button
				>
				<button
					type="button"
					class="btn-ghost btn-s"
					disabled={!pitchNow}
					onclick={() => (beltB = pitchNow)}>{m.t_printer_calcs_remember_b()}</button
				>
			</div>
			{#if micError}<p class="field-error" role="alert">{micError}</p>{/if}
			<NumberInput
				label={m.t_printer_calcs_target()}
				unit={unitLabel('Hz')}
				bind:value={target}
				max={400}
				digits={0}
				hint={m.t_printer_calcs_target_hint()}
			/>
			<div class="card grid gap-4 sm:grid-cols-3">
				<div>
					<div class="text-xs text-neutral-400">{m.t_printer_calcs_now()}</div>
					<div class="text-2xl font-semibold tabular-nums" aria-live="polite">
						{pitchNow ? m.t_printer_calcs_hz_value({ value: f(pitchNow, 1) }) : '—'}
					</div>
				</div>
				<div>
					<div class="text-xs text-neutral-400">{m.t_printer_calcs_belt_a()}</div>
					<div class="text-2xl font-semibold tabular-nums">
						{beltA ? m.t_printer_calcs_hz_value({ value: f(beltA, 1) }) : '—'}
					</div>
				</div>
				<div>
					<div class="text-xs text-neutral-400">{m.t_printer_calcs_belt_b()}</div>
					<div class="text-2xl font-semibold tabular-nums">
						{beltB ? m.t_printer_calcs_hz_value({ value: f(beltB, 1) }) : '—'}
					</div>
				</div>
			</div>
			{#if pitchNow}
				<p class="text-sm tabular-nums text-neutral-300">{beltNote}</p>
			{/if}
			<p class="hint">{m.t_printer_calcs_mic_private()}</p>
		</div>
	</Collapsible>
</ToolPage>
