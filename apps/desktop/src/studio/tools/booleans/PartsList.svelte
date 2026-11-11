<script lang="ts">
	/**
	 * «Части: N»: a row per part (DESIGN_CODE §7.6) — visibility, colour,
	 * name, volume and its own download. With `onselect`, the name picks the
	 * part the next action applies to (the current one: grey + check).
	 */
	import { Check, Download } from 'lucide-svelte';
	import { downloadPart, formatCm3, type Part } from './parts';
	import * as m from '$msg/tools/booleans';
	import * as tc from '$msg/tools/common';

	let {
		parts,
		selected = null,
		stale = false,
		onselect,
		onvisible
	}: {
		parts: readonly Part[];
		selected?: number | null;
		/** The parts no longer match the fields: downloads wait for «Пересобрать». */
		stale?: boolean;
		onselect?: (id: number) => void;
		onvisible: (id: number, visible: boolean) => void;
	} = $props();
</script>

<ul class="list">
	{#each parts as part (part.id)}
		<li class="list-row py-1">
			<input
				type="checkbox"
				class="checkbox"
				checked={part.visible}
				onchange={(e) => onvisible(part.id, e.currentTarget.checked)}
				aria-label={m.t_booleans_part_show({ name: part.name })}
			/>
			{#if onselect}
				<button
					type="button"
					class="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md px-2 text-left hover:bg-panel2 aria-pressed:bg-panel3"
					aria-pressed={selected === part.id}
					onclick={() => onselect(part.id)}
				>
					{@render body(part)}
					{#if selected === part.id}<Check size={16} aria-hidden="true" />{/if}
				</button>
			{:else}
				<div class="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-2">{@render body(part)}</div>
			{/if}
			<button
				type="button"
				class="icon-btn"
				aria-label={m.t_booleans_part_download({ name: part.name })}
				title={stale ? tc.tc_rebuild_first() : tc.tc_download_stl()}
				disabled={stale}
				onclick={() => downloadPart(part)}
			>
				<Download size={16} aria-hidden="true" />
			</button>
		</li>
	{/each}
</ul>

{#snippet body(part: Part)}
	<span class="part-dot border border-border" style:background-color={part.color} aria-hidden="true"
	></span>
	<span class="min-w-0 flex-1">
		<span class="block truncate text-sm font-medium">{part.name}</span>
		<span class="mt-1 block text-xs tabular-nums text-neutral-400">
			{formatCm3(part.volume)}{#if part.tag}, {part.tag}{/if}
		</span>
	</span>
{/snippet}

<style>
	.part-dot {
		width: 16px;
		height: 16px;
		flex: none;
		border-radius: 50%;
	}
</style>
