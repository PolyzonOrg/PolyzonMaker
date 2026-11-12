<script lang="ts">
	import { fit, formatRange, recommend } from '../lib/catalog';
	import { core } from '../lib/core';
	import { queue, readyBy } from '../lib/queue';
	import { showToast } from '../studio/toast';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { problem } from '../lib/problem';
	import { app, benchOf, choose, chooseModelsFolder, go, hasRoom, installModel, installing, isInstalled, pick3d, pickPicture, pictureModels, setAfter, startModel, startPictures } from '../lib/state.svelte';
	import Boat from '../parts/Boat.svelte';
	import Icon, { type IconName } from '../parts/Icon.svelte';
	import Select from '../parts/Select.svelte';

	const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
	const MAX_BYTES = 64 << 20;
	const OTHER = '__other';
	const IDEAS: { icon: IconName; label: Key; text: Key }[] = [
		{ icon: 'sparkles', label: 'idea.figure', text: 'idea.figureText' },
		{ icon: 'cube', label: 'idea.miniature', text: 'idea.miniatureText' },
		{ icon: 'image', label: 'idea.toy', text: 'idea.toyText' },
		{ icon: 'grid', label: 'idea.decor', text: 'idea.decorText' }
	];

	const file = $derived(app.draft.file);
	const prompt = $derived(app.draft.prompt);
	let preview = $state('');
	let error = $state('');
	let busy = $state(false);
	/** Why another folder for the models could not be taken */
	let folderProblem = $state<Key | ''>('');
	let picker = $state<HTMLInputElement>();
	let field = $state<HTMLTextAreaElement>();
	let preset = $state('512');
	let variants = $state(1);

	const models3d = $derived(app.models.filter((m) => m.kind === '3d' && isInstalled(m.id)));
	const pictures = $derived(pictureModels());
	const model = $derived(pick3d());
	const pictureModel = $derived(pickPicture());
	const presetOf = $derived(model?.presets.find((p) => p.id === preset));
	// models differ in the detail they offer
	$effect(() => {
		if (model?.presets.length && !presetOf) preset = model.presets[0].id;
	});
	const estimate = $derived(model ? fit(model, app.hw!, benchOf(), presetOf) : null);
	/** The time left moves on by itself; half a minute is fine enough for minutes and hours */
	let now = $state(Date.now());
	$effect(() => {
		const tick = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(tick);
	});
	const line = $derived(queue(app.jobs, app.models, app.hw!, benchOf(), now));
	const ahead = $derived(line.places.filter((p) => p.running).length);
	const nameOf = (id: string) => app.models.find((m) => m.id === id)?.name ?? id;
	const suggestion = $derived(recommend(app.models, app.hw!, benchOf()));
	const words = $derived(!file && !!prompt.trim());

	const options = (list: { id: string; name: string }[]) => [
		...list.map((m) => ({ value: m.id, label: m.name })),
		{ value: OTHER, label: t('create.otherModels') }
	];

	function pick(kind: keyof typeof app.chosen, id: string) {
		if (id === OTHER) go('models');
		else choose(kind, id);
	}

	/** The other photos, for a model that works from several. */
	let more = $state<File[]>([]);

	function take(f: File | undefined | null) {
		error = '';
		if (!f) return;
		if (!TYPES.includes(f.type)) return void (error = t('create.notImage'));
		if (f.size > MAX_BYTES) return void (error = t('create.tooLarge'));
		if (model?.photos && file) more.push(f);
		else app.draft.file = f;
	}

	$effect(() => {
		if (!file) return;
		const url = URL.createObjectURL(file);
		preview = url;
		return () => URL.revokeObjectURL(url);
	});

	// a picture dropped anywhere in the window arrives here
	$effect(() => {
		if (app.dropped) {
			take(app.dropped);
			app.dropped = null;
		}
	});

	async function create() {
		busy = true;
		// with something already on its way the person stays here to line up the next one
		const lined = line.places.length > 0;
		const next = (id: string) => (lined ? showToast(t('queue.added')) : go('result', id));
		try {
			if (file && model) {
				const title = prompt.trim() || file.name.replace(/\.[^.]+$/, '');
				const job = await startModel(file.name, new Uint8Array(await file.arrayBuffer()), title, preset, model.photos ? more : []);
				app.draft = { prompt: '', file: null };
				more = [];
				next(job.id);
			} else if (words && pictureModel) {
				const job = await startPictures(prompt.trim(), variants);
				app.draft.prompt = '';
				next(job.id);
			}
		} catch (e) {
			error = t('create.failed', { why: problem(e) });
		} finally {
			busy = false;
		}
	}

	const canCreate = $derived(!busy && (file ? !!model && (!model.photos || more.length > 0) : !!prompt.trim() && !!pictureModel));
