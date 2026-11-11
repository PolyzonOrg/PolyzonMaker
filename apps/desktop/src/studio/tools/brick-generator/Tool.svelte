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
	import type { ToolInfo } from '$lib/tools/registry';
	import { num } from '$lib/i18n/current';
	import * as tc from '$msg/tools/common';
	import * as m from '$msg/tools/brick-generator';
	import {
		BRICK_DEFAULTS,
		BRICK_PRESETS,
		FIT_OPTIONS,
		PLATE,
		brickCells,
		brickConnected,
		brickHeader,
		brickInfo,
		brickModel,
		type BrickParams,
		type BrickShape
	} from './model';

	let { tool }: { tool: ToolInfo } = $props();

	let p = $state<BrickParams>({ ...BRICK_DEFAULTS });
	const model = $derived(brickModel(p));
	const source = $derived(toScad(model, brickHeader(p)));
	const info = $derived(brickInfo(p));
	const build = createBuild<Node, Uint8Array>((root, signal) => buildCsg(root, signal), 400);
	const cells = $derived(brickCells(p));
	const blank = $derived(p.shape === 'custom' && !cells.length);
	$effect(() => {
		if (!blank) build.run(model);
	});

	// Drawing starts from the shape that was on screen.
	let lastShape: BrickShape = BRICK_DEFAULTS.shape;
	$effect(() => {
		const shape = p.shape;
		if (shape === 'custom' && lastShape !== 'custom' && !p.cells.length) {
			p.cells = brickCells({ ...p, shape: lastShape }).map(([i, j]) => `${i},${j}`);
		}
		lastShape = shape;
	});

	const has = $derived(new Set(cells.map(([i, j]) => `${i},${j}`)));
	function toggle(i: number, j: number) {
		const key = `${i},${j}`;
		p.cells = has.has(key) ? p.cells.filter((k) => k !== key) : [...p.cells, key];
	}
	onMount(preloadCsg);
	onDestroy(() => {
		build.cancel();
		disposeCsg();
	});

	const SHAPES: readonly { value: BrickShape; label: string }[] = [
		{ value: 'rect', label: m.t_brick_generator_shape_rect() },
		{ value: 'l', label: m.t_brick_generator_shape_l() },
		{ value: 'u', label: m.t_brick_generator_shape_u() },
		{ value: 'plus', label: m.t_brick_generator_shape_plus() },
		{ value: 'custom', label: m.t_brick_generator_shape_custom() }
	];
	const summary = $derived.by(() => {
		const tubes = info.tubes
			? m.t_brick_generator_count_tubes({ count: info.tubes, n: num(info.tubes) })
			: '';
		const pins = info.pins
			? m.t_brick_generator_count_pins({ count: info.pins, n: num(info.pins) })
			: '';
		const below = tubes || pins;
		if (!info.studs) {
			if (tubes && pins) return m.t_brick_generator_summary_smooth_both({ tubes, pins });
			return below
				? m.t_brick_generator_summary_smooth_below({ below })
				: m.t_brick_generator_summary_smooth();
		}
		const studs = m.t_brick_generator_count_studs({ count: info.studs, n: num(info.studs) });
		if (tubes && pins) return m.t_brick_generator_summary_studs_both({ studs, tubes, pins });
		return below
			? m.t_brick_generator_summary_studs_below({ studs, below })
			: m.t_brick_generator_summary_studs({ studs });
	});

	function applyPreset(params: Partial<BrickParams>) {
		// The fit belongs to the printer, not the part: it stays.
		p = { ...BRICK_DEFAULTS, fit: p.fit, ...params };
	}
</script>

<ToolShell
	{tool}
	stl={build.value}
	busy={build.busy}
	error={blank ? m.t_brick_generator_grid_empty() : build.error}
	scadSource={source}
	exports={[
		{
			label: tc.tc_download_stl(),
			icon: Download,
			primary: true,
			onClick: () =>
				build.value &&
				downloadBytes(
					build.value,
					`${m.t_brick_generator_filename()}-${p.length}x${p.width}-${p.plates}.stl`,
					'model/stl'
				)
		}
	]}
