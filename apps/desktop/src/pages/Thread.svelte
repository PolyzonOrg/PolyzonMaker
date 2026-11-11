<script lang="ts">
	import { app } from '../lib/state.svelte';
	import { threadWith } from '../lib/threads';
	import Lightbox from '../parts/Lightbox.svelte';
	import Strip from '../parts/Strip.svelte';
	import Result from './Result.svelte';

	let { id }: { id: string } = $props();

	const thread = $derived(threadWith(app.jobs, id));
	const pictures = $derived(thread?.jobs.filter((j) => j.kind === 'picture' && j.state === 'succeeded').map((j) => j.id) ?? []);
	// up here and not on the page of one picture: it stays open while the arrows go through the variants
	let full = $state(false);
</script>

<div class="thread">
	{#if thread && thread.jobs.length > 1}<Strip jobs={thread.jobs} current={id} />{/if}
	<div class="one">
		{#key id}<Result {id} onfull={() => (full = true)} />{/key}
	</div>
</div>

{#if full && app.thumbs[id]}
	<Lightbox ids={pictures} current={id} onclose={() => (full = false)} />
{/if}

<style>
	.thread {
		height: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}

	.one {
		grid-row: 2;
		min-height: 0;
	}
</style>
