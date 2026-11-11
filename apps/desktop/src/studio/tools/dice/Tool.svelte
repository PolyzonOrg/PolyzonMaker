<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/dice';
	import {
		DICE_DEFAULTS,
		diceHeader,
		diceModel,
		diceSummary,
		type D6Face,
		type DiceParams,
		type DieKind
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<DiceParams>({ ...DICE_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(diceModel(drawn));
	const source = $derived(toScad(model, diceHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: { value: DieKind; label: string }[] = (
		['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const
	).map((value) => ({ value, label: value }));
	const D6: { value: D6Face; label: string }[] = [
		{ value: 'pips', label: m.t_dice_face_pips() },
		{ value: 'numbers', label: m.t_dice_face_numbers() }
	];
	/** Sizes of a store set, mm. */
	const SIZES: Record<DieKind, number> = { d4: 20, d6: 16, d8: 18, d10: 18, d12: 20, d20: 22 };
	let kindWas = p.kind;
	$effect(() => {
		if (p.kind === kindWas) return;
		kindWas = p.kind;
		p.size = SIZES[p.kind];
	});
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
				downloadBytes(build.value, `${m.t_dice_filename()}-${p.kind}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={m.t_dice_group()}>
			<ChoiceField
				label={m.t_dice_kind()}
				bind:value={p.kind}
				options={KINDS}
				hint={m.t_dice_kind_hint()}
			/>
			{#if p.kind === 'd6'}
				<ChoiceField label={m.t_dice_faces()} bind:value={p.d6} options={D6} />
			{/if}
			<NumberField
				label={p.kind === 'd4' ? tc.tc_height() : m.t_dice_size()}
				unit="mm"
				bind:value={p.size}
				min={10}
				max={60}
				step={0.5}
			/>
			<NumberField
				label={p.kind === 'd6' && p.d6 === 'pips'
					? m.t_dice_depth_pips()
					: m.t_dice_depth_numbers()}
				unit="mm"
				bind:value={p.depth}
				min={0.3}
				max={2}
				step={0.1}
				hint={m.t_dice_depth_hint()}
			/>
			{#if !(p.kind === 'd6' && p.d6 === 'pips')}
				<FontField bind:value={p.font} />
			{/if}
			<p class="text-xs text-neutral-400">{diceSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