>
	{#snippet controls()}
		<FieldGroup title={m.t_brick_generator_presets()}>
			<div class="flex flex-wrap gap-2">
				{#each BRICK_PRESETS as preset (preset.id)}
					<button type="button" class="btn-ghost btn-s" onclick={() => applyPreset(preset.params)}>
						{preset.label}
					</button>
				{/each}
			</div>
		</FieldGroup>
		<FieldGroup title={tc.tc_size()}>
			<NumberField label={m.t_brick_generator_length()} bind:value={p.length} min={1} max={16} />
			<NumberField label={m.t_brick_generator_width()} bind:value={p.width} min={1} max={16} />
			<NumberField
				label={m.t_brick_generator_plates()}
				bind:value={p.plates}
				min={1}
				max={12}
				hint={m.t_brick_generator_plates_hint({ plate: num(PLATE), brick: num(3 * PLATE) })}
			/>
			<ToggleField
				label={m.t_brick_generator_tile()}
				bind:checked={p.tile}
				hint={m.t_brick_generator_tile_hint()}
			/>
		</FieldGroup>
		<FieldGroup title={tc.tc_shape()}>
			<ChoiceField label={m.t_brick_generator_outline()} bind:value={p.shape} options={SHAPES} />
			{#if p.shape === 'custom'}
				<div>
					<p class="label" id="brick-grid-label">{m.t_brick_generator_grid()}</p>
					<div
						class="brick-grid"
						style:grid-template-columns="repeat({p.length}, minmax(0, 1fr))"
						style:max-width="{p.length * 2}rem"
						role="group"
						aria-labelledby="brick-grid-label"
					>
						{#each Array.from({ length: p.width }, (_, r) => p.width - 1 - r) as j (j)}
							{#each Array.from({ length: p.length }, (_, i) => i) as i (i)}
								<button
									type="button"
									class="brick-cell"
									aria-pressed={has.has(`${i},${j}`)}
									aria-label={m.t_brick_generator_grid_cell({ i: i + 1, j: j + 1 })}
									onclick={() => toggle(i, j)}
								></button>
							{/each}
						{/each}
					</div>
					<p class="hint">
						{brickConnected(cells)
							? m.t_brick_generator_grid_hint()
							: m.t_brick_generator_grid_apart()}
					</p>
				</div>
			{:else if p.shape !== 'rect'}
				<NumberField
					label={m.t_brick_generator_arm()}
					bind:value={p.arm}
					min={1}
					max={Math.max(1, Math.min(p.length, p.width) - 1)}
				/>
			{/if}
			<p class="text-xs text-neutral-400">{summary}</p>
		</FieldGroup>
		<FieldGroup title={m.t_brick_generator_fit_group()}>
			<ChoiceField
				label={m.t_brick_generator_fit()}
				bind:value={p.fit}
				options={FIT_OPTIONS}
				hint={m.t_brick_generator_fit_hint()}
			/>
			<NumberField
				label={tc.tc_wall()}
				unit="mm"
				bind:value={p.wall}
				min={0.8}
				max={2}
				step={0.05}
				hint={m.t_brick_generator_wall_hint()}
			/>
		</FieldGroup>
	{/snippet}
</ToolShell>

<style>
	/* Drawing a shape stud by stud (DESIGN_CODE §9): a filled cell is a stud. */
	.brick-grid {
		display: grid;
		gap: var(--pz-space-1);
	}
	.brick-cell {
		aspect-ratio: 1;
		border-radius: var(--pz-radius-xs);
		background: var(--pz-color-subtle);
	}
	.brick-cell:hover {
		background: var(--pz-color-subtle-hover);
	}
	.brick-cell[aria-pressed='true'] {
		background: var(--pz-color-action);
	}
</style>
