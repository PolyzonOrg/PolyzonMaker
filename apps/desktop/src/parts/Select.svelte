<script lang="ts" module>
	export interface Option<V extends string = string> {
		value: V;
		label: string;
		/** A second, quieter line */
		hint?: string;
		disabled?: boolean;
	}
</script>

<script lang="ts" generics="T extends string">
	import { tick } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	let {
		value,
		options,
		label,
		onchange,
		small = false,
		icon
	}: { value: T; options: Option<T>[]; label: string; onchange: (value: T) => void; small?: boolean; icon?: IconName } = $props();

	let open = $state(false);
	let active = $state(0);
	let place = $state({ left: 0, top: 0, width: 0, up: false });
	let button = $state<HTMLButtonElement>();
	let list = $state<HTMLUListElement>();
	let typed = '';
	let typedAt = 0;

	const current = $derived(options.find((o) => o.value === value));
	const usable = (i: number) => options[i] && !options[i].disabled;

	async function show() {
		const box = button!.getBoundingClientRect();
		const room = innerHeight - box.bottom;
		place = { left: box.left, top: box.bottom + 4, width: box.width, up: room < 240 && box.top > room };
		if (place.up) place.top = innerHeight - box.top + 4;
		active = Math.max(options.findIndex((o) => o.value === value), 0);
		open = true;
		await tick();
		list?.focus();
		list?.children[active]?.scrollIntoView({ block: 'nearest' });
	}

	function hide() {
		open = false;
		button?.focus();
	}

	function choose(i: number) {
		if (!usable(i)) return;
		hide();
		if (options[i].value !== value) onchange(options[i].value);
	}

	function move(from: number, by: number) {
		for (let i = from + by; i >= 0 && i < options.length; i += by) {
			if (usable(i)) {
				active = i;
				list?.children[i]?.scrollIntoView({ block: 'nearest' });
				return;
			}
		}
	}

	function keys(e: KeyboardEvent) {
		const moves: Record<string, () => void> = {
			ArrowDown: () => move(active, 1),
			ArrowUp: () => move(active, -1),
			Home: () => move(-1, 1),
			End: () => move(options.length, -1),
			Enter: () => choose(active),
			' ': () => choose(active),
			Escape: hide,
			Tab: hide
		};
		if (moves[e.key]) {
			e.preventDefault();
			e.stopPropagation();
			moves[e.key]();
		} else if (e.key.length === 1) {
			// typing the first letters goes to that option, as in a system list
			typed = Date.now() - typedAt > 700 ? e.key : typed + e.key;
			typedAt = Date.now();
			const found = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.toLowerCase()));
			if (found >= 0) {
				active = found;
				list?.children[found]?.scrollIntoView({ block: 'nearest' });
			}
		}
	}
</script>

<svelte:window onresize={() => open && hide()} />

<button
	bind:this={button}
	type="button"
	class="input trigger"
	class:small
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-label={label}
	title={label}
	onclick={() => (open ? hide() : show())}
	onkeydown={(e) => {
		if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
			e.preventDefault();
			void show();
		}
	}}
>
	{#if icon}<Icon name={icon} size={16} />{/if}
	<span class="value">{current?.label ?? ''}</span>
	<span class="open"><Icon name="chevron" size={16} /></span>
</button>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="away" onclick={hide}></div>
	<ul
		bind:this={list}
		class="list"
		class:up={place.up}
		role="listbox"
		aria-label={label}
		tabindex="-1"
		aria-activedescendant="option-{active}"
		style:left="{place.left}px"
		style:min-width="{place.width}px"
		style:top={place.up ? '' : `${place.top}px`}
		style:bottom={place.up ? `${place.top}px` : ''}
		onkeydown={keys}
	>
		{#each options as option, i (option.value)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<li
				id="option-{i}"
				role="option"
				class:active={i === active}
				aria-selected={option.value === value}
				aria-disabled={option.disabled}
				onclick={() => choose(i)}
				onpointermove={() => usable(i) && (active = i)}
			>
				<span class="text">
					<span>{option.label}</span>
					{#if option.hint}<small>{option.hint}</small>{/if}
				</span>
				{#if option.value === value}<Icon name="check" size={16} />{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.trigger {
		display: inline-flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		text-align: left;
		cursor: pointer;
		color: var(--ink);
	}

	.trigger.small {
		height: 32px;
		border-radius: var(--r-sm);
		font-size: 13px;
	}

	.trigger :global(svg) {
		flex: none;
		color: var(--ink-faint);
	}

	.open {
		display: flex;
		transition: transform 0.12s var(--ease);
	}

	.trigger[aria-expanded='true'] .open {
		transform: rotate(180deg);
	}

	.value {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.away {
		position: fixed;
		inset: 0;
		z-index: 40;
	}

	.list {
		position: fixed;
		z-index: 41;
		max-width: 420px;
		max-height: 280px;
		overflow-y: auto;
		margin: 0;
		padding: 4px;
		list-style: none;
		border: 1px solid var(--line);
		border-radius: var(--r);
		background: var(--surface-2);
		animation: pop 0.12s var(--ease);
		transform-origin: top;
		outline: none;
	}

	.list.up {
		transform-origin: bottom;
	}

	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 32px;
		padding: 6px 10px;
		border-radius: var(--r-sm);
		cursor: pointer;
	}

	li.active {
		background: var(--surface-4);
	}

	li[aria-disabled='true'] {
		color: var(--ink-faint);
		cursor: default;
	}

	.text {
		display: grid;
		min-width: 0;
	}

	small {
		color: var(--ink-faint);
		font-size: 12px;
	}
</style>
