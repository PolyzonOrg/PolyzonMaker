<script lang="ts">
	import { MODEL_ACCEPT, readModelFile } from '$lib/tools/shared/model-file';
	import { onDestroy, onMount } from 'svelte';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import { Download, FileArchive, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import Rich from '$lib/components/Rich.svelte';
	import { createBuild, readableError, SLOW_BUILD_MS } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { buildOutline, str } from '$lib/tools/scad';
	import type { ToolInfo } from '$lib/tools/registry';
	import { currentLocale, num } from '$lib/i18n/current';
	import { slots } from '$lib/i18n/rich';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import { listJoin } from '$lib/i18n/locale';
	import * as m from '$msg/tools/mold-generator';
	import PartsViewport from '../booleans/PartsViewport.svelte';
	import PartsList from '../booleans/PartsList.svelte';
	import {
		downloadAll,
		downloadZip,
		formatMl,
		partColor,
		partsSize,
		printable,
		type Part
	} from '../booleans/parts';
	import { ToolWorker } from '../booleans/worker';
	import { bounds } from '../stl';
	import {
		cutPlanes,
		MOLD_BOX_DEFAULTS,
		MOLD_PIECES,
		POUR_DEFAULTS,
		POUR_PRESETS,
		SILICONE_RATIOS,
		siliconeMix,
		type MoldBoxParams,
		type MoldPieces,
		type PourParams
	} from './model';
	import type { MoldJob, MoldReply } from './mold.worker';

	let { tool }: { tool: ToolInfo } = $props();

	const worker = new ToolWorker(
		() =>
			new Worker(new URL('./mold.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('mold')
			})
	);

	let mode = $state<'box' | 'pour'>('box');
	let fileName = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let source = $state.raw<{ key: string; tris: Float32Array } | null>(null);
	let boxP = $state<MoldBoxParams>({ ...MOLD_BOX_DEFAULTS });
	let pourP = $state<PourParams>({ ...POUR_DEFAULTS });
	let preset = $state<string | null>(POUR_PRESETS[0].id);
	let explode = $state(0);
	let hiddenParts = $state<string[]>([]);
	let textNote = $state<string | null>(null);
	/** How the silicone is weighed out: no rebuild, only the numbers change. */
	let density = $state(1.1);
	let ratioId = $state(SILICONE_RATIOS[0].id);
	const mix = $derived.by(() => {
		const volume = build.value?.silicone;
		if (volume == null) return null;
		const ratio = SILICONE_RATIOS.find((r) => r.id === ratioId) ?? SILICONE_RATIOS[0];
		return { ...siliconeMix(volume, density, ratio), ratio };
	});
	/** The same numbers as a note in the ZIP, next to the box halves. */
	function mixNote(): { name: string; data: string }[] {
		if (!mix || build.value?.silicone == null) return [];
		return [
			{
				name: `${m.t_mold_generator_mix_filename()}.txt`,
				data: [
					m.t_mold_generator_mix_silicone({ ml: formatMl(build.value.silicone) }),
					m.t_mold_generator_mix_weigh({ total: num(mix.total), density: num(density) }),
					m.t_mold_generator_mix_ratio({
						ratio: mix.ratio.label,
						a: num(mix.a),
						b: num(mix.b)
					})
				].join('\r\n')
			}
		];
	}

	// Glyphs come from OpenSCAD (its fonts), the booleans from manifold.
	type Rings = [number, number][][];
	let glyphCache: { text: string; rings: Rings | null } | null = null;
	async function glyphs(text: string, signal: AbortSignal): Promise<Rings | null> {
		const clean = text.trim();
		textNote = null;
		if (!clean) return null;
		if (glyphCache?.text !== clean) {
			const src = `text(${str(clean, 24)}, size = 10, font = "Noto Sans", halign = "center", valign = "center");`;
			try {
				const rings = await buildOutline(src, signal);
				glyphCache = { text: clean, rings: rings.length ? rings : null };
			} catch (e) {
				if (signal.aborted) throw e;
				glyphCache = { text: clean, rings: null };
			}
		}
		textNote = glyphCache.rings ? null : m.t_mold_generator_text_no_glyphs();
		return glyphCache.rings;
	}

	type Input =
		| { mode: 'box'; key: string; tris: Float32Array; params: MoldBoxParams }
		| { mode: 'pour'; params: PourParams };
	const build = createBuild<Input, MoldReply>(
		async (input, signal) => {
			const job: MoldJob =
				input.mode === 'box'
					? { op: 'box', key: input.key, tris: input.tris, params: input.params }
					: { op: 'pour', params: input.params, text: await glyphs(input.params.text, signal) };
			return worker.run<MoldReply>(job, signal);
		},
		500,
		{ manualAfterMs: SLOW_BUILD_MS }
	);
	// The pour mold is light: switching modes rebuilds on the fly again.
	let builtMode: typeof mode | null = null;
	$effect(() => {
		if (builtMode !== mode) {
			builtMode = mode;
			build.fresh();
		}
		if (mode === 'box') {
			if (source)
				build.run({
					mode,
					key: source.key,
					tris: source.tris,
					params: $state.snapshot(boxP)
				});
		} else build.run({ mode, params: $state.snapshot(pourP) });
	});
	onDestroy(() => {
		build.cancel();
		worker.dispose();
	});

	const parts = $derived.by<Part[]>(() => {
		const reply = build.value;
		if (!reply) return [];
		// A result of the other kind stays on screen until the new one is built.
		const own = mode === 'box' ? reply.silicone !== null : reply.silicone === null;
		if (!own) return [];
		const halves = reply.pieces.filter((x) => x.role === 'box').length === 2;
		let n = 0;
		return reply.pieces.map((piece, k) => {
			const index = piece.role === 'box' || piece.role === 'lid' || piece.role === 'base' ? ++n : 0;
			const [name, file] =
				piece.role === 'master'
					? reply.masterFixed
						? [
								m.t_mold_generator_part_master_fixed(),
								m.t_mold_generator_part_master_fixed_filename()
							]
						: [m.t_mold_generator_part_master(), m.t_mold_generator_part_master_filename()]
					: piece.role === 'mold'
						? [m.t_mold_generator_part_mold(), m.t_mold_generator_part_mold_filename()]
						: piece.role === 'lid'
							? [m.t_mold_generator_part_lid(), m.t_mold_generator_part_lid_filename()]
							: piece.role === 'base'
								? [m.t_mold_generator_part_base(), m.t_mold_generator_part_base_filename()]
								: [
										halves
											? m.t_mold_generator_part_half({ n: index })
											: m.t_mold_generator_part({ n: index }),
										`${m.t_mold_generator_box_filename()}-${index}`
									];
			return {
				id: k + 1,
				name,
				file,
				tris: piece.tris,
				// The lid with its core prints upside down: flat top on the bed, the core up.
				printTris: piece.role === 'lid' ? upsideDown(piece.tris) : undefined,
				volume: piece.volume,
				color: partColor(index),
				// The uploaded model itself: shown in place, not printed with the box.
				reference: piece.role === 'master' && !reply.masterFixed,
				visible: !hiddenParts.includes(file),
				dir: piece.dir
			};
		});
	});

	/** Turned 180° about X (a turn, so the triangles keep their winding). */
	function upsideDown(tris: Float32Array): Float32Array {
		const out = new Float32Array(tris.length);
		for (let i = 0; i < tris.length; i += 3) {
			out[i] = tris[i];
			out[i + 1] = -tris[i + 1];
			out[i + 2] = -tris[i + 2];
		}
		return out;
	}

	// A model sent from another page (a generation, another tool) opens at once.
	onMount(() => {
		const handed = takeHandedOffMesh();
		if (handed) void onfile(handed);
	});

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
			hiddenParts = [];
		} catch (e) {
			if (fresh()) fileError = readableError(e);
		}
	}

	function applyPreset(id: string) {
		const found = POUR_PRESETS.find((x) => x.id === id);
		if (!found) return;
		preset = id;
		pourP = { ...pourP, ...found.params };
	}

	function setVisible(id: number, visible: boolean) {
		const file = parts[id - 1]?.file;
		if (!file) return;
		hiddenParts = visible ? hiddenParts.filter((h) => h !== file) : [...hiddenParts, file];
	}

	const SHAPE_HINTS: Record<MoldBoxParams['shape'], string> = {
		outline: m.t_mold_generator_box_shape_outline_hint(),
		shell: m.t_mold_generator_box_shape_shell_hint(),
		rect: m.t_mold_generator_box_shape_rect_hint()
	};
	const PIECES: Record<MoldPieces, { label: string; hint: string }> = {
		2: { label: m.t_mold_generator_pieces_two(), hint: m.t_mold_generator_pieces_two_hint() },
		3: { label: m.t_mold_generator_pieces_three(), hint: m.t_mold_generator_pieces_three_hint() },
		4: { label: m.t_mold_generator_pieces_four(), hint: m.t_mold_generator_pieces_four_hint() },
		6: { label: m.t_mold_generator_pieces_six(), hint: m.t_mold_generator_pieces_six_hint() }
	};

	/**
	 * The cut on the scene: from a change of its angle, shift or parts until
	 * a moment after the box is built with it, so the planes show where the
	 * box will be cut before a slow rebuild lands.
	 */
	const CUTS_SHOWN_MS = 2500;
	let cutsShown = $state(false);
	let cutKey: string | null = null;
	$effect(() => {
		const key = `${boxP.angle}:${boxP.shift}:${boxP.pieces}`;
		if (cutKey !== null && key !== cutKey) cutsShown = true;
		cutKey = key;
	});
	$effect(() => {
		if (!cutsShown || build.busy || build.stale) return;
		const timer = setTimeout(() => (cutsShown = false), CUTS_SHOWN_MS);
		return () => clearTimeout(timer);
	});
	const planes = $derived.by(() => {
		const limit = build.value?.shiftLimit;
		if (mode !== 'box' || !cutsShown || limit == null) return [];
		// The box as last built: every part but the master, which stays put.
		const box = parts.filter((x) => x.dir.some((d) => d !== 0)).map((x) => bounds(x.tris));
		if (!box.length) return [];
		const min = [0, 1, 2].map((k) => Math.min(...box.map((b) => b.min[k])));
		const max = [0, 1, 2].map((k) => Math.max(...box.map((b) => b.max[k])));
		return cutPlanes(boxP, limit, { min, max });
	});

	const presetNote = $derived(POUR_PRESETS.find((x) => x.id === preset)?.note ?? null);
	const showEmpty = $derived(mode === 'box' && !source);
