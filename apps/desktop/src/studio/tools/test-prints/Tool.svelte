<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Copy, Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import { manualCopyHint } from '$lib/clipboard';
	import { showToast } from '$lib/toast';
	import type { ToolInfo } from '$lib/tools/registry';
	import {
		TEST_PRINT_DEFAULTS,
		TEST_PRINT_PRESETS,
		skewCommands,
		skewOf,
		testPrintHeader,
		testPrintModel,
		testPrintSummary,
		type TestPrintKind,
		type TestPrintParams
	} from './model';
	import { num } from '$lib/i18n/current';
	import * as m from '$msg/tools/test-prints';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<TestPrintParams>({ ...TEST_PRINT_DEFAULTS });
	const model = $derived(testPrintModel(p));
	const source = $derived(toScad(model, testPrintHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 350);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const KINDS: readonly { value: TestPrintKind; label: string }[] = TEST_PRINT_PRESETS.map((t) => ({
		value: t.params.kind as TestPrintKind,
		label: t.label
	}));

	// Skew: what the person measured on the printed square.
	let ac = $state(141.42);
	let bd = $state(141.42);
	let ad = $state(100);
	const skew = $derived(skewOf(ac, bd, ad));
	const commands = $derived(skewCommands(ac, bd, ad));

	async function copy(text: string, list: Element | null) {
		try {
			await navigator.clipboard.writeText(text);
			showToast(m.t_test_prints_copied(), { kind: 'success' });
		} catch {
			if (list) getSelection()?.selectAllChildren(list);
			showToast(manualCopyHint(m.t_test_prints_commands_selected()), { kind: 'error' });
		}
	}
</script>

{#snippet commandList(text: string)}
	<ul class="list">
		{#each text.split('\n') as line, i (i)}
			<li class="list-row min-h-11 py-2">
				<span class="min-w-0 flex-1 break-all text-sm font-medium">{line}</span>
			</li>
		{/each}
	</ul>
	<button
		type="button"
		class="btn-ghost btn-s"
		onclick={(e) => copy(text, e.currentTarget.previousElementSibling)}
	>
		<Copy size={14} aria-hidden="true" />
		{m.t_test_prints_copy_commands()}
	</button>
{/snippet}

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
			onClick: () => build.value && downloadBytes(build.value, `test-${p.kind}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={m.t_test_prints_group_test()}>
			<ChoiceField label={m.t_test_prints_what_to_check()} bind:value={p.kind} options={KINDS} />
			<p class="text-xs text-neutral-400">{testPrintSummary(p)}</p>
		</FieldGroup>
		<FieldGroup title={m.t_test_prints_group_params()}>
			{#if p.kind === 'fit'}
				<TextField
					label={m.t_test_prints_plays()}
					bind:value={p.plays}
					maxlength={80}
					hint={m.t_test_prints_plays_hint()}
				/>
			{:else if p.kind === 'overhang'}
				<TextField
					label={m.t_test_prints_angles()}
					bind:value={p.angles}
					maxlength={80}
					hint={m.t_test_prints_angles_hint()}
				/>
			{:else if p.kind === 'bridge'}
				<TextField label={m.t_test_prints_spans()} bind:value={p.spans} maxlength={80} />
			{:else if p.kind === 'holes'}
				<TextField label={m.t_test_prints_diameters()} bind:value={p.diameters} maxlength={80} />
			{:else if p.kind === 'cube'}
				<NumberField
					label={m.t_test_prints_cube_side()}
					unit="mm"
					bind:value={p.cubeSize}
					min={10}
					max={60}
					step={1}
				/>
			{:else if p.kind === 'skew'}
				<NumberField
					label={m.t_test_prints_square_side()}
					unit="mm"
					bind:value={p.skewSize}
					min={50}
					max={200}
					step={10}
				/>
			{:else}
				<NumberField
					label={m.t_test_prints_bed_x()}
					unit="mm"
					bind:value={p.bedX}
					min={80}
					max={600}
					step={1}
				/>
				<NumberField
					label={m.t_test_prints_bed_y()}
					unit="mm"
					bind:value={p.bedY}
					min={80}
					max={600}
					step={1}
				/>
				<NumberField
					label={m.t_test_prints_first_layer()}
					unit="mm"
					bind:value={p.layer}
					min={0.08}
					max={0.6}
					step={0.02}
				/>
			{/if}
		</FieldGroup>
		{#if p.kind === 'skew'}
			<FieldGroup title={m.t_test_prints_group_measurements()}>
				<NumberField
					label={m.t_test_prints_diagonal_ac()}
					unit="mm"
					bind:value={ac}
					min={50}
					max={300}
					step={0.01}
				/>
				<NumberField
					label={m.t_test_prints_diagonal_bd()}
					unit="mm"
					bind:value={bd}
					min={50}
					max={300}
					step={0.01}
				/>
				<NumberField
					label={m.t_test_prints_side_ad()}
					unit="mm"
					bind:value={ad}
					min={30}
					max={200}
					step={0.01}
				/>
				{#if skew && commands}
					{@const degrees = num(Math.round(Math.abs(skew.degrees) * 1000) / 1000, 3)}
					<p class="text-sm tabular-nums text-neutral-300">
						{Math.abs(skew.degrees) < 0.05
							? m.t_test_prints_skew_none({ degrees })
							: m.t_test_prints_skew({ degrees })}
					</p>
					<div class="text-xs font-medium text-neutral-400">Klipper</div>
					{@render commandList(commands.klipper)}
					<div class="text-xs font-medium text-neutral-400">Marlin</div>
					{@render commandList(commands.marlin)}
				{:else}
					<p class="field-error" role="alert">
						{m.t_test_prints_skew_impossible()}
					</p>
				{/if}
			</FieldGroup>
		{/if}
	{/snippet}
</ToolShell>
