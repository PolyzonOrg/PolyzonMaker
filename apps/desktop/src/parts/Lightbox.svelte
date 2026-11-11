<script lang="ts">
	import { fileUrl } from '../lib/core';
	import { t } from '../lib/i18n.svelte';
	import { app, go } from '../lib/state.svelte';
	import Icon from './Icon.svelte';

	let { ids, current, onclose }: { ids: string[]; current: string; onclose: () => void } = $props();

	const at = $derived(Math.max(ids.indexOf(current), 0));
	/** The list holds small copies: the picture itself comes from its folder. */
	let full = $state('');

	$effect(() => {
		let url = '';
		let gone = false;
		full = '';
		fileUrl(ids[at], 'picture.png', 'image/png').then(
			(made) => {
				if (gone) return URL.revokeObjectURL(made);
				full = url = made;
			},
			() => {}
		);
		return () => {
			gone = true;
			if (url) URL.revokeObjectURL(url);
		};
	});

	function step(by: number) {
		const next = ids[at + by];
		if (next) go('result', next);
	}

	function keys(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
		else if (e.key === 'ArrowLeft') step(-1);
		else if (e.key === 'ArrowRight') step(1);
	}
</script>

<svelte:window onkeydown={keys} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="box" role="dialog" tabindex="-1" aria-modal="true" aria-label={t('job.full')} onclick={(e) => e.target === e.currentTarget && onclose()}>
	<img src={full || app.thumbs[ids[at]]} alt="" />
	<button class="round close" aria-label={t('window.close')} title={t('window.close')} onclick={onclose}><Icon name="x" /></button>
	{#if ids.length > 1}
		<button class="round back" disabled={at === 0} aria-label={t('job.previous')} title={t('job.previous')} onclick={() => step(-1)}>
			<Icon name="arrow" />
		</button>
		<button class="round next" disabled={at === ids.length - 1} aria-label={t('job.next')} title={t('job.next')} onclick={() => step(1)}>
			<Icon name="arrow" />
		</button>
		<span class="count">{at + 1} / {ids.length}</span>
	{/if}
</div>

<style>
	.box {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(10, 10, 12, 0.94);
		animation: fade-in 0.18s ease-out;
	}

	img {
		max-width: calc(100vw - 48px);
		max-height: calc(100vh - 48px);
		object-fit: contain;
		border-radius: var(--r-lg);
		animation: pop 0.22s var(--ease);
		user-select: none;
	}

	.round {
		position: absolute;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
		transition: background 0.12s;
	}

	.round:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.22);
	}

	.round:disabled {
		opacity: 0.3;
	}

	.close {
		top: 16px;
		right: 16px;
	}

	.back,
	.next {
		top: 50%;
		margin-top: -22px;
	}

	.back {
		left: 16px;
		transform: scaleX(-1);
	}

	.next {
		right: 16px;
	}

	.count {
		position: absolute;
		bottom: 16px;
		color: rgba(255, 255, 255, 0.7);
		font-size: 13px;
	}
</style>
