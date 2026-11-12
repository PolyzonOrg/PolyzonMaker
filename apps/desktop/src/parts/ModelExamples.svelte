<script lang="ts">
	// What a model really made, source by source: the picture a 3D model began from, marked as such, and
	// what was made from it beside it. Larger on a click, in the same dark viewer as a generation's
	// pictures (Lightbox), with the source picture in its corner.
	import { EXAMPLES, type Example, type Group } from '../lib/examples';
	import { lang, t } from '../lib/i18n.svelte';
	import { app } from '../lib/state.svelte';
	import Icon from './Icon.svelte';

	/** `of`: the model whose page this is; under a picture its name is said only when it is another's */
	let { groups, of }: { groups: Group[]; of: string } = $props();

	// in the order shown, for the viewer's arrows
	const shown = $derived(groups.flatMap((g) => (g.picture ? [g.picture, ...g.made] : g.made)));
	let open = $state<number | null>(null);
	const name = (id: string) => app.models.find((m) => m.id === id)?.name ?? id;
	const sourceOf = (e: Example) => EXAMPLES.find((p) => p.file === e.picture);
	const seconds = (e: Example) => {
		const time = `${Math.round(e.seconds)} ${lang.value === 'ru' ? 'с' : 's'}`;
		return e.device === 'cpu' ? t('models.exampleOnCpu', { time }) : time;
	};
	const caption = (e: Example) => (e.from ? `${t('models.exampleFrom', { picture: name(e.from), model: name(e.model) })}, ${seconds(e)}` : `${name(e.model)}, ${seconds(e)}`);
	/** Under the picture, what the page and the source beside it do not already say */
	const short = (e: Example) => {
		const said = [e.model !== of ? name(e.model) : '', e.from && !e.picture && e.from !== of ? t('models.exampleFromPicture', { picture: name(e.from) }) : '', seconds(e)];
		const text = said.filter(Boolean).join(', ');
		return text.charAt(0).toLocaleUpperCase(lang.value) + text.slice(1);
	};

	function step(by: number) {
		if (open !== null) open = Math.min(Math.max(open + by, 0), shown.length - 1);
	}

	function keys(e: KeyboardEvent) {
		if (open === null) return;
		if (e.key === 'Escape') open = null;
		else if (e.key === 'ArrowLeft') step(-1);
		else if (e.key === 'ArrowRight') step(1);
	}
</script>

<svelte:window onkeydown={keys} />

{#snippet tile(e: Example, source: boolean)}
	<figure>
		<div class="frame">
			<button class="shot" aria-label={source ? `${t('models.exampleSource')}: ${e.alt[lang.value]}` : e.alt[lang.value]} onclick={() => (open = shown.indexOf(e))}>
				<img src="/examples/{e.file}" alt={e.alt[lang.value]} loading="lazy" decoding="async" width="600" height="600" />
				{#if source}<span class="tag">{t('models.exampleSource')}</span>{/if}
			</button>
			<!-- in the gap after the source, level with the middle of its picture -->
			{#if source}<span class="to" aria-hidden="true"><Icon name="arrow" size={16} /></span>{/if}
		</div>
		<figcaption class="faint">{short(e)}</figcaption>
	</figure>
{/snippet}

<div class="groups">
	{#each groups as g (g.picture?.file ?? '')}
		{#if g.picture}
			<div class="group" class:fan={g.made.length > 1}>
				{@render tile(g.picture, true)}
				<div class="made">
					{#each g.made as e (e.file)}{@render tile(e, false)}{/each}
				</div>
			</div>
		{:else}
			<div class="rest">
				{#each g.made as e (e.file)}{@render tile(e, false)}{/each}
			</div>
		{/if}
	{/each}
</div>

{#if open !== null}
	{@const e = shown[open]}
	{@const source = sourceOf(e)}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="box" class:sourced={source} role="dialog" tabindex="-1" aria-modal="true" aria-label={e.alt[lang.value]} onclick={(ev) => ev.target === ev.currentTarget && (open = null)}>
		<img src="/examples/{e.file}" alt={e.alt[lang.value]} />
		{#if source}
			<figure class="source">
				<img src="/examples/{source.file}" alt={source.alt[lang.value]} />
				<figcaption>{t('models.exampleSource')}</figcaption>
			</figure>
		{/if}
		<button class="round close" aria-label={t('window.close')} title={t('window.close')} onclick={() => (open = null)}><Icon name="x" /></button>
		{#if shown.length > 1}
			<button class="round back" disabled={open === 0} aria-label={t('job.previous')} title={t('job.previous')} onclick={() => step(-1)}><Icon name="arrow" /></button>
			<button class="round next" disabled={open === shown.length - 1} aria-label={t('job.next')} title={t('job.next')} onclick={() => step(1)}><Icon name="arrow" /></button>
		{/if}
		<span class="count">{e.alt[lang.value]}. {e.kind === 'picture' ? `${name(e.model)}, ${seconds(e)}` : caption(e)}</span>
	</div>
{/if}

<style>
	/* a source with one result is a pair, two pairs to a row; a source with several takes the row */
	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr));
		gap: 12px;
	}

	.group {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: start;
		gap: 24px;
		padding: 8px;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
	}

	.group.fan {
		grid-column: 1 / -1;
		/* the source as large as one result: five results to the row in the page's 820 px */
		grid-template-columns: minmax(104px, 1fr) 5fr;
	}

	.made,
	.rest {
		display: grid;
		gap: 8px;
	}

	.fan .made {
		grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
	}

	.rest {
		grid-column: 1 / -1;
		grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 1fr));
		gap: 12px;
	}

	.frame {
		position: relative;
	}

	.to {
		position: absolute;
		top: 50%;
		right: -24px;
		width: 24px;
		display: grid;
		place-items: center;
		transform: translateY(-50%);
		color: var(--ink-faint);
	}

	figure {
		margin: 0;
		display: grid;
		gap: 6px;
		align-content: start;
		min-width: 0;
	}

	.shot {
		position: relative;
		display: block;
		padding: 0;
		/* 16 px of the group, less its 8 px of padding */
		border-radius: var(--r-sm);
		background: var(--surface-2);
		overflow: hidden;
		cursor: zoom-in;
	}

	.rest .shot {
		border-radius: var(--r-lg);
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

	.tag {
		position: absolute;
		left: 6px;
		top: 6px;
		padding: 2px 8px;
		border-radius: var(--r-pill);
		background: rgba(10, 10, 12, 0.72);
		color: #fff;
		font-size: 11px;
		font-weight: 600;
	}

	figcaption {
		font-size: 12px;
		overflow-wrap: anywhere;
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

	.box > img {
		max-width: calc(100vw - 48px);
		max-height: calc(100vh - 96px);
		object-fit: contain;
		border-radius: var(--r-lg);
		animation: pop 0.22s var(--ease);
		user-select: none;
	}

	/* the source in the corner never covers the result */
	.box.sourced > img {
		max-width: calc(100vw - 2 * min(22vw, 220px) - 64px);
	}

	.source {
		position: absolute;
		left: 16px;
		top: 16px;
		width: min(22vw, 220px);
		gap: 6px;
		color: rgba(255, 255, 255, 0.7);
		font-size: 12px;
	}

	.source img {
		width: 100%;
		border-radius: var(--r);
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
