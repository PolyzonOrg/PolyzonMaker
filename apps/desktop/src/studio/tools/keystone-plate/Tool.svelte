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
	import * as m from '$msg/tools/keystone-plate';
	import {
		KEYSTONE_PLATE_DEFAULTS,
		KEYSTONE_PLATE_PRESETS,
		keystonePlateHeader,
		keystonePlateModel,
		keystonePlateSummary,
		type KeystonePlateParams,
		type PlateMount,
		type PlateSize
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<KeystonePlateParams>({ ...KEYSTONE_PLATE_DEFAULTS });
	const model = $derived(keystonePlateModel(p));
	const source = $derived(toScad(model, keystonePlateHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 300);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SIZES: { value: PlateSize; label: string }[] = [
		{ value: '80', label: '80 × 80' },
		{ value: '86', label: '86 × 86' }
	];
	const MOUNTS: { value: PlateMount; label: string }[] = [
		{ value: 'flush', label: m.t_keystone_plate_mount_flush() },
		{ value: 'surface', label: m.t_keystone_plate_mount_surface() }
	];
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
				build.value && downloadBytes(build.value, `keystone-${p.ports}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each KEYSTONE_PLATE_PRESETS as preset (preset.id)}
					<button
						type="button"
						class="btn-ghost btn-s"
						onclick={() => (p = { ...KEYSTONE_PLATE_DEFAULTS, ...preset.params })}
					>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={m.t_keystone_plate_group_plate()}>
			<ChoiceField
				label={tc.tc_size()}
				bind:value={p.size}
				options={SIZES}
				hint={m.t_keystone_plate_size_hint()}
			/>
			<NumberField
				label={m.t_keystone_plate_ports()}
				bind:value={p.ports}
				min={0}
				max={4}
				hint={m.t_keystone_plate_ports_hint()}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={2.4}
				max={5}
				step={0.2}
				hint={m.t_keystone_plate_thickness_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_mount()}>
			<ChoiceField label={m.t_keystone_plate_mount()} bind:value={p.mount} options={MOUNTS} />
			{#if p.mount === 'surface'}
				<NumberField
					label={m.t_keystone_plate_depth()}
					unit="mm"
					bind:value={p.depth}
					min={32}
					max={60}
					hint={m.t_keystone_plate_depth_hint()}
				/>
			{/if}
			<p class="text-xs text-neutral-400">
				{keystonePlateSummary(p)}
				{p.mount === 'surface'
					? m.t_keystone_plate_surface_note()
					: m.t_keystone_plate_flush_note()}
			</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
