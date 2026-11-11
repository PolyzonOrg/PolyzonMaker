<script lang="ts">
	import { t, type Key } from '../lib/i18n.svelte';
	import { ACTIONS, clash, comboOf, shown, type Scope } from '../lib/keys';
	import { app, setKeys } from '../lib/state.svelte';
	import Dialog from './Dialog.svelte';

	const { onclose }: { onclose: () => void } = $props();

	const mac = /Mac/.test(navigator.platform);
	const SCOPES: Scope[] = ['app', 'cad', 'result'];
	let changing = $state('');
	let taken = $state('');

	function capture(e: KeyboardEvent) {
		if (!changing) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape') return void (changing = '');
		const combo = comboOf(e);
		if (!combo) return;
		const other = clash(changing, combo, app.keys);
		if (other) return void (taken = t('keys.taken', { name: t(`keys.${other.id}` as Key) }));
		setKeys({ ...app.keys, [changing]: combo });
		changing = '';
		taken = '';
	}
</script>

<svelte:window onkeydowncapture={capture} />

<Dialog title={t('keys.title')} {onclose}>
	{#if taken}<p class="note warn">{taken}</p>{/if}
	<div class="sheet">
		{#each SCOPES as scope (scope)}
			<h3>{t(`keys.scope.${scope}`)}</h3>
			{#each ACTIONS.filter((a) => a.scope === scope) as action (action.id)}
				<div class="row">
					<span>{t(`keys.${action.id}` as Key)}</span>
					<button class="btn small ghost" class:on={changing === action.id} onclick={() => ((changing = action.id), (taken = ''))}>
						{changing === action.id ? t('keys.press') : shown(app.keys[action.id] ?? action.keys, mac)}
					</button>
				</div>
			{/each}
		{/each}
	</div>
	<div class="row-end">
		<button class="btn ghost" disabled={!Object.keys(app.keys).length} onclick={() => setKeys({})}>{t('keys.reset')}</button>
		<button class="btn primary" onclick={onclose}>{t('keys.done')}</button>
	</div>
</Dialog>

<style>
	.sheet {
		max-height: 60vh;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
	}

	h3 {
		margin: 8px 0 4px;
		font-size: 13px;
		font-weight: 600;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
	}

	.on {
		background: var(--button-hover);
	}
</style>
