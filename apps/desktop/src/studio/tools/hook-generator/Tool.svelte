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
	import * as m from '$msg/tools/hook-generator';
	import {
		HOOK_DEFAULTS,
		HOOK_KIND_DEFAULTS,
		HOOK_PRESETS,
		hookHeader,
		hookLayout,
		hookModel,
		type HookKind,
		type HookParams,
		type Mount
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<HookParams>({ ...HOOK_DEFAULTS });
	const model = $derived(hookModel(p));
	const source = $derived(toScad(model, hookHeader(p)));
	const layout = $derived(hookLayout(p));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	// Another kind of holder starts from its own sizes.
	let lastKind: HookKind = HOOK_DEFAULTS.kind;
	$effect(() => {
		if (p.kind === lastKind) return;
		lastKind = p.kind;
		Object.assign(p, HOOK_KIND_DEFAULTS[p.kind]);
	});

	function applyPreset(params: Partial<HookParams>) {
		if (params.kind) lastKind = params.kind;
		p = { ...HOOK_DEFAULTS, ...params };
	}

	const KINDS: readonly { value: HookKind; label: string }[] = [
		{ value: 'hook', label: m.t_hook_generator_kind_hook() },
		{ value: 'keys', label: m.t_hook_generator_kind_keys() },
		{ value: 'headphones', label: m.t_hook_generator_kind_headphones() },
		{ value: 'tool', label: m.t_hook_generator_kind_tool() }
	];
	const MOUNTS: readonly { value: Mount; label: string }[] = [
		{ value: 'screws', label: m.t_hook_generator_mount_screws() },
		{ value: 'tape', label: m.t_hook_generator_mount_tape() }
	];
	const mm = (v: number) => num(v, 1);
	const isTool = $derived(p.kind === 'tool');
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
				downloadBytes(build.value, `${m.t_hook_generator_filename()}-${p.kind}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each HOOK_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup>
			<ChoiceField
				label={m.t_hook_generator_kind()}
				bind:value={p.kind}
				options={KINDS}
				hint={isTool
					? m.t_hook_generator_kind_tool_hint()
					: p.kind === 'keys'
						? m.t_hook_generator_kind_keys_hint()
						: undefined}
			/>
		</FieldGroup>
		<FieldGroup
			title={isTool ? m.t_hook_generator_group_prongs() : m.t_hook_generator_group_hooks()}
		>
			<NumberField
				label={isTool ? m.t_hook_generator_slots() : m.t_hook_generator_hooks()}
				bind:value={p.count}
				min={1}
				max={12}
			/>
			<NumberField
				label={isTool ? m.t_hook_generator_prong_width() : m.t_hook_generator_hook_width()}
				unit="mm"
				bind:value={p.armWidth}
				min={4}
				max={80}
				step={0.5}
			/>
			{#if isTool || p.count > 1}
				<NumberField
					label={isTool ? m.t_hook_generator_slot_width() : m.t_hook_generator_hook_gap()}
					unit="mm"
					bind:value={p.gap}
					min={3}
					max={80}
					step={0.5}
				/>
			{/if}
			<NumberField
				label={m.t_hook_generator_reach()}
				unit="mm"
				bind:value={p.reach}
				min={8}
				max={150}
				step={1}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={3}
				max={20}
				step={0.5}
				hint={m.t_hook_generator_thickness_hint()}
			/>
			<NumberField
				label={m.t_hook_generator_lip()}
				unit="mm"
				bind:value={p.lip}
				min={0}
				max={60}
				step={1}
				hint={m.t_hook_generator_lip_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_hook_generator_group_plate()}>
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.plateHeight}
				min={16}
				max={200}
				step={1}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.plateThickness}
				min={2.5}
				max={12}
				step={0.5}
			/>
			<NumberField
				label={tc.tc_corner_rounding()}
				unit="mm"
				bind:value={p.radius}
				min={0}
				max={20}
				step={0.5}
			/>
			<p class="text-xs text-neutral-400">
				{m.t_hook_generator_plate_size({ width: mm(layout.plate[0]), height: mm(layout.plate[1]) })}
			</p>
		</FieldGroup>
		<FieldGroup title={tc.tc_mount()}>
			<ChoiceField label={m.t_hook_generator_mount()} bind:value={p.mount} options={MOUNTS} />
			{#if p.mount === 'screws'}
				<NumberField
					label={m.t_hook_generator_screw_d()}
					unit="mm"
					bind:value={p.screwD}
					min={2.5}
					max={8}
					step={0.1}
					hint={m.t_hook_generator_screw_d_hint()}
				/>
				<NumberField
					label={m.t_hook_generator_head_d()}
					unit="mm"
					bind:value={p.headD}
					min={4}
					max={16}
					step={0.1}
					hint={m.t_hook_generator_head_d_hint()}
				/>
			{:else}
				<p class="text-xs text-neutral-400">
					{m.t_hook_generator_tape_note()}
				</p>
			{/if}
		</FieldGroup>
		<FieldGroup title={m.t_hook_generator_group_label()}>
			<TextField
				label={tc.tc_text()}
				bind:value={p.label}
				maxlength={30}
				placeholder={m.t_hook_generator_label_placeholder()}
			/>
			{#if p.label.trim()}
				<NumberField
					label={tc.tc_letter_height()}
					unit="mm"
					bind:value={p.labelSize}
					min={3}
					max={20}
					step={0.5}
					hint={m.t_hook_generator_label_size_hint()}
				/>
			{/if}
			<p class="text-xs text-neutral-400">
				{m.t_hook_generator_print_note()}
			</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