</script>

<svelte:window
	onpaste={(e) => {
		const image = [...(e.clipboardData?.files ?? [])].find((f) => TYPES.includes(f.type));
		if (image) take(image);
	}}
/>

<div class="page start">
	<div class="stage">
		<h1 class="mark"><Boat size={40} /><span>{t('app.name')}</span></h1>

		{#if !models3d.length && suggestion}
			<section class="card first">
				<div class="text">
					<strong>{t('create.needModel')}</strong>
					<p class="muted">{t('create.needModelText', { name: suggestion.name })}</p>
				</div>
				{#if installing(suggestion.id)}
					<button class="btn" onclick={() => go('models')}>{t('models.stage.weights')}<Icon name="arrow" size={16} /></button>
				{:else}
					<button class="btn primary" disabled={!hasRoom(suggestion)} onclick={() => installModel(suggestion)}><Icon name="download" size={16} />{t('models.install')}</button>
				{/if}
				{#if !hasRoom(suggestion)}
					<p class="note bad">
						{t('models.noDiskIn', { gb: fit(suggestion, app.hw!, benchOf()).target?.disk_gb ?? 0 })}
						<button class="link" onclick={async () => (folderProblem = await chooseModelsFolder())}>{t('folder.other')}</button>
					</p>
					{#if folderProblem}<p class="note bad">{t(folderProblem)}</p>{/if}
				{/if}
				{#if app.packs[suggestion.id]?.state === 'failed'}<p class="note bad">{t('models.failed')}</p>{/if}
			</section>
		{:else if !models3d.length}
			<section class="card first">
				<p class="muted">{t('create.noModelFits')}</p>
				<button class="btn" onclick={() => go('models')}>{t('nav.models')}<Icon name="arrow" size={16} /></button>
			</section>
		{/if}

		<section class="composer" aria-label={t('create.title')}>
			{#if file}
				<div class="photo">
					<img src={preview} alt="" />
					<p class="selectable">{file.name}{more.length ? ` + ${more.length}` : ''}</p>
					<button class="tool" aria-label={t('create.change')} title={t('create.change')} onclick={() => ((app.draft.file = null), (more = []))}><Icon name="x" size={16} /></button>
				</div>
			{/if}
			{#if model?.photos}<p class="faint hint">{model.summary[lang.value === 'ru' ? 'ru' : 'en']}</p>{/if}
			<textarea
				bind:this={field}
				rows="2"
				placeholder={t(file ? 'create.placeholderPhoto' : 'create.placeholder')}
				aria-label={t('create.title')}
				bind:value={app.draft.prompt}
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey && canCreate) {
						e.preventDefault();
						void create();
					}
				}}
			></textarea>
			<input bind:this={picker} type="file" accept=".png,.jpg,.jpeg,.webp" multiple={!!model?.photos} hidden onchange={(e) => { for (const f of e.currentTarget.files ?? []) take(f); e.currentTarget.value = ''; }} />
			<div class="controls">
				<button class="tool" aria-label={t('create.attach')} title={t('create.attach')} onclick={() => picker?.click()}><Icon name="plus" /></button>
				{#if models3d.length}
					<span class="choice">
						<Select small icon="cube" label={t('create.model3d')} value={model?.id ?? ''} options={options(models3d)} onchange={(id) => pick('model3d', id)} />
					</span>
				{/if}
				{#if pictures.length}
					<span class="choice">
						<Select small icon="image" label={t('create.modelPicture')} value={pictureModel?.id ?? ''} options={options(pictures)} onchange={(id) => pick('picture', id)} />
					</span>
				{/if}
				<span class="spacer"></span>
				<button class="send" disabled={!canCreate} onclick={create} aria-label={file || !prompt.trim() ? t('create.go') : t('create.draw')} title={file || !prompt.trim() ? t('create.go') : t('create.draw')}>
					<Icon name="up" size={18} />
				</button>
			</div>
		</section>

		{#if (file && model) || (words && pictureModel)}
			<div class="tray">
				{#if file && model}
					{#if model.presets.length}
						<span class="faint">{t('create.quality')}</span>
						<div class="seg" role="group" aria-label={t('create.quality')}>
							{#each model.presets as p (p.id)}
								<button aria-pressed={preset === p.id} onclick={() => (preset = p.id)}>{p.id === '512' ? t('create.q512') : t('create.q1024')}</button>
							{/each}
						</div>
					{/if}
					{#if estimate?.seconds}
						<span class="faint when">{t(estimate.band === 'night' ? 'create.timeNight' : 'create.time', { time: formatRange(estimate.seconds, lang.value) })}</span>
					{/if}
				{:else}
					<span class="faint">{t('create.variants')}</span>
					<div class="seg" role="group" aria-label={t('create.variants')}>
						{#each [1, 2, 3, 4] as n (n)}
							<button aria-pressed={variants === n} onclick={() => (variants = n)}>{n}</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if error}<p class="note bad" role="alert">{error}</p>{/if}
		{#if prompt.trim() && !file && !pictureModel}
			<p class="note">
				{t('create.needPicture')}
				<button class="link" onclick={() => go('models')}>{t('create.manage')}</button>
			</p>
		{/if}

		{#if line.places.length}
			<section class="card queue" aria-label={t('queue.title')}>
				<div class="queue-head">
					<h2>{t('queue.title')}</h2>
					{#if app.settings.queue_paused}<span class="faint">{t('queue.paused')}</span>{:else if line.done}<span class="faint">{readyBy(line.done, now)}</span>{/if}
					<button class="btn small ghost pause" onclick={async () => (app.settings.queue_paused = await core.pauseQueue(!app.settings.queue_paused))}>
						<Icon name={app.settings.queue_paused ? 'play' : 'pause'} size={14} />{t(app.settings.queue_paused ? 'queue.resume' : 'queue.pause')}
					</button>
				</div>
				<ol>
					{#each line.places as place, i (place.job.id)}
						{@const label = place.running ? t('job.cancel') : t('queue.cancel')}
						{@const turn = i - ahead}
						<li>
							<button class="open" onclick={() => go('result', place.job.id)}>
								<i class="pip" class:live={place.running} aria-hidden="true"></i>
								<span class="name">{place.job.title || t('job.untitled')}</span>
								<span class="faint">{nameOf(place.job.model)} · {place.running ? t('queue.running') : t('queue.waiting', { n: i + 1 - ahead })}</span>
								{#if place.seconds}<span class="faint time">{formatRange(place.seconds, lang.value)}</span>{/if}
							</button>
							{#if !place.running}
								<button class="tool" aria-label={t('queue.earlier')} title={t('queue.earlier')} disabled={turn === 0} onclick={() => core.moveJob(place.job.id, true)}><Icon name="up" size={16} /></button>
								<button class="tool" aria-label={t('queue.later')} title={t('queue.later')} disabled={i === line.places.length - 1} onclick={() => core.moveJob(place.job.id, false)}><Icon name="down" size={16} /></button>
							{/if}
							<button class="tool" aria-label={label} title={label} onclick={() => core.cancelJob(place.job.id)}><Icon name="x" size={16} /></button>
						</li>
					{/each}
				</ol>
				<div class="after">
					<span class="faint">{t('queue.after')}</span>
					<span class="when">
						<Select
							small
							label={t('queue.after')}
							value={app.after.chosen}
							options={app.after.offered.map((a) => ({ value: a, label: t(`queue.after.${a}`) }))}
							onchange={async (a) => setAfter(await core.afterQueue(a))}
						/>
					</span>
				</div>
				<p class="faint hint">{t('queue.hint')}</p>
			</section>
		{/if}

		{#if !file && !prompt.trim()}
			<div class="ideas">
				{#each IDEAS as idea (idea.label)}
					<button
						class="idea"
						onclick={() => {
							app.draft.prompt = t(idea.text);
							field?.focus();
						}}
					>
						<Icon name={idea.icon} size={16} />{t(idea.label)}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.start {
		display: grid;
		place-items: center;
	}

	.stage {
		width: min(760px, 100%);
		display: grid;
		gap: 14px;
	}

	.mark {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		margin: 0 0 22px;
		font-size: 40px;
		font-weight: 700;
		letter-spacing: -0.03em;
	}

	/* the words and the button on one line, what stands in the way under both */
	.first {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 16px;
	}

	.first .text {
		flex: 1 1 0;
		min-width: 0;
	}

	.first .note {
		flex: 1 0 100%;
	}

	.first strong {
		font-weight: 500;
	}

	.first p {
		margin: 0;
	}

	.composer {
		display: grid;
		gap: 10px;
		padding: 14px;
		border-radius: 20px;
		border: 1px solid var(--line);
		background: var(--surface-2);
		transition: border-color 0.12s;
	}

	.composer:focus-within {
		border-color: var(--ink-faint);
	}

	.hint {
		margin: 0;
		font-size: 12px;
	}

	.after {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		font-size: 13px;
	}

	/* as wide as what it says, as the model pickers above */
	.when {
		display: block;
		flex: 0 1 auto;
		min-width: 0;
	}

	.photo {
		display: flex;
		align-items: center;
		gap: 10px;
		animation: enter 0.2s var(--ease);
	}

	.photo img {
		width: 56px;
		height: 56px;
		object-fit: cover;
		border-radius: 10px;
		background: var(--surface-3);
	}

	.photo p {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 13px;
		color: var(--ink-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	textarea {
		width: 100%;
		min-height: 52px;
		max-height: 200px;
		padding: 2px 4px;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 15px;
		line-height: 1.45;
		resize: none;
		user-select: text;
		-webkit-user-select: text;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* as wide as the model's name, whole in the narrowest window; a long one stops at 220 px */
	.choice {
		display: block;
		flex: 0 1 auto;
		min-width: 0;
		max-width: 220px;
	}

	.choice :global(.input) {
		background: var(--surface-3);
	}

	.spacer {
		flex: 1;
	}

	.send {
		width: 38px;
		height: 38px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--ink);
		color: var(--on-ink);
		transition:
			opacity 0.12s,
			transform 0.08s;
	}

	.send:disabled {
		background: var(--button);
		color: var(--ink-faint);
	}

	.send:hover:not(:disabled) {
		opacity: 0.86;
	}

	.send:active:not(:disabled) {
		transform: scale(0.95);
	}

	.tray {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		padding: 0 6px;
		animation: enter 0.2s var(--ease);
	}

	.when {
		margin-left: auto;
	}

	.queue {
		gap: 8px;
		animation: enter 0.2s var(--ease);
	}

	.queue-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
	}

	.queue h2 {
		margin: 0;
		font-size: 14px;
		font-weight: 500;
	}

	/* the title on the left, what the queue will do and its button on the right */
	.queue-head .faint {
		margin-left: auto;
		font-size: 13px;
	}

	.queue-head h2 + .pause {
		margin-left: auto;
	}

	.queue ol {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.queue li {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 36px;
		padding: 0 8px;
		border-radius: 10px;
		text-align: left;
		transition: background 0.12s;
	}

	.open:hover {
		background: var(--surface-3);
	}

	.open .name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.open .faint {
		flex: none;
		font-size: 13px;
	}

	.open .time {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}

	.pip {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1px solid var(--ink-faint);
	}

	.pip.live {
		border-color: var(--good);
		background: var(--good);
		animation: breathe 1.4s ease-in-out infinite;
	}

	.ideas {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 12px;
	}

	.idea {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 38px;
		padding: 0 14px;
		border-radius: var(--r-pill);
		border: 1px solid var(--line);
		color: var(--ink-muted);
		transition:
			background 0.12s,
			color 0.12s;
	}

	.idea:hover {
		background: var(--surface-2);
		color: var(--ink);
	}
</style>
