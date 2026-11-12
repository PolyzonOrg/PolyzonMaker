<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { core, type Job, type Program } from '../lib/core';
	import { lang, t, type Key } from '../lib/i18n.svelte';
	import { fitted } from '../lib/menu';
	import { app, go } from '../lib/state.svelte';
	import { openCad, type CadParam } from '../cad/agent';
	import { build, CadError, stlOf, warm, type BuiltPart } from '../cad/client';
	import { EXAMPLES } from '../cad/examples';
	import { handle as onKeys } from '../lib/keys';
	import { addPart, dropPart, modelsIn, placeOf, setPaint, setParam, setPlace, usesIn } from '../cad/source';
	import type { CadViewer, Handle } from '../cad/viewer';
	import DeskEdges from '../parts/DeskEdges.svelte';
	import Dialog from '../parts/Dialog.svelte';
	import Icon from '../parts/Icon.svelte';
	import MoreMenu from '../parts/MoreMenu.svelte';
	import Select from '../parts/Select.svelte';
	import ViewControls from '../parts/ViewControls.svelte';
	import { num } from '../studio/i18n/current';
	import ScadEditor from '../studio/components/scad/ScadEditor.svelte';
	import type { ScadDiagnostic } from '../studio/openscad/diagnostics';
	import '../studio/styles/studio.css';

	const DRAFT_KEY = 'maker-cad-draft';
	const NEW = '';
	const label = (e: (typeof EXAMPLES)[number]) => (lang.value === 'ru' ? e.label.ru : e.label.en);

	function opening(): { title: string; code: string; program: string } {
		const draft = readDraft();
		if (app.cad) {
			// what the person was working on must not vanish under what was handed over
			if (draft?.code && !EXAMPLES.some((e) => e.code === draft.code)) void core.saveProgram({ id: draft.program, title: draft.title || t('scad.untitled'), code: draft.code, kind: 'cad' });
			return app.cad;
		}
		if (draft?.code) return draft;
		return { title: label(EXAMPLES[0]), code: EXAMPLES[0].code, program: NEW };
	}

	function readDraft(): { title: string; code: string; program: string } | null {
		try {
			return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
		} catch {
			return null; // blocked or broken storage only costs the draft
		}
	}

	const own = (list: Program[]) => list.filter((p) => p.kind === 'cad');
	const first = opening();
	app.cad = null;
	let title = $state(first.title);
	let code = $state(first.code);
	let program = $state(first.program);
	let programs = $state<Program[]>([]);
	let saved = $state(first.program ? first.code : '');

	let parts = $state.raw<BuiltPart[]>([]);
	/** What `parts` were built from: a model goes to the library only with its own program. */
	let built = $state('');
	let params = $state<CadParam[]>([]);
	let warnings = $state<string[]>([]);
	let failure = $state<string | null>(null);
	let failedLine = $state<number | null>(null);
	let compiling = $state(false);
	let elapsed = $state(0);
	let picked = $state<string | null>(null);
	let hidden = $state<Set<string>>(new Set());
	let handle = $state<Handle>('translate');
	let replacing = $state<{ title: string; code: string; program: string } | null>(null);
	let removing = $state(false);
	let adding = $state(false);
	let library = $state<Job[]>([]);

	let language = $state.raw<import('@codemirror/state').Extension | null>(null);
	let host = $state<HTMLDivElement>();

	/** How wide the desk is and where its header ends: its edges stand between the columns below the header */
	let room = $state(0);
	let top = $state(0);
	const panes = $derived(room ? fitted(room, app.panes.cad, true) : app.panes.cad);
	let picker = $state<HTMLInputElement>();
	let viewer = $state.raw<CadViewer | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let clock: ReturnType<typeof setInterval> | undefined;
	let controller: AbortController | null = null;
	let run = 0;
	let fitNext = true;

	const name = $derived(title.trim() || t('scad.untitled'));
	/** A kept program is what the list says, not what the draft remembers. */
	const kept = $derived(programs.find((p) => p.id === program));
	const dirty = $derived(kept ? code !== kept.code || name !== kept.title : code !== saved);
	const file = $derived(name.replace(/[\\/:*?"<>|]+/g, ' ').trim());
	const stl = $derived(parts.length ? stlOf(parts) : null);
	const names = $derived([...new Map([...parts].reverse().map((p) => [p.name, p])).values()].reverse());
	const size = $derived.by(() => {
		if (!parts.length) return null;
		return [0, 1, 2].map((i) => Math.max(...parts.map((p) => p.max[i])) - Math.min(...parts.map((p) => p.min[i])));
	});
	/** What the view's "About the model" says. */
	const facts = $derived.by((): [Key, string][] => {
		if (!parts.length || !size) return [];
		const n = (v: number) => v.toLocaleString(lang.value);
		return [
			['view.fact.parts', n(names.length)],
			['view.fact.triangles', n(parts.reduce((all, p) => all + p.triangles.length / 9, 0))],
			['view.fact.size', `${size.map((v) => num(v, 1)).join(' × ')} ${t('scad.mm')}`]
		];
	});
	const diagnostics = $derived<ScadDiagnostic[]>(failure && failedLine ? [{ line: failedLine, severity: 'error', message: failure }] : []);
	const status = $derived(compiling ? 'compiling' : failure ? 'error' : parts.length ? 'ok' : 'idle');

	$effect(() => {
		const draft = { title, code, program };
		try {
			localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
		} catch {
			// the draft is a convenience
		}
	});

	function stop() {
		clearTimeout(timer);
		controller?.abort();
		run++;
		compiling = false;
		clearInterval(clock);
	}

	/** What a program takes from outside itself: kept programs and examples it uses, models of the library. */
	async function needed(source: string) {
		const known = new Map([...EXAMPLES.flatMap((e) => [[e.id, e.code], [label(e), e.code]] as const), ...programs.map((p) => [p.title, p.code] as const)]);
		const used: Record<string, string> = {};
		const texts = [source];
		for (const text of texts) {
			for (const name of usesIn(text)) {
				const found = known.get(name);
				if (found === undefined || name in used) continue;
				used[name] = found;
				texts.push(found);
			}
		}
		const models: Record<string, Float32Array> = {};
		const wanted = texts.flatMap(modelsIn);
		if (wanted.length) {
			const { readGlb } = await import('@polyzon/mesh-kit');
			const jobs = await core.jobs();
			for (const title of wanted) {
				const job = jobs.find((j) => j.title === title || j.id === title);
				if (job) models[title] = readGlb(new Uint8Array(await core.readFile(job.id, 'model.glb')));
			}
		}
		return { models, programs: used };
	}

	async function compile() {
		clearTimeout(timer);
		controller?.abort();
		const mine = ++run;
		const started = performance.now();
		const signal = (controller = new AbortController()).signal;
		compiling = true;
		elapsed = 0;
		clearInterval(clock);
		clock = setInterval(() => (elapsed = performance.now() - started), 200);
		try {
			const source = code;
			const done = await build({ code: source, ...(await needed(source)) }, signal);
			if (mine !== run) return;
			failure = null;
			failedLine = null;
			parts = done.parts;
			built = source;
			params = done.params;
			warnings = done.warnings;
			viewer?.show(done.parts, fitNext);
			fitNext = false;
		} catch (error) {
			if (mine !== run || (error instanceof DOMException && error.name === 'AbortError')) return;
			failure = error instanceof Error ? error.message : String(error);
			failedLine = error instanceof CadError ? error.line : null;
		} finally {
			if (mine === run) {
				compiling = false;
				clearInterval(clock);
				elapsed = performance.now() - started;
			}
		}
	}

	const later = () => {
		clearTimeout(timer);
		timer = setTimeout(() => void compile(), 500);
	};

	function edited(next: string) {
		code = next;
		later();
	}

	function changeParam(param: string, value: number) {
		code = setParam(code, param, value);
		params = params.map((p) => (p.name === param ? { ...p, value } : p));
		later();
	}

	function load(next: { title: string; code: string; program?: string }, ask = true) {
		const item = { program: NEW, ...next };
		if (ask && dirty) {
			replacing = item;
			return;
		}
		replacing = null;
		title = item.title;
		code = item.code;
		program = item.program;
		saved = item.program ? item.code : '';
		parts = [];
		params = [];
		warnings = [];
		failure = null;
		picked = null;
		hidden = new Set();
		fitNext = true;
		void compile();
	}

	function pickProgram(id: string) {
		if (id === NEW) return load({ title: '', code: '' });
		const found = programs.find((p) => p.id === id);
		if (found) load({ title: found.title, code: found.code, program: found.id });
	}

	function pickExample(id: string) {
		const found = EXAMPLES.find((e) => e.id === id);
		if (found) load({ title: label(found), code: found.code });
	}

	async function keep() {
		const done = await core.saveProgram({ id: program, title: name, code, kind: 'cad' });
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
		if (chosen) load({ title: chosen.name.replace(/\.[^.]+$/, ''), code: await chosen.text() });
	}

	const saveText = () => core.saveFile(`${file}.cad.js`, new TextEncoder().encode(code));
	const saveStl = () => stl && core.saveFile(`${file}.stl`, stl);

	async function saveStep() {
		const done = await build({ code, ...(await needed(code)), step: true });
		if (done.step) await core.saveFile(`${file}.step`, done.step);
		else failure = t('cad.noStep');
	}

	async function finish() {
		const { writeGlb } = await import('@polyzon/mesh-kit');
		const job = await core.importModel(name, writeGlb(parts.map((p) => p.triangles), 'm', parts.map((p) => p.color)));
		await core.writeFile(job.id, 'model.cad.js', new TextEncoder().encode(code));
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

	function add(word: string, make: string) {
		code = addPart(code, word, names.map((p) => p.name), make);
		void compile();
	}

	function toggle(part: string) {
		const next = new Set(hidden);
		if (!next.delete(part)) next.add(part);
		hidden = next;
		viewer?.setHidden(next);
	}

	function pick(part: string | null) {
		picked = part;
		viewer?.pick(part);
	}

	function moved(part: string, by: number[]) {
		const now = placeOf(code, part);
		code = setPlace(code, part, now.map((v, i) => v + by[i]));
		void compile();
	}

	function paint(part: string, color: string) {
		code = setPaint(code, part, color);
		later();
	}

	function takeAway(part: string) {
		code = dropPart(code, part);
		picked = null;
		void compile();
	}

	function useHandle(next: Handle) {
		handle = next;
		viewer?.handle(next);
	}

	openCad({
		read: () => ({ title, code, program, compiling, error: failure, parts, stl, params, warnings, elapsed: Math.round(elapsed) }),
		load: (next) => {
			if (dirty) void core.saveProgram({ id: program, title: name, code, kind: 'cad' });
			load(next, false);
		},
		setCode: (next) => {
			code = next;
		},
		setParams: (values) => {
			for (const [key, value] of Object.entries(values)) code = setParam(code, key, value);
		},
		compile,
		examples: () => EXAMPLES.map((e) => ({ id: e.id, label: label(e), code: e.code })),
		programs: () => programs,
		finish
	});

	/** The first load takes a moment, and the page can be gone before it ends. */
	let left = false;

	const leaveKeys = onKeys({
		'cad.handleMove': () => useHandle('translate'),
		'cad.handleTurn': () => useHandle('rotate'),
		'cad.fit': () => viewer?.fit(),
		'cad.front': () => viewer?.fit([0, -1, 0.001]),
		'cad.side': () => viewer?.fit([1, 0, 0.001]),
		'cad.top': () => viewer?.fit([0, -0.001, 1]),
		'cad.hide': () => picked && toggle(picked),
		'cad.showAll': () => {
			hidden = new Set();
			viewer?.setHidden(hidden);
		},
		'cad.delete': () => picked && takeAway(picked),
		'cad.deselect': () => pick(null),
		'cad.build': () => void compile(),
		'cad.toLibrary': () => {
			if (stl && !failure && !compiling && !adding) void toLibrary();
		}
	});

	onMount(async () => {
		warm();
		// the build needs only the programs a code may use: it starts with them, beside the editor's and the view's
		// code and the library, and a model built before the view is there is shown as it comes
		programs = own(await core.programs());
		if (code.trim() && !parts.length && !compiling) void compile();
		const [{ cadLanguage }, { CadViewer }, jobs] = await Promise.all([import('../cad/editor'), import('../cad/viewer'), core.jobs()]);
		language = cadLanguage();
		library = jobs.filter((j) => j.state === 'succeeded');
		if (!host || left) return;
		viewer = new CadViewer(host, { onPick: pick, onMove: moved });
		if (parts.length) viewer.show(parts, true);
	});

	onDestroy(() => {
		left = true;
		leaveKeys();
		stop();
		viewer?.dispose();
	});
</script>

<div class="desk" bind:clientWidth={room} style:--code="{panes.code}px" style:--side="{panes.side}px">
	<header bind:offsetHeight={top}>
		<!-- the page's heading for a screen reader; on the screen the icon and the program's name say it -->
		<h1 class="sr-only">{t('nav.cad')}</h1>
		<Icon name="cube" size={18} />
		<input class="input small title" aria-label={t('scad.name')} placeholder={t('scad.untitled')} bind:value={title} />
		<div class="choose">
			<Select small icon="folder" label={t('scad.programs')} value={program} onchange={pickProgram} options={[{ value: NEW, label: t('scad.programs') }, ...programs.map((p) => ({ value: p.id, label: p.title }))]} />
		</div>
		<div class="choose">
			<Select small icon="grid" label={t('cad.examples')} value="" onchange={pickExample} options={[{ value: '', label: t('cad.examples') }, ...EXAMPLES.map((e) => ({ value: e.id, label: label(e) }))]} />
		</div>
		<input bind:this={picker} class="hidden" type="file" accept=".js,.txt" aria-hidden="true" tabindex="-1" onchange={(e) => openFile(e.currentTarget.files?.[0])} />
		<MoreMenu
			actions={[
				{ label: t('scad.open'), icon: 'folder', run: () => picker?.click() },
				{ label: t('cad.saveFile'), icon: 'download', run: saveText },
				{ label: t('agent.button'), icon: 'plug', run: () => (app.connect = true) },
				...(program ? [{ label: t('scad.delete'), icon: 'trash' as const, run: () => (removing = true), danger: true }] : [])
			]}
		/>
		<button class="btn small" disabled={!code.trim() || (!dirty && !!program)} onclick={keep}><Icon name="check" size={14} />{t(dirty || !program ? 'scad.save' : 'scad.saved')}</button>
	</header>

	<div class="source studio">
		{#if language}
			<ScadEditor bind:value={code} onChange={edited} errorLine={failedLine} {diagnostics} {status} elapsedMs={elapsed} onRun={compile} onSave={keep} {language} heading={t('cad.code')} />
		{/if}
	</div>

	<section class="scene">
		<div class="host" bind:this={host}></div>
		{#if !parts.length && !compiling && !failure}<p class="empty muted">{t('cad.empty')}</p>{/if}
		<div class="status">
			{#if compiling}
				<span class="chip" role="status">{t('scad.building')}</span>
				<button class="btn small" onclick={stop}><Icon name="x" size={14} />{t('scad.stop')}</button>
			{:else if size && !failure}
				<span class="chip">{num(size[0], 1)} × {num(size[1], 1)} × {num(size[2], 1)} {t('scad.mm')}</span>
			{/if}
			{#if failure}<p class="note bad selectable" role="alert">{failure}</p>{/if}
			{#each warnings as warning (warning)}<p class="note warn selectable">{warning}</p>{/each}
		</div>
		<ViewControls {viewer} facts={facts} grid keyed>
			{#snippet before()}
				<button class="tool" data-keys="cad.handleMove" class:on={handle === 'translate'} title={t('cad.move')} aria-label={t('cad.move')} aria-pressed={handle === 'translate'} onclick={() => useHandle('translate')}><Icon name="move" size={16} /></button>
				<button class="tool" data-keys="cad.handleTurn" class:on={handle === 'rotate'} title={t('cad.turn')} aria-label={t('cad.turn')} aria-pressed={handle === 'rotate'} onclick={() => useHandle('rotate')}><Icon name="rotate" size={16} /></button>
				<hr />
			{/snippet}
		</ViewControls>
		<div class="actions">
			<button class="btn small primary" disabled={!stl || !!failure || compiling || adding || built !== code} onclick={toLibrary}><Icon name="library" size={14} />{t('tools.toLibrary')}</button>
			<button class="btn small" title={t('print.saveStl')} disabled={!stl || !!failure} onclick={saveStl}><Icon name="download" size={14} />STL</button>
			<button class="btn small" title={t('cad.saveStep')} disabled={!stl || !!failure} onclick={saveStep}><Icon name="download" size={14} />STEP</button>
			<button class="btn small" disabled={compiling || !code.trim()} onclick={compile}><Icon name="play" size={14} />{t('scad.build')}</button>
		</div>
	</section>

	<aside class="side studio">
		<h2>{t('cad.add')}</h2>
		<div class="adds">
			<button class="btn small" onclick={() => add('box', 'box(40, 40, 40)')}>{t('cad.box')}</button>
			<button class="btn small" onclick={() => add('cylinder', 'cyl(20, 40)')}>{t('cad.cylinder')}</button>
			<button class="btn small" onclick={() => add('ball', 'ball(20)')}>{t('cad.ball')}</button>
			<button class="btn small" onclick={() => add('text', "text('Text', 12, 2)")}>{t('cad.text')}</button>
		</div>
		{#if library.length}
			<Select small icon="library" label={t('cad.fromLibrary')} value="" onchange={(id) => { const job = library.find((j) => j.id === id); if (job) add('model', `model('${job.title.replace(/'/g, "\\'")}')`); }} options={[{ value: '', label: t('cad.fromLibrary') }, ...library.map((j) => ({ value: j.id, label: j.title }))]} />
		{/if}

		{#if params.length}
			<h2>{t('cad.params')}</h2>
			{#each params as param (param.name)}
				<label class="param">
					<span>{param.name}</span>
					<input class="range" style:--range-p={(param.value - param.min) / (param.max - param.min)} type="range" min={param.min} max={param.max} step={param.step} value={param.value} oninput={(e) => changeParam(param.name, +e.currentTarget.value)} />
					<input class="input small" type="number" min={param.min} max={param.max} step={param.step} value={param.value} onchange={(e) => changeParam(param.name, +e.currentTarget.value)} />
				</label>
			{/each}
		{/if}

		{#if names.length}
			<h2>{t('cad.parts')}</h2>
			<ul class="parts">
				{#each names as part (part.name)}
					<li class:on={picked === part.name}>
						<input class="swatch" type="color" aria-label={t('cad.color', { name: part.name })} value={part.color ?? '#b9babd'} onchange={(e) => paint(part.name, e.currentTarget.value)} />
						<button class="name" onclick={() => pick(picked === part.name ? null : part.name)}>{part.name}</button>
						<button class="tool" title={t('cad.hide')} aria-label={t('cad.hide')} aria-pressed={hidden.has(part.name)} onclick={() => toggle(part.name)}><Icon name={hidden.has(part.name) ? 'eyeOff' : 'eye'} size={14} /></button>
						<button class="tool" title={t('scad.delete')} aria-label={t('scad.delete')} onclick={() => takeAway(part.name)}><Icon name="trash" size={14} /></button>
					</li>
				{/each}
			</ul>
		{/if}
	</aside>
	{#if room}<DeskEdges desk="cad" {room} {top} side />{/if}
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
		grid-template-columns: var(--code) minmax(0, 1fr) var(--side);
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
		/* Lighter than the other scenes: parts are often black here. */
		background: color-mix(in srgb, var(--viewer) 82%, #8a8b92);
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
		max-height: 30vh;
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
	}

	.side {
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 12px;
		overflow-y: auto;
		border-left: 1px solid var(--line);
	}

	/* the side panel's sections, under the page's heading */
	h2 {
		margin: 8px 0 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: normal;
	}

	.adds {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
		gap: 4px;
	}

	.param {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 84px;
		gap: 4px 8px;
		align-items: center;
		font-size: 12px;
	}

	.param span {
		grid-column: 1 / -1;
	}

	.parts {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.parts li {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 4px;
		border-radius: var(--r-sm);
	}

	.parts li.on {
		background: var(--surface-2);
	}

	.parts .tool {
		width: 24px;
		height: 24px;
		background: transparent;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 12px;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.swatch {
		flex: none;
		width: 18px;
		height: 18px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		overflow: hidden;
	}

	/* a scene needs its height: with too little room the page scrolls and nothing is squeezed */
	@container (max-width: 860px) {
		.desk {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-rows: auto 440px auto;
			overflow-y: auto;
		}

		.side {
			grid-column: 1 / -1;
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
