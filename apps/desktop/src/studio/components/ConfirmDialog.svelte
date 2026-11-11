<script lang="ts">
	/**
	 * Destructive confirmation (DESIGN_CODE §7, §13): the dialog names the
	 * object and the consequence, the confirm button repeats the verb + object
	 * («Удалить модель»), never a bare «OK»/«Да». Built on <Dialog>, so focus
	 * trap, Escape and focus return come for free.
	 */
	import type { Snippet } from 'svelte';
	import { Loader2 } from 'lucide-svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import * as m from '$msg/common';

	interface Props {
		open?: boolean;
		title: string;
		/** Consequence in plain words, e.g. «Файлы будут удалены без возможности восстановления». */
		description?: string;
		confirmLabel: string;
		cancelLabel?: string;
		/** `danger` only to confirm a delete (DESIGN_CODE §7.4). */
		variant?: 'danger' | 'primary';
		busy?: boolean;
		onConfirm: () => void;
		/** The cancel button itself: Escape and the backdrop only close the dialog. */
		onCancel?: () => void;
		children?: Snippet;
	}

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel,
		cancelLabel = m.common_cancel(),
		variant = 'primary',
		busy = false,
		onConfirm,
		onCancel,
		children
	}: Props = $props();
</script>

<Dialog bind:open {title} size="sm" dismissible={!busy}>
	{#if description}<p class="confirm-text">{description}</p>{/if}
	{@render children?.()}
	{#snippet footer()}
		<button
			type="button"
			class="btn-ghost"
			data-autofocus
			onclick={() => {
				open = false;
				onCancel?.();
			}}
			disabled={busy}
		>
			{cancelLabel}
		</button>
		<button
			type="button"
			class={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
			disabled={busy}
			onclick={onConfirm}
		>
			{#if busy}<Loader2 size={16} class="animate-spin" aria-hidden="true" />{/if}
			{confirmLabel}
		</button>
	{/snippet}
</Dialog>

<style>
	.confirm-text {
		margin: 0;
		color: var(--pz-color-text-secondary);
		font-size: var(--pz-text-sm);
		line-height: 1.25rem;
		/* Descriptions quote user titles («Удалить «…»?»): an unbroken one ran
		   out of the dialog instead of wrapping. */
		overflow-wrap: anywhere;
	}
</style>
