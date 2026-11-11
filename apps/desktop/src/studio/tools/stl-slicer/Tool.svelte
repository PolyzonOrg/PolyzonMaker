<script lang="ts">
	import { MODEL_ACCEPT, modelHint, readModelFile } from '$lib/tools/shared/model-file';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import { Download, FileArchive, RotateCw, Scissors, Undo2 } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { readableError } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { bounds } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import PartsViewport from '../booleans/PartsViewport.svelte';
	import PartsList from '../booleans/PartsList.svelte';
	import { downloadAll, downloadZip, partColor, partsSize, type Part } from '../booleans/parts';
	import {
		AXIS_INDEX,
		planeAt,
		quarterTurn,
		transformTriangles,
		applyMat4,
		type Axis,
		type Vec3
	} from '../booleans/plane';
	import { ToolWorker } from '../booleans/worker';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/stl-slicer';
	import { CONNECTOR_DEFAULTS, type ConnectorParams } from './model';
	import { biggerHalf, halfDirs, replacePart } from './cut-parts';
	import type { CutReply, Piece, PreparedPiece } from './slicer.worker';

	let { tool }: { tool: ToolInfo } = $props();

	const worker = new ToolWorker(
		() =>
			new Worker(new URL('./slicer.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('slicer')
			})
	);
	onDestroy(() => worker.dispose());

	let fileName = $state<string | null>(null);
	let original = $state.raw<Piece | null>(null);
	let parts = $state.raw<Part[]>([]);
	let selected = $state<number | null>(null);
	let axis = $state<Axis>('z');
	let position = $state(0);
	let tilt1 = $state(0);
	let tilt2 = $state(0);
	let showPlane = $state(true);
	let connector = $state<ConnectorParams>({ ...CONNECTOR_DEFAULTS });
	let explode = $state(0);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let note = $state<string | null>(null);
	/** What was done to the uploaded mesh to make it cuttable (repaired, simplified). */
	let modelNote = $state<string | null>(null);
	let layout = $state(0);
	let nextId = 1;
	let nextNumber = 1;

	const current = $derived(parts.find((p) => p.id === selected) ?? null);
	const box = $derived(current ? bounds(current.tris) : null);
	const center = $derived<Vec3>(
		box
			? [
					(box.min[0] + box.max[0]) / 2,
					(box.min[1] + box.max[1]) / 2,
					(box.min[2] + box.max[2]) / 2
				]
			: [0, 0, 0]
	);
	const i = $derived(AXIS_INDEX[axis]);
	const rangeMin = $derived(box ? Math.floor(box.min[i] * 10) / 10 : -100);
	const rangeMax = $derived(box ? Math.ceil(box.max[i] * 10) / 10 : 100);
	const plane = $derived(box ? planeAt(axis, position, center, tilt1, tilt2) : null);
	const planes = $derived(
		plane && box && showPlane
			? [{ point: plane.point, normal: plane.normal, size: Math.max(...box.size) * 1.3 }]
			: []
	);

	// A new part, axis or orientation puts the plane through the middle again.
	$effect(() => {
		void axis;
		void selected;
		void layout;
		untrack(() => {
			if (box) position = Math.round(center[i] * 10) / 10;
		});
	});

	function newPart(piece: Piece, name: string, dir: Vec3, extra: Partial<Part> = {}): Part {
		const id = nextId++;
		return {
			id,
			name,
			file: `${m.t_stl_slicer_filename()}-${id}`,
			tris: piece.tris,
			volume: piece.volume,
			color: partColor(id - 1),
			visible: true,
			dir,
			...extra
		};
	}

	// A model sent from another page (a generation, another tool) opens at once.
	onMount(() => {
		const handed = takeHandedOffMesh();
		if (handed) void onfile(handed);
	});

	const opening = latestOnly();
	async function onfile(file: File) {
		const fresh = opening.next();
		error = null;
		note = null;
		modelNote = null;
		busy = true;
		try {
			const tris = await readModelFile(file);
			if (!fresh()) return; // a newer file was chosen meanwhile
			const piece = await worker.run<PreparedPiece>({ op: 'prepare', tris }, undefined, [
				tris.buffer
			]);
			if (!fresh()) return;
			original = piece;
			modelNote = piece.note;
			fileName = file.name;
			reset();
		} catch (e) {
			if (fresh() && !(e instanceof DOMException && e.name === 'AbortError'))
				error = readableError(e);
		} finally {
			if (fresh()) busy = false;
		}
	}

	function reset() {
		if (!original) return;
		nextId = 1;
		nextNumber = 1;
		const whole = newPart(original, m.t_stl_slicer_part_whole(), [0, 0, 0], { file: 'model' });
		parts = [whole];
		selected = whole.id;
		explode = 0;
		note = null;
		error = null;
		layout++;
	}

	async function cut() {
		if (!current || !plane) return;
		const part = current;
		error = null;
		note = null;
		busy = true;
		try {
			const reply = await worker.run<CutReply>({
				op: 'cut',
				tris: part.tris,
				plane: $state.snapshot(plane),
				connector: $state.snapshot(connector)
			});
			const [down, up] = halfDirs(part.dir, plane.normal);
			const minus = newPart(reply.minus, m.t_stl_slicer_part_n({ n: nextNumber++ }), down);
			const plus = newPart(reply.plus, m.t_stl_slicer_part_n({ n: nextNumber++ }), up);
			const made = [minus, plus];
			if (reply.dowels) {
				made.push(
					newPart(reply.dowels, m.t_stl_slicer_part_pins({ n: reply.pins }), part.dir, {
						printTris: reply.dowels.printTris,
						file: `${m.t_stl_slicer_pins_filename()}-${nextId}`
					})
				);
			}
			parts = replacePart(parts, part, made);
			selected = biggerHalf(minus, plus).id;
			note = reply.note;
			if (explode === 0) explode = 30;
		} catch (e) {
			if (!(e instanceof DOMException && e.name === 'AbortError')) error = readableError(e);
		} finally {
			busy = false;
		}
	}

	/** A quarter turn about X for every part (and the original, so «Отменить все резы» keeps it). */
	function rotate() {
		if (!parts.length || !original) return;
		const all = bounds(original.tris);
		const c: Vec3 = [
			(all.min[0] + all.max[0]) / 2,
			(all.min[1] + all.max[1]) / 2,
			(all.min[2] + all.max[2]) / 2
		];
		const m = quarterTurn('x', 1, c);
		const r = quarterTurn('x', 1, [0, 0, 0]);
		original = { ...original, tris: transformTriangles(original.tris, m) };
		parts = parts.map((p) => ({
			...p,
			tris: transformTriangles(p.tris, m),
			dir: applyMat4(r, p.dir)
		}));
		layout++;
	}

	function setVisible(id: number, visible: boolean) {
		parts = parts.map((p) => (p.id === id ? { ...p, visible } : p));
	}

	const TILT_NAMES: Record<Axis, [string, string]> = {
		x: ['Y', 'Z'],
		y: ['X', 'Z'],
		z: ['X', 'Y']
	};
	const AXES = [
		{ value: 'x' as const, label: 'X' },
		{ value: 'y' as const, label: 'Y' },
		{ value: 'z' as const, label: 'Z' }
	];
