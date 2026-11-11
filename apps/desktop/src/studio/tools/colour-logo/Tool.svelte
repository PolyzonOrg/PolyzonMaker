<script lang="ts">
	import PictureTool from './PictureTool.svelte';
	import type { ToolInfo } from '$lib/tools/registry';

	let { tool }: { tool: ToolInfo } = $props();
</script>

<PictureTool {tool} kind="logo" />
