<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Download, Layers } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { buildCsg, buildCsg3mf, disposeCsg, preloadCsg } from '$lib/tools/csg/run';
	import { toScad, type Node } from '$lib/tools/csg/csg';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { downloadBytes } from '$lib/tools/stl';
	import { showToast } from '$lib/toast';
	import type { ToolInfo } from '$lib/tools/registry';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/bookmark';
	import {
		BOOKMARK_DEFAULTS,
		BOOKMARK_PRESETS,
		bookmarkHeader,
		bookmarkModel,
		bookmarkSummary,
		type BookmarkParams,
		type BookmarkTop,
		bookmarkColours
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BookmarkParams>({ ...BOOKMARK_DEFAULTS });
	const drawn = $derived({ ...p, font: usableFont(p.font) });
	const model = $derived(bookmarkModel(drawn));
	const source = $derived(toScad(model, bookmarkHeader(drawn)));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	$effect(() => build.run(model));
	onMount(preloadCsg);
	const colours = $derived(bookmarkColours(drawn));
	let saving = $state(false);

	async function download3mf() {
		if (saving) return;
		saving = true;
		try {
			downloadBytes(
				await buildCsg3mf(colours, tool.title),
				`${m.t_bookmark_filename()}.3mf`,
				'model/3mf'
			);
		} catch (e) {
			showToast(e instanceof Error ? e.message : m.t_bookmark_3mf_failed(), { kind: 'error' });
		} finally {
			saving = false;
		}
	}

	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const TOPS: readonly { value: BookmarkTop; label: string }[] = [
		{ value: 'round', label: m.t_bookmark_top_round() },
		{ value: 'point', label: m.t_bookmark_top_point() },
		{ value: 'flat', label: m.t_bookmark_top_flat() }
	];

	function applyPreset(params: Partial<BookmarkParams>) {
		p = { ...BOOKMARK_DEFAULTS, ...params };
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
				build.value && downloadBytes(build.value, `${m.t_bookmark_filename()}.stl`, 'model/stl')
		},
		...(colours.length > 1
			? [{ label: tc.tc_download_3mf_colours(), icon: Layers, onClick: () => void download3mf() }]
			: [])
	]}
>
	{#snippet controls()}
		<FieldGroup title={tc.tc_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each BOOKMARK_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_inscription()}>
			<TextField
				label={tc.tc_text()}
				bind:value={p.text}
				maxlength={40}
				hint={m.t_bookmark_text_hint()}
			/>
			<TextField
				label={m.t_bookmark_line()}
				bind:value={p.line}
				maxlength={40}
				hint={m.t_bookmark_line_hint()}
			/>
			<FontField bind:value={p.font} />
			<ToggleField label={tc.tc_bolder()} bind:checked={p.bold} />
		</FieldGroup>
		<FieldGroup title={m.t_bookmark_group()}>
			<ChoiceField label={m.t_bookmark_top()} bind:value={p.top} options={TOPS} />
			<NumberField
				label={tc.tc_width()}
				unit="mm"
				bind:value={p.width}
				min={15}
				max={60}
				step={1}
			/>
			<NumberField
				label={tc.tc_length()}
				unit="mm"
				bind:value={p.length}
				min={60}
				max={220}
				step={1}
			/>
			<NumberField
				label={tc.tc_thickness()}
				unit="mm"
				bind:value={p.thickness}
				min={0.8}
				max={3}
				step={0.1}
				hint={m.t_bookmark_thickness_hint()}
			/>
			<NumberField
				label={tc.tc_relief_height()}
				unit="mm"
				bind:value={p.relief}
				min={0.4}
				max={2}
				step={0.1}
			/>
			<ToggleField label={tc.tc_frame()} bind:checked={p.border} />
			<ToggleField label={m.t_bookmark_hole()} bind:checked={p.hole} />
			<NumberField label={tc.tc_count()} bind:value={p.count} min={1} max={8} />
			<p class="text-xs text-neutral-400">{bookmarkSummary(p)}</p>
		</FieldGroup>
	{/snippet}
</ToolShell>
