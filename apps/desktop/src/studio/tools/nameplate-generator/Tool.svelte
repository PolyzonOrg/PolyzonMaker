<script lang="ts">
	import type { ToolInfo } from '$lib/tools/registry';
	import TagTool from './TagTool.svelte';
	import * as m from '$msg/tools/nameplate-generator';
	import { NAMEPLATE_DEFAULTS, NAMEPLATE_PRESETS } from './model';

	let { tool }: { tool: ToolInfo } = $props();
</script>

<TagTool
	{tool}
	config={{
		filePrefix: m.t_nameplate_generator_filename(),
		defaults: NAMEPLATE_DEFAULTS,
		presets: NAMEPLATE_PRESETS,
		mounts: ['holes2', 'holes4', 'hole', 'loop', 'none'],
		maxLines: 3,
		adhesive: true
	}}
/>
