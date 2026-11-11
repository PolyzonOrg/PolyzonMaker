<script lang="ts">
	import { field } from '$lib/agent';
	/**
	 * A number with a slider and an exact input (DESIGN_CODE §9: keyboard users
	 * and exact values are not left to the slider). The language's decimal mark in
	 * the readout (a comma in Russian, a point in English); either is accepted on
	 * input, and the value stays a number. `unit` is a code (`mm`, `g`, `mm/s`…,
	 * see units.ts) or text to show as is.
	 */
	import { currentLocale } from '$lib/i18n/current';
	import { decimalMark } from '$lib/i18n/locale';
	import * as tc from '$msg/tools/common';
	import { readNumber } from './read-number';
	import { unitLabel } from './units';

	let {
		label,
		value = $bindable(),
		min,
		max,
		step = 1,
		unit = '',
		hint
	}: {
		label: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		unit?: string;
		hint?: string;
	} = $props();

	const id = $props.id();
	const progress = $derived(max > min ? (value - min) / (max - min) : 0);

	// No digit grouping: the field is edited, and «1,200» would parse back as 1.2.
	const mark = decimalMark(currentLocale());
	const shown = (n: number) => String(n).replace('.', mark);
	/** What the field did with the last typed value, when it was not taken as typed. */
	let note = $state('');
	function typed(raw: string) {
		const read = readNumber(raw, { min, max, step });
		if (!read) {
			note = tc.tc_number_invalid({ value: shown(value) });
			return;
		}
		value = read.value;
		const v = shown(read.value);
		note =
			read.fixed === 'range'
				? tc.tc_number_range({ min: shown(min), max: shown(max), value: v })
				: read.fixed === 'step'
					? tc.tc_number_step({ step: shown(step), value: v })
					: '';
	}

	field({ kind: 'number', get label() { return label; }, get hint() { return hint; }, get value() { return value; }, set value(v) { value = v as number; }, get min() { return min; }, get max() { return max; }, get step() { return step; }, get unit() { return unit; } });
</script>

<div>
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<label for={id} class="min-w-0 truncate text-sm font-medium">{label}</label>
		{#if unit}<span class="shrink-0 text-xs text-neutral-400">{unitLabel(unit)}</span>{/if}
	</div>
	<div class="flex items-center gap-2">
		<input
			{id}
			type="range"
			{min}
			{max}
			{step}
			bind:value
			oninput={() => (note = '')}
			class="range min-w-0 flex-1"
			style:--range-p={progress}
			aria-describedby={hint ? `${id}-hint` : undefined}
		/>
		<input
			type="text"
			inputmode="decimal"
			aria-label={tc.tc_exact_value({ label })}
			value={shown(value)}
			onkeydown={(event) => {
				if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
				event.preventDefault();
				const next = readNumber(String(value + (event.key === 'ArrowUp' ? step : -step)), {
					min,
					max,
					step
				});
				if (next) value = next.value;
			}}
			onchange={(event) => {
				typed(event.currentTarget.value);
				event.currentTarget.value = shown(value);
			}}
			aria-describedby={note ? `${id}-note` : undefined}
			class="input input-s w-20 shrink-0 text-right tabular-nums"
		/>
	</div>
	<!-- A corrected value is said once, in words, under the field; the next change clears it. -->
	<p id="{id}-note" class="hint text-amber-300" class:sr-only={!note} role="status">{note}</p>
	{#if hint}<p id="{id}-hint" class="hint">{hint}</p>{/if}
</div>
