<script lang="ts">
	import { MODEL_ACCEPT, readModelFile } from '$lib/tools/shared/model-file';
	import { onDestroy, onMount } from 'svelte';
	import { takeHandedOffMesh } from '$lib/tools/shared/mesh-handoff';
	import { Download, MousePointerClick, Palette } from 'lucide-svelte';
	import ToolShell from '$lib/components/tools/ToolShell.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import FontField from '$lib/components/tools/FontField.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import { createBuild, readableError, SLOW_BUILD_MS } from '$lib/tools/build.svelte';
	import { latestOnly } from '$lib/latest';
	import { union } from '$lib/tools/csg/csg';
	import { glyphsFor } from '$lib/tools/csg/run';
	import { usableFont } from '$lib/tools/shared/fonts';
	import { write3mf } from '$lib/tools/shared/threemf';
	import { bounds, downloadBytes, placeOnBed, writeStl } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import PartsViewport from '../booleans/PartsViewport.svelte';
	import { partColor, partsSize, type Part } from '../booleans/parts';
	import type { Vec3 } from '../booleans/plane';
	import { ToolWorker } from '../booleans/worker';
	import {
		MODEL_TEXT_DEFAULTS,
		modelTextLabels,
		placeAt,
		sideSize,
		type ModelTextParams,
		type TextSide,
		type TextStyle
	} from './model';
	import type { ModelTextReply } from './text.worker';
	import { workerName } from '$lib/i18n/worker';
	import * as m from '$msg/tools/model-text';
	import * as tc from '$msg/tools/common';

	let { tool }: { tool: ToolInfo } = $props();

	const worker = new ToolWorker(
		() =>
			new Worker(new URL('./text.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('model-text')
			})
	);

	let fileName = $state<string | null>(null);
	let fileError = $state<string | null>(null);
	let source = $state.raw<{ key: string; tris: Float32Array; name: string } | null>(null);
	let p = $state<ModelTextParams>({ ...MODEL_TEXT_DEFAULTS });
	// Three lines in three fields; the model takes them joined.
	const fromText = (text: string) => [...text.split('\n'), '', '', ''].slice(0, 3);
	let lines = $state(fromText(MODEL_TEXT_DEFAULTS.text));
	$effect(() => {
		p.text = lines.filter((l) => l.trim()).join('\n');
	});

	const box = $derived(source ? bounds(source.tris) : null);
	const side = $derived(box ? sideSize(p.side, box) : ([100, 100] as [number, number]));

	interface Input {
		key: string;
		tris: Float32Array;
		params: ModelTextParams;
	}
	const build = createBuild<Input, ModelTextReply>(
		async (input, signal) => {
			const glyphs = await glyphsFor(union(...modelTextLabels(input.params)), signal);
			return worker.run<ModelTextReply>({ ...input, glyphs }, signal);
		},
		450,
		{ manualAfterMs: SLOW_BUILD_MS }
	);
	$effect(() => {
		if (!source) return;
		const params = $state.snapshot(p);
		build.run({
			key: source.key,
			tris: source.tris,
			params: { ...params, font: usableFont(params.font) }
		});
	});
	onDestroy(() => {
		build.cancel();
		worker.dispose();
	});

	const parts = $derived.by<Part[]>(() => {
		const reply = build.value;
		if (!reply) return [];
		const still: Vec3 = [0, 0, 0];
		if (reply.model && reply.letters)
			return [
				{
					id: 1,
					name: tc.tc_model(),
					file: 'model',
					tris: reply.model,
					volume: reply.volume,
					color: partColor(0),
					visible: true,
					dir: still
				},
				{
					id: 2,
					name: tc.tc_inscription(),
					file: m.t_model_text_filename(),
					tris: reply.letters,
					volume: 0,
					color: partColor(1),
					visible: true,
					dir: still
				}
			];
		return [
			{
				id: 1,
				name: m.t_model_text_part_whole(),
				file: `model-${m.t_model_text_filename()}`,
				tris: reply.whole,
				volume: reply.volume,
				color: partColor(0),
				visible: true,
				dir: still
			}
		];
	});

	// A model sent from another page (a generation, another tool) opens at once.
	onMount(() => {
		const handed = takeHandedOffMesh();
		if (handed) void onfile(handed);
	});

	const opening = latestOnly();
	async function onfile(file: File) {
		const fresh = opening.next();
		fileError = null;
		try {
			const tris = await readModelFile(file);
			if (!fresh()) return; // a newer file was chosen meanwhile
			const b = bounds(tris);
			build.fresh();
			source = { key: `${file.name}:${file.size}:${file.lastModified}`, tris, name: file.name };
			fileName = file.name;
			// Letters about a sixth of the side, never tiny.
			const [w, h] = sideSize(p.side, b);
			p.cap = Math.max(3, Math.min(30, Math.round(Math.min(w / 6, h / 4))));
			p.across = 0;
			p.up = 0;
		} catch (e) {
			if (fresh()) fileError = readableError(e);
		}
	}

	let picking = $state(false);
	function pick(point: Vec3) {
		if (box) Object.assign(p, placeAt(point, box));
	}

	const base = $derived(
		(source?.name ?? 'model').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-') || 'model'
	);

	const SIDES: { value: TextSide; label: string }[] = [
		{ value: 'front', label: m.t_model_text_side_front() },
		{ value: 'back', label: m.t_model_text_side_back() },
		{ value: 'left', label: m.t_model_text_side_left() },
		{ value: 'right', label: m.t_model_text_side_right() },
		{ value: 'top', label: m.t_model_text_side_top() },
		{ value: 'bottom', label: m.t_model_text_side_bottom() }
	];
	const STYLES: { value: TextStyle; label: string }[] = [
		{ value: 'raised', label: m.t_model_text_style_raised() },
		{ value: 'engraved', label: m.t_model_text_style_engraved() }
	];
