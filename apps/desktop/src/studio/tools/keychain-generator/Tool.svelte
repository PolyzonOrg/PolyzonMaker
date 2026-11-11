<script lang="ts">
	import type { ToolInfo } from '$lib/tools/registry';
	import TagTool from '../nameplate-generator/TagTool.svelte';
	import * as m from '$msg/tools/keychain-generator';
	import { KEYCHAIN_DEFAULTS, KEYCHAIN_PRESETS } from './model';

	let { tool }: { tool: ToolInfo } = $props();
</script>

<TagTool
	{tool}
	config={{
		filePrefix: m.t_keychain_generator_filename(),
		defaults: KEYCHAIN_DEFAULTS,
		presets: KEYCHAIN_PRESETS,
		mounts: ['loop', 'hole', 'none'],
		maxLines: 2,
		adhesive: false
	}}
/>
