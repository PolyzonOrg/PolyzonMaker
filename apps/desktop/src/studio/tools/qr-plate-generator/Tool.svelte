<script lang="ts">
	/**
	 * QR plate: the form, the build (caption glyphs from OpenSCAD, the rest
	 * in the plate worker) and the downloads.
	 */
	import { onDestroy } from 'svelte';
	import { CircleCheck, Download, Layers, Palette, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import type { QrEcc } from '$lib/tools/shared/qr';
	import { partCount, type Layer, type ModuleShape } from '$lib/tools/shared/relief';
	import { createReliefClient } from '$lib/tools/shared/relief-client';
	import type { ReliefResult } from '$lib/tools/shared/relief-worker';
	import { fmt, type ReliefMode } from '$lib/tools/nameplate-generator/tag';
	import {
		plateTexts,
		QR_PLATE_DEFAULTS,
		QR_PLATE_LIMITS,
		QR_PLATE_PRESETS,
		type CaptionPlace,
		type PlateMount,
		type PlateShape,
		type QrPlateInfo,
		type QrPlateJob,
		type QrPlateParams
	} from './model';
	import type { PayloadKind, WifiSecurity } from './payload';
	import { num } from '$lib/i18n/current';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/qr-plate-generator';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<QrPlateParams>(structuredClone(QR_PLATE_DEFAULTS));

	const client = createReliefClient<QrPlateJob, QrPlateInfo>(
		() =>
			new Worker(new URL('./plate.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('qr-plate')
			})
	);
	const build = createBuild<QrPlateParams, ReliefResult<QrPlateInfo>>(
		(params, signal) => client.build({ params }, plateTexts(params), signal),
		350
	);
	$effect(() => build.run($state.snapshot(p)));
	onDestroy(() => {
		build.cancel();
		client.dispose();
	});

	const result = $derived(build.value);
	const parts = $derived(result ? partCount(result.layers) : 0);
	const NAME = m.t_qr_plate_generator_filename();

	const PAYLOAD_KEYS = [
		'link',
		'text',
		'wifiName',
		'wifiPassword',
		'phone',
		'email',
		'emailSubject',
		'emailBody',
		'contactName',
		'contactOrg',
		'contactPhone',
		'contactEmail',
		'contactSite'
	] as const;

	/** A preset sets the plate; what the person already typed into the code stays. */
	function applyPreset(params: Partial<QrPlateParams>) {
		const next: QrPlateParams = { ...structuredClone(QR_PLATE_DEFAULTS), ...params };
		for (const key of PAYLOAD_KEYS) if (p[key].trim()) next[key] = p[key];
		p = next;
	}

	async function downloadParts() {
		const r = result;
		if (!r) return;
		const zip = await client.parts($state.snapshot(r.layers) as Layer[], NAME, r.info.colorChange);
		downloadBytes(
			zip,
			`${NAME}-${m.t_qr_plate_generator_colours_filename()}.zip`,
			'application/zip'
		);
	}

	async function download3mf() {
		const r = result;
		if (!r) return;
		const file = await client.parts3mf($state.snapshot(r.layers) as Layer[], NAME);
		downloadBytes(file, `${NAME}.3mf`, 'model/3mf');
	}

	async function downloadSvg() {
		const r = result;
		if (!r) return;
		downloadBytes(
			await client.svg($state.snapshot(r.layers) as Layer[]),
			`${NAME}.svg`,
			'image/svg+xml'
		);
	}

	const L = QR_PLATE_LIMITS;
	const kinds: { value: PayloadKind; label: string }[] = [
		{ value: 'link', label: m.t_qr_plate_generator_kind_link() },
		{ value: 'text', label: m.t_qr_plate_generator_kind_text() },
		{ value: 'wifi', label: 'Wi-Fi' },
		{ value: 'phone', label: m.t_qr_plate_generator_kind_phone() },
		{ value: 'email', label: m.t_qr_plate_generator_kind_email() },
		{ value: 'contact', label: m.t_qr_plate_generator_kind_contact() }
	];
	const securities: { value: WifiSecurity; label: string }[] = [
		{ value: 'WPA', label: m.t_qr_plate_generator_security_wpa() },
		{ value: 'WEP', label: 'WEP' },
		{ value: 'nopass', label: m.t_qr_plate_generator_security_none() }
	];
	const levels: { value: QrEcc; label: string }[] = [
		{ value: 'L', label: m.t_qr_plate_generator_ecc_low() },
		{ value: 'M', label: m.t_qr_plate_generator_ecc_medium() },
		{ value: 'Q', label: m.t_qr_plate_generator_ecc_quartile() },
		{ value: 'H', label: m.t_qr_plate_generator_ecc_high() }
	];
	const ECC_LABEL: Record<QrEcc, string> = {
		L: m.t_qr_plate_generator_info_ecc_low(),
		M: m.t_qr_plate_generator_info_ecc_medium(),
		Q: m.t_qr_plate_generator_info_ecc_quartile(),
		H: m.t_qr_plate_generator_info_ecc_high()
	};
	const moduleShapes: { value: ModuleShape; label: string }[] = [
		{ value: 'square', label: m.t_qr_plate_generator_module_square() },
		{ value: 'dot', label: m.t_qr_plate_generator_module_dot() },
		{ value: 'diamond', label: m.t_qr_plate_generator_module_diamond() }
	];
	const modes: { value: ReliefMode; label: string }[] = [
		{ value: 'raised', label: m.t_qr_plate_generator_mode_raised() },
		{ value: 'engraved', label: m.t_qr_plate_generator_mode_engraved() }
	];
	const plateShapes: { value: PlateShape; label: string }[] = [
		{ value: 'rect', label: m.t_qr_plate_generator_shape_rect() },
		{ value: 'circle', label: m.t_qr_plate_generator_shape_circle() }
	];
	const places: { value: CaptionPlace; label: string }[] = [
		{ value: 'below', label: m.t_qr_plate_generator_place_below() },
		{ value: 'above', label: m.t_qr_plate_generator_place_above() },
		{ value: 'right', label: m.t_qr_plate_generator_place_right() }
	];
	const mounts: { value: PlateMount; label: string }[] = [
		{ value: 'none', label: tc.tc_none() },
		{ value: 'top', label: m.t_qr_plate_generator_mount_top() },
		{ value: 'top2', label: m.t_qr_plate_generator_mount_top2() },
		{ value: 'corners', label: m.t_qr_plate_generator_mount_corners() }
	];
	const magnetCounts: { value: 0 | 1 | 2 | 4; label: string }[] = [
		{ value: 0, label: tc.tc_none() },
		{ value: 1, label: m.t_qr_plate_generator_magnets_one() },
		{ value: 2, label: m.t_qr_plate_generator_magnets_two() },
		{ value: 4, label: m.t_qr_plate_generator_magnets_four() }
	];
</script>

<ToolShell
	{tool}
	stl={result?.stl ?? null}
	busy={build.busy}
	error={build.error}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () => result && downloadBytes(result.stl, `${NAME}.stl`, 'model/stl')
		},
		...(parts > 1
			? [
					{ label: tc.tc_download_3mf_colours(), icon: Layers, onClick: () => void download3mf() },
					{
						label: m.t_qr_plate_generator_download_stl_colours(),
						icon: Download,
						onClick: () => void downloadParts()
					}
				]
			: []),
		{
			label: m.t_qr_plate_generator_download_svg(),
			icon: Download,
			onClick: () => void downloadSvg()
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each QR_PLATE_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>

		<FieldGroup title={m.t_qr_plate_generator_group_payload()}>
			<ChoiceField label={m.t_qr_plate_generator_kind()} bind:value={p.kind} options={kinds} />
			{#if p.kind === 'link'}
				<TextField
					label={m.t_qr_plate_generator_link()}
					bind:value={p.link}
					maxlength={300}
					placeholder="polyzon.org"
					hint={m.t_qr_plate_generator_link_hint()}
				/>
			{:else if p.kind === 'text'}
				<TextField
					label={tc.tc_text()}
					bind:value={p.text}
					maxlength={300}
					placeholder={m.t_qr_plate_generator_text_placeholder()}
				/>
			{:else if p.kind === 'wifi'}
				<TextField
					label={m.t_qr_plate_generator_wifi_name()}
					bind:value={p.wifiName}
					maxlength={32}
				/>
				<ChoiceField
					label={m.t_qr_plate_generator_wifi_security()}
					bind:value={p.wifiSecurity}
					options={securities}
				/>
				{#if p.wifiSecurity !== 'nopass'}
					<TextField
						label={m.t_qr_plate_generator_wifi_password()}
						bind:value={p.wifiPassword}
						maxlength={63}
					/>
				{/if}
				<ToggleField
					label={m.t_qr_plate_generator_wifi_hidden()}
					bind:checked={p.wifiHidden}
					hint={m.t_qr_plate_generator_wifi_hidden_hint()}
				/>
			{:else if p.kind === 'phone'}
				<TextField
					label={m.t_qr_plate_generator_phone()}
					bind:value={p.phone}
					maxlength={24}
					placeholder="+7 900 000-00-00"
				/>
			{:else if p.kind === 'email'}
				<TextField
					label={m.t_qr_plate_generator_email()}
					bind:value={p.email}
					maxlength={120}
					placeholder="name@example.ru"
				/>
				<TextField
					label={m.t_qr_plate_generator_email_subject()}
					bind:value={p.emailSubject}
					maxlength={120}
				/>
				<TextField
					label={m.t_qr_plate_generator_email_body()}
					bind:value={p.emailBody}
					maxlength={300}
				/>
			{:else}
				<TextField
					label={m.t_qr_plate_generator_contact_name()}
					bind:value={p.contactName}
					maxlength={60}
				/>
				<TextField
					label={m.t_qr_plate_generator_contact_org()}
					bind:value={p.contactOrg}
					maxlength={80}
				/>
				<TextField
					label={m.t_qr_plate_generator_contact_phone()}
					bind:value={p.contactPhone}
					maxlength={24}
					placeholder="+7 900 000-00-00"
				/>
				<TextField
					label={m.t_qr_plate_generator_contact_email()}
					bind:value={p.contactEmail}
					maxlength={120}
				/>
				<TextField
					label={m.t_qr_plate_generator_contact_site()}
					bind:value={p.contactSite}
					maxlength={120}
				/>
			{/if}
		</FieldGroup>

		<FieldGroup title={m.t_qr_plate_generator_group_code()}>
			<ChoiceField
				label={m.t_qr_plate_generator_ecc()}
				bind:value={p.ecc}
				options={levels}
				hint={m.t_qr_plate_generator_ecc_hint()}
			/>
			<ChoiceField
				label={m.t_qr_plate_generator_modules()}
				bind:value={p.modules}
				options={moduleShapes}
			/>
			{#if p.modules !== 'square'}
				<NumberField
					label={m.t_qr_plate_generator_dot_size()}
					unit={m.t_qr_plate_generator_dot_size_unit()}
					bind:value={p.dotSize}
					min={L.dotSize[0]}
					max={L.dotSize[1]}
				/>
			{/if}
			<NumberField
				label={m.t_qr_plate_generator_quiet()}
				unit={m.t_qr_plate_generator_quiet_unit()}
				bind:value={p.quiet}
				min={L.quiet[0]}
				max={L.quiet[1]}
				hint={m.t_qr_plate_generator_quiet_hint()}
			/>
			<ChoiceField label={m.t_qr_plate_generator_mode()} bind:value={p.mode} options={modes} />
			<NumberField
				label={p.mode === 'engraved' ? tc.tc_depth() : m.t_qr_plate_generator_relief()}
				unit="mm"
				bind:value={p.relief}
				min={L.relief[0]}
				max={L.relief[1]}
				step={0.1}
			/>
			<ToggleField
				label={m.t_qr_plate_generator_light_on_top()}
				bind:checked={p.lightOnTop}
				hint={m.t_qr_plate_generator_light_on_top_hint()}
			/>
		</FieldGroup>

		<FieldGroup title={m.t_qr_plate_generator_group_plate()}>
			<ChoiceField label={tc.tc_shape()} bind:value={p.shape} options={plateShapes} />
			<NumberField
				label={p.shape === 'circle' ? tc.tc_diameter() : tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={L.width[0]}
				max={L.width[1]}
			/>
			{#if p.shape === 'rect'}
				<NumberField
					label={tc.tc_height()}
					unit="mm"
					bind:value={p.height}
					min={L.height[0]}
					max={L.height[1]}
				/>
				<NumberField
					label={tc.tc_corner_radius()}
					unit="mm"
					bind:value={p.radius}
					min={L.radius[0]}
					max={L.radius[1]}
					step={0.5}
				/>
			{/if}
			<NumberField
				label={m.t_qr_plate_generator_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={L.thickness[0]}
				max={L.thickness[1]}
				step={0.2}
			/>
			<ToggleField
				label={tc.tc_frame()}
				bind:checked={p.frame}
				hint={m.t_qr_plate_generator_frame_hint()}
			/>
			{#if p.frame}
				<NumberField
					label={m.t_qr_plate_generator_frame_width()}
					unit="mm"
					bind:value={p.frameWidth}
					min={L.frameWidth[0]}
					max={L.frameWidth[1]}
					step={0.1}
				/>
			{/if}
		</FieldGroup>

		<FieldGroup title={m.t_qr_plate_generator_group_caption()}>
			<ToggleField label={m.t_qr_plate_generator_caption()} bind:checked={p.caption} />
			{#if p.caption}
				<TextField
					label={m.t_qr_plate_generator_caption_text()}
					bind:value={p.captionText}
					maxlength={40}
					placeholder={m.t_qr_plate_generator_caption_placeholder()}
				/>
				<ChoiceField
					label={m.t_qr_plate_generator_caption_place()}
					bind:value={p.captionPlace}
					options={places}
				/>
				<NumberField
					label={m.t_qr_plate_generator_caption_height()}
					unit="mm"
					bind:value={p.captionHeight}
					min={L.captionHeight[0]}
					max={L.captionHeight[1]}
					step={0.5}
				/>
			{/if}
		</FieldGroup>

		<FieldGroup title={tc.tc_mount()}>
			<ChoiceField label={m.t_qr_plate_generator_mount()} bind:value={p.mount} options={mounts} />
			{#if p.mount !== 'none'}
				<NumberField
					label={m.t_qr_plate_generator_hole_diameter()}
					unit="mm"
					bind:value={p.holeDiameter}
					min={L.holeDiameter[0]}
					max={L.holeDiameter[1]}
					step={0.5}
				/>
				<ToggleField
					label={m.t_qr_plate_generator_countersink()}
					bind:checked={p.countersink}
					hint={m.t_qr_plate_generator_countersink_hint()}
				/>
			{/if}
			<ChoiceField
				label={m.t_qr_plate_generator_magnets()}
				bind:value={p.magnets}
				options={magnetCounts}
			/>
			{#if p.magnets > 0}
				<NumberField
					label={m.t_qr_plate_generator_magnet_diameter()}
					unit="mm"
					bind:value={p.magnetDiameter}
					min={L.magnetDiameter[0]}
					max={L.magnetDiameter[1]}
					step={0.5}
					hint={m.t_qr_plate_generator_magnet_diameter_hint()}
				/>
				<NumberField
					label={m.t_qr_plate_generator_magnet_depth()}
					unit="mm"
					bind:value={p.magnetDepth}
					min={L.magnetDepth[0]}
					max={L.magnetDepth[1]}
					step={0.2}
				/>
			{/if}
		</FieldGroup>

		{#if result}
			{@const info = result.info}
			<FieldGroup title={m.t_qr_plate_generator_group_check()}>
				<p class="text-xs text-neutral-400">
					{m.t_qr_plate_generator_info({
						count: info.qr.bytes,
						n: num(info.qr.bytes),
						side: fmt(info.qr.side),
						size: info.qr.size,
						module: fmt(info.qr.module),
						ecc:
							info.qr.ecc !== p.ecc
								? m.t_qr_plate_generator_info_ecc_raised({ level: ECC_LABEL[info.qr.ecc] })
								: ECC_LABEL[info.qr.ecc]
					})}
				</p>
				<div class="notice">
					<Palette size={16} aria-hidden="true" />
					<p>
						{#if p.mode === 'engraved'}
							{p.lightOnTop
								? m.t_qr_plate_generator_colour_engraved_light({ height: fmt(info.colorChange) })
								: m.t_qr_plate_generator_colour_engraved_dark({ height: fmt(info.colorChange) })}
						{:else}
							{p.lightOnTop
								? m.t_qr_plate_generator_colour_raised_light({ height: fmt(info.colorChange) })
								: m.t_qr_plate_generator_colour_raised_dark({ height: fmt(info.colorChange) })}
						{/if}
						{#if parts > 1}{m.t_qr_plate_generator_colour_3mf({
								button: tc.tc_download_3mf_colours()
							})}{/if}
					</p>
				</div>
				{#each info.warnings as warning (warning)}
					<div class="notice notice-warning" role="status">
						<TriangleAlert size={16} aria-hidden="true" />
						<p>{warning}</p>
					</div>
				{:else}
					<div class="notice notice-success">
						<CircleCheck size={16} aria-hidden="true" />
						<p>{m.t_qr_plate_generator_no_problems()}</p>
					</div>
				{/each}
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>
