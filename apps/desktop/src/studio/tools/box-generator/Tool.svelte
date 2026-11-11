<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { num } from '$lib/i18n/current';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/box-generator';
	import { LID_OPTIONS } from '../box-master/model';
	import {
		BOX_GENERATOR_DEFAULTS,
		BOX_GENERATOR_PRESETS,
		binInfo,
		clampGenerator,
		boxGeneratorHeader,
		boxGeneratorModel,
		plateLayout,
		type BaseStyle,
		type BoxGeneratorParams,
		type BoxMode,
		type HolePlace,
		type LipStyle
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BoxGeneratorParams>(structuredClone(BOX_GENERATOR_DEFAULTS));
	const model = $derived(boxGeneratorModel(p));
	const source = $derived(toScad(model, boxGeneratorHeader(p)));
	const info = $derived(binInfo(p));
	const plate = $derived(plateLayout(p));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const MODES: readonly { value: BoxMode; label: string }[] = [
		{ value: 'gridfinity', label: m.t_box_generator_mode_gridfinity() },
		{ value: 'baseplate', label: m.t_box_generator_mode_baseplate() },
		{ value: 'box', label: m.t_box_generator_mode_box() }
	];
	const LIPS: readonly { value: LipStyle; label: string }[] = [
		{ value: 'standard', label: m.t_box_generator_lip_standard() },
		{ value: 'thin', label: m.t_box_generator_lip_thin() },
		{ value: 'none', label: tc.tc_none() }
	];
	const BASES: readonly { value: BaseStyle; label: string }[] = [
		{ value: 'standard', label: m.t_box_generator_base_standard() },
		{ value: 'flat', label: m.t_box_generator_base_flat() }
	];
	const HOLES: readonly { value: HolePlace; label: string }[] = [
		{ value: 'none', label: tc.tc_none() },
		{ value: 'corners', label: m.t_box_generator_holes_corners() },
		{ value: 'all', label: m.t_box_generator_holes_all() }
	];

	const mm = (v: number) => num(v, 1);

	function applyPreset(params: Partial<BoxGeneratorParams>) {
		// From the defaults: a preset never inherits the last one's mode or sizes.
		p = { ...structuredClone(BOX_GENERATOR_DEFAULTS), ...structuredClone(params) };
	}

	const fileName = $derived(
		p.mode === 'box'
			? `${m.t_box_generator_box_filename()}.stl`
			: p.mode === 'baseplate'
				? `${m.t_box_generator_plate_filename()}-${plate.nx}x${plate.ny}.stl`
				: `gridfinity-${p.unitsX}x${p.unitsY}x${p.unitsZ}.stl`
	);
</script>

<ToolShell
	{tool}
	stl={build.value}
	busy={build.busy}
	error={build.error}
	scadSource={source}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () => build.value && downloadBytes(build.value, fileName, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each BOX_GENERATOR_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup>
			<ChoiceField label={m.t_box_generator_mode()} bind:value={p.mode} options={MODES} />
		</FieldGroup>

		{#if p.mode === 'gridfinity'}
			<FieldGroup title={m.t_box_generator_group_grid_size()}>
				<NumberField label={m.t_box_generator_cells_x()} bind:value={p.unitsX} min={1} max={10} />
				<NumberField label={m.t_box_generator_cells_y()} bind:value={p.unitsY} min={1} max={10} />
				<NumberField
					label={m.t_box_generator_units_z()}
					bind:value={p.unitsZ}
					min={1}
					max={20}
					hint={p.lip === 'none'
						? m.t_box_generator_height_hint({ walls: mm(p.unitsZ * 7) })
						: m.t_box_generator_height_hint_lip({
								walls: mm(p.unitsZ * 7),
								total: mm(info.size[2])
							})}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_box_generator_group_body()}>
				<ChoiceField
					label={m.t_box_generator_lip()}
					bind:value={p.lip}
					options={LIPS}
					hint={p.lip === 'none' ? m.t_box_generator_lip_none_hint() : m.t_box_generator_lip_hint()}
				/>
				<ChoiceField
					label={m.t_box_generator_base()}
					bind:value={p.base}
					options={BASES}
					hint={p.base === 'flat'
						? m.t_box_generator_base_flat_hint()
						: m.t_box_generator_base_standard_hint()}
				/>
				<NumberField
					label={tc.tc_wall()}
					unit="mm"
					bind:value={p.wall}
					min={0.8}
					max={3}
					step={0.05}
				/>
			</FieldGroup>
			<FieldGroup title={m.t_box_generator_group_compartments()}>
				<NumberField
					label={m.t_box_generator_comp_x()}
					bind:value={p.compX}
					min={1}
					max={clampGenerator({ ...p, compX: 12 }).compX}
				/>
				<NumberField
					label={m.t_box_generator_comp_y()}
					bind:value={p.compY}
					min={1}
					max={clampGenerator({ ...p, compY: 12 }).compY}
				/>
				{#if p.compX > 1 || p.compY > 1}
					<NumberField
						label={m.t_box_generator_divider()}
						unit="mm"
						bind:value={p.divider}
						min={0.4}
						max={5}
						step={0.05}
					/>
				{/if}
				<ToggleField
					label={m.t_box_generator_scoop()}
					bind:checked={p.scoop}
					hint={m.t_box_generator_scoop_hint()}
				/>
				<ToggleField
					label={m.t_box_generator_label_shelf()}
					bind:checked={p.labelShelf}
					hint={m.t_box_generator_label_shelf_hint()}
				/>
				<p class="text-xs text-neutral-400">
					{m.t_box_generator_compartment_size({
						width: mm(info.compartment[0]),
						depth: mm(info.compartment[1]),
						height: mm(info.compartment[2])
					})}
				</p>
			</FieldGroup>
			<FieldGroup title={m.t_box_generator_group_holes()}>
				<ChoiceField label={m.t_box_generator_magnets()} bind:value={p.magnets} options={HOLES} />
				{#if p.magnets !== 'none'}
					<NumberField
						label={m.t_box_generator_magnet_d()}
						unit="mm"
						bind:value={p.magnetD}
						min={2}
						max={12}
						step={0.1}
						hint={m.t_box_generator_magnet_d_hint()}
					/>
					<NumberField
						label={m.t_box_generator_magnet_h()}
						unit="mm"
						bind:value={p.magnetH}
						min={0.5}
						max={4}
						step={0.1}
					/>
				{/if}
				<ChoiceField label={m.t_box_generator_screws()} bind:value={p.screws} options={HOLES} />
				{#if p.screws !== 'none'}
					<ToggleField
						label={m.t_box_generator_heat_set()}
						bind:checked={p.heatSet}
						hint={m.t_box_generator_heat_set_hint()}
					/>
				{/if}
			</FieldGroup>
			<FieldGroup title={tc.tc_lid()}>
				{#if p.lip === 'none'}
					<p class="text-xs text-neutral-400">{m.t_box_generator_lid_needs_lip()}</p>
				{:else}
					<ToggleField
						label={m.t_box_generator_lid_add()}
						bind:checked={p.lid}
						hint={m.t_box_generator_lid_add_hint()}
					/>
				{/if}
			</FieldGroup>
			<FieldGroup title={m.t_box_generator_group_grid()}>
				<NumberField
					label={tc.tc_grid_step()}
					unit="mm"
					bind:value={p.pitch}
					min={30}
					max={100}
					step={0.5}
					hint={m.t_box_generator_pitch_hint()}
				/>
			</FieldGroup>
		{:else if p.mode === 'baseplate'}
			<FieldGroup title={tc.tc_size()}>
				<ToggleField
					label={m.t_box_generator_plate_fit()}
					bind:checked={p.plateFit}
					hint={m.t_box_generator_plate_fit_hint()}
				/>
				{#if p.plateFit}
					<NumberField
						label={m.t_box_generator_drawer_w()}
						unit="mm"
						bind:value={p.drawerW}
						min={50}
						max={1200}
					/>
					<NumberField
						label={m.t_box_generator_drawer_d()}
						unit="mm"
						bind:value={p.drawerD}
						min={50}
						max={1200}
					/>
					<p class="text-xs text-neutral-400">
						{m.t_box_generator_plate_fit_summary({
							x: plate.nx,
							y: plate.ny,
							marginX: mm(plate.marginX),
							marginY: mm(plate.marginY)
						})}
					</p>
				{:else}
					<NumberField label={m.t_box_generator_plate_x()} bind:value={p.plateX} min={1} max={10} />
					<NumberField label={m.t_box_generator_plate_y()} bind:value={p.plateY} min={1} max={10} />
					<p class="text-xs text-neutral-400">
						{m.t_box_generator_plate_size({ width: mm(plate.width), depth: mm(plate.depth) })}
					</p>
				{/if}
				<ToggleField
					label={m.t_box_generator_plate_split()}
					bind:checked={p.plateSplit}
					hint={m.t_box_generator_plate_split_hint()}
				/>
				{#if p.plateSplit}
					<NumberField
						label={m.t_box_generator_plate_bed()}
						unit="mm"
						bind:value={p.plateBed}
						min={100}
						max={500}
						hint={m.t_box_generator_plate_bed_hint()}
					/>
				{/if}
				{#if plate.piecesX.length * plate.piecesY.length > 1}
					<p class="text-xs text-neutral-400">
						{m.t_box_generator_plate_pieces({
							x: plate.piecesX.length,
							y: plate.piecesY.length,
							width: mm(plate.largest[0]),
							depth: mm(plate.largest[1])
						})}
					</p>
				{/if}
				{#if plate.tooBig}
					<p class="field-error" role="alert">
						{m.t_box_generator_plate_too_big()}
					</p>
				{/if}
			</FieldGroup>
			<FieldGroup title={m.t_box_generator_group_magnets()}>
				<ToggleField
					label={m.t_box_generator_magnets()}
					bind:checked={p.plateMagnets}
					hint={m.t_box_generator_plate_magnets_hint()}
				/>
				{#if p.plateMagnets}
					<NumberField
						label={m.t_box_generator_magnet_d()}
						unit="mm"
						bind:value={p.magnetD}
						min={2}
						max={12}
						step={0.1}
					/>
					<NumberField
						label={m.t_box_generator_magnet_h()}
						unit="mm"
						bind:value={p.magnetH}
						min={0.5}
						max={4}
						step={0.1}
					/>
				{/if}
			</FieldGroup>
			<FieldGroup title={m.t_box_generator_group_grid()}>
				<NumberField
					label={tc.tc_grid_step()}
					unit="mm"
					bind:value={p.pitch}
					min={30}
					max={100}
					step={0.5}
					hint={m.t_box_generator_pitch_hint_plate()}
				/>
			</FieldGroup>
		{:else}
			<FieldGroup title={m.t_box_generator_group_inner_size()}>
				<NumberField label={tc.tc_width()} unit="mm" bind:value={p.box.width} min={10} max={300} />
				<NumberField label={tc.tc_depth()} unit="mm" bind:value={p.box.depth} min={10} max={300} />
				<NumberField label={tc.tc_height()} unit="mm" bind:value={p.box.height} min={5} max={200} />
			</FieldGroup>
			<FieldGroup title={m.t_box_generator_group_walls()}>
				<NumberField
					label={tc.tc_wall()}
					unit="mm"
					bind:value={p.box.wall}
					min={0.8}
					max={6}
					step={0.1}
					hint={m.t_box_generator_box_wall_hint()}
				/>
				<NumberField
					label={tc.tc_bottom()}
					unit="mm"
					bind:value={p.box.floor}
					min={0.8}
					max={6}
					step={0.1}
				/>
				<NumberField
					label={tc.tc_corner_rounding()}
					unit="mm"
					bind:value={p.box.radius}
					min={0}
					max={30}
					step={0.5}
				/>
				<NumberField
					label={m.t_box_generator_box_cols()}
					bind:value={p.box.cols}
					min={1}
					max={12}
				/>
				<NumberField
					label={m.t_box_generator_box_rows()}
					bind:value={p.box.rows}
					min={1}
					max={12}
				/>
			</FieldGroup>
			<FieldGroup title={tc.tc_lid()}>
				<ChoiceField
					label={m.t_box_generator_box_lid_kind()}
					bind:value={p.box.lid}
					options={LID_OPTIONS}
				/>
				{#if p.box.lid !== 'none'}
					<NumberField
						label={m.t_box_generator_box_clearance()}
						unit="mm"
						bind:value={p.box.clearance}
						min={0}
						max={1}
						step={0.05}
						hint={m.t_box_generator_box_clearance_hint()}
					/>
					{#if p.box.lid !== 'slide'}
						<NumberField
							label={p.box.lid === 'cap'
								? m.t_box_generator_box_skirt()
								: m.t_box_generator_box_rim()}
							unit="mm"
							bind:value={p.box.rim}
							min={2}
							max={20}
							step={0.5}
						/>
					{/if}
				{/if}
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>
