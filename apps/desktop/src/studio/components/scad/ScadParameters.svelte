<script lang="ts">
	import { Sliders } from 'lucide-svelte';
	import Collapsible from '$lib/components/Collapsible.svelte';
	import FieldGroup from '$lib/components/tools/FieldGroup.svelte';
	import type { ScadParam } from '$lib/openscad/parser';
	import Rich from '$lib/components/Rich.svelte';
	import { num } from '$lib/i18n/current';
	import { slots } from '$lib/i18n/rich';
	import * as m from '$msg/scad';

	let {
		params,
		onChange
	}: {
		params: ScadParam[];
		onChange: (name: string, value: string | number | boolean) => void;
	} = $props();

	/** Keep the source order, but show Customizer groups as headings. */
	const groups = $derived.by(() => {
		const list: Array<{ name: string | undefined; items: ScadParam[] }> = [];
		for (const parameter of params) {
			const last = list.at(-1);
			if (last && last.name === parameter.group) last.items.push(parameter);
			else list.push({ name: parameter.group, items: [parameter] });
		}
		return list;
	});

	const format = (value: unknown) => (typeof value === 'number' ? num(value, 3) : String(value));

	function progress(parameter: ScadParam): number {
		if (parameter.kind !== 'range' || parameter.min === undefined || parameter.max === undefined)
			return 0;
		const span = parameter.max - parameter.min;
		return span > 0 ? (Number(parameter.value) - parameter.min) / span : 0;
	}

	function clampNumber(parameter: ScadParam, raw: string): number | null {
		const value = Number(raw);
		if (!Number.isFinite(value)) return null;
		if (parameter.kind === 'range' && parameter.min !== undefined && parameter.max !== undefined)
			return Math.min(parameter.max, Math.max(parameter.min, value));
		return value;
	}
</script>

<!-- A pane section with its own 48px head; from lg the list scrolls under it. -->
<Collapsible
	title={m.scad_params_title()}
	tip={m.scad_params_tip()}
	class="flex min-h-0 flex-1 flex-col"
	bodyClass="min-h-0 flex-1 p-4 lg:overflow-y-auto"
>
	{#if params.length === 0}
		<div class="notice">
			<Sliders size={16} aria-hidden="true" />
			<p>
				<Rich text={m.scad_params_empty(slots('example'))}
					>{#snippet example()}<code>x = 30; // [10:1:50]</code>{/snippet}</Rich
				>
			</p>
		</div>
	{:else}
		{#each groups as group, groupIndex (groupIndex)}
			<FieldGroup title={group.name}>
				{#each group.items as parameter (parameter.name)}
					{@const id = `scad-param-${parameter.name}`}
					<div>
						<div class="mb-2 flex items-baseline justify-between gap-2">
							<label for={id} class="min-w-0">
								<span class="block text-sm font-medium text-neutral-100"
									>{parameter.label ?? parameter.name}</span
								>
								{#if parameter.label}
									<span class="block truncate text-xs text-neutral-400" title={parameter.name}>{parameter.name}</span>
								{/if}
							</label>
							{#if parameter.kind === 'range' && parameter.min !== undefined && parameter.max !== undefined}
								<span class="shrink-0 text-xs tabular-nums text-neutral-400"
									>{format(parameter.min)}–{format(parameter.max)}</span
								>
							{/if}
						</div>
						{#if parameter.kind === 'range'}
							<!-- Slider + number input: keyboard users and exact values are not left to the slider (DESIGN_CODE §9). -->
							<div class="flex items-center gap-2">
								<input
									{id}
									type="range"
									min={parameter.min}
									max={parameter.max}
									step={parameter.step ?? 1}
									value={parameter.value}
									oninput={(event) => onChange(parameter.name, Number(event.currentTarget.value))}
									class="range min-w-0 flex-1"
									style:--range-p={progress(parameter)}
								/>
								<input
									type="number"
									aria-label={m.scad_param_exact_value({
										label: parameter.label ?? parameter.name
									})}
									min={parameter.min}
									max={parameter.max}
									step={parameter.step ?? 1}
									value={parameter.value}
									onchange={(event) => {
										const next = clampNumber(parameter, event.currentTarget.value);
										if (next !== null) onChange(parameter.name, next);
										event.currentTarget.value = String(next ?? parameter.value);
									}}
									class="input input-s w-20 shrink-0 text-right tabular-nums"
								/>
							</div>
						{:else if parameter.kind === 'number'}
							<input
								{id}
								type="number"
								value={parameter.value}
								step={0.1}
								oninput={(event) => {
									const next = clampNumber(parameter, event.currentTarget.value);
									if (next !== null) onChange(parameter.name, next);
								}}
								class="input input-s"
							/>
						{:else if parameter.kind === 'bool'}
							<label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
								<input
									{id}
									type="checkbox"
									checked={parameter.value === true}
									onchange={(event) => onChange(parameter.name, event.currentTarget.checked)}
									class="checkbox"
								/>
								<span class="text-neutral-300"
									>{parameter.value === true ? m.scad_param_on() : m.scad_param_off()}</span
								>
							</label>
						{:else if parameter.kind === 'enumNumber' || parameter.kind === 'enumString'}
							<select
								{id}
								value={String(parameter.value)}
								onchange={(event) =>
									onChange(
										parameter.name,
										parameter.kind === 'enumNumber'
											? Number(event.currentTarget.value)
											: event.currentTarget.value
									)}
								class="input input-s"
							>
								{#each parameter.options ?? [] as option (option)}
									<option value={String(option)}>{option}</option>
								{/each}
							</select>
						{:else}
							<input
								{id}
								type="text"
								value={String(parameter.value)}
								oninput={(event) => onChange(parameter.name, event.currentTarget.value)}
								class="input input-s"
							/>
						{/if}
					</div>
				{/each}
			</FieldGroup>
		{/each}
	{/if}
</Collapsible>