</script>

<ToolShell
	{tool}
	size={partsSize(parts)}
	busy={build.busy}
	stale={build.stale}
	onrebuild={build.flush}
	error={fileError ?? build.error}
	exports={build.value
		? [
				{
					label: tc.tc_download_stl(),
					icon: Download,
					primary: true,
					onClick: () =>
						build.value &&
						downloadBytes(
							writeStl(placeOnBed(build.value.whole)),
							`${base}-${m.t_model_text_filename()}.stl`,
							'model/stl'
						)
				},
				...(build.value.model && build.value.letters
					? [
							{
								label: m.t_model_text_3mf(),
								icon: Palette,
								onClick: () => {
									const r = build.value;
									if (!r?.model || !r.letters) return;
									downloadBytes(
										write3mf(
											[
												{ name: tc.tc_model(), tris: r.model },
												{ name: tc.tc_inscription(), tris: r.letters }
											],
											base
										),
										`${base}-${m.t_model_text_filename()}.3mf`,
										'model/3mf'
									);
								}
							}
						]
					: [])
			]
		: []}
	empty={source ? undefined : emptyHint}
>
	{#snippet viewport()}
		<PartsViewport {parts} fitKey={source?.key} onpick={picking ? pick : null} />
	{/snippet}
	{#snippet controls()}
		<FieldGroup title={tc.tc_file()}>
			<FileField
				label={tc.tc_open_model()}
				accept={MODEL_ACCEPT}
				hint={m.t_model_text_file_hint()}
				{fileName}
				{onfile}
			/>
			{#if build.value?.note}
				<p class="text-xs text-neutral-400">{build.value.note}</p>
			{/if}
		</FieldGroup>
		<FieldGroup title={tc.tc_inscription()}>
			{#each lines as line, i (i)}
				{#if i === 0 || lines[i - 1].trim() || line.trim()}
					<TextField
						label={m.t_model_text_line({ n: i + 1 })}
						bind:value={lines[i]}
						maxlength={40}
					/>
				{/if}
			{/each}
			<FontField bind:value={p.font} />
			<NumberField
				label={tc.tc_letter_height()}
				unit="mm"
				bind:value={p.cap}
				min={2}
				max={60}
				step={0.5}
			/>
			<ChoiceField label={m.t_model_text_style()} bind:value={p.style} options={STYLES} />
			<NumberField
				label={p.style === 'raised' ? m.t_model_text_raise() : m.t_model_text_depth()}
				unit="mm"
				bind:value={p.depth}
				min={0.2}
				max={5}
				step={0.1}
				hint={p.style === 'raised' ? m.t_model_text_raised_hint() : m.t_model_text_engraved_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={m.t_model_text_place()}>
			<div>
				<button
					type="button"
					class="btn-ghost btn-s"
					aria-pressed={picking}
					onclick={() => (picking = !picking)}
				>
					<MousePointerClick size={14} aria-hidden="true" />
					{picking ? m.t_model_text_pick_done() : m.t_model_text_pick()}
				</button>
				<p class="hint">
					{picking ? m.t_model_text_pick_hint() : m.t_model_text_pick_or()}
				</p>
			</div>
			<ChoiceField label={m.t_model_text_side()} bind:value={p.side} options={SIDES} />
			<NumberField
				label={m.t_model_text_across()}
				unit="mm"
				bind:value={p.across}
				min={-Math.ceil(side[0] / 2)}
				max={Math.ceil(side[0] / 2)}
				step={0.5}
			/>
			<NumberField
				label={m.t_model_text_up()}
				unit="mm"
				bind:value={p.up}
				min={-Math.ceil(side[1] / 2)}
				max={Math.ceil(side[1] / 2)}
				step={0.5}
			/>
			<NumberField
				label={m.t_model_text_angle()}
				unit="°"
				bind:value={p.angle}
				min={-180}
				max={180}
				step={5}
			/>
		</FieldGroup>
	{/snippet}
</ToolShell>

{#snippet emptyHint()}
	{m.t_model_text_empty()}
{/snippet}
