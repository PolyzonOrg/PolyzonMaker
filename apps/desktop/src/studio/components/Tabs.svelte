<script lang="ts">
	import type { Icon as LucideIcon } from 'lucide-svelte';

	interface TabItem {
		value: string;
		label: string;
		/** A Lucide icon before the label, 16px (DESIGN_CODE §8). */
		icon?: typeof LucideIcon;
	}

	let {
		id,
		items,
		value = $bindable(),
		label,
		panelId,
		onChange
	}: {
		id: string;
		items: TabItem[];
		value: string;
		label: string;
		/** One panel whose content follows the tab (instead of a panel per tab). */
		panelId?: string;
		onChange?: (value: string) => void;
	} = $props();

	function select(next: string) {
		value = next;
		onChange?.(next);
	}

	function onKeydown(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		const buttons = [
			...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')
		];
		const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (current < 0) return;
		event.preventDefault();
		let index = current;
		if (event.key === 'Home') index = 0;
		else if (event.key === 'End') index = buttons.length - 1;
		else
			index = (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
		buttons[index].focus();
		buttons[index].click();
	}
</script>

<div class="tabs" role="tablist" aria-label={label} tabindex="-1" onkeydown={onKeydown}>
	{#each items as item (item.value)}
		<button
			type="button"
			id={`${id}-tab-${item.value}`}
			role="tab"
			aria-selected={value === item.value}
			aria-controls={panelId ?? `${id}-panel-${item.value}`}
			tabindex={value === item.value ? 0 : -1}
			onclick={() => select(item.value)}
		>
			{#if item.icon}<item.icon size={16} aria-hidden="true" />{/if}
			{item.label}
		</button>
	{/each}
</div>

<style>
	/* Segmented control (DESIGN_CODE §7), polyzon.org's theme switch: a grey
	   track, the selected segment is a raised thumb. No borders. */
	.tabs {
		display: flex;
		/* A segment that does not fit moves to a second row instead of being cut off. */
		flex-wrap: wrap;
		gap: 2px;
		padding: 2px;
		border-radius: var(--pz-radius-control);
		background: var(--pz-color-subtle);
	}
	button {
		min-height: 38px;
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--pz-space-2);
		min-width: max-content;
		padding-inline: var(--pz-space-3);
		border-radius: var(--pz-radius-sm);
		color: var(--pz-color-text-muted);
		background: transparent;
		font-size: var(--pz-text-sm);
		font-weight: 500;
		transition:
			color var(--pz-duration-fast) var(--pz-ease-standard),
			background-color var(--pz-duration-fast) var(--pz-ease-standard);
	}
	button:active {
		color: var(--pz-color-text);
	}
	@media (hover: hover) {
		button:hover {
			color: var(--pz-color-text);
		}
	}
	button[aria-selected='true'] {
		color: var(--pz-color-text);
		background: var(--pz-color-thumb);
		box-shadow: var(--pz-shadow-xs);
	}
	@media (max-width: 639px), (pointer: coarse) {
		button {
			min-height: 44px;
		}
	}
	@media (max-width: 639px) {
		button {
			padding-inline: var(--pz-space-2);
		}
	}
</style>
