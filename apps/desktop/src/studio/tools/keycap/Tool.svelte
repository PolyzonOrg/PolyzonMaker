<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { num } from '$lib/i18n/current';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/keycap';
	import {
		KEYCAP_DEFAULTS,
		KEYCAP_PRESETS,
		KEY_SIZES,
		keycapHeader,
		keycapModel,
		keycapSummary,
		type KeySize,
		type KeycapParams
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<KeycapParams>({ ...KEYCAP_DEFAULTS });
	const model = $derived(keycapModel(p));
	const source = $derived(toScad(model, keycapHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SIZES: readonly { value: KeySize; label: string }[] = KEY_SIZES.map((s) => ({
		value: s,
		label: `${num(s)}u`
	}));

	function applyPreset(params: Partial<KeycapParams>) {
		p = { ...KEYCAP_DEFAULTS, ...params };
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
			onClick: () => build.value && downloadBytes(build.value, `keycap-${p.size}u.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each KEYCAP_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_keycap_cap()}>
			<ChoiceField
				label={tc.tc_size()}
				bind:value={p.size}
				options={SIZES}
				hint={m.t_keycap_size_hint()}
			/>
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.height}
				min={5}
				max={14}
				step={0.1}
			/>
			<NumberField
				label={m.t_keycap_dish()}
				unit="mm"
				bind:value={p.dish}
				min={0}
				max={2.5}
				step={0.1}
				hint={m.t_keycap_dish_hint()}
			/>
			<NumberField
				label={tc.tc_walls_thickness()}
				unit="mm"
				bind:value={p.wall}
				min={0.8}
				max={2.5}
				step={0.1}
			/>
			<NumberField
				label={m.t_keycap_fit()}
				unit="mm"
				bind:value={p.fit}
				min={-0.1}
				max={0.4}
				step={0.02}
				hint={m.t_keycap_fit_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_inscription()}>
			<TextField label={m.t_keycap_legend()} bind:value={p.legend} maxlength={8} />
			{#if p.legend}
				<NumberField
					label={m.t_keycap_legend_size()}
					unit="mm"
					bind:value={p.legendSize}
					min={2}
					max={10}
					step={0.5}
				/>
			{/if}
		</FieldGroup>
		<FieldGroup title={tc.tc_print()}>
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={20} />
			<p class="text-xs text-neutral-400">{keycapSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