</script>

<ToolShell
	{tool}
	size={partsSize(parts)}
	{busy}
	busyLabel={m.t_stl_slicer_busy()}
	{error}
	exports={parts.length
		? [
				{
					label: parts.length > 1 ? m.t_stl_slicer_download_all() : tc.tc_download_stl(),
					icon: Download,
					onClick: () => downloadAll(parts, m.t_stl_slicer_filename())
				},
				...(parts.length > 1
					? [
							{
								label: tc.tc_zip_archive(),
								icon: FileArchive,
								onClick: () => downloadZip(parts, m.t_stl_slicer_filename())
							}
						]
					: [])
			]
		: []}
	empty={parts.length ? undefined : emptyHint}
>
	{#snippet viewport()}
		<PartsViewport {parts} explode={explode / 100} {planes} fitKey={layout} />
	{/snippet}
	{#snippet controls()}
		<FieldGroup title={tc.tc_file()}>
			<FileField
				label={tc.tc_open_model()}
				accept={MODEL_ACCEPT}
				hint={modelHint()}
				{fileName}
				{onfile}
			/>
			{#if modelNote}<p class="hint" role="status">{modelNote}</p>{/if}
		</FieldGroup>
		{#if parts.length}
			<FieldGroup title={m.t_stl_slicer_group_cut()}>
				<ChoiceField label={m.t_stl_slicer_axis()} bind:value={axis} options={AXES} />
				<NumberField
					label={m.t_stl_slicer_position({ axis: axis.toUpperCase() })}
					unit="mm"
					bind:value={position}
					min={rangeMin}
					max={rangeMax}
					step={0.1}
				/>
				<NumberField
					label={m.t_stl_slicer_tilt({ axis: TILT_NAMES[axis][0] })}
					unit="°"
					bind:value={tilt1}
					min={-60}
					max={60}
				/>
				<NumberField
					label={m.t_stl_slicer_tilt({ axis: TILT_NAMES[axis][1] })}
					unit="°"
					bind:value={tilt2}
					min={-60}
					max={60}
				/>
				<ToggleField label={m.t_stl_slicer_show_plane()} bind:checked={showPlane} />
				<div class="flex flex-wrap gap-2">
					<button type="button" class="btn-primary" disabled={busy || !current} onclick={cut}>
						<Scissors size={16} aria-hidden="true" />
						{m.t_stl_slicer_cut()}
					</button>
					<button type="button" class="btn-ghost" disabled={busy} onclick={rotate}>
						<RotateCw size={16} aria-hidden="true" />
						{m.t_stl_slicer_rotate()}
					</button>
					<button
						type="button"
						class="btn-ghost"
						disabled={busy || parts.length < 2}
						onclick={reset}
					>
						<Undo2 size={16} aria-hidden="true" />
						{m.t_stl_slicer_reset()}
					</button>
				</div>
				{#if note}<p class="hint" role="status">{note}</p>{/if}
			</FieldGroup>
			<FieldGroup title={m.t_stl_slicer_group_pins()}>
				<ToggleField
					label={m.t_stl_slicer_pins()}
					hint={m.t_stl_slicer_pins_hint()}
					bind:checked={connector.enabled}
				/>
				{#if connector.enabled}
					<ChoiceField
						label={m.t_stl_slicer_pins_mode()}
						bind:value={connector.mode}
						options={[
							{ value: 'dowel', label: m.t_stl_slicer_pins_mode_dowel() },
							{ value: 'peg', label: m.t_stl_slicer_pins_mode_peg() }
						]}
						hint={connector.mode === 'dowel'
							? m.t_stl_slicer_pins_mode_dowel_hint()
							: m.t_stl_slicer_pins_mode_peg_hint()}
					/>
					<ChoiceField
						label={m.t_stl_slicer_pins_shape()}
						bind:value={connector.shape}
						options={[
							{ value: 'round', label: m.t_stl_slicer_pins_shape_round() },
							{ value: 'square', label: m.t_stl_slicer_pins_shape_square() }
						]}
					/>
					<NumberField
						label={m.t_stl_slicer_pins_diameter()}
						unit="mm"
						bind:value={connector.diameter}
						min={2}
						max={20}
						step={0.5}
					/>
					<NumberField
						label={m.t_stl_slicer_pins_depth()}
						unit="mm"
						bind:value={connector.depth}
						min={2}
						max={30}
						step={0.5}
					/>
					<NumberField
						label={m.t_stl_slicer_pins_count()}
						bind:value={connector.count}
						min={0}
						max={16}
						hint={m.t_stl_slicer_pins_count_hint()}
					/>
					<NumberField
						label={tc.tc_gap()}
						unit="mm"
						bind:value={connector.clearance}
						min={0}
						max={0.8}
						step={0.05}
						hint={m.t_stl_slicer_pins_clearance_hint()}
					/>
				{/if}
			</FieldGroup>
			<FieldGroup title={m.t_stl_slicer_group_parts({ n: parts.length })}>
				{#if parts.length > 1}
					<NumberField
						label={tc.tc_spread_parts()}
						unit="%"
						bind:value={explode}
						min={0}
						max={100}
					/>
				{/if}
				<PartsList {parts} {selected} onselect={(id) => (selected = id)} onvisible={setVisible} />
				{#if parts.length > 1}
					<p class="hint">{m.t_stl_slicer_next_cut()}</p>
				{/if}
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>

{#snippet emptyHint()}
	{m.t_stl_slicer_empty()}
{/snippet}
