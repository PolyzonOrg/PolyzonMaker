<script lang="ts">
	import { field } from '$lib/agent';
	/** Single-line text with a label, a limit and an optional hint. */
	let {
		label,
		value = $bindable(),
		maxlength = 60,
		placeholder = '',
		hint
	}: {
		label: string;
		value: string;
		maxlength?: number;
		placeholder?: string;
		hint?: string;
	} = $props();

	const id = $props.id();

	field({ kind: 'text', get label() { return label; }, get hint() { return hint; }, get value() { return value; }, set value(v) { value = v as string; }, get maxlength() { return maxlength; } });
</script>

<div>
	<label for={id} class="label">{label}</label>
	<input
		{id}
		type="text"
		class="input"
		bind:value
		{maxlength}
		{placeholder}
		autocomplete="off"
		aria-describedby={hint ? `${id}-hint` : undefined}
	/>
	{#if hint}<p id="{id}-hint" class="hint">{hint}</p>{/if}
</div>