</script>

<ToolShell
	{tool}
	size={partsSize(parts)}
	busy={build.busy}
	busyLabel={m.t_mold_generator_busy()}
	error={fileError ?? build.error}
	stale={build.stale}
	onrebuild={build.flush}
	exports={parts.length
		? [
				{
					label: tc.tc_download_stl(),
					icon: Download,
					primary: true,
					onClick: () =>
						downloadAll(
							parts,
							mode === 'box'
								? m.t_mold_generator_box_filename()
								: m.t_mold_generator_part_mold_filename()
						)
				},
				...(printable(parts).length > 1
					? [
							{
								label: tc.tc_zip_archive(),
								icon: FileArchive,
								onClick: () => downloadZip(parts, m.t_mold_generator_box_filename(), mixNote())
							}
						]
					: [])
			]
		: []}
	empty={showEmpty ? emptyHint : undefined}
>
	{#snippet viewport()}
		<PartsViewport {parts} {planes} explode={explode / 100} fitKey="{mode}:{source?.key}" />
	{/snippet}
	{#snippet controls()}
		<FieldGroup>
			<ChoiceField
				label={m.t_mold_generator_mode()}
				bind:value={mode}
				options={[
					{ value: 'box', label: m.t_mold_generator_mode_box() },
					{ value: 'pour', label: m.t_mold_generator_mode_pour() }
				]}
				hint={mode === 'box'
					? m.t_mold_generator_mode_box_hint()
					: m.t_mold_generator_mode_pour_hint()}
			/>
		</FieldGroup>
		{#if mode === 'box'}
			<FieldGroup title={m.t_mold_generator_group_master()}>
				<FileField
					label={tc.tc_open_model()}
					accept={MODEL_ACCEPT}
					hint={m.t_mold_generator_master_hint()}
					{fileName}
					{onfile}
				/>
				<NumberField
					label={tc.tc_size()}
					unit="%"
					bind:value={boxP.scale}
					min={25}
					max={300}
					step={5}
				/>
				<ToggleField label={m.t_mold_generator_flip()} bind:checked={boxP.flip} />
			</FieldGroup>
			<FieldGroup title={m.t_mold_generator_group_walls()}>
				<NumberField
					label={m.t_mold_generator_silicone()}
					unit="mm"
					bind:value={boxP.silicone}
					min={3}
					max={15}
					step={0.5}
					hint={m.t_mold_generator_silicone_hint()}
				/>
				<NumberField
					label={m.t_mold_generator_above()}
					unit="mm"
					bind:value={boxP.above}
					min={3}
					max={30}
				/>
				<NumberField
					label={m.t_mold_generator_wall()}
					unit="mm"
					bind:value={boxP.wall}
					min={1.6}
					max={6}
					step={0.2}
				/>
				<ChoiceField
					label={m.t_mold_generator_box_shape()}
					bind:value={boxP.shape}
					options={[
						{ value: 'outline', label: m.t_mold_generator_box_shape_outline() },
						{ value: 'shell', label: m.t_mold_generator_box_shape_shell() },
						{ value: 'rect', label: m.t_mold_generator_box_shape_rect() }
					]}
					hint={SHAPE_HINTS[boxP.shape]}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_mold_generator_group_cut()}>
				<ChoiceField
					label={m.t_mold_generator_pieces()}
					bind:value={boxP.pieces}
					options={MOLD_PIECES.map((n) => ({ value: n, label: PIECES[n].label }))}
					hint={PIECES[boxP.pieces].hint}
				/>
				{#if boxP.pieces === 2}
					<!-- Quick angles: marked while the angle below is one of them. -->
					<ChoiceField
						label={m.t_mold_generator_parting()}
						bind:value={boxP.angle}
						options={[
							{ value: 0, label: m.t_mold_generator_parting_y() },
							{ value: 90, label: m.t_mold_generator_parting_x() }
						]}
					/>
				{/if}
				<NumberField
					label={m.t_mold_generator_angle()}
					unit="°"
					bind:value={boxP.angle}
					min={0}
					max={175}
					step={5}
					hint={m.t_mold_generator_angle_hint()}
				/>
				<NumberField
					label={m.t_mold_generator_shift()}
					unit="mm"
					bind:value={boxP.shift}
					min={-60}
					max={60}
					step={0.5}
					hint={build.value?.shiftLimit != null
						? m.t_mold_generator_shift_hint_limit({ mm: num(build.value.shiftLimit, 1) })
						: m.t_mold_generator_shift_hint()}
				/>
				<ToggleField
					label={m.t_mold_generator_ribs()}
					hint={m.t_mold_generator_ribs_hint()}
					bind:checked={boxP.ribs}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_mold_generator_group_pour()}>
				<ToggleField label={m.t_mold_generator_neck()} bind:checked={boxP.neck} />
				{#if boxP.neck}
					<NumberField
						label={m.t_mold_generator_neck_width()}
						unit="mm"
						bind:value={boxP.neckWidth}
						min={8}
						max={60}
					/>
					<NumberField
						label={m.t_mold_generator_neck_height()}
						unit="mm"
						bind:value={boxP.neckHeight}
						min={5}
						max={40}
					/>
				{/if}
				<ToggleField
					label={m.t_mold_generator_base()}
					hint={m.t_mold_generator_base_hint()}
					bind:checked={boxP.base}
				/>
				{#if boxP.base}
					<ToggleField
						label={m.t_mold_generator_label()}
						hint={m.t_mold_generator_label_hint()}
						bind:checked={boxP.label}
					/>
				{/if}
				<ToggleField
					label={m.t_mold_generator_pedestal()}
					hint={m.t_mold_generator_pedestal_hint()}
					bind:checked={boxP.pedestal}
				/>
				{#if boxP.pedestal}
					<NumberField
						label={m.t_mold_generator_pedestal_diameter()}
						unit="mm"
						bind:value={boxP.pedestalDiameter}
						min={0}
						max={60}
						hint={m.t_mold_generator_pedestal_diameter_hint()}
					/>
				{/if}
			</FieldGroup>
			<FieldGroup title={m.t_mold_generator_group_hollow()}>
				<ToggleField
					label={m.t_mold_generator_core()}
					hint={m.t_mold_generator_core_hint()}
					bind:checked={boxP.core}
				/>
				<ToggleField
					label={m.t_mold_generator_straighten()}
					hint={m.t_mold_generator_straighten_hint()}
					bind:checked={boxP.straighten}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_mold_generator_group_assembly()}>
				<ToggleField
					label={m.t_mold_generator_flanges()}
					hint={m.t_mold_generator_flanges_hint()}
					bind:checked={boxP.flanges}
				/>
				{#if boxP.flanges}
					<NumberField
						label={m.t_mold_generator_slot_width()}
						unit="mm"
						bind:value={boxP.slotWidth}
						min={3}
						max={12}
					/>
					<NumberField
						label={m.t_mold_generator_slot_offset()}
						unit="mm"
						bind:value={boxP.slotOffset}
						min={5}
						max={30}
					/>
					<NumberField
						label={m.t_mold_generator_extra_slots()}
						bind:value={boxP.extraSlots}
						min={0}
						max={6}
					/>
					<ToggleField
						label={m.t_mold_generator_keys()}
						hint={m.t_mold_generator_keys_hint()}
						bind:checked={boxP.keys}
					/>
				{/if}
			</FieldGroup>
		{:else}
			<FieldGroup title={m.t_mold_generator_group_presets()}>
				<div class="flex flex-wrap gap-2">
					{#each POUR_PRESETS as item (item.id)}
						<button
							type="button"
							class="btn-ghost btn-s"
							aria-pressed={preset === item.id}
							onclick={() => applyPreset(item.id)}
						>
							{item.label}
						</button>
					{/each}
				</div>
				{#if presetNote}<p class="hint">{presetNote}</p>{/if}
			</FieldGroup>
			<FieldGroup title={m.t_mold_generator_group_cell()}>
				<ChoiceField
					label={tc.tc_shape()}
					bind:value={pourP.shape}
					options={[
						{ value: 'rect', label: m.t_mold_generator_cell_rect() },
						{ value: 'circle', label: m.t_mold_generator_cell_circle() },
						{ value: 'oval', label: m.t_mold_generator_cell_oval() },
						{ value: 'hex', label: m.t_mold_generator_cell_hex() },
						{ value: 'heart', label: m.t_mold_generator_cell_heart() }
					]}
				/>
				<NumberField
					label={pourP.shape === 'circle' ? tc.tc_diameter() : tc.tc_width()}
					unit="mm"
					bind:value={pourP.width}
					min={10}
					max={150}
				/>
				{#if pourP.shape !== 'circle' && pourP.shape !== 'hex'}
					<NumberField
						label={tc.tc_length()}
						unit="mm"
						bind:value={pourP.length}
						min={10}
						max={180}
					/>
				{/if}
				<NumberField label={tc.tc_depth()} unit="mm" bind:value={pourP.depth} min={3} max={60} />
				{#if pourP.shape === 'rect' || pourP.shape === 'hex' || pourP.shape === 'heart'}
					<NumberField
						label={tc.tc_corner_radius()}
						unit="mm"
						bind:value={pourP.corner}
						min={0}
						max={30}
						step={0.5}
					/>
				{/if}
				<NumberField
					label={m.t_mold_generator_draft()}
					unit="°"
					bind:value={pourP.draft}
					min={0}
					max={15}
					step={0.5}
					hint={m.t_mold_generator_draft_hint()}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_mold_generator_group_layout()}>
				<NumberField label={m.t_mold_generator_cols()} bind:value={pourP.cols} min={1} max={8} />
				<NumberField label={m.t_mold_generator_rows()} bind:value={pourP.rows} min={1} max={8} />
				<NumberField
					label={m.t_mold_generator_divider()}
					unit="mm"
					bind:value={pourP.wall}
					min={3}
					max={20}
					step={0.5}
				/>
				<NumberField
					label={tc.tc_bottom()}
					unit="mm"
					bind:value={pourP.floor}
					min={2}
					max={15}
					step={0.5}
				/>
				<NumberField
					label={m.t_mold_generator_outer_radius()}
					unit="mm"
					bind:value={pourP.outerRadius}
					min={0}
					max={20}
					step={0.5}
				/>
				{#if pourP.cols * pourP.rows > 1}
					<ToggleField
						label={m.t_mold_generator_channels()}
						hint={m.t_mold_generator_channels_hint()}
						bind:checked={pourP.channels}
					/>
					{#if pourP.channels}
						<NumberField
							label={m.t_mold_generator_channel_width()}
							unit="mm"
							bind:value={pourP.channelWidth}
							min={2}
							max={10}
							step={0.5}
						/>
						<NumberField
							label={m.t_mold_generator_channel_depth()}
							unit="mm"
							bind:value={pourP.channelDepth}
							min={1}
							max={10}
							step={0.5}
						/>
					{/if}
				{/if}
			</FieldGroup>
			<FieldGroup title={m.t_mold_generator_group_text()}>
				<TextField
					label={tc.tc_text()}
					bind:value={pourP.text}
					maxlength={24}
					placeholder={m.t_mold_generator_text_placeholder()}
				/>
				{#if pourP.text.trim()}
					<NumberField
						label={m.t_mold_generator_text_depth()}
						unit="mm"
						bind:value={pourP.textDepth}
						min={0.4}
						max={3}
						step={0.1}
					/>
					<ToggleField
						label={m.t_mold_generator_mirror()}
						hint={m.t_mold_generator_mirror_hint()}
						bind:checked={pourP.mirror}
					/>
				{/if}
			</FieldGroup>
		{/if}
		{#if build.value && parts.length}
			<FieldGroup title={m.t_mold_generator_group_calc()}>
				<div class="space-y-1 text-sm text-neutral-300">
					{#if build.value.silicone !== null}
						{@const silicone = build.value.silicone}
						{@const cast = build.value.cast}
						<p>
							{#if mix}
								{@const total = mix.total}
								<Rich text={m.t_mold_generator_calc_silicone_mix(slots('ml', 'grams'))}
									>{#snippet ml()}<span class="tabular-nums text-neutral-100"
											>{formatMl(silicone)}</span
										>{/snippet}{#snippet grams()}<span class="tabular-nums text-neutral-100"
											>{m.t_mold_generator_grams({ g: num(total) })}</span
										>{/snippet}</Rich
								>
							{:else}
								<Rich text={m.t_mold_generator_calc_silicone(slots('ml'))}
									>{#snippet ml()}<span class="tabular-nums text-neutral-100"
											>{formatMl(silicone)}</span
										>{/snippet}</Rich
								>
							{/if}
						</p>
						{#if mix}
							{@const grams = { a: num(mix.a), b: num(mix.b) }}
							<p>
								<Rich text={m.t_mold_generator_calc_parts(slots('a', 'b'))}
									>{#snippet a()}<span class="tabular-nums text-neutral-100"
											>{m.t_mold_generator_grams({ g: grams.a })}</span
										>{/snippet}{#snippet b()}<span class="tabular-nums text-neutral-100"
											>{m.t_mold_generator_grams({ g: grams.b })}</span
										>{/snippet}</Rich
								>
							</p>
						{/if}
						<p>
							<Rich text={m.t_mold_generator_calc_model(slots('ml'))}
								>{#snippet ml()}<span class="tabular-nums text-neutral-100">{formatMl(cast)}</span
									>{/snippet}</Rich
							>
						</p>
					{:else}
						{@const cavities = build.value.cavities}
						{@const cast = build.value.cast}
						<p>
							<Rich text={m.t_mold_generator_calc_cavities(slots('n', 'ml'))}
								>{#snippet n()}<span class="tabular-nums text-neutral-100">{cavities}</span
									>{/snippet}{#snippet ml()}<span class="tabular-nums text-neutral-100"
										>{formatMl(cast)}</span
									>{/snippet}</Rich
							>
						</p>
					{/if}
				</div>
				{#if build.value.silicone !== null}
					<ChoiceField
						label={m.t_mold_generator_ratio()}
						bind:value={ratioId}
						options={SILICONE_RATIOS.map((r) => ({ value: r.id, label: r.label }))}
					/>
					<NumberField
						label={m.t_mold_generator_density()}
						unit="g/cm3"
						bind:value={density}
						min={0.9}
						max={1.6}
						step={0.01}
						hint={m.t_mold_generator_density_hint()}
					/>
				{/if}
				{#if build.value.check}
					{@const check = build.value.check}
					{#if check.open.length}
						<div class="notice notice-warning" role="status">
							<TriangleAlert size={16} aria-hidden="true" />
							<p class="min-w-0">
								{m.t_mold_generator_check_open({
									parts: listJoin(
										check.open.map((k) => parts[k]?.name),
										currentLocale()
									)
								})}
							</p>
						</div>
					{:else}
						<p class="hint" role="status">
							{m.t_mold_generator_check_ok({
								clearance: num(Math.floor(check.clearance * 10) / 10)
							})}
						</p>
					{/if}
				{/if}
				{#if build.value.note ?? textNote}
					<p class="hint" role="status">{build.value.note ?? textNote}</p>
				{/if}
			</FieldGroup>
			<FieldGroup title={m.t_mold_generator_group_parts({ n: parts.length })}>
				{#if parts.length > 1}
					<NumberField
						label={tc.tc_spread_parts()}
						unit="%"
						bind:value={explode}
						min={0}
						max={100}
					/>
				{/if}
				<PartsList {parts} stale={build.stale} onvisible={setVisible} />
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>

{#snippet emptyHint()}
	{m.t_mold_generator_empty()}
{/snippet}
