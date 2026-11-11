<script lang="ts">
	import type { Snippet } from 'svelte';
	import { splitRich } from '$lib/i18n/rich';

	// A translated sentence with markup insertions ($lib/i18n/rich): the text comes from a
	// message with ⟦name⟧ markers, the insertions are snippet props of the same names.
	// ⟦item0⟧…⟦itemN⟧ from listSlots render the `item` snippet with the element's index.
	let { text, ...parts }: { text: string } & Record<string, unknown> = $props();

	const pieces = $derived(splitRich(text));
	const indexed = (name: string): [Snippet<[number]>, number] | null => {
		const match = /^(\D+)(\d+)$/u.exec(name);
		const snippet = match ? parts[match[1]] : undefined;
		return typeof snippet === 'function' ? [snippet as Snippet<[number]>, Number(match![2])] : null;
	};
</script>

{#each pieces as piece, i (i)}{#if i % 2 === 0}{piece}{:else if typeof parts[piece] === 'function'}{@render (
			parts[piece] as Snippet
		)()}{:else if indexed(piece)}{@const [snippet, n] = indexed(piece)!}{@render snippet(
			n
		)}{/if}{/each}
