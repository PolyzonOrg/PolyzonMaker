<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, TriangleAlert } from 'lucide-svelte';
	import ToolShell, { type ToolExport } from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes, parseStl, placeOnBed, writeStl } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { num } from '$lib/i18n/current';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/drawer-organizer';
	import {
		DRAWER_DEFAULTS,
		DRAWER_PRESETS,
		drawerHeader,
		drawerLayout,
		drawerModel,
		pieceRects,
		trianglesInRect,
		type DrawerParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<DrawerParams>({ ...DRAWER_DEFAULTS });
	const model = $derived(drawerModel(p));
	const source = $derived(toScad(model, drawerHeader(p)));
	const layout = $derived(drawerLayout(p));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 450);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const mm = (v: number) => num(v, 1);
	const uniform = $derived(
		Math.max(...layout.x.cells) - Math.min(...layout.x.cells) < 0.05 &&
			Math.max(...layout.y.cells) - Math.min(...layout.y.cells) < 0.05
	);

	function applyPreset(params: Partial<DrawerParams>) {
		p = { ...DRAWER_DEFAULTS, ...params };
	}

	/** One piece out of the built STL, moved onto the bed. */
	function downloadPiece(index: number) {
		if (!build.value) return;
		const rect = pieceRects(p)[index];
		const tris = trianglesInRect(parseStl(build.value), rect);
		downloadBytes(
			writeStl(placeOnBed(tris)),
			`${m.t_drawer_organizer_piece_filename()}-${index + 1}.stl`,
			'model/stl'
		);
	}

	const exports = $derived.by(() => {
		const list: ToolExport[] = [
			{
				label: layout.pieceCount > 1 ? m.t_drawer_organizer_download_all() : tc.tc_download_stl(),
				icon: Download,
				primary: true,
				onClick: () =>
					build.value &&
					downloadBytes(build.value, `${m.t_drawer_organizer_filename()}.stl`, 'model/stl')
			}
		];
		// A button per piece while they fit on the scene; more pieces — one file.
		if (layout.pieceCount > 1 && layout.pieceCount <= 6)
			for (let i = 0; i < layout.pieceCount; i++)
				list.push({
					label: m.t_drawer_organizer_download_piece({ n: i + 1 }),
					onClick: () => downloadPiece(i)
				});
		return list;
	});
</script>

