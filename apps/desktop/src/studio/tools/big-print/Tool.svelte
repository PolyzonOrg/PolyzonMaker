<script lang="ts">
	/**
	 * «Большая модель по частям»: a model bigger than the printer, scaled to
	 * the size wanted and cut into as few parts as fit the build volume, with
	 * dowel sockets on every joint and the order to glue them. The plan and
	 * the cuts run in the worker (model.ts); the page keeps the form, the
	 * scene and the files.
	 */
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Download, FileArchive, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, readableError, SLOW_BUILD_MS } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { MODEL_ACCEPT, modelHint, readModelFile } from '$lib/tools/shared/model-file';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import { bounds, placeOnBed, translate } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { currentLocale, num } from '$lib/i18n/current';
	import { listJoin, sentenceGap } from '$lib/i18n/locale';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/big-print';
	import PartsViewport from '../booleans/PartsViewport.svelte';
	import PartsList from '../booleans/PartsList.svelte';
	import { downloadAll, downloadZip, partColor, PART_COLORS, type Part } from '../booleans/parts';
	import { ToolWorker } from '../booleans/worker';
	import { scaleFor, valueFor } from '../model-resize/model';
	import {
		BIG_PRINT_DEFAULTS,
		connectorOf,
		PRINTERS,
		type BigPrintParams,
		type Joint
	} from './model';
	import type { Vec3 } from './plan';
	import type { BigPrintJob, BigPrintReply } from './big-print.worker';

	let { tool }: { tool: ToolInfo } = $props();

	const worker = new ToolWorker(
		() =>
			new Worker(new URL('./big-print.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('big-print')
			})
	);

	type SizeBy = 'max' | 'z' | 'scale';

	let fileName = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let source = $state.raw<{ key: string; tris: Float32Array; size: Vec3 } | null>(null);
	let p = $state<BigPrintParams>({ ...BIG_PRINT_DEFAULTS, bed: [...BIG_PRINT_DEFAULTS.bed] });
	let by = $state<SizeBy>('max');
	let value = $state(500);
	let explode = $state(40);
	let view = $state<'assembled' | 'bed'>('assembled');
	let hidden = $state<number[]>([]);
	let progress = $state(0);

	const scale = $derived(source ? scaleFor(source.size, by, value) : 1);
	const dims = (s: readonly number[]) => s.map((v) => num(v, 0)).join(' × ');

	// A preset fills in the bed; a bed typed by hand is «Свой».
	const printer = $derived(
		PRINTERS.find((x) => x.size.every((v, k) => v === p.bed[k]))?.id ?? 'own'
	);
	function choosePrinter(id: string) {
		const found = PRINTERS.find((x) => x.id === id);
		if (found) p.bed = [...found.size];
	}

	// Another measure shows what the model measures now, so nothing jumps.
	let lastBy: SizeBy = 'max';
	$effect(() => {
		const next = by;
		if (next === lastBy) return;
		const was = lastBy;
		lastBy = next;
		untrack(() => {
			if (!source) return;
			value = valueFor(source.size, next, scaleFor(source.size, was, value));
		});
	});

	const build = createBuild<BigPrintJob, BigPrintReply>(
		(job, signal) => {
			progress = 0;
			return worker.run<BigPrintReply>(job, signal, [], (f) => (progress = Math.round(f * 100)));
		},
		500,
		{ manualAfterMs: SLOW_BUILD_MS }
	);
	$effect(() => {
		if (!source) return;
		build.run({ key: source.key, tris: source.tris, scale, params: $state.snapshot(p) });
	});
	onDestroy(() => {
		build.cancel();
		worker.dispose();
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
			const size = bounds(tris).size;
			build.fresh();
			source = { key: `${file.name}:${file.size}:${file.lastModified}`, tris, size };
			fileName = file.name;
			hidden = [];
			by = 'max';
			lastBy = 'max';
			// A model that fits the bed is here to be printed big: half a metre to start with.
			const longest = Math.round(Math.max(...size));
			value = longest < Math.max(...p.bed) ? Math.max(500, longest) : longest;
		} catch (e) {
			if (fresh()) fileError = readableError(e);
		}
	}

	const reply = $derived(build.value);
	const file = (n: number, total: number) =>
		`${m.t_big_print_part_filename()}-${String(n).padStart(total >= 10 ? 2 : 1, '0')}`;

	/** Bounds of several meshes together. */
	function boundsOf(list: Float32Array[]) {
		const min: Vec3 = [Infinity, Infinity, Infinity];
		const max: Vec3 = [-Infinity, -Infinity, -Infinity];
		for (const b of list.map((t) => bounds(t)))
			for (let k = 0; k < 3; k++) {
				min[k] = Math.min(min[k], b.min[k]);
				max[k] = Math.max(max[k], b.max[k]);
			}
		return { min, max, size: [0, 1, 2].map((k) => max[k] - min[k]) as Vec3 };
	}

	/** Each part in print position, side by side in rows: how they go on the bed. */
	function laidOut(list: Float32Array[]): Float32Array[] {
		const placed = list.map((t) => placeOnBed(t));
		const sizes = placed.map((t) => bounds(t).size);
		const cols = Math.ceil(Math.sqrt(placed.length));
		const w = Math.max(...sizes.map((s) => s[0])) + 20;
		const d = Math.max(...sizes.map((s) => s[1])) + 20;
		return placed.map((t, i) => translate(t, (i % cols) * w, -Math.floor(i / cols) * d, 0));
	}

	const parts = $derived.by<Part[]>(() => {
		if (!reply) return [];
		const all = [
			...reply.parts.map((part, i) => ({
				name: m.t_big_print_part_name({ n: i + 1 }),
				file: file(i + 1, reply.parts.length),
				tris: part.tris,
				printTris: part.printTris,
				volume: part.volume,
				tag: m.t_big_print_size({ size: dims(part.size) })
			})),
			...(reply.dowels
				? [
						{
							name: m.t_big_print_dowels_name({ count: reply.dowels.count }),
							file: m.t_big_print_dowels_filename(),
							tris: reply.dowels.tris,
							printTris: reply.dowels.printTris,
							volume: reply.dowels.volume,
							tag: m.t_big_print_dowels_tag()
						}
					]
				: [])
		];
		const whole = boundsOf(all.map((x) => x.tris));
		const centre = [0, 1, 2].map((k) => (whole.min[k] + whole.max[k]) / 2);
		const half = Math.max(...whole.size) / 2 || 1;
		const onBed = view === 'bed' ? laidOut(all.map((x) => x.printTris)) : null;
		return all.map((x, i) => {
			const id = i + 1;
			const b = bounds(x.tris);
			const dowels = i === reply.parts.length;
			return {
				...x,
				id,
				tris: onBed ? onBed[i] : x.tris,
				// The dowels are the plain grey; the parts take the other colours in turn.
				color: dowels ? PART_COLORS[0] : partColor(1 + (i % (PART_COLORS.length - 1))),
				visible: !hidden.includes(id),
				dir:
					onBed || dowels
						? [0, 0, 0]
						: ([0, 1, 2].map((k) => ((b.min[k] + b.max[k]) / 2 - centre[k]) / half) as Vec3)
			};
		});
	});
	const assembled = $derived(reply ? boundsOf(reply.parts.map((x) => x.tris)).size : null);
	const misfits = $derived(reply ? reply.parts.flatMap((x, i) => (x.fits ? [] : [i + 1])) : []);

	function setVisible(id: number, visible: boolean) {
		hidden = visible ? hidden.filter((x) => x !== id) : [...hidden, id];
	}

	const span = (r: [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);
	function stepTitle(j: Joint): string {
		const one = (r: [number, number]) => r[0] === r[1];
		if (one(j.a) && one(j.b)) return m.t_big_print_step_parts({ a: j.a[0], b: j.b[0] });
		if (!one(j.a) && !one(j.b)) return m.t_big_print_step_blocks({ a: span(j.a), b: span(j.b) });
		return one(j.a)
			? m.t_big_print_step_part_block({ a: j.a[0], b: span(j.b) })
			: m.t_big_print_step_block_part({ a: span(j.a), b: j.b[0] });
	}
	function stepMeta(j: Joint): string {
		const pins = j.pins
			? m.t_big_print_step_pins({ count: j.pins, n: num(j.pins) })
			: m.t_big_print_step_no_pins();
		const area = num(j.area / 100, 0);
		return j.level
			? m.t_big_print_step_meta_level({ pins, area })
			: m.t_big_print_step_meta_upright({ pins, area });
	}

	const connector = $derived(connectorOf(p));
	const turnNote = $derived(
		!reply || reply.parts.length < 2
			? null
			: reply.orientation.yaw === null
				? m.t_big_print_turn_aligned()
				: reply.orientation.yaw
					? m.t_big_print_turn_yaw({ yaw: num(reply.orientation.yaw) })
					: null
	);

	/** What came out, in a few sentences: under «Части» and at the top of the archive's guide. */
	function summary(r: BigPrintReply): string {
		if (r.parts.length === 1)
			return r.orientation.yaw
				? m.t_big_print_summary_whole_turned({ bed: dims(p.bed), yaw: num(r.orientation.yaw) })
				: m.t_big_print_summary_whole({ bed: dims(p.bed) });
		return [
			m.t_big_print_summary_parts({
				count: r.parts.length,
				n: num(r.parts.length),
				bed: dims(p.bed),
				margin: num(p.margin, 0)
			}),
			turnNote,
			r.dowels && m.t_big_print_summary_dowels()
		]
			.filter(Boolean)
			.join(sentenceGap(currentLocale()));
	}

	/** The plan in words, next to the files in the archive. */
	function guide(r: BigPrintReply): string {
		const lines = [
			summary(r),
			'',
			...r.parts.map((x, i) =>
				m.t_big_print_guide_part({ file: file(i + 1, r.parts.length), size: dims(x.size) })
			),
			...(r.dowels
				? [
						m.t_big_print_guide_dowels({
							count: r.dowels.count,
							n: num(r.dowels.count),
							file: m.t_big_print_dowels_filename(),
							diameter: num(connector.diameter, 0),
							length: num(2 * connector.depth, 0)
						})
					]
				: []),
			...(r.joints.length ? ['', m.t_big_print_guide_order()] : []),
			...r.joints.map((j, i) =>
				m.t_big_print_guide_step({ n: i + 1, title: stepTitle(j), meta: stepMeta(j) })
			),
			...(r.joints.length ? ['', m.t_big_print_guide_glue()] : [])
		];
		return lines.join('\r\n');
	}
</script>

<ToolShell
	{tool}
	size={assembled}
	busy={build.busy}
	busyLabel={progress > 0 ? m.t_big_print_busy_progress({ progress }) : m.t_big_print_busy()}
	stale={build.stale}
	onrebuild={build.flush}
	error={fileError ?? build.error}
	exports={reply
		? [
				{
					label: tc.tc_zip_archive(),
					icon: FileArchive,
					primary: true,
					onClick: () =>
						downloadZip(parts, m.t_big_print_filename(), [
							{ name: `${m.t_big_print_guide_filename()}.txt`, data: guide(reply) }
						])
				},
				{
					label: m.t_big_print_download_all(),
					icon: Download,
					onClick: () => downloadAll(parts, m.t_big_print_filename())
				}
			]
		: []}
	empty={source ? undefined : emptyHint}
>
	{#snippet viewport()}
		<PartsViewport
			{parts}
			explode={view === 'bed' ? 0 : explode / 100}
			fitKey={`${reply?.key}|${view}`}
		/>
	{/snippet}
	{#snippet controls()}
		<FieldGroup title={tc.tc_model()}>
			<FileField
				label={tc.tc_open_model()}
				accept={MODEL_ACCEPT}
				hint={modelHint()}
				{fileName}
				{onfile}
			/>
			{#if reply?.note}<p class="hint" role="status">{reply.note}</p>{/if}
		</FieldGroup>
		<FieldGroup title={m.t_big_print_group_printer()}>
			<ChoiceField
				label={m.t_big_print_printer()}
				bind:value={() => printer, choosePrinter}
				options={[
					...PRINTERS.map((x) => ({ value: x.id, label: x.label })),
					{ value: 'own', label: m.t_big_print_printer_own() }
				]}
			/>
			<NumberField
				label={m.t_big_print_bed_x()}
				unit="mm"
				bind:value={p.bed[0]}
				min={50}
				max={1000}
			/>
			<NumberField
				label={m.t_big_print_bed_y()}
				unit="mm"
				bind:value={p.bed[1]}
				min={50}
				max={1000}
			/>
			<NumberField
				label={m.t_big_print_bed_z()}
				unit="mm"
				bind:value={p.bed[2]}
				min={50}
				max={1000}
			/>
			<NumberField
				label={m.t_big_print_margin()}
				unit="mm"
				bind:value={p.margin}
				min={0}
				max={30}
				hint={m.t_big_print_margin_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_big_print_group_size()}>
			<ChoiceField
				label={m.t_big_print_by()}
				bind:value={by}
				options={[
					{ value: 'max', label: m.t_big_print_by_max() },
					{ value: 'z', label: m.t_big_print_by_z() },
					{ value: 'scale', label: m.t_big_print_by_scale() }
				]}
			/>
			<NumberField
				label={by === 'scale'
					? m.t_big_print_value_scale()
					: by === 'z'
						? tc.tc_height()
						: m.t_big_print_value_max()}
				unit={by === 'scale' ? '%' : 'mm'}
				bind:value
				min={by === 'scale' ? 10 : 20}
				max={by === 'scale' ? 10000 : 2000}
			/>
			{#if source}
				<p class="hint">
					{m.t_big_print_size_change({
						from: dims(source.size),
						to: dims(source.size.map((v) => v * scale))
					})}
				</p>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_big_print_group_pins()}>
			<ToggleField
				label={m.t_big_print_pins()}
				hint={m.t_big_print_pins_hint()}
				bind:checked={p.pins}
			/>
			{#if p.pins}
				<NumberField
					label={m.t_big_print_pin_diameter()}
					unit="mm"
					bind:value={p.pinDiameter}
					min={3}
					max={12}
					step={0.5}
					hint={m.t_big_print_pin_diameter_hint({ depth: num(connector.depth) })}
				/>
				<NumberField
					label={tc.tc_gap()}
					unit="mm"
					bind:value={p.clearance}
					min={0}
					max={0.6}
					step={0.05}
					hint={m.t_big_print_clearance_hint()}
				/>
			{/if}
		</FieldGroup>
		{#if reply}
			<!-- i18n-ok: «Части» below is the key the open/closed state is stored under, never shown -->
			<FieldGroup title={m.t_big_print_parts_title({ count: reply.parts.length })} key="Части">
				<p class="text-sm text-neutral-300">{summary(reply)}</p>
				{#if misfits.length}
					<div class="notice notice-warning">
						<TriangleAlert size={16} aria-hidden="true" />
						<p>
							{misfits.length === 1
								? m.t_big_print_misfit_one({ n: misfits[0] })
								: m.t_big_print_misfit_many({
										list: listJoin(misfits.map(String), currentLocale())
									})}
						</p>
					</div>
				{/if}
				<ChoiceField
					label={m.t_big_print_view()}
					bind:value={view}
					options={[
						{ value: 'assembled', label: m.t_big_print_view_assembled() },
						{ value: 'bed', label: m.t_big_print_view_bed() }
					]}
				/>
				{#if view === 'assembled' && reply.parts.length > 1}
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
			{#if reply.joints.length}
				<FieldGroup title={m.t_big_print_group_order()}>
					<ol class="list">
						{#each reply.joints as j, i (i)}
							<li class="list-row">
								<span class="counter shrink-0">{i + 1}</span>
								<span class="min-w-0 flex-1">
									<span class="block text-sm font-medium">{stepTitle(j)}</span>
									<span class="mt-1 block text-xs text-neutral-400">{stepMeta(j)}</span>
								</span>
							</li>
						{/each}
					</ol>
					<p class="hint">
						{m.t_big_print_order_hint()}
					</p>
				</FieldGroup>
			{/if}
		{/if}
	{/snippet}
</ToolShell>

{#snippet emptyHint()}
	{m.t_big_print_empty()}
{/snippet}
