<script lang="ts">
	import PictureTool from '../colour-logo/PictureTool.svelte';
	import type { ToolInfo } from '$lib/tools/registry';

	let { tool }: { tool: ToolInfo } = $props();
</script>

<PictureTool {tool} kind="mosaic" />
