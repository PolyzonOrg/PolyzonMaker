<script lang="ts">
	/**
	 * On this computer the fence leaves the network open (fence.rs): what that means, and the person's
	 * choice to run the plugin's program anyway. A new version of the plugin asks again.
	 */
	import { core } from '../lib/core';
	import { t } from '../lib/i18n.svelte';
	import { pluginsChanged } from '../lib/state.svelte';
	import Icon from './Icon.svelte';

	let { plugin, then }: { plugin: string; then: () => void } = $props();
	let busy = $state(false);

	async function allow() {
		busy = true;
		try {
			await pluginsChanged(await core.allowPluginNetwork(plugin, true));
			then();
		} finally {
			busy = false;
		}
	}
</script>

<div class="note warn fence">
	<p>{t('fence.open')}</p>
	<button class="btn small" disabled={busy} onclick={allow}><Icon name="play" size={14} />{t('fence.allow')}</button>
</div>

<style>
	.fence {
		display: grid;
		justify-items: start;
		gap: 8px;
	}

	p {
		margin: 0;
	}
</style>
