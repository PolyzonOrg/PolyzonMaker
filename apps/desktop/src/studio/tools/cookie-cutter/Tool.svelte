<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Download, TriangleAlert } from 'lucide-svelte';
	import ToolShell, { type ToolExport } from '$lib/components/tools/ToolShell.svelte';
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import FileField from '$lib/components/tools/FileField.svelte';
	import NumberField from '$lib/components/tools/NumberField.svelte';
	import TextField from '$lib/components/tools/TextField.svelte';
	import ToggleField from '$lib/components/tools/ToggleField.svelte';
	import TraceFields from '$lib/tools/shared/TraceFields.svelte';
	import { createBuild } from '$lib/tools/build.svelte';
	import { downloadBytes } from '$lib/tools/stl';
	import type { ToolInfo } from '$lib/tools/registry';
	import { workerName } from '$lib/i18n/worker';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/cookie-cutter';
	import { cleanText, fileSlug, WEIGHT_OPTIONS } from '$lib/tools/shared/glyphs';
	import { createWorkerRunner } from '$lib/tools/shared/mesh-worker-client';
	import { imageShape, svgShape, textLines } from '$lib/tools/shared/shape-input';
	import { shapeById, SHAPES } from '$lib/tools/shared/shapes';
	import { dropSmall, fitRings, type Ring } from '$lib/tools/shared/trace';
	import {
		COOKIE_DEFAULTS,
		COOKIE_LIMITS as L,
		type CookieJob,
		type CookieParams,
		type CookieSource,
		type EdgeKind
	} from './model';
	import type { CookieOutput } from './cookie.worker';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<CookieParams>(structuredClone(COOKIE_DEFAULTS));
	let svgFile = $state.raw<File | null>(null);
	let imageFile = $state.raw<File | null>(null);

	interface Input {
		p: CookieParams;
		svgFile: File | null;
		imageFile: File | null;
	}

	const baseName = (file: File) => file.name.replace(/\.\w+$/, '');
	const worker = createWorkerRunner<CookieJob, CookieOutput>(
		() =>
			new Worker(new URL('./cookie.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('cookie')
			})
	);

	/** The shape's rings and how to read them; null while there is nothing to cut. */
	async function shapeRings({ p, svgFile, imageFile }: Input, signal: AbortSignal) {
		if (p.source === 'shape')
			return { kind: 'shape' as const, rings: shapeById(p.shape).rings(), name: p.shape };
		if (p.source === 'text') {
			const text = cleanText(p.text, 12);
			const [rings] = await textLines([text], signal);
			return rings.length
				? {
						kind: 'glyphs' as const,
						rings,
						name: fileSlug(text, m.t_cookie_cutter_text_filename())
					}
				: null;
		}
		const file = p.source === 'svg' ? svgFile : imageFile;
		if (!file) return null;
		const rings: Ring[] =
			p.source === 'svg'
				? await svgShape(file, signal)
				: dropSmall(fitRings(await imageShape(file, p.trace, signal), p.size), p.minDetail);
		return {
			kind: 'outline' as const,
			rings,
			name: fileSlug(baseName(file), m.t_cookie_cutter_file_filename())
		};
	}

	const build = createBuild<Input, (CookieOutput & { name: string }) | null>(
		async (input, signal) => {
			const { p } = input;
			const stampText = p.stamp ? cleanText(p.stampText, 12) : '';
			const [shape, [stampGlyphs]] = await Promise.all([
				shapeRings(input, signal),
				// The stamp's letters are made bold in the worker: set as wide as that needs.
				textLines([stampText], signal, undefined, 'bold')
			]);
			if (!shape) return null;
			const out = await worker.run(
				{ p, kind: shape.kind, rings: shape.rings, stampGlyphs },
				signal
			);
			return { ...out, name: `${m.t_cookie_cutter_filename()}-${shape.name}` };
		},
		400
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
				label: m.t_cookie_cutter_download_cutter(),
				icon: Download,
				primary: true,
				onClick: () => result && downloadBytes(result.cutter, `${result.name}.stl`, 'model/stl')
			}
		];
		if (p.stamp)
			list.push({
				label: m.t_cookie_cutter_download_stamp(),
				icon: Download,
				disabled: !result?.stamp,
				onClick: () =>
					result?.stamp &&
					downloadBytes(
						result.stamp,
						`${result.name}-${m.t_cookie_cutter_stamp_filename()}.stl`,
						'model/stl'
					)
			});
		list.push({
			label: m.t_cookie_cutter_download_outline(),
			icon: Download,
			onClick: () => result && downloadBytes(result.svg, `${result.name}.svg`, 'image/svg+xml')
		});
		return list;
	});

	const sources: { value: CookieSource; label: string }[] = [
		{ value: 'shape', label: m.t_cookie_cutter_source_shape() },
		{ value: 'text', label: tc.tc_inscription() },
		{ value: 'svg', label: m.t_cookie_cutter_source_svg() },
		{ value: 'image', label: tc.tc_picture() }
	];
	const shapeOptions = SHAPES.map((s) => ({ value: s.id, label: s.label }));
	const edges: { value: EdgeKind; label: string }[] = [
		{ value: 'straight', label: m.t_cookie_cutter_edge_straight() },
		{ value: 'fine', label: m.t_cookie_cutter_edge_fine() },
		{ value: 'sturdy', label: m.t_cookie_cutter_edge_sturdy() }
	];
	const edgeHints: Record<EdgeKind, string> = {
		straight: m.t_cookie_cutter_edge_straight_hint(),
		fine: m.t_cookie_cutter_edge_fine_hint(),
		sturdy: m.t_cookie_cutter_edge_sturdy_hint()
	};
