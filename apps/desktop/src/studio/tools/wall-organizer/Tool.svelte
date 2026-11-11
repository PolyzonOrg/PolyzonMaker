<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/wall-organizer';
	import {
		WALL_DEFAULTS,
		PANEL_MIN,
		WALL_PRESETS,
		wallHeader,
		wallModel,
		wallSummary,
		type WallItem,
		type WallMount,
		type WallParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<WallParams>({ ...WALL_DEFAULTS });
	const model = $derived(wallModel(p));
	const source = $derived(toScad(model, wallHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const MOUNTS: readonly { value: WallMount; label: string }[] = [
		{ value: 'skadis', label: 'SKÅDIS' },
		{ value: 'cleat', label: m.t_wall_organizer_choice_cleat() },
		{ value: 'screws', label: m.t_wall_organizer_choice_screws() }
	];
	const items = $derived<readonly { value: WallItem; label: string }[]>([
		{ value: 'hook', label: m.t_wall_organizer_choice_hook() },
		{ value: 'shelf', label: m.t_wall_organizer_choice_shelf() },
		{ value: 'cup', label: m.t_wall_organizer_choice_cup() },
		{ value: 'rack', label: m.t_wall_organizer_choice_rack() },
		...(p.mount === 'cleat'
			? [{ value: 'rail' as const, label: m.t_wall_organizer_choice_rail() }]
			: []),
		...(p.mount === 'skadis'
			? [{ value: 'panel' as const, label: m.t_wall_organizer_choice_panel() }]
			: [])
	]);
	$effect(() => {
		if (p.item === 'rail' && p.mount !== 'cleat') p.item = 'hook';
		if (p.item === 'panel' && p.mount !== 'skadis') p.item = 'hook';
		// A hook-sized width makes an empty panel: start from a useful size.
		if (p.item === 'panel' && (p.width < PANEL_MIN || p.plateHeight < PANEL_MIN)) {
			p.width = Math.max(p.width, 160);
			p.plateHeight = Math.max(p.plateHeight, 160);
		}
	});
	const isRail = $derived(p.item === 'rail');
	const isPanel = $derived(p.item === 'panel');

	function applyPreset(params: Partial<WallParams>) {
		p = { ...WALL_DEFAULTS, ...params };
	}
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
			onClick: () =>
				build.value &&
				downloadBytes(
					build.value,
					`${m.t_wall_organizer_filename()}-${p.mount}-${p.item}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each WALL_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup>
			<ChoiceField
				label={m.t_wall_organizer_mount()}
				bind:value={p.mount}
				options={MOUNTS}
				hint={p.mount === 'skadis'
					? m.t_wall_organizer_mount_skadis_hint()
					: p.mount === 'cleat'
						? m.t_wall_organizer_mount_cleat_hint()
						: undefined}
			/>
			<ChoiceField label={tc.tc_what_to_print()} bind:value={p.item} options={items} />
		</FieldGroup>
		<FieldGroup title={m.t_wall_organizer_group_size()}>
			<NumberField
				label={m.t_wall_organizer_width()}
				unit="mm"
				bind:value={p.width}
				min={isPanel ? PANEL_MIN : 8}
				max={400}
				step={1}
				hint={p.mount === 'skadis' && !isRail && !isPanel
					? m.t_wall_organizer_width_skadis_hint()
					: undefined}
			/>
			{#if isRail}
				<NumberField
					label={m.t_wall_organizer_rail_height()}
					unit="mm"
					bind:value={p.railHeight}
					min={2 * p.cleat + 6}
					max={200}
					step={1}
				/>
			{:else if isPanel}
				<NumberField
					label={m.t_wall_organizer_panel_height()}
					unit="mm"
					bind:value={p.plateHeight}
					min={PANEL_MIN}
					max={300}
					step={1}
					hint={m.t_wall_organizer_panel_height_hint()}
				/>
			{:else}
				<NumberField
					label={m.t_wall_organizer_back_height()}
					unit="mm"
					bind:value={p.plateHeight}
					min={p.mount === 'skadis' ? 54 : 24}
					max={300}
					step={1}
				/>
				<NumberField
					label={tc.tc_thickness()}
					unit="mm"
					bind:value={p.thickness}
					min={2.4}
					max={10}
					step={0.2}
				/>
			{/if}
			{#if p.mount === 'cleat'}
				<NumberField
					label={m.t_wall_organizer_cleat()}
					unit="mm"
					bind:value={p.cleat}
					min={6}
					max={25}
					step={0.5}
					hint={m.t_wall_organizer_cleat_hint()}
				/>
			{/if}
		</FieldGroup>
		{#if p.item === 'hook'}
			<FieldGroup title={m.t_wall_organizer_choice_hook()}>
				<NumberField
					label={m.t_wall_organizer_reach()}
					unit="mm"
					bind:value={p.reach}
					min={10}
					max={120}
					step={1}
				/>
				<NumberField
					label={m.t_wall_organizer_lip()}
					unit="mm"
					bind:value={p.lip}
					min={0}
					max={60}
					step={1}
				/>
				<NumberField
					label={tc.tc_thickness()}
					unit="mm"
					bind:value={p.arm}
					min={4}
					max={16}
					step={0.5}
				/>
			</FieldGroup>
		{:else if p.item === 'shelf' || p.item === 'cup' || p.item === 'rack'}
			<FieldGroup
				title={p.item === 'shelf'
					? m.t_wall_organizer_choice_shelf()
					: p.item === 'cup'
						? m.t_wall_organizer_choice_cup()
						: m.t_wall_organizer_group_rack()}
			>
				<NumberField
					label={tc.tc_depth()}
					unit="mm"
					bind:value={p.depth}
					min={15}
					max={200}
					step={1}
				/>
				{#if p.item === 'shelf'}
					<NumberField
						label={m.t_wall_organizer_shelf_lip()}
						unit="mm"
						bind:value={p.shelfLip}
						min={0}
						max={40}
						step={1}
					/>
				{:else if p.item === 'cup'}
					<NumberField
						label={m.t_wall_organizer_cup_height()}
						unit="mm"
						bind:value={p.cupHeight}
						min={10}
						max={p.plateHeight}
						step={1}
					/>
				{:else}
					<NumberField label={m.t_wall_organizer_holes()} bind:value={p.holes} min={1} max={30} />
					<NumberField
						label={tc.tc_hole_diameter()}
						unit="mm"
						bind:value={p.holeDiameter}
						min={3}
						max={40}
						step={0.5}
						hint={m.t_wall_organizer_hole_hint()}
					/>
				{/if}
			</FieldGroup>
		{/if}
		{#if p.mount === 'screws' || isRail || isPanel}
			<FieldGroup title={m.t_wall_organizer_group_screws()}>
				<NumberField
					label={tc.tc_hole()}
					unit="mm"
					bind:value={p.screw}
					min={2.5}
					max={6}
					step={0.1}
				/>
				<NumberField
					label={m.t_wall_organizer_head()}
					unit="mm"
					bind:value={p.head}
					min={p.screw + 1}
					max={14}
					step={0.5}
				/>
			</FieldGroup>
		{/if}
		<p class="text-xs text-neutral-400">{wallSummary(p)}</p>
	{/snippet}
</ToolShell>
