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
	import * as m from '$msg/tools/shelf-bracket';
	import * as tc from '$msg/tools/common';
	import {
		SHELF_BRACKET_DEFAULTS,
		SHELF_BRACKET_PRESETS,
		shelfBracketHeader,
		shelfBracketModel,
		shelfBracketSummary,
		type BracketKind,
		type ShelfBracketParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<ShelfBracketParams>({ ...SHELF_BRACKET_DEFAULTS });
	const model = $derived(shelfBracketModel(p));
	const source = $derived(toScad(model, shelfBracketHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: readonly { value: BracketKind; label: string }[] = [
		{ value: 'shelf', label: m.t_shelf_bracket_kind_shelf() },
		{ value: 'corner', label: m.t_shelf_bracket_kind_corner() },
		{ value: 'tee', label: m.t_shelf_bracket_kind_tee() },
		{ value: 'straight', label: m.t_shelf_bracket_kind_straight() }
	];

	function applyPreset(params: Partial<ShelfBracketParams>) {
		p = { ...SHELF_BRACKET_DEFAULTS, ...params };
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
				downloadBytes(build.value, `${m.t_shelf_bracket_filename()}-${p.kind}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each SHELF_BRACKET_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_shelf_bracket_group_part()}>
			<ChoiceField label={m.t_shelf_bracket_kind()} bind:value={p.kind} options={KINDS} />
			<NumberField
				label={p.kind === 'shelf'
					? m.t_shelf_bracket_arm_wall()
					: p.kind === 'straight'
						? tc.tc_length()
						: m.t_shelf_bracket_arm_first()}
				unit="mm"
				bind:value={p.armA}
				min={30}
				max={300}
				step={1}
			/>
			{#if p.kind !== 'straight'}
				<NumberField
					label={p.kind === 'shelf'
						? m.t_shelf_bracket_arm_shelf()
						: m.t_shelf_bracket_arm_second()}
					unit="mm"
					bind:value={p.armB}
					min={30}
					max={300}
					step={1}
				/>
			{/if}
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={10}
				max={60}
				step={1}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={2}
				max={12}
				step={0.5}
			/>
			{#if p.kind === 'shelf'}
				<ToggleField
					label={m.t_shelf_bracket_gusset()}
					bind:checked={p.gusset}
					hint={m.t_shelf_bracket_gusset_hint()}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_shelf_bracket_group_fasteners()}>
			<NumberField
				label={m.t_shelf_bracket_screw()}
				unit="mm"
				bind:value={p.screw}
				min={2.5}
				max={8}
				step={0.5}
			/>
			<NumberField label={m.t_shelf_bracket_holes()} bind:value={p.holes} min={1} max={6} />
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={8} />
			<p class="text-xs text-neutral-400">{shelfBracketSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
