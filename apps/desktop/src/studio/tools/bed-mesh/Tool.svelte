<script lang="ts">
	/**
	 * «Карта стола»: paste the mesh the printer measured, see it as a coloured
	 * grid (the hues of the G-code speed scale: blue lowest, red highest) and
	 * how far to turn each corner screw. Nothing leaves the browser.
	 */
	import ChoiceField from '$lib/components/tools/ChoiceField.svelte';
	import type { ToolInfo } from '$lib/tools/registry';
	import ToolPage from '../print-kit/ToolPage.svelte';
	import { SPEED_GRADIENT } from '../gcode-viewer/parse';
	import {
		PITCHES,
		SAMPLE,
		hueOf,
		parseMesh,
		screwTurns,
		rowOrderOf,
		statsOf,
		verdictOf,
		type FirstRow
	} from './model';
	import { currentLocale } from '$lib/i18n/current';
	import { decimalMark } from '$lib/i18n/locale';
	import * as m from '$msg/tools/bed-mesh';

	let { tool }: { tool: ToolInfo } = $props();

	let text = $state('');
	let firstRow = $state<FirstRow>('front');
	let pitch = $state(0.5);

	// Each firmware's block says which row it lists first: follow the text.
	$effect(() => {
		const order = rowOrderOf(text);
		if (order) firstRow = order;
	});

	const grid = $derived(text.trim() ? parseMesh(text, firstRow) : null);
	const stats = $derived(grid ? statsOf(grid) : null);
	const screws = $derived(grid ? screwTurns(grid, pitch) : []);
	// Drawn as seen from above: the back row on top.
	const shown = $derived(grid ? grid.slice().reverse() : []);
	// Fixed decimals keep the grid's columns even; the language's decimal mark.
	const mark = decimalMark(currentLocale());
	const dec = (v: number, d: number) => v.toFixed(d).replace('.', mark);
	const fmt = (v: number, d = 3) => (v > 0 ? '+' : '') + dec(v, d);
	const mm = (v: number) => dec(Math.abs(v), 2);
</script>

<ToolPage {tool} lead={m.t_bed_mesh_lead()}>
	<section class="space-y-4">
		<h2 class="section-title">{m.t_bed_mesh_input_title()}</h2>
		<div>
			<label for="mesh-text" class="label">{m.t_bed_mesh_input_label()}</label>
			<textarea
				id="mesh-text"
				class="input"
				bind:value={text}
				spellcheck="false"
				placeholder={m.t_bed_mesh_input_placeholder()}
				aria-describedby="mesh-hint"></textarea>
			<p id="mesh-hint" class="hint">
				{m.t_bed_mesh_input_hint()}
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<button type="button" class="btn-ghost btn-s" onclick={() => (text = SAMPLE)}
				>{m.t_bed_mesh_sample()}</button
			>
		</div>
		<ChoiceField
			label={m.t_bed_mesh_first_row()}
			bind:value={firstRow}
			options={[
				{ value: 'front', label: m.t_bed_mesh_first_row_front() },
				{ value: 'back', label: m.t_bed_mesh_first_row_back() }
			]}
			hint={m.t_bed_mesh_first_row_hint()}
		/>
		{#if text.trim() && !grid}
			<p class="field-error" role="alert">
				{m.t_bed_mesh_not_found()}
			</p>
		{/if}
	</section>

	{#if grid && stats}
		<section class="space-y-4">
			<h2 class="section-title">{m.t_bed_mesh_map_title()}</h2>
			<p class="section-lead">{m.t_bed_mesh_map_lead()}</p>
			<div class="overflow-x-auto">
				<div class="mesh" style:grid-template-columns="repeat({grid[0].length}, minmax(44px, 1fr))">
					{#each shown as row, y (y)}
						{#each row as v, x (x)}
							<div class="mesh-cell" style:background-color="hsl({hueOf(v, stats)} 90% 55%)">
								<span class="caption-inverse tabular-nums">{fmt(v, 2)}</span>
							</div>
						{/each}
					{/each}
				</div>
			</div>
			<div>
				<div class="h-2 rounded-full" style:background-image={SPEED_GRADIENT}></div>
				<div class="mt-1 flex justify-between text-xs tabular-nums text-neutral-400">
					<span>{m.t_bed_mesh_lowest({ value: fmt(stats.min) })}</span>
					<span>{m.t_bed_mesh_highest({ value: fmt(stats.max) })}</span>
				</div>
			</div>
			<div class="card">
				<div class="text-xs text-neutral-400">{m.t_bed_mesh_range()}</div>
				<div class="text-2xl font-semibold tabular-nums">
					{m.t_bed_mesh_range_value({ value: mm(stats.range) })}
				</div>
				<p class="mt-1 text-sm text-neutral-300">{verdictOf(stats.range)}</p>
			</div>
		</section>

		<section class="space-y-4">
			<h2 class="section-title">{m.t_bed_mesh_screws_title()}</h2>
			<ChoiceField
				label={m.t_bed_mesh_screw_thread()}
				bind:value={pitch}
				options={PITCHES.map((s) => ({ value: s.pitch, label: s.label }))}
			/>
			<ul class="list">
				{#each screws as s (s.corner)}
					<li class="list-row">
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">{s.corner}</div>
							<div class="mt-1 text-xs text-neutral-400">
								{Math.abs(s.delta) < 0.01
									? m.t_bed_mesh_screw_keep()
									: s.delta > 0
										? m.t_bed_mesh_screw_lower({ value: mm(s.delta) })
										: m.t_bed_mesh_screw_raise({ value: mm(s.delta) })}
							</div>
						</div>
						<div class="text-sm tabular-nums">
							{Math.abs(s.delta) < 0.01
								? '—'
								: m.t_bed_mesh_screw_turns({ turns: dec(s.turns, 2), minutes: s.minutes })}
						</div>
					</li>
				{/each}
			</ul>
			<p class="hint">
				{m.t_bed_mesh_screws_hint()}
			</p>
		</section>
	{/if}
</ToolPage>

<style>
	.mesh {
		display: grid;
		gap: var(--pz-space-1);
		min-width: 0;
	}
	.mesh-cell {
		display: flex;
		min-height: 44px;
		align-items: center;
		justify-content: center;
		border-radius: var(--pz-radius-sm);
	}
</style>
