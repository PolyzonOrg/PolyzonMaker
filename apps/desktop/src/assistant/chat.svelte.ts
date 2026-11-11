/**
 * The conversation with the local assistant. It lives here and not in a page, because the assistant works
 * on other pages: it opens CAD or OpenSCAD and builds in plain sight while the chat stays open beside them.
 */
import { formatRange } from '../lib/catalog';
import { core, on } from '../lib/core';
import { lang, t, type Key } from '../lib/i18n.svelte';
import { go } from '../lib/state.svelte';
import { applyEdits } from '../cad/source';
import { toolCall } from '../studio/agent';
import type { Choice } from './choose';
import { tally, turn, type Content, type Message, type Outcome, type World } from './loop';
import { firstAction, read, type Action, type Kind, type Page, type Step } from './protocol';
import { SYSTEM } from './prompt';

/** What the chat shows: words, what was done (`app`, as the program said it; `note`, in the person's words), pictures of it, the plan, and answers to pick. */
export interface Line {
	who: 'you' | 'assistant' | 'app' | 'note';
	text: string;
	picture?: string;
	failed?: boolean;
	plan?: Step[];
	options?: string[];
}

export interface Thread {
	id: string;
	title: string;
	updated: number;
	lines: Line[];
	/** What the model read, without pictures. */
	history: Message[];
}

/** What the assistant is doing this moment. */
export type Status =
	| { stage: 'loading' | 'thinking' | 'answering' | 'looking' | 'opening' }
	| { stage: 'writing'; kind: Kind }
	| { stage: 'building'; kind: 'cad' | 'scad' }
	| { stage: 'picture'; job: string; model: string }
	| { stage: 'model'; job: string; model: string; preset: string };

/** Characters of conversation sent to the model, about a third of the tokens the server keeps. */
const MEMORY = 30_000;

export type ThreadName = Pick<Thread, 'id' | 'title' | 'updated'>;

const blank = (): Thread => ({ id: '', title: '', updated: 0, lines: [], history: [] });

export const chat = $state({
	thread: blank(),
	threads: [] as ThreadName[],
	/** The text model in use. */
	model: '',
	sees: false,
	busy: false,
	/** The model is loading into memory. */
	starting: false,
	/** What it does now, and since when */
	status: null as (Status & { since: number }) | null,
	error: '',
	/** What the engine said, for "Technical details". */
	detail: ''
});

let settling: ReturnType<typeof setTimeout> | undefined;

/**
 * The clock of a stage starts when the stage does, not each time it is said again. The few words between
 * two blocks are no stage of their own: «answering» after another stage waits to see if it lasts.
 */
function show(next: Status | null) {
	clearTimeout(settling);
	if (next?.stage === 'answering' && chat.status && chat.status.stage !== 'thinking' && chat.status.stage !== 'answering') {
		settling = setTimeout(() => apply(next), 400);
		return;
	}
	apply(next);
}

function apply(next: Status | null) {
	if (next && chat.status) {
		const { since: _, ...now } = chat.status;
		if (JSON.stringify(now) === JSON.stringify(next)) return;
	}
	chat.status = next && { ...next, since: Date.now() };
}

let stopper: AbortController | null = null;
/** What the assistant last built, so an edit knows what it edits. */
let building: 'cad' | 'scad' = 'cad';
let scadCode = '';

const toDataUrl = (base64: string) => `data:image/jpeg;base64,${base64}`;
const lengthOf = (content: Content) => (typeof content === 'string' ? content.length : JSON.stringify(content).length);

/** The newest messages that fit, starting from what the person said. */
function remembered(history: Message[]): Message[] {
	let left = MEMORY;
	let from = history.length;
	while (from > 0 && left > 0) left -= lengthOf(history[--from].content);
	while (from < history.length && history[from].role !== 'user') from++;
	return [{ role: 'system', content: SYSTEM }, ...history.slice(from)];
}

interface Talk {
	text: string;
	partial(text: string): void;
	resolve(text: string): void;
	reject(error: Error): void;
}

const talks = new Map<string, Talk>();

void on<{ id: string; text: string }>('assistant-delta', ({ id, text }) => {
	const talk = talks.get(id);
	if (!talk) return;
	talk.text += text;
	talk.partial(talk.text);
});

void on<{ id: string; error: string }>('assistant-end', ({ id, error }) => {
	const talk = talks.get(id);
	talks.delete(id);
	if (error) talk?.reject(new Error(error));
	else talk?.resolve(talk.text);
});

/** The model leaves memory when idle or when a generation needs the room: a question brings it back. */
async function ready() {
	chat.starting = true;
	// a model already in memory answers at once: no word about loading for that
	const slow = setTimeout(() => show({ stage: 'loading' }), 300);
	try {
		await core.assistantStart(chat.model);
	} finally {
		clearTimeout(slow);
		chat.starting = false;
	}
}

