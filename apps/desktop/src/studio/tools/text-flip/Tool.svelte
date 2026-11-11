<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Download, TriangleAlert } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import { currentLocale } from '$lib/i18n/current';
	import { listJoin } from '$lib/i18n/locale';
	import * as m from '$msg/tools/text-flip';
	import { fileSlug, WEIGHT_OPTIONS } from '$lib/tools/shared/glyphs';
	import { createWorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import { letterGlyphs } from '$lib/tools/shared/shape-input';
	import { usableFont } from '$lib/tools/shared/fonts';
	import FontField from '$lib/components/tools/FontField.svelte';
	import { FLIP_DEFAULTS, FLIP_LIMITS as L, flipLetters, type FlipParams } from './model';
	import type { FlipJob, FlipOutput } from './flip.worker';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<FlipParams>({ ...FLIP_DEFAULTS });

	const worker = createWorkerRunner<FlipJob, FlipOutput>(
		() =>
			new Worker(new URL('./flip.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('flip')
			})
	);
	const build = createBuild<FlipParams, (FlipOutput & { name: string }) | null>(
		async (p, signal) => {
			const front = flipLetters(p.front, p.uppercase);
			const side = flipLetters(p.side, p.uppercase);
			if (!front.length || !side.length) return null;
			const glyphs = await letterGlyphs([...front, ...side], signal, usableFont(p.font));
			const out = await worker.run(
				{
					p,
					front,
					frontGlyphs: glyphs.slice(0, front.length),
					side,
					sideGlyphs: glyphs.slice(front.length)
				},
				signal
			);
			return {
				...out,
				name: `${fileSlug(front.join(''), m.t_text_flip_word_filename())}-${fileSlug(side.join(''), m.t_text_flip_word_filename())}`
			};
		},
		450
	);
	$effect(() => build.run($state.snapshot(p)));
	onDestroy(() => {
		build.cancel();
		worker.dispose();
	});

	const result = $derived(build.value);
	const lengths = $derived([
		flipLetters(p.front, p.uppercase).length,
		flipLetters(p.side, p.uppercase).length
	]);
</script>

<ToolShell
	{tool}
	stl={result?.stl ?? null}
	busy={build.busy}
	error={build.error}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () => result && downloadBytes(result.stl, `${result.name}.stl`, 'model/stl')
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={m.t_text_flip_words()}>
			<TextField
				label={m.t_text_flip_front()}
				bind:value={p.front}
				maxlength={10}
				placeholder={m.t_text_flip_front_placeholder()}
			/>
			<TextField
				label={m.t_text_flip_side()}
				bind:value={p.side}
				maxlength={10}
				placeholder={m.t_text_flip_side_placeholder()}
			/>
			<ToggleField
				label={m.t_text_flip_uppercase()}
				bind:checked={p.uppercase}
				hint={m.t_text_flip_uppercase_hint()}
			/>
			{#if lengths[0] && lengths[1] && lengths[0] !== lengths[1]}
				<p class="text-xs text-neutral-400">{m.t_text_flip_different_lengths()}</p>
			{/if}
			{#if result?.empty.length}
				<div class="notice notice-warning" role="status">
					<TriangleAlert size={16} aria-hidden="true" />
					<p>
						{m.t_text_flip_pairs_missed({
							pairs: listJoin(
								result.empty.map(([a, b]) => m.t_text_flip_pair({ a, b })),
								currentLocale()
							)
						})}
					</p>
				</div>
			{/if}
		</FieldGroup>

		<FieldGroup title={m.t_text_flip_size_shape()}>
			<ChoiceField
				label={m.t_text_flip_weight()}
				bind:value={p.weight}
				options={WEIGHT_OPTIONS}
				hint={m.t_text_flip_weight_hint()}
			/>
			<FontField bind:value={p.font} />
			<NumberField
				label={tc.tc_letter_height()}
				unit="mm"
				bind:value={p.height}
				min={L.height[0]}
				max={L.height[1]}
				step={L.height[2]}
			/>
			<NumberField
				label={m.t_text_flip_spacing()}
				unit="mm"
				bind:value={p.spacing}
				min={L.spacing[0]}
				max={L.spacing[1]}
				step={L.spacing[2]}
			/>
			<ToggleField label={tc.tc_stand()} bind:checked={p.base} hint={m.t_text_flip_base_hint()} />
			{#if p.base}
				<NumberField
					label={m.t_text_flip_base_thickness()}
					unit="mm"
					bind:value={p.baseThickness}
					min={L.baseThickness[0]}
					max={L.baseThickness[1]}
					step={L.baseThickness[2]}
				/>
			{/if}
			<p class="hint">{m.t_text_flip_reading_hint()}</p>
		</FieldGroup>
	{/snippet}
	{#snippet empty()}
		{m.t_text_flip_empty()}
	{/snippet}
</ToolShell>