</script>

<ToolShell {tool} stl={result?.preview ?? null} busy={build.busy} error={build.error} {exports}>
	{#snippet controls()}
		<FieldGroup title={tc.tc_shape()}>
			<ChoiceField label={m.t_cookie_cutter_source()} bind:value={p.source} options={sources} />
			{#if p.source === 'shape'}
				<ChoiceField
					label={m.t_cookie_cutter_shape()}
					bind:value={p.shape}
					options={shapeOptions}
				/>
			{:else if p.source === 'text'}
				<TextField
					label={tc.tc_inscription()}
					bind:value={p.text}
					maxlength={12}
					placeholder={m.t_cookie_cutter_text_placeholder()}
					hint={m.t_cookie_cutter_text_hint()}
				/>
				<ChoiceField
					label={m.t_cookie_cutter_weight()}
					bind:value={p.weight}
					options={WEIGHT_OPTIONS}
				/>
			{:else if p.source === 'svg'}
				<FileField
					label={m.t_cookie_cutter_svg_pick()}
					accept=".svg,image/svg+xml"
					hint={m.t_cookie_cutter_svg_hint()}
					fileName={svgFile?.name ?? null}
					onfile={(f) => (svgFile = f)}
				/>
			{:else}
				<FileField
					label={m.t_cookie_cutter_image_pick()}
					accept="image/png,image/jpeg,image/webp,image/bmp"
					hint={m.t_cookie_cutter_image_hint()}
					fileName={imageFile?.name ?? null}
					onfile={(f) => (imageFile = f)}
				/>
				<TraceFields bind:value={p.trace} bind:minDetail={p.minDetail} />
			{/if}
			<NumberField
				label={m.t_cookie_cutter_size()}
				unit="mm"
				bind:value={p.size}
				min={L.size[0]}
				max={L.size[1]}
				step={L.size[2]}
				hint={m.t_cookie_cutter_size_hint()}
			/>
			<p class="hint">{m.t_cookie_cutter_mirrored_note()}</p>
		</FieldGroup>

		<FieldGroup title={m.t_cookie_cutter_blade()}>
			<NumberField
				label={tc.tc_height()}
				unit="mm"
				bind:value={p.bladeHeight}
				min={L.bladeHeight[0]}
				max={L.bladeHeight[1]}
				step={L.bladeHeight[2]}
				hint={m.t_cookie_cutter_blade_height_hint()}
			/>
			<NumberField
				label={tc.tc_wall_thickness()}
				unit="mm"
				bind:value={p.blade}
				min={L.blade[0]}
				max={L.blade[1]}
				step={L.blade[2]}
			/>
			<ChoiceField
				label={m.t_cookie_cutter_edge()}
				bind:value={p.edge}
				options={edges}
				hint={edgeHints[p.edge]}
			/>
		</FieldGroup>

		<FieldGroup title={m.t_cookie_cutter_rim_and_top()}>
			<ToggleField
				label={m.t_cookie_cutter_rim()}
				bind:checked={p.rim}
				hint={m.t_cookie_cutter_rim_hint()}
			/>
			{#if p.rim}
				<NumberField
					label={m.t_cookie_cutter_rim_width()}
					unit="mm"
					bind:value={p.rimWidth}
					min={L.rimWidth[0]}
					max={L.rimWidth[1]}
					step={L.rimWidth[2]}
				/>
				<NumberField
					label={m.t_cookie_cutter_rim_height()}
					unit="mm"
					bind:value={p.rimHeight}
					min={L.rimHeight[0]}
					max={L.rimHeight[1]}
					step={L.rimHeight[2]}
				/>
			{/if}
			<ToggleField
				label={m.t_cookie_cutter_closed_top()}
				bind:checked={p.closedTop}
				hint={m.t_cookie_cutter_closed_top_hint()}
			/>
			{#if p.closedTop}
				<NumberField
					label={m.t_cookie_cutter_top_thickness()}
					unit="mm"
					bind:value={p.topThickness}
					min={L.topThickness[0]}
					max={L.topThickness[1]}
					step={L.topThickness[2]}
				/>
			{/if}
		</FieldGroup>

		<FieldGroup title={m.t_cookie_cutter_stamp_group()}>
			<ToggleField
				label={m.t_cookie_cutter_stamp()}
				bind:checked={p.stamp}
				hint={m.t_cookie_cutter_stamp_hint()}
			/>
			{#if p.stamp}
				<NumberField
					label={m.t_cookie_cutter_stamp_inset()}
					unit="mm"
					bind:value={p.stampInset}
					min={L.stampInset[0]}
					max={L.stampInset[1]}
					step={L.stampInset[2]}
				/>
				<NumberField
					label={m.t_cookie_cutter_stamp_line()}
					unit="mm"
					bind:value={p.stampLine}
					min={L.stampLine[0]}
					max={L.stampLine[1]}
					step={L.stampLine[2]}
				/>
				<NumberField
					label={tc.tc_relief_height()}
					unit="mm"
					bind:value={p.stampRelief}
					min={L.stampRelief[0]}
					max={L.stampRelief[1]}
					step={L.stampRelief[2]}
				/>
				<ToggleField
					label={m.t_cookie_cutter_stamp_details()}
					bind:checked={p.stampDetails}
					hint={m.t_cookie_cutter_stamp_details_hint()}
				/>
				<TextField
					label={m.t_cookie_cutter_stamp_text()}
					bind:value={p.stampText}
					maxlength={12}
					placeholder={m.t_cookie_cutter_stamp_text_placeholder()}
				/>
				{#if p.stampText.trim()}
					<NumberField
						label={m.t_cookie_cutter_stamp_text_height()}
						unit="mm"
						bind:value={p.stampTextHeight}
						min={L.stampTextHeight[0]}
						max={L.stampTextHeight[1]}
						step={L.stampTextHeight[2]}
					/>
				{/if}
			{/if}
		</FieldGroup>

		{#if result?.warnings.length}
			<FieldGroup title={m.t_cookie_cutter_print_check()}>
				{#each result.warnings as warning (warning)}
					<div class="notice notice-warning" role="status">
						<TriangleAlert size={16} aria-hidden="true" />
						<p>{warning}</p>
					</div>
				{/each}
			</FieldGroup>
		{/if}
	{/snippet}
	{#snippet empty()}
		{#if p.source === 'text'}
			{m.t_cookie_cutter_empty_text()}
		{:else if p.source === 'svg'}
			{m.t_cookie_cutter_empty_svg()}
		{:else}
			{m.t_cookie_cutter_empty_image()}
		{/if}
	{/snippet}
</ToolShell>