async function ask(messages: Message[], partial: (text: string) => void, signal: AbortSignal): Promise<string> {
	await ready();
	signal.throwIfAborted();
	show({ stage: 'thinking' });
	return new Promise((resolve, reject) => {
		const id = crypto.randomUUID();
		talks.set(id, { text: '', partial, resolve, reject });
		signal.addEventListener('abort', () => void core.assistantStop(id), { once: true });
		core.assistantChat(id, remembered(messages)).catch(reject);
	});
}

async function look(call: string): Promise<string | undefined> {
	show({ stage: 'looking' });
	const seen = (await toolCall(call, chat.sees ? { views: ['iso', 'front', 'top', 'right'], cell: 256 } : {})) as { png: string };
	return toDataUrl(seen.png);
}

async function buildCad(answer: Promise<unknown>): Promise<Outcome> {
	const { text } = (await answer) as { text: string };
	const failed = /^error:/.test(text);
	return { text: text.split('\nexamples ')[0], failed, picture: failed ? undefined : await look('cad_view') };
}

async function buildScad(answer: Promise<unknown>): Promise<Outcome> {
	const done = (await answer) as { error: string | null; size_mm?: number[]; warnings: string[] };
	if (done.error) return { text: `error: ${done.error}`, failed: true };
	return { text: [`built ${done.size_mm?.join('×')} mm`, ...done.warnings].join('\n'), failed: false, picture: await look('scad_view') };
}

/** «TRELLIS.2 · detail 1024 · ≈ 2–4 min»: what it took, so the person knows why it takes as long as it does. */
function chosen({ model, preset, fit }: Choice) {
	const what = [model.name, preset && t('chat.detail', { preset }), fit.seconds && `≈ ${formatRange(fit.seconds, lang.value)}`];
	return t('chat.chose', { what: what.filter(Boolean).join(' · ') });
}

/** A model from the best generator installed, from the photo the person gave, or from words. */
async function generate(prompt: string): Promise<Outcome> {
	const { generate: make } = await import('./generate');
	const result = await make(prompt, lastPhoto, {
		picture: (job, model) => show({ stage: 'picture', job: job.id, model }),
		model: (job, choice) => {
			show({ stage: 'model', job: job.id, model: choice.model.id, preset: choice.preset });
			line({ who: 'note', text: chosen(choice) });
		}
	});
	if ('cancelled' in result) {
		stopper?.abort(); // the person stopped it: the assistant must not start it over
		return { text: '', failed: false };
	}
	if ('failed' in result) {
		if (result.failed === 'no_model') return { text: 'No 3D model is installed: tell the person to install one on the Models page.', note: t('chat.needs3d'), failed: true };
		if (result.failed === 'no_picture_model') return { text: 'No picture model is installed and there is no photo: ask the person for a photo, or to install a picture model on the Models page.', note: t('chat.needsPicture'), failed: true };
		const error = result.job?.error ?? '';
		return { text: `The ${result.failed} did not come out: ${error}`, note: t(`error.${error}` as Key), failed: true };
	}
	const { done, choice } = result;
	return { text: `The model ${done.id} is generated by ${choice.model.name} and shown to the person, prepared for print.`, note: t('chat.generated'), failed: false };
}

const PAGE_NAMES: Record<Page, Key> = { create: 'nav.new', library: 'nav.library', models: 'nav.models', tools: 'nav.tools', cad: 'nav.cad', openscad: 'nav.scad', settings: 'nav.settings' };

async function openPage(action: Extract<Action, { kind: 'open' }>): Promise<Outcome> {
	if ('page' in action) {
		go(action.page);
		return { text: `The ${action.page} page is open.`, note: t('chat.opened', { page: t(PAGE_NAMES[action.page]) }), failed: false };
	}
	const [tool] = (await toolCall('list', { query: action.tool })) as { slug: string; title: string }[];
	if (!tool) return { text: `No tool matches «${action.tool}». Build it in CAD instead.`, failed: true };
	await toolCall('open', { slug: tool.slug });
	return { text: `The tool «${tool.title}» is open for the person to set up.`, note: t('chat.opened', { page: tool.title }), failed: false };
}

async function act(action: Action): Promise<Outcome> {
	try {
		return await carryOut(action);
	} catch (error) {
		return { text: `error: ${error instanceof Error ? error.message : String(error)}`, failed: true };
	}
}

function carryOut(action: Action): Promise<Outcome> {
	if (action.kind === 'cad') {
		building = 'cad';
		show({ stage: 'building', kind: 'cad' });
		return buildCad(toolCall('cad_open', { title: chat.thread.title, code: action.code }));
	}
	if (action.kind === 'scad') {
		building = 'scad';
		scadCode = action.code;
		show({ stage: 'building', kind: 'scad' });
		return buildScad(toolCall('scad_open', { title: chat.thread.title, code: action.code }));
	}
	if (action.kind === 'generate') return generate(action.prompt);
	if (action.kind === 'open') {
		show({ stage: 'opening' });
		return openPage(action);
	}
	show({ stage: 'building', kind: building });
	if (building === 'cad') return buildCad(toolCall('cad_set', { edits: action.edits }));
	scadCode = applyEdits(scadCode, action.edits);
	return buildScad(toolCall('scad_set', { code: scadCode }));
}

