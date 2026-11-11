<script lang="ts">
	/**
	 * The versions of one generation, as a bar across the top of its page: the pictures, then the models made
	 * from them, each kind under its word and counted in it. The one on the page is ringed; one being made shows
	 * how far along it is. Arrows, Home and End move along the bar.
	 */
	import { tick } from 'svelte';
	import type { Job } from '../lib/core';
	import { t, type Key } from '../lib/i18n.svelte';
	import { app, go, jobShare, loadThumb } from '../lib/state.svelte';
	import { isWorking, stepped, versions } from '../lib/threads';
	import Icon from './Icon.svelte';

	let { jobs, current }: { jobs: Job[]; current: string } = $props();

	const groups = $derived(versions(jobs));
	const order = $derived(groups.flatMap((group) => group.jobs.map((job) => job.id)));
	const STOPPED: Partial<Record<Job['state'], Key>> = { failed: 'job.failed', cancelled: 'job.cancelled', interrupted: 'job.interrupted' };

	let bar = $state<HTMLElement>();
	let now = $state(Date.now());

	$effect(() => jobs.forEach(loadThumb));

	// a clock for the progress of what is being made, only while something is
	$effect(() => {
		if (!jobs.some(isWorking)) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	// the version on the page stays in sight, and keeps the focus the arrows gave it
	$effect(() => {
		void current;
		void tick().then(() => {
			const shown = bar?.querySelector<HTMLElement>('[aria-current]');
			shown?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			if (bar?.contains(document.activeElement)) shown?.focus();
		});
	});

	// a wheel that only turns up and down still goes along the bar
	$effect(() => {
		const along = (e: WheelEvent) => {
			if (!bar || e.deltaX || !e.deltaY || bar.scrollWidth <= bar.clientWidth) return;
			bar.scrollLeft += e.deltaY;
			e.preventDefault();
		};
		bar?.addEventListener('wheel', along, { passive: false });
		return () => bar?.removeEventListener('wheel', along);
	});

	function step(e: KeyboardEvent) {
		const to = stepped(order, current, e.key);
		if (!to) return;
		e.preventDefault();
		go('result', to);
	}

	function named(job: Job, n: number) {
		const name = t(job.kind === 'model' ? 'job.versionModel' : 'job.versionPicture', { n });
		const stopped = STOPPED[job.state];
		return stopped ? `${name} · ${t(stopped)}` : name;
	}
</script>

<nav class="strip" aria-label={t('job.versions')} bind:this={bar}>
	{#each groups as group, g (group.kind)}
		{#if g}<span class="then" aria-hidden="true"><Icon name="arrow" size={16} /></span>{/if}
		<div class="group" role="group" aria-label={t(group.kind === 'model' ? 'job.models' : 'job.pictures')}>
			<span class="label" aria-hidden="true">{t(group.kind === 'model' ? 'job.models' : 'job.pictures')}</span>
			{#each group.jobs as job, i (job.id)}
				{@const share = isWorking(job) ? jobShare(job, now) : 0}
				<button
					class="shot"
					class:stopped={!!STOPPED[job.state]}
					style:--i={order.indexOf(job.id)}
					aria-current={job.id === current ? 'true' : undefined}
					aria-label={named(job, i + 1)}
					title={named(job, i + 1)}
					onclick={() => go('result', job.id)}
					onkeydown={step}
				>
					{#if app.thumbs[job.id]}<img src={app.thumbs[job.id]} alt="" />{/if}
					{#if STOPPED[job.state]}
						<span class="mark"><Icon name="x" size={18} /></span>
					{:else if !app.thumbs[job.id]}
						<Icon name={job.kind === 'model' ? 'cube' : 'image'} size={18} />
					{/if}
					{#if isWorking(job)}
						<span class="bar" class:unknown={!share}><i style:width={share ? `${share * 100}%` : undefined}></i></span>
					{/if}
				</button>
			{/each}
		</div>
	{/each}
</nav>

<style>
	/* a bar of the work area: its colour, told apart from the page by a line */
	.strip {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 16px;
		overflow-x: auto;
		scrollbar-width: thin;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}

	.group {
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.label {
		margin-right: 4px;
		font-size: 12px;
		color: var(--ink-faint);
		white-space: nowrap;
	}

	.then {
		flex: none;
		display: grid;
		color: var(--ink-faint);
	}

	/* no room for the words: the tiles and their tooltips say it */
	@container (max-width: 520px) {
		.label {
			display: none;
		}
	}

	.shot {
		position: relative;
		flex: none;
		width: 48px;
		height: 48px;
		display: grid;
		place-items: center;
		border-radius: var(--r-sm);
		background: var(--surface-3);
		color: var(--ink-muted);
		overflow: hidden;
		outline: 2px solid transparent;
		outline-offset: 2px;
		animation: pop 0.22s var(--ease) backwards;
		animation-delay: calc(var(--i) * 30ms);
		transition: outline-color 0.12s;
	}

	.shot:hover {
		outline-color: var(--line);
	}

	.shot[aria-current] {
		outline-color: var(--ink);
	}

	.shot.stopped {
		color: var(--bad);
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* what it started from stays faintly in sight under the cross */
	.stopped img {
		opacity: 0.35;
	}

	.mark {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}

	.shot .bar {
		position: absolute;
		left: 6px;
		right: 6px;
		bottom: 6px;
		height: 4px;
		background: var(--surface-4);
	}
</style>
