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
	import { showToast } from '$lib/toast';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/gear-generator';
	import {
		GEAR_DEFAULTS,
		GEAR_PRESETS,
		gearHeader,
		gearModel,
		gearPrintModel,
		gearSummary,
		type BoreShape,
		type GearKind,
		type GearParams,
		type GearShow
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<GearParams>({ ...GEAR_DEFAULTS });
	const model = $derived(gearModel(p));
	const source = $derived(toScad(model, gearHeader(p)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 450);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	let saving = $state(false);
	/** A pair is shown in mesh but printed apart (gearPrintModel). */
	async function downloadStl() {
		if (!build.value || saving) return;
		saving = true;
		try {
			const name = `${m.t_gear_generator_filename()}-${p.teeth1}-${p.teeth2}-${p.show}.stl`;
			const stl =
				p.show === 'pair'
					? await buildCsg(gearPrintModel(p), new AbortController().signal)
					: build.value;
			downloadBytes(stl, name, 'model/stl');
		} catch (e) {
			showToast(e instanceof Error ? e.message : m.t_gear_generator_stl_failed(), {
				kind: 'error'
			});
		} finally {
			saving = false;
		}
	}

	const KINDS: readonly { value: GearKind; label: string }[] = [
		{ value: 'spur', label: m.t_gear_generator_kind_spur() },
		{ value: 'helical', label: m.t_gear_generator_kind_helical() },
		{ value: 'herringbone', label: m.t_gear_generator_kind_herringbone() }
	];
	const SHOWS: readonly { value: GearShow; label: string }[] = [
		{ value: 'pair', label: m.t_gear_generator_show_pair() },
		{ value: 'first', label: m.t_gear_generator_show_first() },
		{ value: 'second', label: m.t_gear_generator_show_second() }
	];
	const BORES: readonly { value: BoreShape; label: string }[] = [
		{ value: 'round', label: m.t_gear_generator_bore_round() },
		{ value: 'dflat', label: m.t_gear_generator_bore_dflat() },
		{ value: 'hex', label: m.t_gear_generator_bore_hex() }
	];

	function applyPreset(params: Partial<GearParams>) {
		p = { ...GEAR_DEFAULTS, ...params };
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
			onClick: () => void downloadStl()
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each GEAR_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup>
			<ChoiceField
				label={m.t_gear_generator_teeth()}
				bind:value={p.kind}
				options={KINDS}
				hint={p.kind === 'spur'
					? undefined
					: p.kind === 'helical'
						? m.t_gear_generator_helical_hint()
						: m.t_gear_generator_herringbone_hint()}
			/>
			<ChoiceField
				label={tc.tc_what_to_print()}
				bind:value={p.show}
				options={SHOWS}
				hint={m.t_gear_generator_show_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_gear_generator_teeth()}>
			<NumberField
				label={m.t_gear_generator_module()}
				unit="mm"
				bind:value={p.module}
				min={0.5}
				max={8}
				step={0.25}
				hint={m.t_gear_generator_module_hint()}
			/>
			<NumberField label={m.t_gear_generator_teeth1()} bind:value={p.teeth1} min={8} max={150} />
			<NumberField label={m.t_gear_generator_teeth2()} bind:value={p.teeth2} min={8} max={150} />
			{#if p.kind !== 'spur'}
				<NumberField
					label={m.t_gear_generator_helix()}
					unit="°"
					bind:value={p.helix}
					min={5}
					max={45}
					step={1}
				/>
			{/if}
			<NumberField
				label={m.t_gear_generator_pressure_angle()}
				unit="°"
				bind:value={p.pressureAngle}
				min={14.5}
				max={25}
				step={0.5}
				hint={m.t_gear_generator_pressure_angle_hint()}
			/>
			<NumberField
				label={m.t_gear_generator_backlash()}
				unit="mm"
				bind:value={p.backlash}
				min={0}
				max={1}
				step={0.05}
				hint={m.t_gear_generator_backlash_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_gear_generator_wheel()}>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={2}
				max={80}
				step={0.5}
			/>
			<ChoiceField label={tc.tc_hole()} bind:value={p.boreShape} options={BORES} />
			<NumberField
				label={p.boreShape === 'hex' ? m.t_gear_generator_bore1_hex() : m.t_gear_generator_bore1()}
				unit="mm"
				bind:value={p.bore1}
				min={0}
				max={100}
				step={0.1}
			/>
			<NumberField
				label={p.boreShape === 'hex' ? m.t_gear_generator_bore2_hex() : m.t_gear_generator_bore2()}
				unit="mm"
				bind:value={p.bore2}
				min={0}
				max={100}
				step={0.1}
			/>
			<NumberField
				label={m.t_gear_generator_hub()}
				unit="mm"
				bind:value={p.hub}
				min={0}
				max={40}
				step={0.5}
				hint={m.t_gear_generator_hub_hint()}
			/>
			<ToggleField
				label={m.t_gear_generator_lighten()}
				bind:checked={p.lighten}
				hint={m.t_gear_generator_lighten_hint()}
			/>
			<p class="text-xs text-neutral-400">{gearSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
