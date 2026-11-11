// What another program sees of the tools: the same form a person sees (./fields), live, whichever tool
// is open. The window does the work, in plain sight.
import { onDestroy, tick } from 'svelte';
import { core, type Job } from '../lib/core';
import { pictures } from '../lib/scad';
import { go } from '../lib/state.svelte';
import type { Look } from './chat/scad-run';
import { checked, form } from './fields';
import type { ScadParam } from './openscad/parser';

// what the field components import, as Studio's code is brought in (sync-studio.mjs)
export { field } from './fields';

/** The open tool, as its shell knows it. */
export interface Bench {
	slug: string;
	busy: boolean;
	error: string | null;
	stale: boolean;
	ready: boolean;
	size: readonly [number, number, number] | null;
	form: () => HTMLElement | undefined;
	finish: () => Promise<Job>;
	snapshot: () => Promise<Blob | null>;
	rebuild?: () => void;
}

/** The OpenSCAD page, as it knows itself. */
export interface Desk {
	read: () => { title: string; program: string; params: readonly ScadParam[]; compiling: boolean; error: string | null; log: string; ready: boolean; size: readonly [number, number, number] | null; elapsed: number };
	load: (next: { title: string; code: string; program?: string }) => void;
	setCode: (code: string) => void;
	setParam: (name: string, value: string | number | boolean) => void;
	compile: () => Promise<void>;
	stl: () => Uint8Array | null;
	templates: () => { id: string; label: string }[];
	programs: () => { id: string; title: string; code: string }[];
	finish: () => Promise<Job>;
}

let bench: Bench | null = null;
let desk: Desk | null = null;

export function openBench(one: Bench): void {
	bench = one;
	onDestroy(() => {
		if (bench === one) bench = null;
	});
}

