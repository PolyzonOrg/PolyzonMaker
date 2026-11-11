<script lang="ts">
	import { MODEL_ACCEPT, readModelFile } from '$lib/tools/shared/model-file';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import { Download, MousePointerClick, X } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, readableError, SLOW_BUILD_MS } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { bounds, downloadBytes, merge, placeOnBed, writeStl } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/flexi-maker';
	import PartsViewport from '../booleans/PartsViewport.svelte';
	import PartsList from '../booleans/PartsList.svelte';
	import { partColor, partsSize, type Part } from '../booleans/parts';
	import { AXIS_INDEX, type Axis, type Vec3 } from '../booleans/plane';
	import { ToolWorker } from '../booleans/worker';
	import { evenCuts, FLEXI_DEFAULTS, hingeOptions, type FlexiParams } from './model';
	import type { FlexiReply } from './flexi.worker';

	let { tool }: { tool: ToolInfo } = $props();

	const worker = new ToolWorker(
		() =>
			new Worker(new URL('./flexi.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('flexi')
			})
	);

	let fileName = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let source = $state.raw<{ key: string; tris: Float32Array } | null>(null);
	let axis = $state<Axis>(FLEXI_DEFAULTS.axis);
	let links = $state(6);
	let cuts = $state<number[]>([]);
	let hinge = $state<Axis>(FLEXI_DEFAULTS.hinge);
	let clearance = $state(FLEXI_DEFAULTS.clearance);
	let swing = $state(FLEXI_DEFAULTS.swing);
	let size = $state(FLEXI_DEFAULTS.size);
	let flat = $state(FLEXI_DEFAULTS.flat);
	let picking = $state(false);
	let showCuts = $state(true);
	let hiddenParts = $state<number[]>([]);

	const box = $derived(source ? bounds(source.tris) : null);
	const i = $derived(AXIS_INDEX[axis]);
	const center = $derived<Vec3>(
		box ? ([0, 1, 2].map((k) => (box.min[k] + box.max[k]) / 2) as Vec3) : [0, 0, 0]
	);

	// New axis or number of links: cuts spread evenly again, the hinge lies across.
	// Cuts set by hand already match their number of links and stay where they are.
	let spreadAxis: Axis | null = null;
	$effect(() => {
		const a = axis;
		const n = links;
		untrack(() => {
			if (!box) return;
			const same = spreadAxis === a && cuts.length === n - 1;
			spreadAxis = a;
			if (same) return;
			cuts = evenCuts(box.min[AXIS_INDEX[a]], box.max[AXIS_INDEX[a]], n).map(
				(c) => Math.round(c * 2) / 2
			);
			if (!hingeOptions(a).includes(hinge)) hinge = hingeOptions(a)[0];
		});
	});

	interface Input {
		key: string;
		tris: Float32Array;
		params: FlexiParams;
	}
	const build = createBuild<Input, FlexiReply>(
		(input, signal) => worker.run<FlexiReply>(input, signal),
		500,
		{ manualAfterMs: SLOW_BUILD_MS }
	);
	$effect(() => {
		if (!source || !cuts.length) return;
		build.run({
			key: source.key,
			tris: source.tris,
			params: { axis, hinge, clearance, swing, size, flat, cuts: $state.snapshot(cuts) }
		});
	});
	onDestroy(() => {
		build.cancel();
		worker.dispose();
	});

	const parts = $derived.by<Part[]>(() => {
		const reply = build.value;
		if (!reply) return [];
		return reply.links.map((link, k) => ({
			id: k + 1,
			name: m.t_flexi_maker_link_name({ n: k + 1 }),
			file: `${m.t_flexi_maker_link_filename()}-${k + 1}`,
			tris: link.tris,
			volume: link.volume,
			color: partColor(k),
			visible: !hiddenParts.includes(k + 1),
			dir: [0, 0, 0]
		}));
	});

	const planes = $derived(
		box && showCuts
			? cuts.map((c) => {
					const point: Vec3 = [...center];
					point[i] = c;
					const normal: Vec3 = [0, 0, 0];
					normal[i] = 1;
					// As wide as the model across the links, not as long as it.
					return {
						point,
						normal,
						size: 1.4 * Math.max(box.size[(i + 1) % 3], box.size[(i + 2) % 3])
					};
				})
			: []
	);

	/** A click on the model: a cut across the links at that point. */
	function addCut(point: Vec3) {
		if (!box) return;
		const at = Math.round(point[i] * 2) / 2;
		if (cuts.some((c) => Math.abs(c - at) < 1)) return;
		cuts = [...cuts, at].sort((x, y) => x - y);
		links = cuts.length + 1;
	}

	function removeCut(k: number) {
		cuts = cuts.filter((_, j) => j !== k);
		links = cuts.length + 1;
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
			const b = bounds(tris);
			// Links run along the longest side.
			const longest = b.size.indexOf(Math.max(...b.size));
			build.fresh();
			source = { key: `${file.name}:${file.size}:${file.lastModified}`, tris };
			fileName = file.name;
			hiddenParts = [];
			// A joint takes about the model's width along the axis, so a short or
			// stout model starts with fewer links instead of an error.
			const width = [...b.size].sort((x, y) => y - x)[1];
			links = Math.max(2, Math.min(6, Math.floor(b.size[longest] / (width + 2))));
			const next = (['x', 'y', 'z'] as const)[longest];
			// Always from scratch: cuts set by hand on the previous model do not carry over.
			cuts = evenCuts(b.min[longest], b.max[longest], links).map((c) => Math.round(c * 2) / 2);
			axis = next;
		} catch (e) {
			if (fresh()) fileError = readableError(e);
		}
	}

	function download() {
		// One file, the links in place: they print together and come off the bed joined.
		const all = placeOnBed(merge(parts.map((p) => p.tris)));
		downloadBytes(writeStl(all), `${m.t_flexi_maker_filename()}.stl`, 'model/stl');
	}

	function hingeHint(axis: Axis): string {
		if (axis === 'x') return m.t_flexi_maker_hinge_hint_x();
		if (axis === 'y') return m.t_flexi_maker_hinge_hint_y();
		return m.t_flexi_maker_hinge_hint_z();
	}
