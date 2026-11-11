<script lang="ts">
	import { field } from '$lib/agent';
	/** Checkbox row (DESIGN_CODE §7.5): the whole row is the target. */
	let {
		label,
		checked = $bindable(),
		hint
	}: { label: string; checked: boolean; hint?: string } = $props();

	field({ kind: 'toggle', get label() { return label; }, get hint() { return hint; }, get value() { return checked; }, set value(v) { checked = v as boolean; } });
</script>

<label class="flex min-h-11 cursor-pointer items-start gap-3">
	<input type="checkbox" class="checkbox mt-px" bind:checked />
	<span class="min-w-0">
		<span class="block text-sm font-medium">{label}</span>
		{#if hint}<span class="mt-1 block text-xs text-neutral-400">{hint}</span>{/if}
	</span>
</label>
