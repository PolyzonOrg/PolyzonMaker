<script lang="ts">
	import { MODEL_ACCEPT, readModelFile } from '$lib/tools/shared/model-file';
	import { onDestroy, onMount } from 'svelte';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import { Download, FileArchive } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, readableError, SLOW_BUILD_MS } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { bounds } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import PartsViewport from '../booleans/PartsViewport.svelte';
	import PartsList from '../booleans/PartsList.svelte';
	import { downloadAll, downloadZip, partColor, partsSize, type Part } from '../booleans/parts';
	import { AXIS_INDEX, planeAt, type Axis, type Plane, type Vec3 } from '../booleans/plane';
	import { ToolWorker } from '../booleans/worker';
	import { HOLLOW_DEFAULTS, type HollowParams } from './model';
	import type { HollowReply } from './hollow.worker';
	import { num } from '$lib/i18n/current';
	import { workerName } from '$lib/i18n/worker';
	import * as m from '$msg/tools/stl-hollow';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	const worker = new ToolWorker(
		() =>
			new Worker(new URL('./hollow.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('stl-hollow')
			})
	);

	let fileName = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let source = $state.raw<{ key: string; tris: Float32Array } | null>(null);
	let p = $state<HollowParams>({ ...HOLLOW_DEFAULTS });
	let axis = $state<Axis>('z');
	let position = $state(0);
	let tilt1 = $state(0);
	let tilt2 = $state(0);
	let showPlane = $state(true);
	let explode = $state(0);
	let progress = $state(0);
	let hiddenParts = $state<number[]>([]);

	const box = $derived(source ? bounds(source.tris) : null);
	const center = $derived<Vec3>(
		box ? ([0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2) as Vec3) : [0, 0, 0]
	);
	const i = $derived(AXIS_INDEX[axis]);
	const plane = $derived<Plane | null>(
		box && p.mode === 'box' ? planeAt(axis, position, center, tilt1, tilt2) : null
	);
	const planes = $derived(
		plane && box && showPlane
			? [{ point: plane.point, normal: plane.normal, size: Math.max(...box.size) * 1.3 }]
			: []
	);

	interface Input {
		key: string;
		tris: Float32Array;
		params: HollowParams;
		plane: Plane | null;
	}
	const build = createBuild<Input, HollowReply>(
		(input, signal) => {
			progress = 0;
			return worker.run<HollowReply>(input, signal, [], (f) => (progress = Math.round(f * 100)));
		},
		500,
		{ manualAfterMs: SLOW_BUILD_MS }
	);
	$effect(() => {
		if (!source) return;
		build.run({
			key: source.key,
			tris: source.tris,
			params: $state.snapshot(p),
			plane: plane ? $state.snapshot(plane) : null
		});
	});
	onDestroy(() => {
		build.cancel();
		worker.dispose();
	});

	const NAMES = {
		shell: m.t_stl_hollow_part_shell(),
		lid: tc.tc_lid(),
		base: m.t_stl_hollow_part_base()
	};
	const FILES = {
		shell: m.t_stl_hollow_shell_filename(),
		lid: m.t_stl_hollow_lid_filename(),
		base: m.t_stl_hollow_base_filename()
	};
	const parts = $derived.by<Part[]>(() => {
		const reply = build.value;
		if (!reply) return [];
		const n = plane?.normal ?? [0, 0, 1];
		const up = p.lid === 'plus' ? 1 : -1;
		return reply.pieces.map((piece, k) => {
			const sign = piece.role === 'lid' ? up : piece.role === 'base' ? -up : 0;
			return {
				id: k + 1,
				name: NAMES[piece.role],
				file: FILES[piece.role],
				tris: piece.tris,
				volume: piece.volume,
				color: partColor(piece.role === 'shell' ? 0 : piece.role === 'base' ? 1 : 2),
				visible: !hiddenParts.includes(k + 1),
				dir: [n[0] * sign, n[1] * sign, n[2] * sign]
			};
		});
	});

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
			const b = bounds(tris);
			build.fresh();
			source = { key: `${file.name}:${file.size}:${file.lastModified}`, tris };
			fileName = file.name;
			hiddenParts = [];
			axis = 'z';
			position = Math.round(((b.min[2] + b.max[2]) / 2) * 10) / 10;
			tilt1 = 0;
			tilt2 = 0;
		} catch (e) {
			if (fresh()) fileError = readableError(e);
		}
	}

	// A new axis puts the cut through the middle again.
	let lastAxis: Axis = 'z';
	$effect(() => {
		if (axis === lastAxis || !box) return;
		lastAxis = axis;
		position = Math.round(center[i] * 10) / 10;
	});

	const SIDE: Record<Axis, [string, string]> = {
		x: [m.t_stl_hollow_side_right(), m.t_stl_hollow_side_left()],
		y: [m.t_stl_hollow_side_back(), m.t_stl_hollow_side_front()],
		z: [m.t_stl_hollow_side_top(), m.t_stl_hollow_side_bottom()]
	};
	const TILT_NAMES: Record<Axis, [string, string]> = {
		x: ['Y', 'Z'],
		y: ['X', 'Z'],
		z: ['X', 'Y']
	};
