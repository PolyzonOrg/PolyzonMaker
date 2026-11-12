<script lang="ts">
	// What a model really made: renders of its models after print preparation, larger on a click,
	// in the same dark viewer as a generation's pictures (Lightbox).
	import type { Example } from '../lib/examples';
	import { lang, t } from '../lib/i18n.svelte';
	import { app } from '../lib/state.svelte';
	import Icon from './Icon.svelte';

	let { examples }: { examples: Example[] } = $props();

	let open = $state<number | null>(null);
	const name = (id: string) => app.models.find((m) => m.id === id)?.name ?? id;
	const seconds = (e: Example) => `${Math.round(e.seconds)} ${lang.value === 'ru' ? 'с' : 's'}`;
	const caption = (e: Example) => (e.from ? `${t('models.exampleFrom', { picture: name(e.from), model: name(e.model) })}, ${seconds(e)}` : `${name(e.model)}, ${seconds(e)}`);

	function step(by: number) {
		if (open !== null) open = Math.min(Math.max(open + by, 0), examples.length - 1);
	}

	function keys(e: KeyboardEvent) {
		if (open === null) return;
		if (e.key === 'Escape') open = null;
		else if (e.key === 'ArrowLeft') step(-1);
		else if (e.key === 'ArrowRight') step(1);
	}
</script>

<svelte:window onkeydown={keys} />

<div class="grid">
	{#each examples as e, i (e.file)}
		<figure>
			<button class="shot" aria-label={e.alt[lang.value]} onclick={() => (open = i)}>
				<img src="/examples/{e.file}" alt={e.alt[lang.value]} loading="lazy" decoding="async" width="600" height="600" />
			</button>
			<figcaption class="faint">{caption(e)}</figcaption>
		</figure>
	{/each}
</div>

{#if open !== null}
	{@const e = examples[open]}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="box" role="dialog" tabindex="-1" aria-modal="true" aria-label={e.alt[lang.value]} onclick={(ev) => ev.target === ev.currentTarget && (open = null)}>
		<img src="/examples/{e.file}" alt={e.alt[lang.value]} />
		<button class="round close" aria-label={t('window.close')} title={t('window.close')} onclick={() => (open = null)}><Icon name="x" /></button>
		{#if examples.length > 1}
			<button class="round back" disabled={open === 0} aria-label={t('job.previous')} title={t('job.previous')} onclick={() => step(-1)}><Icon name="arrow" /></button>
			<button class="round next" disabled={open === examples.length - 1} aria-label={t('job.next')} title={t('job.next')} onclick={() => step(1)}><Icon name="arrow" /></button>
		{/if}
		<span class="count">{e.alt[lang.value]}. {caption(e)}</span>
	</div>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
		gap: 12px;
	}

	figure {
		margin: 0;
		display: grid;
		gap: 6px;
		align-content: start;
	}

	.shot {
		display: block;
		padding: 0;
		border-radius: var(--r-lg);
		background: var(--surface-2);
		overflow: hidden;
		cursor: zoom-in;
	}

	.shot img {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 1;
		object-fit: cover;
		transition: transform 0.2s var(--ease);
	}

	.shot:hover img {
		transform: scale(1.03);
	}

	figcaption {
		font-size: 12px;
	}

	/* the viewer: as Lightbox.svelte draws a generation's picture */
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

	.box img {
		max-width: calc(100vw - 48px);
		max-height: calc(100vh - 96px);
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
		left: 16px;
		right: 16px;
		text-align: center;
		color: rgba(255, 255, 255, 0.7);
		font-size: 13px;
	}
</style>
