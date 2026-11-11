<script lang="ts">
	/**
	 * Page layout for print tools without a 3D scene (calculator, spools):
	 * the studio page (DESIGN_CODE §5) with the tool's back arrow and title,
	 * as in the tool pane head. The page's one primary action goes on the right.
	 */
	import type { Snippet } from 'svelte';
	import { ArrowLeft } from 'lucide-svelte';
	import type { ToolInfo } from '$lib/tools/registry';
	import InAppNotice from '$lib/components/tools/InAppNotice.svelte';
	import FavoriteButton from '$lib/components/tools/FavoriteButton.svelte';
	import * as tc from '$msg/tools/common';

	let {
		tool,
		lead,
		wide = false,
		action,
		children
	}: {
		tool: ToolInfo;
		lead: string;
		wide?: boolean;
		action?: Snippet;
		children: Snippet;
	} = $props();
</script>

<svelte:head><title>{tool.title} · Polyzon Maker</title></svelte:head>

<div class="studio h-full overflow-y-auto">
	<div class="page" class:page-wide={wide}>
		<header class="page-head">
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<a
						href="/workspace/tools"
						class="icon-btn -ml-2"
						aria-label={tc.tc_all_tools()}
						title={tc.tc_all_tools()}
					>
						<ArrowLeft size={20} aria-hidden="true" />
					</a>
					<h1 class="page-title min-w-0">{tool.title}</h1>
					<FavoriteButton slug={tool.slug} title={tool.title} size={20} />
				</div>
				<p class="page-lead">{lead}</p>
			</div>
			{#if action}{@render action()}{/if}
		</header>
		<InAppNotice />
		{@render children()}
	</div>
</div>
