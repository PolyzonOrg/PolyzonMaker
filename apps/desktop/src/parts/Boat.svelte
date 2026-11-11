<script lang="ts">
	let { size = 28 }: { size?: number } = $props();
</script>

<span class="boat" style="width:{size}px;height:{(size * 1087) / 1029}px" role="img" aria-label="Polyzon Maker"></span>

<style>
	.boat {
		display: inline-block;
		background: var(--ink);
		mask: url('/boat.svg') center / contain no-repeat;
		-webkit-mask: url('/boat.svg') center / contain no-repeat;
	}
</style>
