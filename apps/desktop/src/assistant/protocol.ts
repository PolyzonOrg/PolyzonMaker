/**
 * How the local assistant acts: it writes fenced blocks into its answer and the app carries them out.
 * Blocks and not JSON tools, because every text model can write a code block, and few local ones keep
 * to a tool schema. Small models bend the fence: a capital name, a block on one line, a closing fence
 * glued to the last line, an answer cut before the fence closes. All of those count, and none of them
 * is ever shown to the person. An answer without anything to do ends the turn.
 */

export type Page = 'create' | 'library' | 'models' | 'tools' | 'cad' | 'openscad' | 'settings';

export type Action =
	| { kind: 'cad'; code: string }
	| { kind: 'scad'; code: string }
	| { kind: 'edit'; edits: { find: string; put: string }[] }
	| { kind: 'generate'; prompt: string }
	| { kind: 'open'; page: Page }
	| { kind: 'open'; tool: string };

export type Kind = 'cad' | 'scad' | 'edit' | 'generate' | 'open' | 'plan' | 'ask';

/** A step of the plan the assistant wrote, checked when it said so. */
export interface Step {
	text: string;
	done: boolean;
}

export interface Question {
	question: string;
	options: string[];
}

export interface Answer {
	/** What the person reads */
	words: string;
	/** The first thing to carry out; the rest waits for what that one shows */
	action: Action | null;
	plan: Step[] | null;
	ask: Question | null;
	/** The block it is in the middle of writing, while the answer arrives */
	writing: Kind | null;
}

const KINDS = new Set<string>(['cad', 'scad', 'edit', 'generate', 'open', 'plan', 'ask']);

const PAGES: Record<string, Page> = {
	create: 'create',
	generate: 'create',
	generation: 'create',
	new: 'create',
	создать: 'create',
	генерация: 'create',
	library: 'library',
	библиотека: 'library',
	models: 'models',
	модели: 'models',
	tools: 'tools',
	инструменты: 'tools',
	cad: 'cad',
	openscad: 'openscad',
	scad: 'openscad',
	settings: 'settings',
	настройки: 'settings'
};

interface Block {
	kind: string;
	body: string;
	start: number;
	end: number;
	closed: boolean;
}

/** Every fence in the answer, the last one perhaps still open. */
function blocks(answer: string): Block[] {
	const out: Block[] = [];
	for (let at = answer.indexOf('```'); at >= 0; ) {
		const name = /^```([A-Za-z]*)/.exec(answer.slice(at, at + 40))![1];
		let from = at + 3 + name.length;
		from += /^[^\S\n]*\n/.exec(answer.slice(from))?.[0].length ?? 0;
		const close = answer.indexOf('```', from);
		const end = close < 0 ? answer.length : close + 3;
		out.push({ kind: name.toLowerCase(), body: answer.slice(from, close < 0 ? end : close), start: at, end, closed: close >= 0 });
		at = close < 0 ? -1 : answer.indexOf('```', end);
	}
	return out;
}

function edits(body: string) {
	return body
		.split(/^---[^\S\n]*$/m)
		.map((pair) => pair.split(/^===[^\S\n]*$/m))
		.filter((pair) => pair.length === 2)
		.map(([find, put]) => ({ find: find.replace(/^\n|\n$/g, ''), put: put.replace(/^\n|\n$/g, '') }));
}

const ITEM = /^\s*(?:[-*+•]|\d+[.)])\s*(.+)$/;

function plan(body: string): Step[] {
	return body.split('\n').flatMap((line) => {
		const item = ITEM.exec(line)?.[1].trim();
		if (!item) return [];
		const mark = /^\[([ xX])\]\s*(.*)$/.exec(item);
		return [{ text: mark ? mark[2] : item, done: !!mark && mark[1] !== ' ' }];
	});
}

function question(body: string): Question {
	const lines = body.split('\n').filter((line) => line.trim());
	const options = lines.flatMap((line) => ITEM.exec(line)?.[1].trim() ?? []);
	return { question: lines.filter((line) => !ITEM.test(line)).map((line) => line.trim()).join(' '), options };
}

function open(body: string): Action | null {
	const wanted = body.trim().toLowerCase();
	const tool = /^(?:tool|инструмент)\s+(.+)$/.exec(wanted);
	if (tool) return { kind: 'open', tool: tool[1] };
	const page = PAGES[wanted];
	return page ? { kind: 'open', page } : null;
}

function actionOf({ kind, body }: Block): Action | null {
	const text = body.trim();
	if (kind === 'cad' || kind === 'scad') return text ? { kind, code: `${text}\n` } : null;
	if (kind === 'edit') return edits(body).length ? { kind, edits: edits(body) } : null;
	if (kind === 'generate') return text ? { kind, prompt: text } : null;
	if (kind === 'open') return open(body);
	return null;
}

export function read(answer: string): Answer {
	const found = blocks(answer);
	let words = answer;
	for (const b of [...found].reverse()) words = words.slice(0, b.start) + words.slice(b.end);
	const last = found.at(-1);
	const planned = found.find((b) => b.kind === 'plan');
	const asked = found.find((b) => b.kind === 'ask');
	return {
		// two backticks at the very end are a fence on its way
		words: words.replace(/`{1,2}$/, '').trim(),
		action: found.reduce<Action | null>((first, b) => first ?? actionOf(b), null),
		plan: planned ? plan(planned.body) : null,
		ask: asked ? question(asked.body) : null,
		writing: last && !last.closed && KINDS.has(last.kind) ? (last.kind as Kind) : null
	};
}

/** The first thing the answer asks to do. */
export const firstAction = (answer: string) => read(answer).action;

/** An answer for showing: what was written to the app stays out of the conversation. */
export const spoken = (answer: string) => read(answer).words;