</script>

<ToolShell
	{tool}
	size={partsSize(parts)}
	busy={build.busy}
	busyLabel={m.t_flexi_maker_busy()}
	error={fileError ?? build.error}
	stale={build.stale}
	onrebuild={build.flush}
	exports={parts.length
		? [{ label: tc.tc_download_stl(), icon: Download, primary: true, onClick: download }]
		: []}
	empty={source ? undefined : emptyHint}
>
	{#snippet viewport()}
		<PartsViewport
			{parts}
			planes={parts.length ? planes : []}
			fitKey={source?.key}
			onpick={picking ? addCut : null}
		/>
	{/snippet}
	{#snippet controls()}
		<FieldGroup title={tc.tc_file()}>
			<FileField
				label={tc.tc_open_model()}
				accept={MODEL_ACCEPT}
				hint={m.t_flexi_maker_file_hint()}
				{fileName}
				{onfile}
			/>
			{#if build.value?.note}<p class="hint" role="status">{build.value.note}</p>{/if}
		</FieldGroup>
		{#if source && box}
			<FieldGroup title={m.t_flexi_maker_links()}>
				<ChoiceField
					label={m.t_flexi_maker_links_axis()}
					bind:value={axis}
					options={[
						{ value: 'x', label: 'X' },
						{ value: 'y', label: 'Y' },
						{ value: 'z', label: 'Z' }
					]}
				/>
				<NumberField label={m.t_flexi_maker_links_count()} bind:value={links} min={2} max={24} />
				<div>
					<button
						type="button"
						class="btn-ghost btn-s"
						aria-pressed={picking}
						onclick={() => (picking = !picking)}
					>
						<MousePointerClick size={14} aria-hidden="true" />
						{picking ? m.t_flexi_maker_pick_done() : m.t_flexi_maker_pick_cuts()}
					</button>
					<p class="hint">
						{picking ? m.t_flexi_maker_pick_hint() : m.t_flexi_maker_cuts_hint()}
					</p>
				</div>
				{#each [...cuts.keys()] as k (k)}
					<div class="flex items-start gap-2">
						<div class="min-w-0 flex-1">
							<NumberField
								label={m.t_flexi_maker_cut({ n: k + 1 })}
								unit="mm"
								bind:value={cuts[k]}
								min={Math.floor(box.min[i])}
								max={Math.ceil(box.max[i])}
								step={0.5}
							/>
						</div>
						{#if cuts.length > 1}
							<button
								type="button"
								class="icon-btn mt-6"
								aria-label={m.t_flexi_maker_remove_cut_label({ n: k + 1 })}
								title={m.t_flexi_maker_remove_cut()}
								onclick={() => removeCut(k)}
							>
								<X size={16} aria-hidden="true" />
							</button>
						{/if}
					</div>
				{/each}
				<ToggleField label={m.t_flexi_maker_show_cuts()} bind:checked={showCuts} />
				<NumberField
					label={m.t_flexi_maker_flat()}
					unit="mm"
					bind:value={flat}
					min={0}
					max={Math.max(1, Math.floor(box.size[2] / 3))}
					step={0.5}
					hint={m.t_flexi_maker_flat_hint()}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_flexi_maker_hinge()}>
				<ChoiceField
					label={m.t_flexi_maker_hinge_axis()}
					bind:value={hinge}
					options={hingeOptions(axis).map((a) => ({ value: a, label: a.toUpperCase() }))}
					hint={hingeHint(hinge)}
				/>
				<NumberField
					label={tc.tc_gap()}
					unit="mm"
					bind:value={clearance}
					min={0.2}
					max={0.6}
					step={0.05}
					hint={m.t_flexi_maker_clearance_hint()}
				/>
				<NumberField
					label={m.t_flexi_maker_swing()}
					unit="°"
					bind:value={swing}
					min={10}
					max={45}
				/>
				<NumberField
					label={m.t_flexi_maker_hinge_size()}
					unit="%"
					bind:value={size}
					min={60}
					max={140}
					step={5}
					hint={m.t_flexi_maker_hinge_size_hint()}
				/>
			</FieldGroup>
			{#if parts.length}
				<FieldGroup title={m.t_flexi_maker_links_title({ n: parts.length })}>
					<PartsList
						{parts}
						stale={build.stale}
						onvisible={(id, visible) =>
							(hiddenParts = visible ? hiddenParts.filter((h) => h !== id) : [...hiddenParts, id])}
					/>
					<p class="hint">{m.t_flexi_maker_print_hint()}</p>
				</FieldGroup>
			{/if}
		{/if}
	{/snippet}
</ToolShell>

{#snippet emptyHint()}
	{m.t_flexi_maker_empty()}
{/snippet}
