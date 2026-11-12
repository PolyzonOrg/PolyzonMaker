<script lang="ts">
	// A README drawn from parsed blocks: every element is made here, nothing from the README itself runs or loads.
	import { core } from '../lib/core';
	import type { Block, Inline } from '../lib/markdown';

	let { blocks }: { blocks: Block[] } = $props();
</script>

{#snippet words(inl: Inline[])}
	{#each inl as part, i (i)}
		{#if part.t === 'b'}<strong>{part.v}</strong>{:else if part.t === 'code'}<code>{part.v}</code>{:else if part.t === 'link'}<button class="link" title={part.href} onclick={() => core.openUrl(part.href)}>{part.v}</button>{:else}{part.v}{/if}
	{/each}
{/snippet}

<div class="md selectable">
	{#each blocks as b, i (i)}
		{#if b.t === 'h'}
			<p class="h h{Math.min(b.level, 3)}">{@render words(b.inl)}</p>
		{:else if b.t === 'p'}
			<p>{@render words(b.inl)}</p>
		{:else if b.t === 'quote'}
			<blockquote>{@render words(b.inl)}</blockquote>
		{:else if b.t === 'ul' || b.t === 'ol'}
			<svelte:element this={b.t}>
				{#each b.items as item, j (j)}<li>{@render words(item)}</li>{/each}
			</svelte:element>
		{:else if b.t === 'code'}
			<pre class="code">{b.v}</pre>
		{:else}
			<hr />
		{/if}
	{/each}
</div>

<style>
	.md {
		display: grid;
		gap: 10px;
		max-width: 72ch;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}

	p,
	ul,
	ol,
	blockquote,
	pre {
		margin: 0;
	}

	ul,
	ol {
		padding-left: 22px;
		display: grid;
		gap: 4px;
	}

	.h {
		font-weight: 600;
		margin-top: 6px;
	}

	.h1 {
		font-size: 20px;
	}

	.h2 {
		font-size: 18px;
	}

	.h3 {
		font-size: 14px;
	}

	blockquote {
		color: var(--ink-muted);
		padding-left: 12px;
		border-left: 2px solid var(--line);
	}

	code {
		padding: 1px 5px;
		border-radius: 6px;
		background: var(--surface-3);
		font: 13px ui-monospace, Consolas, Menlo, monospace;
	}

	pre {
		white-space: pre-wrap;
		max-height: 320px;
		overflow: auto;
	}

	hr {
		width: 100%;
		border: 0;
		border-top: 1px solid var(--line);
	}

	.link {
		display: inline;
	}
</style>
