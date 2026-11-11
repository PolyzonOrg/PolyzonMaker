<script lang="ts" generics="T extends string | number">
	import { field } from '$lib/agent';
	/** One of a few options as pressed/unpressed chips (DESIGN_CODE §7.4). */
	let {
		label,
		value = $bindable(),
		options,
		hint
	}: {
		label: string;
		value: T;
		options: readonly { value: T; label: string }[];
		hint?: string;
	} = $props();

	const id = $props.id();

	field({ kind: 'choice', get label() { return label; }, get hint() { return hint; }, get value() { return value; }, set value(v) { value = v as T; }, get options() { return options; } });
</script>

<div role="group" aria-labelledby={id}>
	<div {id} class="label">{label}</div>
	<div class="flex flex-wrap gap-2">
		{#each options as option (option.value)}
			<button
				type="button"
				class="btn-ghost btn-s"
				aria-pressed={value === option.value}
				onclick={() => (value = option.value)}
			>
				{option.label}
			</button>
		{/each}
	</div>
	{#if hint}<p class="hint">{hint}</p>{/if}
</div>