</script>

<ToolShell
	{tool}
	size={partsSize(parts)}
	busy={build.busy}
	busyLabel={progress > 0 ? m.t_stl_hollow_busy_progress({ progress }) : m.t_stl_hollow_busy()}
	stale={build.stale}
	onrebuild={build.flush}
	error={fileError ?? build.error}
	exports={parts.length
		? [
				{
					label: parts.length > 1 ? m.t_stl_hollow_download_both() : tc.tc_download_stl(),
					icon: Download,
					primary: true,
					onClick: () =>
						downloadAll(
							parts,
							p.mode === 'box' ? m.t_stl_hollow_box_filename() : m.t_stl_hollow_shell_filename()
						)
				},
				...(parts.length > 1
					? [
							{
								label: tc.tc_zip_archive(),
								icon: FileArchive,
								onClick: () => downloadZip(parts, m.t_stl_hollow_box_filename())
							}
						]
					: [])
			]
		: []}
	empty={source ? undefined : emptyHint}
>
	{#snippet viewport()}
		<PartsViewport {parts} explode={explode / 100} {planes} fitKey={source?.key} />
	{/snippet}
	{#snippet controls()}
		<FieldGroup title={tc.tc_file()}>
			<FileField
				label={tc.tc_open_model()}
				accept={MODEL_ACCEPT}
				hint={m.t_stl_hollow_file_hint()}
				{fileName}
				{onfile}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_result()}>
			<ChoiceField
				label={m.t_stl_hollow_mode()}
				bind:value={p.mode}
				options={[
					{ value: 'hollow', label: m.t_stl_hollow_mode_hollow() },
					{ value: 'box', label: m.t_stl_hollow_mode_box() }
				]}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_stl_hollow_shell()}>
			<NumberField
				label={tc.tc_wall()}
				unit="mm"
				bind:value={p.wall}
				min={0.8}
				max={10}
				step={0.1}
				hint={m.t_stl_hollow_wall_hint()}
			/>
			<ChoiceField
				label={m.t_stl_hollow_detail()}
				bind:value={p.detail}
				options={[
					{ value: 'standard', label: m.t_stl_hollow_detail_standard() },
					{ value: 'high', label: m.t_stl_hollow_detail_high() }
				]}
			/>
			{#if p.mode === 'hollow'}
				<ToggleField
					label={m.t_stl_hollow_drain()}
					hint={m.t_stl_hollow_drain_hint()}
					bind:checked={p.drain}
				/>
				{#if p.drain}
					<NumberField
						label={tc.tc_hole_diameter()}
						unit="mm"
						bind:value={p.drainDiameter}
						min={2}
						max={10}
						step={0.5}
					/>
				{/if}
			{/if}
		</FieldGroup>
		{#if p.mode === 'box'}
			<FieldGroup title={m.t_stl_hollow_cut()}>
				<ChoiceField
					label={m.t_stl_hollow_axis()}
					bind:value={axis}
					options={[
						{ value: 'x', label: 'X' },
						{ value: 'y', label: 'Y' },
						{ value: 'z', label: 'Z' }
					]}
				/>
				<NumberField
					label={m.t_stl_hollow_position({ axis: axis.toUpperCase() })}
					unit="mm"
					bind:value={position}
					min={box ? Math.floor(box.min[i] * 10) / 10 : -100}
					max={box ? Math.ceil(box.max[i] * 10) / 10 : 100}
					step={0.1}
				/>
				<NumberField
					label={m.t_stl_hollow_tilt({ axis: TILT_NAMES[axis][0] })}
					unit="°"
					bind:value={tilt1}
					min={-60}
					max={60}
				/>
				<NumberField
					label={m.t_stl_hollow_tilt({ axis: TILT_NAMES[axis][1] })}
					unit="°"
					bind:value={tilt2}
					min={-60}
					max={60}
				/>
				<ToggleField label={m.t_stl_hollow_show_plane()} bind:checked={showPlane} />
				<ChoiceField
					label={tc.tc_lid()}
					bind:value={p.lid}
					options={[
						{ value: 'plus', label: SIDE[axis][0] },
						{ value: 'minus', label: SIDE[axis][1] }
					]}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_stl_hollow_fit_title()}>
				<ChoiceField
					label={m.t_stl_hollow_fit()}
					bind:value={p.fit}
					options={[
						{ value: 'plate', label: m.t_stl_hollow_fit_plate() },
						{ value: 'lip', label: m.t_stl_hollow_fit_lip() }
					]}
					hint={p.fit === 'plate' ? m.t_stl_hollow_fit_plate_hint() : m.t_stl_hollow_fit_lip_hint()}
				/>
				{#if p.fit === 'plate'}
					<NumberField
						label={m.t_stl_hollow_plate()}
						unit="mm"
						bind:value={p.plate}
						min={1.2}
						max={5}
						step={0.1}
					/>
					<NumberField
						label={m.t_stl_hollow_groove()}
						unit="mm"
						bind:value={p.groove}
						min={0}
						max={8}
						step={0.1}
						hint={m.t_stl_hollow_groove_hint()}
					/>
					<NumberField
						label={m.t_stl_hollow_weld()}
						unit="mm"
						bind:value={p.weld}
						min={0.6}
						max={4}
						step={0.1}
						hint={m.t_stl_hollow_weld_hint()}
					/>
				{:else}
					<NumberField
						label={m.t_stl_hollow_lip()}
						unit="mm"
						bind:value={p.lip}
						min={1}
						max={6}
						step={0.1}
					/>
				{/if}
				<NumberField
					label={tc.tc_gap()}
					unit="mm"
					bind:value={p.clearance}
					min={0.1}
					max={0.6}
					step={0.05}
					hint={m.t_stl_hollow_clearance_hint()}
				/>
			</FieldGroup>
		{/if}
		{#if parts.length}
			<FieldGroup title={m.t_stl_hollow_parts({ count: num(parts.length) })}>
				{#if parts.length > 1}
					<NumberField
						label={tc.tc_spread_parts()}
						unit="%"
						bind:value={explode}
						min={0}
						max={100}
					/>
				{/if}
				<PartsList
					{parts}
					stale={build.stale}
					onvisible={(id, visible) =>
						(hiddenParts = visible ? hiddenParts.filter((h) => h !== id) : [...hiddenParts, id])}
				/>
				{#if build.value?.note}<p class="hint" role="status">{build.value.note}</p>{/if}
				{#if build.value}
					<p class="hint">{m.t_stl_hollow_edge({ edge: num(build.value.edge, 2) })}</p>
				{/if}
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>

{#snippet emptyHint()}
	{m.t_stl_hollow_empty()}
{/snippet}