/** The photo the person attached last: `generate` works from it. */
let lastPhoto: { name: string; bytes: Uint8Array } | null = null;

function line(entry: Line) {
	chat.thread.lines.push(entry);
	return chat.thread.lines.length - 1;
}

/** Pictures are what makes a conversation too long to keep; the words matter more. */
function withoutPictures(thread: Thread): Thread {
	const lines = thread.lines.map(({ picture: _, ...line }) => line);
	const history = thread.history.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.filter((c) => c.type === 'text') } : m));
	return { ...thread, lines, history };
}

async function keep() {
	const { thread } = chat;
	const copy = { ...$state.snapshot(thread), updated: Date.now() } as Thread;
	const saved = await core.saveChat(copy).catch(() => core.saveChat(withoutPictures(copy)));
	thread.id = saved.id;
	chat.threads = await core.chats();
}

export async function send(words: string, photo?: { name: string; bytes: Uint8Array; url: string }) {
	if (chat.busy) return;
	chat.error = '';
	chat.detail = '';
	chat.busy = true;
	const { thread } = chat;
	thread.title ||= words.slice(0, 60);
	// A turn that was stopped leaves the model's turn to speak: most chat templates want roles in turn.
	while (thread.history.at(-1)?.role === 'user') thread.history.pop();
	line({ who: 'you', text: words, picture: photo?.url });
	if (photo) lastPhoto = photo;
	thread.history.push({ role: 'user', content: photo && chat.sees ? [{ type: 'text', text: words }, { type: 'image_url', image_url: { url: photo.url } }] : words });
	const controller = (stopper = new AbortController());
	const began = performance.now();
	let told = 'stopped';
	/** What it built and how often that failed, for the report */
	const count = tally();
	const answers = new Map<number, number>();
	/** One plan per request: written again, it changes in place */
	let planAt: number | undefined;
	const world: World = { ask, act, sees: chat.sees };
	show({ stage: 'thinking' });
	await keep().catch(() => undefined); // what was asked stays even if the window closes in the middle
	const before = thread.lines.length;
	try {
		const ending = await turn(
			thread.history,
			world,
			{
				onAnswer(round, text) {
					const answer = read(text);
					show(answer.writing ? { stage: 'writing', kind: answer.writing } : answer.words ? { stage: 'answering' } : { stage: 'thinking' });
					if (answer.plan?.length) {
						if (planAt === undefined) planAt = line({ who: 'assistant', text: '', plan: answer.plan });
						else thread.lines[planAt].plan = answer.plan;
					}
					const said = [answer.words, answer.ask?.question].filter(Boolean).join('\n\n');
					if (!said) return;
					const at = answers.get(round);
					const options = answer.ask?.options.length ? answer.ask.options : undefined;
					if (at === undefined) answers.set(round, line({ who: 'assistant', text: said, options }));
					else Object.assign(thread.lines[at], { text: said, options });
				},
				onAct: count.events.onAct,
				onOutcome(round, outcome) {
					count.events.onOutcome(round, outcome);
					const shown = outcome.note ?? outcome.text;
					if (shown) line({ who: outcome.note ? 'note' : 'app', text: shown, picture: outcome.picture, failed: outcome.failed });
				}
			},
			controller.signal
		);
		told = ending;
		if (ending !== 'done') chat.error = ending;
		else if (thread.lines.length === before) chat.error = 'empty';
	} catch (error) {
		if (!controller.signal.aborted) {
			chat.error = 'failed';
			chat.detail = error instanceof Error ? error.message : String(error);
			told = 'engine_failed';
		}
	} finally {
		chat.busy = false;
		show(null);
		stopper = null;
		void core.report('assistant_done', chat.model, '', count.code(told), (performance.now() - began) / 1000);
		await keep().catch(() => undefined);
	}
}

export function stop() {
	stopper?.abort();
}

export function newChat() {
	if (chat.busy) return;
	chat.thread = blank();
	chat.error = '';
	chat.detail = '';
	lastPhoto = null;
}

export async function openThread(id: string) {
	if (chat.busy) return;
	chat.thread = await core.readChat(id);
	// an edit must go to what this conversation built, not to what was built last anywhere
	const last = [...chat.thread.history].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string' && ['cad', 'scad'].includes(firstAction(m.content as string)?.kind ?? ''));
	const action = last && firstAction(last.content as string);
	if (action?.kind === 'scad') scadCode = action.code;
	if (action?.kind === 'cad' || action?.kind === 'scad') building = action.kind;
}

export async function removeThread(id: string) {
	if (chat.busy) return;
	await core.deleteChat(id);
	chat.threads = await core.chats();
	if (chat.thread.id === id) newChat();
}

/** Loads the chosen model into memory. Only one is held at a time. */
export async function useModel(id: string, sees: boolean) {
	chat.model = id;
	chat.sees = sees;
	if (!id) return;
	chat.starting = true;
	chat.error = '';
	try {
		await core.assistantStart(id);
	} catch (error) {
		chat.error = String(error);
	} finally {
		chat.starting = false;
	}
}
