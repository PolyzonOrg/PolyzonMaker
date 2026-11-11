<script lang="ts">
	// What the assistant does this moment, how long it has, and for a generation how far it is.
	import { onDestroy } from 'svelte';
	import { t, type Key } from '../lib/i18n.svelte';
	import { app, go, jobShare, modelName } from '../lib/state.svelte';
	import { chat } from './chat.svelte';

	let now = $state(Date.now());
	const tick = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(tick));

	const status = $derived(chat.status);
	const job = $derived(status && 'job' in status ? app.jobs.find((j) => j.id === status.job) : undefined);
	const label = $derived.by(() => {
		if (!status) return '';
		const key = 'kind' in status ? `chat.stage.${status.stage}.${status.kind}` : `chat.stage.${status.stage}`;
		return t(key as Key);
	});
	const detail = $derived.by(() => {
		if (!status || !('model' in status)) return '';
		const step = job && (job.state === 'queued' ? t('job.queued') : job.stage ? t(`job.${job.stage}` as Key) : '');
		return [modelName(status.model), 'preset' in status && status.preset && t('chat.detail', { preset: status.preset }), step].filter(Boolean).join(' · ');
	});
	const share = $derived(job ? jobShare(job, now) : 0);
	const clock = $derived.by(() => {
		const s = status ? Math.max(Math.floor((now - status.since) / 1000), 0) : 0;
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});
	const elsewhere = $derived(!!job && (app.page !== 'result' || app.jobId !== job.id));
</script>

{#if status}
	<div class="status" role="status">
		<span class="alive" aria-hidden="true"></span>
		<div class="what">
			<p class="head"><strong>{label}</strong><span class="faint clock">{clock}</span></p>
			{#if detail}<p class="faint">{detail}</p>{/if}
			{#if job}
				<div class="bar" class:unknown={!share}><i style:width={share ? `${Math.round(share * 100)}%` : ''}></i></div>
				{#if elsewhere}<button class="link" onclick={() => go('result', job.id)}>{t('chat.show')}</button>{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.status {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r);
		font-size: 13px;
	}

	/* alive for as long as it works, whatever it is doing */
	.alive {
		flex: none;
		width: 8px;
		height: 8px;
		margin-top: 5px;
		border-radius: 50%;
		background: var(--good);
		animation: alive 1.4s ease-in-out infinite;
	}

	@keyframes alive {
		50% {
			opacity: 0.25;
			transform: scale(0.75);
		}
	}

	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.what p {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.clock {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}

	.link {
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
</style>