export function openDesk(one: Desk): void {
	desk = one;
	onDestroy(() => {
		if (desk === one) desk = null;
	});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settled() {
	await tick();
	await sleep(50);
	// clients give up on a call after about a minute: a longer build answers `building` and goes on
	for (let waited = 0; bench?.busy && waited < 45_000; waited += 100) await sleep(100);
}

function report() {
	if (!bench) throw new Error('No tool is open: call maker_tool_open first.');
	const { slug, busy, error, stale, ready, size } = bench;
	const shown = form().map(([name, f]) => ({
		name,
		kind: f.kind,
		...(f.kind === 'file' ? {} : { value: f.value }),
		...(f.min !== undefined && { min: f.min, max: f.max, step: f.step }),
		...(f.unit && { unit: f.unit }),
		...(f.options && { options: f.options.map((o) => ({ value: o.value, label: o.label })) }),
		...(f.accept && { accept: f.accept }),
		...(f.hint && { hint: f.hint })
	}));
	return { tool: slug, fields: shown, buttons: buttons().map((b) => b.textContent?.trim()), building: busy, error, stale, ready, size_mm: size };
}

/** What can be pressed besides the fields: ready-made variants and the like, not a choice or a group's heading. */
const buttons = () => [...(bench?.form()?.querySelectorAll('button:not([aria-pressed], .collapse-toggle)') ?? [])].filter((b) => !(b as HTMLButtonElement).disabled && b.textContent?.trim()) as HTMLButtonElement[];

async function set(values: Record<string, unknown>) {
	const known = new Map(form());
	for (const [name, value] of Object.entries(values)) {
		const f = known.get(name);
		if (!f) throw new Error(`No field «${name}» here. There are: ${[...known.keys()].join(', ')}`);
		if (f.kind === 'file') {
			const id = (value as { job?: string })?.job;
			if (!id) throw new Error(`«${name}» takes a finished job: {"job": "<id>"}`);
			f.open?.(new File([await core.readFile(id, 'model.glb')], 'model.glb'));
		} else f.value = checked(name, f, value);
		await tick();
	}
	await settled();
}

async function open(slug: string) {
	const { TOOLS } = await import('./tools/registry');
	if (!TOOLS.some((t) => t.slug === slug)) throw new Error(`No tool «${slug}». maker_tools_list has them all.`);
	go('tool', slug);
	for (let waited = 0; bench?.slug !== slug && waited < 30_000; waited += 100) await sleep(100);
	await settled();
}

const base64 = (blob: Blob) =>
	new Promise<string>((done) => {
		const reader = new FileReader();
		reader.onload = () => done(String(reader.result).split(',')[1]);
		reader.readAsDataURL(blob);
	});

async function picture() {
	const blob = await bench?.snapshot();
	if (!blob) throw new Error('There is nothing to look at yet.');
	return { png: await base64(blob) };
}

/** What is on the OpenSCAD page. The code is left out: the caller wrote it, and it costs tokens to read. */
function deskReport() {
	if (!desk) throw new Error('OpenSCAD is not open: call maker_scad_open first.');
	const { title, program, params, compiling, error, log, ready, size, elapsed } = desk.read();
	return {
		title,
		program,
		building: compiling,
		ready,
		size_mm: size?.map((v) => Math.round(v * 100) / 100),
		error,
		warnings: log.split('\n').filter((line) => /warning/i.test(line)).slice(0, 12),
		seconds: Math.round(elapsed / 100) / 10,
		params: params.map(({ name, label, kind, value, min, max, options }) => ({ name, label, kind, value, min, max, options }))
	};
}

/** Waits for the build to stand still, up to what a client will sit through. A newer build can replace this one. */
async function built() {
	void desk!.compile();
	await tick();
	for (let waited = 0; desk?.read().compiling && waited < 45_000; waited += 50) await sleep(50);
	return deskReport();
}

async function scadOpen(args: Record<string, unknown>) {
	go('openscad');
	for (let waited = 0; !desk && waited < 15_000; waited += 100) await sleep(100);
	if (!desk) throw new Error('The OpenSCAD page did not open.');
	const template = desk.templates().find((t) => t.id === args.template);
	const saved = desk.programs().find((p) => p.id === args.program);
	if (args.template && !template) throw new Error(`No template «${args.template}». There are: ${desk.templates().map((t) => t.id).join(', ')}`);
	if (args.program && !saved) throw new Error(`No program «${args.program}».`);
	const { SCAD_TEMPLATES } = await import('./openscad/templates');
	if (saved) desk.load({ title: saved.title, code: saved.code, program: saved.id });
	else if (template) desk.load({ title: template.label, code: SCAD_TEMPLATES.find((t) => t.id === template.id)!.source });
	else if (typeof args.code === 'string') desk.load({ title: String(args.title ?? ''), code: args.code });
	await tick();
	return { ...(await built()), templates: desk.templates(), programs: desk.programs().map(({ id, title }) => ({ id, title })) };
}

async function scadSet(args: Record<string, unknown>) {
	if (!desk) throw new Error('OpenSCAD is not open: call maker_scad_open first.');
	if (typeof args.code === 'string') desk.setCode(args.code);
	for (const [name, value] of Object.entries((args.params ?? {}) as Record<string, string | number | boolean>)) {
		if (!desk.read().params.some((p) => p.name === name)) throw new Error(!desk.read().params.length ? 'This program has no parameters.' : `No parameter «${name}». There are: ${desk.read().params.map((p) => p.name).join(', ')}`);
		desk.setParam(name, value);
	}
	await tick();
	return built();
}

async function scadView(args: Record<string, unknown>) {
	const stl = desk?.stl();
	if (!stl) throw new Error('There is no built model to look at.');
	return { png: await base64(await pictures(stl, args as Look)) };
}

async function scadFinish() {
	if (!desk?.read().ready) throw new Error(desk?.read().error ?? 'There is no built model yet.');
	return { job: (await desk.finish()).id };
}

async function finish() {
	if (!bench?.ready) throw new Error(bench?.error ?? 'There is no finished model yet.');
	if (bench.stale) bench.rebuild?.();
	await settled();
	return { job: (await bench.finish()).id };
}

/** One call from the local API: `args` come from outside and are checked here. */
export async function toolCall(call: string, args: Record<string, unknown>): Promise<unknown> {
	if (call === 'list') {
		const { TOOLS } = await import('./tools/registry');
		const wanted = String(args.query ?? '').trim();
		const found = wanted ? new Set((await import('./tools/catalog-search')).findTools(wanted).hits.map((h) => h.slug)) : null;
		return TOOLS.filter((t) => !found || found.has(t.slug)).map(({ slug, title, description, category }) => ({ slug, title, description, category }));
	}
	if (call.startsWith('cad_')) return (await import('../cad/agent')).cadCall(call.slice(4), args);
	if (call === 'scad_open') return scadOpen(args);
	if (call === 'scad_set') return scadSet(args);
	if (call === 'scad_status') return deskReport();
	if (call === 'scad_view') return scadView(args);
	if (call === 'scad_finish') return scadFinish();
	if (call === 'open') await open(String(args.slug));
	else if (call === 'status') await settled();
	else if (call === 'set') await set((args.values ?? {}) as Record<string, unknown>);
	else if (call === 'press') {
		const pressed = buttons().find((b) => b.textContent?.trim() === args.label);
		if (!pressed) throw new Error(`No button «${args.label}» here.`);
		pressed.click();
		await settled();
	} else if (call === 'view') return picture();
	else if (call === 'finish') return finish();
	return report();
}
