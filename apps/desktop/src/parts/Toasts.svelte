<script lang="ts">
	import { t } from '../lib/i18n.svelte';
	import { dismissToast, holdToasts, toasts } from '../studio/toast';
	import Icon from './Icon.svelte';
</script>

<div
	class="toasts"
	role="status"
	aria-live="polite"
	onpointerenter={() => holdToasts(true)}
	onpointerleave={() => holdToasts(false)}
	onfocusin={() => holdToasts(true)}
	onfocusout={() => holdToasts(false)}
>
	{#each $toasts as toast (toast.id)}
		<div class="toast" class:bad={toast.kind === 'error'}>
			<span>{toast.text}</span>
			{#if toast.action?.onClick}<button class="link" onclick={toast.action.onClick}>{toast.action.label}</button>{/if}
			<button class="tool" aria-label={t('window.close')} title={t('window.close')} onclick={() => dismissToast(toast.id)}><Icon name="x" size={14} /></button>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		z-index: 40;
		right: 16px;
		bottom: 16px;
		display: grid;
		justify-items: end;
		gap: 8px;
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 420px;
		padding: 4px 4px 4px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r);
		background: var(--surface-2);
		font-size: 13px;
		pointer-events: auto;
		animation: enter 0.2s var(--ease);
	}

	.toast.bad span {
		color: var(--bad);
	}
</style>
