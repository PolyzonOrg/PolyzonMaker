<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { formatRange, formatTime, timeLeft } from '../lib/catalog';
	import { core, fileUrl, type Slicer } from '../lib/core';
	import { Geometry, type Opened, type Prepared } from '../lib/geometry';
	import { keep, kept, KEPT_FILE } from '../lib/print-kept';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { handle } from '../lib/keys';
	import { contributed } from '../lib/plugins';
	import { app, choose, go, isInstalled, jobExpected, jobTitle, modelName, pick3d, pickPicture, runCommand, save, setThumb } from '../lib/state.svelte';
	import { Viewer } from '../lib/viewer';
	import { threadOf, threadWith } from '../lib/threads';
	import { areaWidth } from '../lib/menu';
	import AreaEdge from '../parts/AreaEdge.svelte';
	import Dialog from '../parts/Dialog.svelte';
	import FenceOpen from '../parts/FenceOpen.svelte';
	import Gather from '../parts/Gather.svelte';
	import ViewControls from '../parts/ViewControls.svelte';
	import Icon from '../parts/Icon.svelte';
	import PluginFrame from '../parts/PluginFrame.svelte';
	import Select from '../parts/Select.svelte';

	let { id, onfull }: { id: string; onfull: () => void } = $props();

	const HEIGHTS = [28, 50, 80, 120];

	const job = $derived(app.jobs.find((j) => j.id === id));
	const active = $derived(job && ['queued', 'preparing', 'running', 'finalizing'].includes(job.state));
	const done = $derived(job?.state === 'succeeded');
	const engine = $derived(app.models.find((m) => m.id === job?.model));
	/** Came ready from a plugin, with no generator behind it. */
	const finished = $derived(!!job && !job.model);
	/** The plugin whose model made this, if one did */
	const pluginOf = $derived(app.models.find((m) => m.id === job?.model)?.plugin?.id ?? '');
	/** What the plugins that are on add to this page */
	const panels = $derived(contributed(app.plugins, app.settings.plugins ?? {}, 'panels').filter(({ item }) => item.where === 'result'));
	const commands = $derived(contributed(app.plugins, app.settings.plugins ?? {}, 'commands').filter(({ item }) => item.where === 'result'));
	/** What a model from the OpenSCAD or CAD page was built from. */
	let source = $state('');
	let cadSource = $state('');
	const text = (name: string) => core.readFile(id, name).then((bytes) => new TextDecoder().decode(bytes), () => '');
	$effect(() => {
		if (!finished) return;
		text('model.scad').then((code) => (source = code));
		text('model.cad.js').then((code) => (cadSource = code));
	});
	// a picture says what drew it, what will make it 3D, and what draws it again
	const models3d = $derived(app.models.filter((m) => m.kind === '3d' && !m.photos && isInstalled(m.id)));
	const next3d = $derived(models3d.find((m) => m.id === app.chosen.model3d) ?? models3d.find((m) => m.id === pick3d()?.id) ?? models3d[0]);
	const redraw = $derived(job && isInstalled(job.model) ? job.model : pickPicture()?.id);
	const name = $derived((job?.title || 'model').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60).trim() || 'model');

	// ---- while it runs
	let now = $state(Date.now());
	let tick: ReturnType<typeof setInterval>;
	/** A job from before the engine said when it began counts from the opening of this page. */
	const opened_ = Date.now();
	const elapsed = $derived(Math.max((now - (job?.started ? job.started * 1000 : opened_)) / 1000, 0));
	// by the longer end of the estimate; it stops short of the end until the engine is really done
	const expected = $derived(job ? jobExpected(job) : null);
	/** A second seed is a second run, and the time counts from the first */
	const twice = $derived(!!job?.notes?.includes('second_try'));
	const share = $derived(expected ? Math.min(elapsed / (expected[1] * (twice ? 2 : 1)), 0.95) : 0);
	/** What is left, by the estimate for this computer, in words */
	const remaining = $derived.by(() => {
		if (!expected) return '';
		const l = timeLeft(elapsed, expected, twice);
		if (l.kind === 'range') return t('job.leftAbout', { time: formatRange(l.seconds, lang.value) });
		if (l.kind === 'upto') return t('job.leftUpTo', { time: formatTime(l.seconds, lang.value) });
		return t('job.longer');
	});
	const stageKey = $derived((job?.state === 'queued' ? 'job.queued' : `job.${job?.stage || 'prepare'}`) as Key);

	onMount(() => {
		tick = setInterval(() => (now = Date.now()), 1000);
		// one installed a minute ago counts too
		void core
			.slicers()
			.then((found) => {
				app.slicers = found;
			})
			.catch(() => undefined); // the ones found at the start stay
	});

	/** What the specks gather into while it runs: the picture it is made from, or the words about it. */
	let inputBox = $state<HTMLElement | null>(null);
	let wordsBox = $state<HTMLElement | null>(null);
	const aim = $derived(inputBox ?? wordsBox);

	// ---- the input picture
	let input = $state('');
	let picture = $state('');
	$effect(() => {
		if (job?.input && !input) fileUrl(id, job.input, 'image/png').then((u) => (input = u), () => {});
		if (job?.kind === 'picture' && done && !picture) fileUrl(id, 'picture.png', 'image/png').then((u) => (picture = u), () => {});
	});

	// ---- the model
	let canvas = $state<HTMLCanvasElement>();
	let viewer = $state.raw<Viewer | null>(null);
	let fileBytes = $state(0);
	let geometry: Geometry | null = null;
	let opened = $state<Opened | null>(null);
	let noWebgl = $state(false);
	let openFailed = $state('');
	let loading = false;
	/** The model as generated, and as it will be printed once that is known; the view shows one of them */
	let original: [Float32Array, Float32Array?] | null = null;
	let printView = $state.raw<Float32Array | null>(null);
	/** The page's width: the panel's edge keeps the view at least its narrowest */
	let room = $state(0);
	let showing = $state<'print' | 'original'>('original');

	function look(which: 'print' | 'original') {
		const tris = which === 'print' ? printView : original?.[0];
		if (!viewer || !tris) return;
		showing = which;
		if (which === 'print') viewer.show(tris, undefined, true);
		else viewer.show(original![0], original![1], true);
	}

	const viewerColor = () => getComputedStyle(document.documentElement).getPropertyValue('--viewer').trim();

	async function openModel() {
		if (loading || !canvas) return;
		loading = true;
		try {
			try {
				viewer = new Viewer(canvas, viewerColor());
			} catch {
				noWebgl = true;
			}
			geometry = new Geometry();
			geometry.onStage = (s) => (stage = s);
			const bytes = new Uint8Array(await core.readFile(id, 'model.glb'));
			if (left) return;
			fileBytes = bytes.length;
			opened = await geometry.open(bytes.slice(), finished);
			// a generator's size means nothing; a finished model is the size it was made
			const tall = opened.report.size[2];
			height = finished ? +tall.toFixed(2) : Math.min(80, Math.round(tall) || 80);
			const shown = await painted(bytes, opened.preview);
			if (left) return;
			original = shown;
			viewer?.show(...shown);
			await saveThumb();
			if (app.prepare?.id === id) return; // asked for through the API: that asks for its own size
			// prepared on an earlier visit: shown as it was; else a generated model comes out ready for print
			if (!(await restore()) && !finished) void prepare();
		} catch (e) {
			openFailed = String(e);
		}
	}

	/** The print files of an earlier visit, as they were made: a model is repaired and simplified once. */
	async function restore(): Promise<boolean> {
		const k = kept(await text(KEPT_FILE), { version: app.version, source: fileBytes });
		if (!k || !geometry) return false;
		// before the files are read: another size clears what was prepared
		height = k.height;
		mend = k.mend;
		const file = (name: string) => core.readFile(id, name).then((b) => new Uint8Array(b), () => null);
		const [stl, threemf] = await Promise.all([file('print.stl'), file('print.3mf')]);
		if (left) return true;
		if (!stl) return false;
		const preview = await geometry.printed(stl.slice()).catch(() => null);
		if (left) return true;
		if (!preview) return false;
		prepared = { ...k.summary, stl, threemf, preview };
		printView = preview;
		if (!finished || mend || showing === 'print') look('print');
		return true;
	}

	/** Parts with colours show in them: all their triangles, as the file gives them. */
	async function painted(bytes: Uint8Array, preview: Float32Array): Promise<[Float32Array, Float32Array?]> {
		const { glbMesh, readGlb } = await import('@polyzon/mesh-kit');
		const { paints } = glbMesh(bytes);
		if (!paints.some((p) => p.color)) return [preview];
		const corners: number[] = [];
		for (const { triangles, color } of paints) for (let i = 0; i < triangles * 3; i++) corners.push(...(color ?? [0.5, 0.5, 0.5]));
		return [readGlb(bytes), new Float32Array(corners)];
	}

	/** What the view's "About the model" says: the model on the screen, as generated or as printed, at the size chosen. */
	const facts = $derived.by((): [Key, string][] => {
		if (!opened) return [];
		const n = (v: number) => v.toLocaleString(lang.value);
		const print = showing === 'print' && prepared ? prepared : null;
		const bytes = print ? (print.stl?.length ?? 0) : fileBytes;
		return [
			['view.fact.triangles', print || !opened.fileFaces ? n((print ?? opened).report.faces) : t('view.fact.simplified', { n: n(opened.report.faces), file: n(opened.fileFaces) })],
			// the model's own, as its triangles are: the view shows a lighter copy of a big one
			['view.fact.vertices', n((print ?? opened).report.vertices)],
			['view.fact.parts', n((print ?? opened).report.components.length)],
			['view.fact.size', `${dims.join(' × ')} ${t('scad.mm')}`],
			['view.fact.file', `${(bytes / 2 ** 20).toLocaleString(lang.value, { maximumFractionDigits: 1 })} ${t('models.mb')}`]
		];
	});

	const leaveKeys = handle({
		'result.prepare': () => void prepare(),
		'result.saveStl': () => {
			if (prepared?.stl) void exportAs('print.stl', 'stl');
		}
	});
	onDestroy(leaveKeys);

	async function saveThumb() {
		const png = await viewer?.thumbnail();
		if (!png || left) return;
		await core.writeFile(id, 'thumb.png', png);
		setThumb(id, URL.createObjectURL(new Blob([png.slice()], { type: 'image/png' })));
	}

	$effect(() => {
		if (done && job?.kind === 'model' && canvas) void openModel();
	});

	/** What was on its way when the page left must not touch what is gone. */
	let left = false;

	onDestroy(() => {
		left = true;
		clearInterval(tick);
		viewer?.dispose();
		geometry?.close();
		for (const u of [input, picture]) if (u) URL.revokeObjectURL(u);
	});

	// ---- to the printer
	let height = $state(80);
	let stage = $state('');
	let preparing = $state(false);
	/** A finished model the person asked to mend: printed as one solid body */
	let mend = $state(false);
	let prepared = $state<Prepared | null>(null);
	let failed = $state('');
	let saved = $state('');
	let confirmDelete = $state(false);

	// another size means other files
	$effect(() => {
		void height;
		prepared = null;
		saved = '';
	});

	const report = $derived(prepared?.report ?? opened?.report);
	const scale = $derived(opened ? height / opened.report.size[2] : 1);
	const dims = $derived(opened?.report.size.map((v) => Math.round(v * scale)) ?? [0, 0, 0]);
	const fits = $derived(dims[2] <= 256 && Math.max(dims[0], dims[1]) <= 256);
	const statusChip = $derived(report?.status === 'basic-passed' ? 'good' : report?.status === 'has-errors' ? 'bad' : 'warn');
	const advice = $derived((job?.notes ?? []).filter((n) => n.startsWith('subject_') || n === 'low_res'));
	const closedOk = $derived(report?.checks.find((c) => c.id === 'closed-solid')?.status === 'passed' && !report?.nonManifoldEdges);
	const slicer = $derived(app.slicers.find((s) => s.path === app.settings.slicer) ?? app.slicers[0]);

	async function prepare() {
		if (!geometry) return;
		preparing = true;
		failed = '';
		saved = '';
		const began = performance.now();
		const said = (event: string, code: string) => core.report(event, job?.model, job?.device, code, (performance.now() - began) / 1000);
		try {
			const wanted = height;
			// a generated model's files say an AI made it; one the person made says nothing of the kind
			const made = finished ? undefined : { tool: `Polyzon Maker ${app.version}`, system: modelName(job!.model), created: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
			const r = await geometry.prepare(wanted, name, mend, made);
			if (left || wanted !== height) return; // another size was asked for meanwhile
			prepared = r;
			printView = r.preview;
			if (!finished || mend || showing === 'print') look('print');
			// what was kept says nothing until the new files are all written: a crash halfway prepares again
			await core.writeFile(id, KEPT_FILE, new TextEncoder().encode('{}'));
			if (r.stl) await core.writeFile(id, 'print.stl', r.stl);
			if (r.threemf) await core.writeFile(id, 'print.3mf', r.threemf);
			if (r.stl) await core.writeFile(id, KEPT_FILE, keep(r, { version: app.version, source: fileBytes, height: wanted, mend }));
			said('print_done', [r.ready ? 'ready' : 'not_ready', r.filled && 'filled', r.solid && 'solid', r.crumbs && 'crumbs', r.flat && 'flat'].filter(Boolean).join('_'));
		} catch (e) {
			failed = t('print.failed', { text: String(e) });
			said('print_failed', e instanceof Error ? e.name : 'unknown');
		} finally {
			preparing = false;
			stage = '';
		}
	}

	// asked for through the API
	$effect(() => {
		if (opened && app.prepare?.id === id) {
			if (app.prepare.height) height = app.prepare.height;
			app.prepare = null;
			setTimeout(prepare);
		}
	});

	async function openSlicer(chosen: Slicer) {
		void core.report('slicer_opened', job?.model, job?.device, chosen.name);
		failed = '';
		await core.openInSlicer(chosen.path, id, chosen.file).catch(() => (failed = t('print.slicerFailed', { name: chosen.name })));
	}

	async function exportAs(file: string, ext: string) {
		failed = '';
		try {
			const path = await core.exportFile(id, file, `${name}.${ext}`);
			if (path) saved = path;
		} catch {
			failed = t('print.saveFailed');
		}
	}

	/** Back to the start with the same picture or words, to choose another model or change something. */
	async function startOver() {
		if (!job) return;
		if (job.input) {
			const bytes = await core.readFile(id, job.input);
			const kind = job.input.endsWith('.png') ? 'png' : job.input.endsWith('.webp') ? 'webp' : 'jpeg';
			app.dropped = new File([new Uint8Array(bytes)], job.input, { type: `image/${kind}` });
		} else {
			app.draft.prompt = job.title;
		}
		go('create');
	}

	async function again() {
		if (!job) return;
		await core.addJob({
			id: undefined,
			kind: job.kind,
			thread: threadOf(job),
			title: job.title,
			prompt: job.prompt,
			input: '',
			model: job.kind === 'picture' ? (redraw ?? job.model) : job.model,
			device: job.kind === 'picture' && redraw ? isInstalled(redraw)!.device : job.device,
			preset: job.preset,
			seed: Math.floor(Math.random() * 2 ** 31)
		}).then((next) => go('result', next.id));
	}

	/** A variant of a model from the same picture: a new job with a copy of the input. */
	async function variant() {
		if (!job?.input) return again();
		const bytes = new Uint8Array(await core.readFile(id, job.input));
		const { id: next, input: copy } = await core.addImage(job.input, bytes);
		await core.addJob({ id: next, thread: threadOf(job), kind: 'model', title: job.title, input: copy, model: job.model, device: job.device, preset: job.preset, seed: Math.floor(Math.random() * 2 ** 31) });
		go('result', next);
	}

	/** The picture model is done: its result goes to a 3D model. */
	async function make3d() {
		const model = next3d;
		if (!job || !model) return go('models');
		const bytes = new Uint8Array(await core.readFile(id, 'picture.png'));
		const { id: next, input: copy } = await core.addImage('picture.png', bytes);
		await core.addJob({ id: next, thread: threadOf(job), kind: 'model', title: job.title, input: copy, model: model.id, device: isInstalled(model.id)!.device, preset: model.presets.find((p) => p.id === '512')?.id ?? model.presets[0]?.id ?? '', seed: Math.floor(Math.random() * 2 ** 31) });
		go('result', next);
	}

	async function remove() {
		const neighbour = threadWith(app.jobs, id)?.jobs.find((j) => j.id !== id);
		await core.deleteJob(id);
		setThumb(id, null);
		app.jobs = app.jobs.filter((j) => j.id !== id);
		if (neighbour) go('result', neighbour.id);
		else go('library');
	}
</script>

{#if !job}
	<div class="page"><p class="muted">{t('lib.noMatch')}</p></div>
{:else if active}
	<div class="page center gathering">
		{#if job.state !== 'queued'}<Gather target={aim} />{/if}
		<div class="running" bind:this={wordsBox}>
			{#if input}<img class="source" src={input} alt="" bind:this={inputBox} />{/if}
			<!-- a new step comes up from below as the old one leaves upward and fades -->
			<div class="swap" aria-live="polite">
				{#key stageKey}
					<h1 in:fly={{ y: 16, duration: 280, easing: cubicOut }} out:fly={{ y: -16, duration: 220, easing: cubicOut }}>{t(stageKey)}</h1>
				{/key}
			</div>
			<p class="muted">{jobTitle(job, t('job.untitled'))}</p>
			{#if job.state !== 'queued'}
				<div class="bar" class:unknown={!share}><i style:width={share ? `${Math.round(share * 100)}%` : ''}></i></div>
				{#if job.notes?.includes('second_try')}<p class="muted">{t('job.again')}</p>{/if}
				<p class="faint">{t('job.elapsed', { time: formatTime(elapsed, lang.value) })}{remaining ? `, ${remaining}` : ''}. {t('job.background_note')}</p>
			{:else}
				<p class="faint">{t('job.background_note')}</p>
			{/if}
			<button class="btn" onclick={() => core.cancelJob(id)}><Icon name="x" size={16} />{t('job.cancel')}</button>
		</div>
	</div>
{:else if !done}
	<div class="page center">
		<div class="running">
			{#if input}<img class="source" src={input} alt="" />{/if}
			<h1>{t(job.state === 'failed' ? 'job.failed' : job.state === 'cancelled' ? 'job.cancelled' : 'job.interrupted')}</h1>
			{#if job.error === 'FENCE_OPEN' && pluginOf}
				<FenceOpen plugin={pluginOf} then={() => core.retryJob(id)} />
			{:else}
				<p class="muted text">
					{#if job.state === 'failed'}{t(`error.${job.error}` as Key)}{:else if job.state === 'cancelled'}{t('job.cancelledText')}{:else}{t(job.notes?.includes('memory_low') ? 'job.interruptedMemoryText' : 'job.interruptedText')}{/if}
				</p>
			{/if}
			<div class="buttons">
				<button class="btn primary" onclick={() => core.retryJob(id)}><Icon name="refresh" size={16} />{t('job.retry')}</button>
				<button class="btn" onclick={startOver}><Icon name="arrow" size={16} />{t('job.startOver')}</button>
				<button class="btn ghost danger" onclick={() => (confirmDelete = true)}><Icon name="trash" size={16} />{t('job.delete')}</button>
			</div>
			{#if job.detail}
				<details>
					<summary class="faint">{t('job.details')}</summary>
					<pre class="code selectable">{job.error}{'\n'}{job.detail}</pre>
				</details>
			{/if}
		</div>
	</div>
{:else if job.kind === 'picture'}
	<div class="page center">
		<div class="running wide">
			{#if picture}
				<button class="zoom" aria-label={t('job.full')} title={t('job.full')} onclick={onfull}>
					<img class="picture" src={picture} alt={job.title} />
					<span class="expand"><Icon name="expand" size={16} /></span>
				</button>
			{/if}
			<p class="muted">{job.title}</p>
			<p class="faint">{t('job.drawnBy', { name: modelName(job.model) })}</p>
			<div class="buttons">
				{#if next3d}
					<span class="pick3d"><Select icon="cube" label={t('create.model3d')} value={next3d.id} options={models3d.map((m) => ({ value: m.id, label: m.name }))} onchange={(id) => choose('model3d', id)} /></span>
					<button class="btn primary" onclick={make3d}><Icon name="cube" size={16} />{t('job.make3d')}</button>
				{:else}
					<button class="btn primary" onclick={() => go('models')}><Icon name="download" size={16} />{t('job.need3d')}</button>
				{/if}
			</div>
			{#if redraw}<button class="btn" onclick={again}><Icon name="refresh" size={16} />{t('job.anotherPictureBy', { name: modelName(redraw) })}</button>{/if}
		</div>
	</div>
{:else}
	<div class="result" bind:clientWidth={room} style:--panel="{areaWidth('result', room, app.areas.result)}px">
		<AreaEdge area="result" {room} at="right" />
		<div class="view">
			<canvas bind:this={canvas} aria-label={job.title}></canvas>
			{#if opened && viewer}<ViewControls {viewer} {facts} shadows />{/if}
			{#if printView && viewer}
				<div class="seg which" role="group" aria-label={t('print.view')}>
					<button aria-pressed={showing === 'print'} onclick={() => look('print')}>{t('print.view.print')}</button>
					<button aria-pressed={showing === 'original'} onclick={() => look('original')}>{t('print.view.original')}</button>
				</div>
			{/if}
			{#if noWebgl}<p class="over faint">{t('print.noWebgl')}</p>{/if}
			{#if !opened && !openFailed}<p class="over faint">{t('print.checking')}</p>{/if}
			{#if openFailed}<p class="over note">{openFailed}</p>{/if}
		</div>
		<aside class="panel">
			<header>
				<h2 class="selectable">{job.title || t('job.untitled')}</h2>
				{#if !finished}<p class="faint">{engine?.name ?? job.model}, {formatTime(job.seconds, lang.value)}</p>{/if}
			</header>

			<section>
				<h3>{t('print.size')}</h3>
				<label class="height">
					<span class="faint">{t('print.height')}</span>
					<input class="input" type="number" min="1" max="1000" bind:value={height} />
				</label>
				<div class="heights">
					{#each HEIGHTS as h (h)}
						<button class="btn small" class:on={height === h} onclick={() => (height = h)}>{h}</button>
					{/each}
				</div>
				<p class="faint">{t('print.dims', { x: dims[0], y: dims[1], z: dims[2] })}</p>
			</section>

			{#if job && job.kind === 'model' && !finished}
				<section class="rate">
					<span class="faint">{t('rate.ask')}</span>
					<button class="btn small" class:primary={job.rating === 'good'} aria-pressed={job.rating === 'good'} onclick={() => core.rateJob(id, 'good')}><Icon name="check" size={14} />{t('rate.good')}</button>
					<button class="btn small" class:primary={job.rating === 'bad'} aria-pressed={job.rating === 'bad'} onclick={() => core.rateJob(id, 'bad')}><Icon name="x" size={14} />{t('rate.bad')}</button>
				</section>
			{/if}

			<section>
				<div class="line">
					<h3>{t('print.check')}</h3>
					{#if report}<span class="chip {statusChip}">{t(`print.status.${report.status}` as Key)}</span>{/if}
				</div>
				{#if report}
					<ul class="facts">
						<li class:bad={!closedOk}>{t(closedOk ? 'print.report.closed' : 'print.report.notClosed')}</li>
						<li>{t('print.report.faces', { n: report.faces.toLocaleString(lang.value) })}</li>
						{#if report.components.length > 1}<li>{t('print.report.parts', { n: report.components.length })}</li>{/if}
						{#if prepared?.solid}<li>{t('print.solid', { mm: prepared.solid.voxel.toFixed(2) })}</li>{/if}
						{#if prepared?.filled}<li>{t('print.filled', { n: prepared.filled })}</li>{/if}
						{#if prepared && closedOk && opened?.report.holes.length}<li>{t('print.sealed', { n: opened.report.holes.length })}</li>{/if}
						{#if prepared && opened && opened.report.components.length > report.components.length}<li>{t('print.merged', { from: opened.report.components.length, to: report.components.length })}</li>{/if}
						{#if prepared?.crumbs}<li>{t('print.crumbs', { n: prepared.crumbs })}</li>{/if}
						{#if report.holes.length}<li>{t('print.report.holes', { n: report.holes.length })}</li>{/if}
						<li class:bad={!fits}>{t(fits ? 'print.report.fits' : 'print.report.big')}</li>
						{#if prepared?.moved}<li>{t('print.moved', { mm: prepared.moved.toFixed(2) })}</li>{/if}
					</ul>
				{/if}
				{#if prepared?.flat || (opened && opened.report.checks.find((c) => c.id === 'flat-plate')?.status === 'warning')}
					<p class="note warn">{t('print.flat')}</p>
				{/if}
				{#each advice as note (note)}<p class="note warn">{t(`job.note.${note}` as Key)}</p>{/each}
				{#if job.offload}<p class="faint">{t('job.note.offload')}</p>{/if}
				{#if job.notes?.includes('memory_low')}<p class="faint">{t('job.note.memory_low')}</p>{/if}
				{#if job.notes?.includes('second_try') && !job.notes.includes('flat')}<p class="faint">{t('job.note.second_try')}</p>{/if}
				{#if prepared && (!closedOk || report?.status === 'has-errors') && !mend}
					<button class="btn" disabled={preparing} onclick={() => ((mend = true), prepare())}><Icon name="wrench" size={16} />{t('print.mend')}</button>
					<p class="faint">{t('print.mendHint')}</p>
				{/if}
				<p class="faint">{t('print.notChecked')}</p>
			</section>

			{#if failed}<p class="note bad" role="alert">{failed}</p>{/if}

			<section class="act">
				{#if !prepared}
					<button class="btn primary" disabled={!opened || preparing || !(height > 0)} onclick={prepare}>
						<Icon name="printer" size={16} />{preparing ? t(stage ? (`print.stage.${stage}` as Key) : 'print.preparing') : t('print.prepare')}
					</button>
				{/if}
				{#if prepared && !prepared.stl && !prepared.threemf}
					<p class="note bad">{t('print.notSaved')}</p>
					<button class="btn" onclick={prepare}><Icon name="refresh" size={16} />{t('print.again')}</button>
				{/if}
				{#if preparing}<div class="bar unknown"><i></i></div>{/if}
				{#if prepared}
					<div class="two">
						<button class="btn primary" disabled={!prepared.threemf} onclick={() => exportAs('print.3mf', '3mf')}><Icon name="download" size={16} />{t('print.save3mf')}</button>
						<button class="btn" disabled={!prepared.stl} onclick={() => exportAs('print.stl', 'stl')}><Icon name="download" size={16} />{t('print.saveStl')}</button>
					</div>
					{#if app.slicers.length > 1}
						<Select label={t('print.slicer')} value={slicer?.path ?? ''} options={app.slicers.map((s) => ({ value: s.path, label: s.name }))} onchange={(chosen) => save({ slicer: chosen })} />
					{/if}
					{#if slicer}
						<button class="btn" disabled={!prepared[slicer.file === 'print.stl' ? 'stl' : 'threemf']} onclick={() => openSlicer(slicer)}><Icon name="external" size={16} />{t('print.openIn', { name: slicer.name })}</button>
					{:else}
						<p class="faint">{t('print.noSlicer')}</p>
					{/if}
				{/if}
				{#if saved}<p class="faint selectable">{t('print.saved')}: {saved}</p>{/if}
				<p class="faint">{t('print.original')}</p>
			</section>

			{#each panels as { plugin, item } (plugin.id + '/' + item.id)}
				<section class="plugin">
					<h3 title={t('plugins.from', { name: plugin.name })}>{item.title}</h3>
					<div class="frame" style:height="{item.height}px">
						<PluginFrame id={plugin.id} file={item.file} title={item.title} context={{ page: 'result', job: id }} />
					</div>
				</section>
			{/each}

			<footer class="menu-list">
				{#if !finished && !engine?.photos && job.model !== 'triposr'}<button onclick={variant}><Icon name="refresh" size={16} />{t('job.newSeed')}</button>{/if}
				<button onclick={() => exportAs('model.glb', 'glb')}><Icon name="download" size={16} />{t('print.saveGlb')}</button>
				{#if source}<button onclick={() => { app.scad = { title: job.title, code: source, program: '' }; go('openscad'); }}><Icon name="code" size={16} />{t('scad.edit')}</button>{/if}
				{#if cadSource}<button onclick={() => { app.cad = { title: job.title, code: cadSource, program: '' }; go('cad'); }}><Icon name="cube" size={16} />{t('cad.edit')}</button>{/if}
				{#each commands as { plugin, item } (plugin.id + '/' + item.id)}
					<button data-tip={t('plugins.from', { name: plugin.name })} onclick={() => runCommand(plugin.id, item.id, id)}><Icon name="puzzle" size={16} />{item.title}</button>
				{/each}
				<hr />
				<button class="danger" onclick={() => (confirmDelete = true)}><Icon name="trash" size={16} />{t('job.delete')}</button>
			</footer>
		</aside>
	</div>
{/if}

{#if confirmDelete}
	<Dialog title={t('job.deleteTitle')} onclose={() => (confirmDelete = false)}>
		<p class="muted">{t('job.deleteText')}</p>
		<div class="row-end">
			<button class="btn ghost" onclick={() => (confirmDelete = false)}>{t('models.cancel')}</button>
			<button class="btn danger" onclick={remove}><Icon name="trash" size={16} />{t('job.delete')}</button>
		</div>
	</Dialog>
{/if}

<style>
	.zoom {
		position: relative;
		display: grid;
		justify-items: center;
		cursor: zoom-in;
		border-radius: var(--r-lg);
		overflow: hidden;
	}

	.expand {
		position: absolute;
		top: 10px;
		right: 10px;
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		opacity: 0;
		transition: opacity 0.14s;
	}

	.zoom:hover .expand,
	.zoom:focus-visible .expand {
		opacity: 1;
	}

	.center {
		display: grid;
		place-items: center;
	}

	.gathering {
		position: relative;
	}

	.swap {
		display: grid;
		justify-items: center;
		overflow: hidden;
	}

	.swap > :global(*) {
		grid-area: 1 / 1;
	}

	.running {
		position: relative;
		width: min(460px, 100%);
		display: grid;
		justify-items: center;
		gap: 12px;
		text-align: center;
	}

	.running.wide {
		width: min(560px, 100%);
	}

	.running .bar {
		width: 100%;
		margin-top: 4px;
	}

	.source {
		width: 160px;
		height: 160px;
		object-fit: cover;
		border-radius: var(--r-lg);
		background: var(--surface-2);
	}

	/* the buttons under it stay on the screen in a small window too */
	.picture {
		display: block;
		width: min(460px, 100%, calc(100vh - 300px));
		aspect-ratio: 1;
		object-fit: cover;
		border-radius: var(--r-lg);
		background: var(--surface-2);
	}

	.text {
		max-width: 44ch;
	}

	.pick3d {
		width: 220px;
	}

	details {
		width: 100%;
		text-align: left;
	}

	summary {
		width: fit-content;
		margin: 0 auto;
		padding: 2px 8px;
		border-radius: var(--r-sm);
		cursor: pointer;
	}

	pre {
		margin: 8px 0 0;
		padding: 12px;
		border-radius: var(--r);
		background: var(--surface-2);
		font: 12px/1.5 ui-monospace, Consolas, Menlo, monospace;
		max-height: 220px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-all;
	}

	/* the row is the page's height whatever is in it: an auto row grew to fit the canvas */
	.result {
		position: relative;
		height: 100%;
		display: grid;
		/* the panel as wide as it was pulled by its edge */
		grid-template-columns: minmax(0, 1fr) var(--panel);
		grid-template-rows: minmax(0, 1fr);
	}

	.view {
		position: relative;
		min-width: 0;
		background: var(--viewer);
	}

	/* over the view, where its own notes would be: which model it shows */
	.which {
		position: absolute;
		z-index: 2;
		top: 12px;
		left: 12px;
	}

	/* Out of the flow, so the view's size never comes from the canvas. In the flow, the size its drawing
	   buffer was given made the view that tall at the next width, and the view grew each time it widened. */
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		outline: none;
		cursor: grab;
	}

	canvas:active {
		cursor: grabbing;
	}

	.over {
		position: absolute;
		inset: auto 16px 16px;
		text-align: center;
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 20px;
		padding: 20px;
		overflow-y: auto;
		border-left: 1px solid var(--line);
	}

	/* no room for the view beside the panel: one column that scrolls, the model on top, as tall as its toolbar needs */
	@container (max-width: 700px) {
		.result {
			display: block;
			overflow-y: auto;
		}

		.view {
			height: max(480px, 60%);
		}

		.panel {
			overflow: visible;
			border-left: 0;
			border-top: 1px solid var(--line);
		}

		/* the panel under the view: no border beside it to pull */
		.result > :global(.edge) {
			display: none;
		}
	}

	section {
		display: grid;
		gap: 8px;
	}

	/* a plugin's panel: its frame on the page's own ground, set apart by a line as the panel's parts are */
	.plugin .frame {
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		overflow: hidden;
	}

	.height {
		display: grid;
		gap: 4px;
	}

	.heights {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
	}

	.heights .on {
		background: var(--surface-4);
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.rate {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.rate .faint {
		grid-column: 1 / -1;
	}

	.facts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 3px;
		color: var(--ink-muted);
	}

	.facts .bad {
		color: var(--bad);
	}

	/* side by side at equal width; a wider font puts them on two rows instead of past the edge */
	.act .two {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.act .two .btn {
		flex: 1 1 0;
		min-width: max-content;
		padding: 0 8px;
		font-size: 13px;
	}

	/* the page's other actions, at the foot of the panel */
	footer {
		margin-top: auto;
	}
</style>
