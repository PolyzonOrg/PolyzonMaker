<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { core, type Program } from '../lib/core';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { modelFile } from '../lib/plugins';
	import { build } from '../lib/scad';
	import { fitted } from '../lib/menu';
	import { app, go } from '../lib/state.svelte';
	import DeskEdges from '../parts/DeskEdges.svelte';
	import Dialog from '../parts/Dialog.svelte';
	import Icon from '../parts/Icon.svelte';
	import MoreMenu from '../parts/MoreMenu.svelte';
	import Select from '../parts/Select.svelte';
	import ViewControls from '../parts/ViewControls.svelte';
	import { sceneView, type SceneView } from '../lib/view-scene';
	import { num } from '../studio/i18n/current';
	import { openDesk } from '../studio/agent';
	import ScadEditor from '../studio/components/scad/ScadEditor.svelte';
	import ScadParameters from '../studio/components/scad/ScadParameters.svelte';
	import { CompileRuns, compileFailureText, editorStatus } from '../studio/openscad/compile-runs';
	import { parseScadLog, primaryErrorLine } from '../studio/openscad/diagnostics';
	import { applyParams, parseParams, type ScadParam } from '../studio/openscad/parser';
	import { SCAD_TEMPLATES } from '../studio/openscad/templates';
	import type { ScadViewer } from '../studio/openscad/three-viewer';
	import '../studio/styles/studio.css';

	const DRAFT_KEY = 'maker-scad-draft';
	const NEW = '';

	/** What the person left here, or what a tool handed over. */
	function opening(): { title: string; code: string; program: string } {
		const draft = readDraft();
		if (app.scad) {
			// what the person was working on must not vanish under what was handed over
			if (draft?.code && !SCAD_TEMPLATES.some((e) => e.source === draft.code)) void core.saveProgram({ id: draft.program, title: draft.title || t('scad.untitled'), code: draft.code });
			return app.scad;
		}
		if (draft?.code) return draft;
		return { title: '', code: SCAD_TEMPLATES[0].source, program: NEW };
	}

	function readDraft(): { title: string; code: string; program: string } | null {
		try {
			return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
		} catch {
			return null; // blocked or broken storage only costs the draft
		}
	}

	const own = (list: Program[]) => list.filter((p) => !p.kind);
	const first = opening();
	app.scad = null;
	let title = $state(first.title);
	let code = $state(first.code);
	let program = $state(first.program);
	let params = $state<ScadParam[]>(parseParams(first.code));
	let programs = $state<Program[]>([]);
	let saved = $state(first.program ? first.code : '');

	let stl = $state.raw<Uint8Array | null>(null);
	/** What `stl` was built from: a model goes to the library only with its own program. */
	let built = $state('');
	let size = $state<readonly [number, number, number] | null>(null);
	let log = $state('');
	let failure = $state<string | null>(null);
	let compiling = $state(false);
	let elapsed = $state(0);
	let replacing = $state<{ title: string; code: string; program: string } | null>(null);
	let removing = $state(false);
	let adding = $state(false);

	let host = $state<HTMLDivElement>();

	/** How wide the desk is and where its header ends: its edges stand between the columns below the header */
	let room = $state(0);
	let top = $state(0);
	const panes = $derived(room ? fitted(room, app.panes.openscad, params.length > 0) : app.panes.openscad);
	let picker = $state<HTMLInputElement>();
	let viewer: ScadViewer | null = null;
	let view = $state.raw<SceneView | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let clock: ReturnType<typeof setInterval> | undefined;
	let controller: AbortController | null = null;
	/** The first load takes a moment, and the page can be gone before it ends. */
	let left = false;
	const runs = new CompileRuns();

	const diagnostics = $derived(parseScadLog(failure ?? log));
	const errorLine = $derived(primaryErrorLine(failure ?? log));
	const status = $derived(editorStatus(compiling, failure, !!stl));
	const name = $derived(title.trim() || t('scad.untitled'));
	/** A kept program is what the list says, not what the draft remembers. */
	const kept = $derived(programs.find((p) => p.id === program));
	/** What the view's "About the model" says. */
	const facts = $derived.by((): [Key, string][] => {
		if (!stl || !size) return [];
		return [
			['view.fact.triangles', Math.max(0, (stl.length - 84) / 50).toLocaleString(lang.value)],
			['view.fact.size', `${size.map((v) => num(v, 1)).join(' × ')} ${t('scad.mm')}`]
		];
	});
	const dirty = $derived(kept ? code !== kept.code || name !== kept.title : code !== saved);
	const file = $derived(name.replace(/[\\/:*?"<>|]+/g, ' ').trim());

	$effect(() => {
		const draft = { title, code, program };
		try {
			localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
		} catch {
			// the draft is a convenience
		}
	});

	/** Stops what is running; the newest compile is the only one the page listens to. */
	function stop() {
		clearTimeout(timer);
		controller?.abort();
		runs.drop();
		compiling = false;
		clearInterval(clock);
	}

	async function compile() {
		clearTimeout(timer);
		controller?.abort();
		const run = runs.start();
		const started = performance.now();
		controller = new AbortController();
		compiling = true;
		elapsed = 0;
		clearInterval(clock);
		clock = setInterval(() => (elapsed = performance.now() - started), 200);
		try {
			const source = code;
			const done = await build(applyParams(source, params), controller.signal);
			if (!runs.current(run)) return;
			failure = null;
			log = done.log;
			stl = done.stl;
			built = source;
			size = (await viewer?.setStl(done.stl)) ?? size;
			view?.again();
		} catch (error) {
			if (!runs.current(run)) return;
			const text = compileFailureText(error, t('scad.failed'));
			if (text) failure = text;
		} finally {
			if (runs.current(run)) {
				compiling = false;
				clearInterval(clock);
			}
		}
	}

	const later = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void compile(), 700);
	};

	function edited(next: string) {
		code = next;
		params = parseParams(next);
		later();
	}

	function setParam(name: string, value: string | number | boolean) {
		code = applyParams(code, params.map((p) => (p.name === name ? { ...p, value } : p)));
		params = parseParams(code);
		later();
	}

	/** Brings another text in. What is written and not saved is asked about first. */
	function load(next: { title: string; code: string; program: string }, ask = true) {
		if (ask && dirty) {
			replacing = next;
			return;
		}
		replacing = null;
		title = next.title;
		code = next.code;
		program = next.program;
		saved = next.program ? next.code : '';
		params = parseParams(next.code);
		stl = null;
		size = null;
		failure = null;
		log = '';
		void compile();
	}

	function pickProgram(id: string) {
		if (id === NEW) return load({ title: '', code: '', program: NEW });
		const found = programs.find((p) => p.id === id);
		if (found) load({ title: found.title, code: found.code, program: found.id });
	}

	function pickTemplate(id: string) {
		const found = SCAD_TEMPLATES.find((p) => p.id === id);
		if (found) load({ title: found.label, code: found.source, program: NEW });
	}

	async function keep() {
		const done = await core.saveProgram({ id: program, title: name, code });
		program = done.id;
		title = done.title;
		saved = done.code;
		programs = own(await core.programs());
	}

	async function remove() {
		removing = false;
		await core.deleteProgram(program);
		program = NEW;
		saved = '';
		programs = own(await core.programs());
	}

	async function openFile(chosen: File | undefined) {
		if (picker) picker.value = '';
		if (chosen) load({ title: chosen.name.replace(/\.[^.]+$/, ''), code: await chosen.text(), program: NEW });
	}

	const saveText = () => core.saveFile(`${file}.scad`, new TextEncoder().encode(code));
	const saveStl = () => stl && core.saveFile(`${file}.stl`, stl);

	async function finish() {
		const job = await core.importModel(name, await modelFile(stl!));
		await core.writeFile(job.id, 'model.scad', new TextEncoder().encode(applyParams(code, params)));
		go('result', job.id);
		return job;
	}

	async function toLibrary() {
		adding = true;
		try {
			await finish();
		} finally {
			adding = false;
		}
	}

	openDesk({
		read: () => ({ title, program, params, compiling, error: failure, log, ready: !!stl && !failure, size, elapsed: Math.round(elapsed) }),
		load: (next) => load({ program: NEW, ...next }, false),
		setCode: edited,
		setParam,
		compile,
		stl: () => stl,
		templates: () => SCAD_TEMPLATES.map(({ id, label }) => ({ id, label })),
		programs: () => programs,
		finish
	});

	onMount(async () => {
		programs = own(await core.programs());
		const { ScadViewer } = await import('../studio/openscad/three-viewer');
		if (!host) return;
		const made = await ScadViewer.create(host, { color: 0xc9c9cc });
		if (left) return made.dispose();
		viewer = made;
		view = sceneView(made);
		if (code.trim() && !stl && !compiling) void compile();
	});

	onDestroy(() => {
		left = true;
		stop();
		viewer?.dispose();
	});
</script>

<div class="desk" bind:clientWidth={room} style:--code="{panes.code}px" style:--side="{panes.side}px">
	<header bind:offsetHeight={top}>
		<Icon name="code" size={18} />
		<input class="input small title" aria-label={t('scad.name')} placeholder={t('scad.untitled')} bind:value={title} />
		<div class="choose">
			<Select small icon="folder" label={t('scad.programs')} value={program} onchange={pickProgram} options={[{ value: NEW, label: t('scad.programs') }, ...programs.map((p) => ({ value: p.id, label: p.title }))]} />
		</div>
		<div class="choose">
			<Select small icon="grid" label={t('scad.templates')} value="" onchange={pickTemplate} options={[{ value: '', label: t('scad.templates') }, ...SCAD_TEMPLATES.map((p) => ({ value: p.id, label: p.label }))]} />
		</div>
		<input bind:this={picker} class="hidden" type="file" accept=".scad,.txt" aria-hidden="true" tabindex="-1" onchange={(e) => openFile(e.currentTarget.files?.[0])} />
		<MoreMenu
			actions={[
				{ label: t('scad.open'), icon: 'folder', run: () => picker?.click() },
				{ label: t('scad.saveFile'), icon: 'download', run: saveText },
				{ label: t('agent.button'), icon: 'plug', run: () => (app.connect = true) },
				...(program ? [{ label: t('scad.delete'), icon: 'trash' as const, run: () => (removing = true), danger: true }] : [])
			]}
		/>
		<button class="btn small" disabled={!code.trim() || (!dirty && !!program)} onclick={keep}><Icon name="check" size={14} />{t(dirty || !program ? 'scad.save' : 'scad.saved')}</button>
	</header>

	<div class="source studio">
		<ScadEditor bind:value={code} onChange={edited} {errorLine} {diagnostics} {status} elapsedMs={elapsed} onRun={compile} onSave={keep} />
	</div>

	<section class="scene">
		<div class="host" bind:this={host}></div>
		<ViewControls viewer={view} {facts} grid />
		{#if !stl && !compiling && !failure}<p class="empty muted">{t('scad.empty')}</p>{/if}
		<div class="status">
			{#if compiling}
				<span class="chip" role="status">{t('scad.building')}</span>
				<button class="btn small" onclick={stop}><Icon name="x" size={14} />{t('scad.stop')}</button>
			{:else if size && !failure}
				<span class="chip">{num(size[0], 1)} × {num(size[1], 1)} × {num(size[2], 1)} {t('scad.mm')}</span>
			{/if}
			{#if failure}<p class="note bad selectable" role="alert">{failure}</p>{/if}
		</div>
		<div class="actions">
			<button class="btn small primary" disabled={!stl || !!failure || compiling || adding || built !== code} onclick={toLibrary}><Icon name="library" size={14} />{t('tools.toLibrary')}</button>
			<button class="btn small" title={t('print.saveStl')} disabled={!stl || !!failure} onclick={saveStl}><Icon name="download" size={14} />STL</button>
			<button class="btn small" disabled={compiling || !code.trim()} onclick={compile}><Icon name="play" size={14} />{t('scad.build')}</button>
		</div>
	</section>

	{#if params.length}
		<aside class="params studio">
			<ScadParameters {params} onChange={setParam} />
		</aside>
	{/if}
	{#if room}<DeskEdges desk="openscad" {room} {top} side={params.length > 0} />{/if}
</div>

{#if replacing}
	<Dialog title={t('scad.replaceTitle')} onclose={() => (replacing = null)}>
		<p class="muted">{t('scad.replaceText')}</p>
		<div class="row-end">
			<button class="btn ghost" onclick={() => (replacing = null)}>{t('models.cancel')}</button>
			<button class="btn primary" onclick={() => replacing && load(replacing, false)}>{t('scad.replace')}</button>
		</div>
	</Dialog>
{/if}

{#if removing}
	<Dialog title={t('scad.deleteTitle', { name })} onclose={() => (removing = false)}>
		<p class="muted">{t('scad.deleteText')}</p>
		<div class="row-end">
			<button class="btn ghost" onclick={() => (removing = false)}>{t('models.cancel')}</button>
			<button class="btn danger" onclick={remove}><Icon name="trash" size={16} />{t('scad.delete')}</button>
		</div>
	</Dialog>
{/if}

<style>
	.desk {
		position: relative;
		height: 100%;
		display: grid;
		grid-template-columns: var(--code) minmax(0, 1fr) auto;
		grid-template-rows: auto minmax(0, 1fr);
	}

	header {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
	}

	.title {
		flex: 1 1 140px;
		min-width: 100px;
	}

	/* as wide as its words, «Мои программы» whole; a long program name stops at 220 px */
	.choose {
		flex: 0 1 auto;
		min-width: 0;
		max-width: 220px;
	}

	.hidden {
		display: none;
	}

	.source {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--line);
		--pz-color-subtle: var(--surface);
	}

	.source :global(.editor-statusbar) {
		padding: 0 16px;
	}

	.scene {
		position: relative;
		min-width: 0;
		background: var(--viewer);
	}

	.host {
		position: absolute;
		inset: 0;
	}

	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 24px;
		text-align: center;
		pointer-events: none;
	}

	.status {
		position: absolute;
		top: 12px;
		left: 12px;
		right: 64px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}

	.status > * {
		pointer-events: auto;
	}

	.status .note {
		max-height: 40%;
		overflow-y: auto;
		white-space: pre-wrap;
	}

	/* clear of the view tools down the right, and centred under the model: as wide a margin on the left */
	.actions {
		position: absolute;
		left: 64px;
		right: 64px;
		bottom: 12px;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		pointer-events: none;
	}

	.actions .btn {
		pointer-events: auto;
	}

	.params {
		width: var(--side);
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 12px;
		overflow-y: auto;
		border-left: 1px solid var(--line);
	}

	/* a scene needs its height: with too little room the page scrolls and nothing is squeezed */
	@container (max-width: 860px) {
		.desk {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-rows: auto 440px auto;
			overflow-y: auto;
		}

		.params {
			grid-column: 1 / -1;
			width: auto;
			border-left: 0;
			border-top: 1px solid var(--line);
		}
	}

	@container (max-width: 560px) {
		.desk {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto 320px 360px auto;
		}

		.source {
			border-right: 0;
		}
	}
</style>
