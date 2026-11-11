<script lang="ts" module>
	// the search stays when the person comes back from a tool
	let query = $state('');
</script>

<script lang="ts">
	import { t } from '../lib/i18n.svelte';
	import { go } from '../lib/state.svelte';
	import Icon from '../parts/Icon.svelte';
	import FavoriteButton from '../studio/components/tools/FavoriteButton.svelte';
	import { findTools } from '../studio/tools/catalog-search';
	import { TOOL_CATEGORIES, TOOLS, toolBySlug, type ToolInfo } from '../studio/tools/registry';

	const sections = TOOL_CATEGORIES.map((c) => ({ ...c, tools: TOOLS.filter((tool) => tool.category === c.id) }));
	const found = $derived(query.trim() ? findTools(query).hits.map((h) => toolBySlug(h.slug)).filter((tool): tool is ToolInfo => !!tool) : null);
</script>

{#snippet cards(tools: readonly ToolInfo[])}
	<div class="cards">
		{#each tools as tool (tool.slug)}
			<div class="tile">
				<button class="item" data-slug={tool.slug} onclick={() => go('tool', tool.slug)}>
					<span class="mark"><tool.icon size={18} aria-hidden="true" /></span>
					<span class="words">
						<strong>{tool.title}</strong>
						<small>{tool.description}</small>
					</span>
				</button>
				<FavoriteButton slug={tool.slug} />
			</div>
		{/each}
	</div>
{/snippet}

<div class="page">
	<h1>{t('tools.title')}</h1>
	<p class="muted lead">{t('tools.text')}</p>
	<label class="find">
		<Icon name="search" size={16} />
		<input class="input" type="search" placeholder={t('tools.search')} aria-label={t('tools.search')} bind:value={query} />
	</label>

	{#if found}
		{#if found.length}{@render cards(found)}{:else}<p class="faint">{t('tools.none')}</p>{/if}
	{:else}
		{#each sections as section (section.id)}
			<section>
				<h2>{section.title}</h2>
				<p class="faint">{section.lead}</p>
				{@render cards(section.tools)}
			</section>
		{/each}
	{/if}
</div>

<style>
	.lead {
		margin: 4px 0 16px;
	}

	.find {
		position: relative;
		display: block;
		max-width: 420px;
		margin-bottom: 24px;
		color: var(--ink-faint);
	}

	.find :global(svg) {
		position: absolute;
		top: 50%;
		left: 12px;
		transform: translateY(-50%);
	}

	.find input {
		width: 100%;
		padding-left: 36px;
	}

	section + section {
		margin-top: 28px;
	}

	h2 {
		margin: 0 0 2px;
		font-size: 17px;
		font-weight: 600;
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 10px;
		margin-top: 12px;
	}

	.tile {
		position: relative;
		display: grid;
	}

	/* in sight while pinned, otherwise with the pointer or the keyboard on the card */
	.tile :global(.pin) {
		position: absolute;
		top: 8px;
		right: 8px;
		opacity: 0;
		transition:
			opacity 0.12s var(--ease),
			background 0.12s,
			color 0.12s;
	}

	.tile:hover :global(.pin),
	.tile:focus-within :global(.pin),
	.tile :global(.pin.on) {
		opacity: 1;
	}

	.tile :global(.pin:hover) {
		background: var(--surface-4);
	}

	.item {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 44px 12px 14px;
		text-align: left;
		border: 0;
		border-radius: var(--r-lg);
		background: var(--surface-2);
		cursor: pointer;
		transition: background 0.12s var(--ease);
	}

	.tile:hover .item {
		background: var(--surface-3);
	}

	.mark {
		flex: none;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--r-sm);
		background: var(--surface-4);
	}

	.words {
		min-width: 0;
		display: grid;
		gap: 2px;
	}

	strong {
		font-weight: 500;
	}

	small {
		font-size: 12px;
		line-height: 1.35;
		color: var(--ink-faint);
	}
</style>
