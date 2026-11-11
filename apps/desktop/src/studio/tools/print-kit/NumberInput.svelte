<script lang="ts" module>
	/**
	 * onsubmit for a dialog form made of these fields: Enter saves like the
	 * button, and blurring the focused field first clamps its value the way a
	 * click on the button would.
	 */
	export function submitWith(save: () => void) {
		return (event: SubmitEvent) => {
			event.preventDefault();
			(document.activeElement as HTMLElement | null)?.blur();
			save();
		};
	}
</script>

<script lang="ts">
	/**
	 * A plain number field for money, grams and hours (DESIGN_CODE §7.5): no
	 * slider — these values have no natural range. Accepts a decimal comma;
	 * an empty field is zero (the placeholder says so); the value is clamped
	 * when the field is left. `unit` is a code as in NumberField (`g`, `h`,
	 * `W`…, units.ts) or text shown as is.
	 */
	import { untrack } from 'svelte';
	import { currentLocale } from '$lib/i18n/current';
	import { decimalMark } from '$lib/i18n/locale';
	import { unitLabel } from '$lib/components/tools/units';
	import * as m from '$msg/tools/print-kit';
	import { clamp, parseNumber } from './format';

	let {
		label,
		value = $bindable(),
		unit = '',
		hint,
		min = 0,
		max = 1_000_000,
		digits = 2,
		placeholder = '0'
	}: {
		label: string;
		value: number;
		unit?: string;
		hint?: string;
		min?: number;
		max?: number;
		digits?: number;
		placeholder?: string;
	} = $props();

	const id = $props.id();
	// No digit grouping: the field is edited, and «1,200» would parse back as 1.2.
	const mark = decimalMark(currentLocale());
	const show = (v: number) => (v ? String(Number(v.toFixed(digits))).replace('.', mark) : '');

	let text = $state(untrack(() => show(value)));
	let last = untrack(() => value);
	let invalid = $state(false);

	// The value changed from outside (a file was read, the form was reset).
	$effect(() => {
		const v = value;
		if (v === last) return;
		last = v;
		text = show(v);
		invalid = false;
	});

	function oninput() {
		const n = parseNumber(text);
		invalid = text.trim() !== '' && n === null;
		if (invalid) return;
		last = n ?? 0;
		value = last;
	}

	function onblur() {
		const next = clamp(parseNumber(text) ?? 0, min, max);
		last = next;
		value = next;
		text = show(next);
		invalid = false;
	}
</script>

<div>
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<label for={id} class="min-w-0 text-sm font-medium">{label}</label>
		{#if unit}<span class="shrink-0 text-xs text-neutral-400">{unitLabel(unit)}</span>{/if}
	</div>
	<input
		{id}
		type="text"
		inputmode="decimal"
		autocomplete="off"
		class="input tabular-nums"
		bind:value={text}
		{oninput}
		{onblur}
		{placeholder}
		aria-invalid={invalid || undefined}
		aria-describedby={invalid ? `${id}-error` : hint ? `${id}-hint` : undefined}
	/>
	{#if invalid}
		<p id="{id}-error" class="field-error">
			{m.t_print_kit_number_invalid({ example: `12${mark}5` })}
		</p>
	{:else if hint}
		<p id="{id}-hint" class="hint">{hint}</p>
	{/if}
</div>
