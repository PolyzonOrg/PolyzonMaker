<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Download } from 'lucide-svelte';
	import ToolShell, { type ToolExport } from '$lib/components/tools/ToolShell.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TraceFields from '$lib/tools/shared/TraceFields.svelte';
	import { workerName } from '$lib/i18n/worker';
	import { createBuild } from '$lib/tools/build.svelte';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { cleanText, fileSlug, WEIGHT_OPTIONS } from '$lib/tools/shared/glyphs';
	import { createWorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import { imageShape, letterGlyphs, svgShape } from '$lib/tools/shared/shape-input';
	import { usableFont } from '$lib/tools/shared/fonts';
	import FontField from '$lib/components/tools/FontField.svelte';
	import { dropSmall, fitRings } from '$lib/tools/shared/trace';
	import * as m from '$msg/tools/sign-generator';
	import * as tc from '$msg/tools/common';
	import {
		SIGN_DEFAULTS,
		SIGN_LIMITS as L,
		type LidKind,
		type SignParams,
		type SignSource
	} from './model';
	import type { SignJob, SignOutput } from './sign.worker';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<SignParams>(structuredClone(SIGN_DEFAULTS));
	let svgFile = $state.raw<File | null>(null);
	let imageFile = $state.raw<File | null>(null);

	interface Input {
		p: SignParams;
		svgFile: File | null;
		imageFile: File | null;
	}

	const baseName = (file: File) => file.name.replace(/\.\w+$/, '');
	const worker = createWorkerRunner<SignJob, SignOutput>(
		() =>
			new Worker(new URL('./sign.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('sign')
			})
	);

	const build = createBuild<Input, (SignOutput & { name: string }) | null>(
		async ({ p, svgFile, imageFile }, signal) => {
			let job: SignJob;
			let name: string;
			if (p.source === 'text') {
				const chars = Array.from(cleanText(p.text, 16));
				if (!chars.some((c) => c.trim())) return null;
				const glyphs = await letterGlyphs(chars, signal, usableFont(p.font));
				job = { p, kind: 'letters', chars, glyphs, rings: [] };
				name = fileSlug(chars.join(''), m.t_sign_generator_text_filename());
			} else {
				const file = p.source === 'svg' ? svgFile : imageFile;
				if (!file) return null;
				// Outlines in any units: the worker scales them to the height.
				const rings =
					p.source === 'svg'
						? await svgShape(file, signal)
						: dropSmall(
								fitRings(await imageShape(file, p.trace, signal), p.size, 'height'),
								p.minDetail
							);
				job = { p, kind: 'outline', chars: [], glyphs: [], rings };
				name = fileSlug(baseName(file), m.t_sign_generator_outline_filename());
			}
			const out = await worker.run(job, signal);
			return { ...out, name: `${m.t_sign_generator_filename()}-${name}` };
		},
		450
	);
	$effect(() => build.run({ p: $state.snapshot(p), svgFile, imageFile }));
	onDestroy(() => {
		build.cancel();
		worker.dispose();
	});

	const result = $derived(build.value);
	const exports = $derived.by(() => {
		const list: ToolExport[] = [
			{
				label: m.t_sign_generator_download_corpus(),
				icon: Download,
				primary: true,
				onClick: () =>
					result &&
					downloadBytes(
						result.corpus,
						`${result.name}-${m.t_sign_generator_corpus_filename()}.stl`,
						'model/stl'
					)
			}
		];
		if (p.lid !== 'none')
			list.push({
				label: m.t_sign_generator_download_lid(),
				icon: Download,
				disabled: !result?.lid,
				onClick: () =>
					result?.lid &&
					downloadBytes(
						result.lid,
						`${result.name}-${m.t_sign_generator_lid_filename()}.stl`,
						'model/stl'
					)
			});
		return list;
	});

	const sources: { value: SignSource; label: string }[] = [
		{ value: 'text', label: tc.tc_inscription() },
		{ value: 'svg', label: m.t_sign_generator_source_svg() },
		{ value: 'image', label: tc.tc_picture() }
	];
	const lids: { value: LidKind; label: string }[] = [
		{ value: 'insert', label: m.t_sign_generator_lid_insert() },
		{ value: 'cap', label: m.t_sign_generator_lid_cap() },
		{ value: 'channel', label: m.t_sign_generator_lid_channel() },
		{ value: 'none', label: m.t_sign_generator_lid_none() }
	];
	const lidHints: Record<LidKind, string> = {
		insert: m.t_sign_generator_lid_insert_hint(),
		cap: m.t_sign_generator_lid_cap_hint(),
		channel: m.t_sign_generator_lid_channel_hint(),
		none: m.t_sign_generator_lid_none_hint()
	};
</script>

<ToolShell {tool} stl={result?.preview ?? null} busy={build.busy} error={build.error} {exports}>
	{#snippet controls()}
		<FieldGroup title={tc.tc_shape()}>
			<ChoiceField label={m.t_sign_generator_source()} bind:value={p.source} options={sources} />
			{#if p.source === 'text'}
				<TextField
					label={tc.tc_inscription()}
					bind:value={p.text}
					maxlength={16}
					placeholder={m.t_sign_generator_text_placeholder()}
				/>
				<ChoiceField
					label={m.t_sign_generator_weight()}
					bind:value={p.weight}
					options={WEIGHT_OPTIONS}
					hint={m.t_sign_generator_weight_hint()}
				/>
				<FontField bind:value={p.font} />
				<NumberField
					label={m.t_sign_generator_letter_height()}
					unit="mm"
					bind:value={p.letterHeight}
					min={L.letterHeight[0]}
					max={L.letterHeight[1]}
					step={L.letterHeight[2]}
				/>
				<NumberField
					label={m.t_sign_generator_spacing()}
					unit="mm"
					bind:value={p.spacing}
					min={L.spacing[0]}
					max={L.spacing[1]}
					step={L.spacing[2]}
					hint={m.t_sign_generator_spacing_hint()}
				/>
			{:else}
				{#if p.source === 'svg'}
					<FileField
						label={m.t_sign_generator_svg_pick()}
						accept=".svg,image/svg+xml"
						hint={m.t_sign_generator_svg_hint()}
						fileName={svgFile?.name ?? null}
						onfile={(f) => (svgFile = f)}
					/>
				{:else}
					<FileField
						label={m.t_sign_generator_image_pick()}
						accept="image/png,image/jpeg,image/webp,image/bmp"
						hint={m.t_sign_generator_image_hint()}
						fileName={imageFile?.name ?? null}
						onfile={(f) => (imageFile = f)}
					/>
					<TraceFields bind:value={p.trace} bind:minDetail={p.minDetail} />
				{/if}
				<NumberField
					label={tc.tc_height()}
					unit="mm"
					bind:value={p.size}
					min={L.size[0]}
					max={L.size[1]}
					step={L.size[2]}
				/>
			{/if}
			{#if result}
				<p class="text-xs text-neutral-400">{m.t_sign_generator_bodies({ n: result.bodies })}</p>
			{/if}
		</FieldGroup>

		<FieldGroup title={m.t_sign_generator_group_corpus()}>
			<NumberField
				label={m.t_sign_generator_depth()}
				unit="mm"
				bind:value={p.depth}
				min={L.depth[0]}
				max={L.depth[1]}
				step={L.depth[2]}
				hint={m.t_sign_generator_depth_hint()}
			/>
			<NumberField
				label={tc.tc_walls()}
				unit="mm"
				bind:value={p.wall}
				min={L.wall[0]}
				max={L.wall[1]}
				step={L.wall[2]}
			/>
			<NumberField
				label={tc.tc_bottom()}
				unit="mm"
				bind:value={p.floor}
				min={L.floor[0]}
				max={L.floor[1]}
				step={L.floor[2]}
			/>
			<ToggleField label={m.t_sign_generator_wire_hole()} bind:checked={p.wireHole} />
			{#if p.wireHole}
				<NumberField
					label={tc.tc_hole_diameter()}
					unit="mm"
					bind:value={p.wireDiameter}
					min={L.wireDiameter[0]}
					max={L.wireDiameter[1]}
					step={L.wireDiameter[2]}
				/>
			{/if}
		</FieldGroup>

		<FieldGroup title={tc.tc_lid()}>
			<ChoiceField label={tc.tc_lid()} bind:value={p.lid} options={lids} hint={lidHints[p.lid]} />
			{#if p.lid === 'insert' || p.lid === 'channel'}
				<NumberField
					label={m.t_sign_generator_lid_thickness()}
					unit="mm"
					bind:value={p.lidThickness}
					min={L.lidThickness[0]}
					max={L.lidThickness[1]}
					step={L.lidThickness[2]}
				/>
				<NumberField
					label={m.t_sign_generator_lid_gap()}
					unit="mm"
					bind:value={p.lidGap}
					min={L.lidGap[0]}
					max={L.lidGap[1]}
					step={L.lidGap[2]}
					hint={m.t_sign_generator_lid_gap_hint()}
				/>
			{/if}
			{#if p.lid === 'insert'}
				<NumberField
					label={m.t_sign_generator_ledge()}
					unit="mm"
					bind:value={p.ledge}
					min={L.ledge[0]}
					max={L.ledge[1]}
					step={L.ledge[2]}
					hint={m.t_sign_generator_ledge_hint()}
				/>
			{:else if p.lid === 'channel'}
				<NumberField
					label={m.t_sign_generator_channel()}
					unit="mm"
					bind:value={p.channel}
					min={L.channel[0]}
					max={L.channel[1]}
					step={L.channel[2]}
					hint={m.t_sign_generator_channel_hint()}
				/>
				<NumberField
					label={m.t_sign_generator_inner_wall()}
					unit="mm"
					bind:value={p.innerWall}
					min={L.innerWall[0]}
					max={L.innerWall[1]}
					step={L.innerWall[2]}
				/>
			{:else if p.lid === 'cap'}
				<NumberField
					label={m.t_sign_generator_cap_wall()}
					unit="mm"
					bind:value={p.capWall}
					min={L.capWall[0]}
					max={L.capWall[1]}
					step={L.capWall[2]}
				/>
				<NumberField
					label={m.t_sign_generator_cap_top()}
					unit="mm"
					bind:value={p.capTop}
					min={L.capTop[0]}
					max={L.capTop[1]}
					step={L.capTop[2]}
				/>
				<NumberField
					label={m.t_sign_generator_cap_gap()}
					unit="mm"
					bind:value={p.capGap}
					min={L.capGap[0]}
					max={L.capGap[1]}
					step={L.capGap[2]}
				/>
				<NumberField
					label={m.t_sign_generator_cap_depth()}
					unit="mm"
					bind:value={p.capDepth}
					min={L.capDepth[0]}
					max={L.capDepth[1]}
					step={L.capDepth[2]}
				/>
			{/if}
			<p class="hint">
				{m.t_sign_generator_print_hint()}
			</p>
		</FieldGroup>
	{/snippet}
	{#snippet empty()}
		{#if p.source === 'text'}
			{m.t_sign_generator_empty_text()}
		{:else if p.source === 'svg'}
			{m.t_sign_generator_empty_svg()}
		{:else}
			{m.t_sign_generator_empty_image()}
		{/if}
	{/snippet}
</ToolShell>
