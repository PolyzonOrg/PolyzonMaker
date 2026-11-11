// What other programs see of the CAD page. A model reads an answer after every build, so an answer is
// a few lines of plain text, and a change can be a few words of the program instead of all of it.
import { onDestroy, tick } from 'svelte';
import { pictures } from '../lib/scad';
import type { Look } from '../studio/chat/scad-run';
import { go } from '../lib/state.svelte';
import { applyEdits } from './source';
import type { BuiltPart } from './client';

export interface CadParam {
	name: string;
	value: number;
	min: number;
	max: number;
	step: number;
}

export interface CadDesk {
	read(): {
		title: string;
		code: string;
		program: string;
		compiling: boolean;
		error: string | null;
		parts: BuiltPart[];
		stl: Uint8Array | null;
		params: CadParam[];
		warnings: string[];
		elapsed: number;
	};
	load(next: { title: string; code: string; program?: string }): void;
	setCode(code: string): void;
	setParams(values: Record<string, number>): void;
	compile(): Promise<void>;
	examples(): { id: string; label: string; code: string }[];
	programs(): { id: string; title: string; code: string }[];
	finish(): Promise<{ id: string }>;
}

let desk: CadDesk | null = null;

export function openCad(open: CadDesk) {
	desk = open;
	onDestroy(() => {
		if (desk === open) desk = null;
	});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mm = (v: number) => String(Math.round(v * 10) / 10);

/** Parts under one name are one line. */
function lines(parts: BuiltPart[]) {
	const named = new Map<string, BuiltPart[]>();
	for (const p of parts) named.set(p.name, [...(named.get(p.name) ?? []), p]);
	return [...named].map(([name, list]) => {
		const min = [0, 1, 2].map((i) => Math.min(...list.map((p) => p.min[i])));
		const max = [0, 1, 2].map((i) => Math.max(...list.map((p) => p.max[i])));
		const count = list.length > 1 ? ` ×${list.length}` : '';
		return `${name}${count} ${min.map((v, i) => mm(max[i] - v)).join('×')} @${min.map((v, i) => mm((v + max[i]) / 2)).join(',')}`;
	});
}

/** What a build came to. */
export function report(state: ReturnType<CadDesk['read']>): string {
	if (state.compiling) return 'building; ask for status in a moment';
	if (state.error) return `error: ${state.error}`;
	if (!state.parts.length) return 'nothing built yet';
	const all = (key: 'min' | 'max', pick: (...v: number[]) => number) => [0, 1, 2].map((i) => pick(...state.parts.map((p) => p[key][i])));
	const [min, max] = [all('min', Math.min), all('max', Math.max)];
	const params = state.params.map((p) => `${p.name}=${p.value} [${p.min}..${p.max}]`).join(' ');
	return [
		`built ${mm(state.elapsed / 1000)}s ${min.map((v, i) => mm(max[i] - v)).join('×')} mm`,
		...lines(state.parts),
		...(params ? [`params ${params}`] : []),
		...state.warnings.map((w) => `! ${w}`)
	].join('\n');
}

/** Waits for the build to stand still, up to what a client will sit through. */
async function built(d: CadDesk) {
	await tick();
	for (let waited = 0; d.read().compiling && waited < 45_000; waited += 50) await sleep(50);
	return { text: report(d.read()) };
}

async function open(args: Record<string, unknown>) {
	go('cad');
	for (let waited = 0; !desk && waited < 15_000; waited += 100) await sleep(100);
	if (!desk) throw new Error('The CAD page did not open.');
	const d = desk;
	const example = d.examples().find((e) => e.id === args.example);
	const saved = d.programs().find((p) => p.id === args.program);
	if (args.example && !example) throw new Error(`No example «${args.example}». There are: ${d.examples().map((e) => e.id).join(', ')}`);
	if (args.program && !saved) throw new Error(`No program «${args.program}».`);
	if (saved) d.load({ title: saved.title, code: saved.code, program: saved.id });
	else if (example) d.load({ title: example.label, code: example.code });
	else if (typeof args.code === 'string') d.load({ title: String(args.title ?? ''), code: args.code });
	const answer = await built(d);
	const list = d.programs().map((p) => `${p.id} ${p.title}`);
	return { text: [answer.text, `examples ${d.examples().map((e) => e.id).join(' ')}`, ...(list.length ? [`programs ${list.join(', ')}`] : [])].join('\n') };
}

function needed() {
	if (!desk) throw new Error('CAD is not open: call maker_cad_open first.');
	return desk;
}

async function set(args: Record<string, unknown>) {
	const d = needed();
	const { code } = d.read();
	if (Array.isArray(args.edits)) d.setCode(applyEdits(code, args.edits as { find: string; put: string }[]));
	else if (typeof args.code === 'string') d.setCode(args.code);
	if (args.params) {
		const known = d.read().params.map((p) => p.name);
		const asked = args.params as Record<string, number>;
		for (const name of Object.keys(asked)) if (!known.includes(name)) throw new Error(`No parameter «${name}». There are: ${known.join(', ') || 'none'}`);
		d.setParams(asked);
	}
	void d.compile();
	return built(d);
}

async function view(args: Record<string, unknown>) {
	const { stl, parts } = needed().read();
	if (!stl) throw new Error('There is no built model to look at.');
	const cell = Math.min(Math.max(Number(args.cell) || 256, 128), 512);
	const picture = await pictures(stl, { views: args.views, section: args.section, part: args.part } as Look, cell, parts.map((p) => ({ name: p.name, color: p.color, triangles: p.triangles.length / 9 })));
	const bytes = new Uint8Array(await picture.arrayBuffer());
	let text = '';
	for (let i = 0; i < bytes.length; i += 32_768) text += String.fromCharCode(...bytes.subarray(i, i + 32_768));
	return { png: btoa(text) };
}

export async function cadCall(call: string, args: Record<string, unknown>) {
	if (call === 'open') return open(args);
	if (call === 'set') return set(args);
	if (call === 'status') return { text: report(needed().read()) };
	if (call === 'view') return view(args);
	if (call === 'finish') {
		const d = needed();
		if (!d.read().stl || d.read().error) throw new Error(d.read().error ?? 'There is no built model yet.');
		return { job: (await d.finish()).id };
	}
	throw new Error(`No call «${call}».`);
}