<ToolShell
	{tool}
	stl={build.value}
	busy={build.busy}
	error={build.error}
	scadSource={source}
	{exports}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each DRAWER_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_drawer_organizer_drawer_inside()}>
			<NumberField label={tc.tc_width()} unit="mm" bind:value={p.width} min={30} max={800} />
			<NumberField label={tc.tc_depth()} unit="mm" bind:value={p.depth} min={30} max={800} />
			<NumberField
				label={m.t_drawer_organizer_tray_height()}
				unit="mm"
				bind:value={p.height}
				min={10}
				max={150}
			/>
			<NumberField
				label={m.t_drawer_organizer_fit()}
				unit="mm"
				bind:value={p.fit}
				min={0}
				max={3}
				step={0.1}
				hint={m.t_drawer_organizer_fit_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_drawer_organizer_cells()}>
			<ToggleField
				label={m.t_drawer_organizer_proportional()}
				bind:checked={p.proportional}
				hint={m.t_drawer_organizer_proportional_hint()}
			/>
			{#if p.proportional}
				<TextField
					label={m.t_drawer_organizer_col_weights()}
					bind:value={p.colWeights}
					maxlength={60}
					placeholder="2, 1, 1"
				/>
				<TextField
					label={m.t_drawer_organizer_row_weights()}
					bind:value={p.rowWeights}
					maxlength={60}
					placeholder="1, 2"
				/>
			{:else}
				<NumberField label={m.t_drawer_organizer_cols()} bind:value={p.cols} min={1} max={12} />
				<NumberField label={tc.tc_rows()} bind:value={p.rows} min={1} max={12} />
			{/if}
			<p class="text-xs text-neutral-400">
				{(uniform ? m.t_drawer_organizer_cells_uniform : m.t_drawer_organizer_cells_smallest)({
					count: layout.cellCount,
					n: num(layout.cellCount),
					x: mm(layout.minCell[0]),
					y: mm(layout.minCell[1]),
					depth: mm(layout.depthInside)
				})}
			</p>
		</FieldGroup>
		<FieldGroup title={tc.tc_walls()}>
			<NumberField
				label={m.t_drawer_organizer_outer_wall()}
				unit="mm"
				bind:value={p.wall}
				min={0.8}
				max={4}
				step={0.1}
			/>
			<NumberField
				label={m.t_drawer_organizer_divider()}
				unit="mm"
				bind:value={p.divider}
				min={0.6}
				max={4}
				step={0.1}
				hint={m.t_drawer_organizer_divider_hint()}
			/>
			<NumberField
				label={tc.tc_bottom()}
				unit="mm"
				bind:value={p.floor}
				min={0.6}
				max={4}
				step={0.1}
			/>
			<NumberField
				label={m.t_drawer_organizer_outer_radius()}
				unit="mm"
				bind:value={p.radius}
				min={0}
				max={20}
				step={0.5}
			/>
			<NumberField
				label={m.t_drawer_organizer_cell_radius()}
				unit="mm"
				bind:value={p.cellRadius}
				min={0}
				max={15}
				step={0.5}
				hint={m.t_drawer_organizer_cell_radius_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_drawer_organizer_comfort()}>
			<ToggleField
				label={m.t_drawer_organizer_notch()}
				bind:checked={p.notch}
				hint={m.t_drawer_organizer_notch_hint()}
			/>
			<ToggleField
				label={m.t_drawer_organizer_scoop()}
				bind:checked={p.scoop}
				hint={m.t_drawer_organizer_scoop_hint()}
			/>
			<ToggleField
				label={m.t_drawer_organizer_labels()}
				bind:checked={p.labels}
				hint={m.t_drawer_organizer_labels_hint()}
			/>
			{#if p.labels}
				<TextField
					label={m.t_drawer_organizer_label_text()}
					bind:value={p.labelText}
					maxlength={400}
					placeholder={m.t_drawer_organizer_label_text_placeholder()}
					hint={m.t_drawer_organizer_label_text_hint()}
				/>
				<NumberField
					label={tc.tc_letter_height()}
					unit="mm"
					bind:value={p.labelSize}
					min={3}
					max={20}
					step={0.5}
					hint={m.t_drawer_organizer_label_size_hint()}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_drawer_organizer_split_print()}>
			<ToggleField
				label={m.t_drawer_organizer_split()}
				bind:checked={p.split}
				hint={m.t_drawer_organizer_split_hint()}
			/>
			{#if p.split}
				<NumberField
					label={m.t_drawer_organizer_bed()}
					unit="mm"
					bind:value={p.bed}
					min={100}
					max={500}
					step={5}
				/>
				<NumberField
					label={m.t_drawer_organizer_gap()}
					unit="mm"
					bind:value={p.gap}
					min={0.2}
					max={2}
					step={0.1}
				/>
			{/if}
			<p class="text-xs text-neutral-400">
				{#if layout.pieceCount === 1}
					{m.t_drawer_organizer_one_piece({
						x: mm(layout.x.pieces[0]),
						y: mm(layout.y.pieces[0])
					})}
				{:else}
					{m.t_drawer_organizer_pieces({
						count: layout.pieceCount,
						n: num(layout.pieceCount),
						x: mm(Math.max(...layout.x.pieces)),
						y: mm(Math.max(...layout.y.pieces))
					})}
				{/if}
			</p>
			{#if layout.x.tooLarge || layout.y.tooLarge}
				<div class="notice notice-warning">
					<TriangleAlert size={16} aria-hidden="true" />
					<span>
						{p.split
							? m.t_drawer_organizer_column_too_wide()
							: m.t_drawer_organizer_tray_too_large()}
					</span>
				</div>
			{/if}
		</FieldGroup>
	{/snippet}
</ToolShell>
