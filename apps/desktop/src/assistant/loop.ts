/**
 * One turn of the local assistant: it writes, the app builds what it wrote and shows it the result, it
 * looks and corrects, until it says it is done. Pure over `World`, so a turn can be tested without a model
 * and without a window.
 */
import { firstAction, type Action } from './protocol';

export type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface Message {
	role: 'system' | 'user' | 'assistant';
	content: Content;
}

/** What the app gives back after an action: words for any model, a picture for one that can see. */
export interface Outcome {
	text: string;
	failed: boolean;
	picture?: string;
	/** What the person reads instead of `text`, in their language */
	note?: string;
}

export interface World {
	/** The model's answer to these messages; `partial` gets it as it grows. */
	ask(messages: Message[], partial: (text: string) => void, signal: AbortSignal): Promise<string>;
	act(action: Action): Promise<Outcome>;
	/** Whether this model takes pictures. */
	sees: boolean;
}

/** Rounds of building and looking one request may take. */
export const ROUNDS = 12;
/** Failures in a row after which it stops and says so, instead of going round. */
export const FAILURES = 4;

export interface Events {
	/** The assistant's answer as it is written; `round` tells answers apart. */
	onAnswer(round: number, text: string): void;
	onAct(round: number, action: Action): void;
	onOutcome(round: number, outcome: Outcome): void;
}

/** What the model reads after an action. */
function reply(outcome: Outcome, sees: boolean): Message {
	const words = outcome.failed ? `${outcome.text}\nFix it.` : `${outcome.text}\nLook at it. If it is right, say so in a sentence, with no block. If not, fix it.`;
	if (!sees || !outcome.picture) return { role: 'user', content: words };
	return { role: 'user', content: [{ type: 'text', text: words }, { type: 'image_url', image_url: { url: outcome.picture } }] };
}

export type Ending = 'done' | 'rounds' | 'failures';

const SHORT: Record<Action['kind'], string> = { cad: 'cad', scad: 'scad', edit: 'edit', generate: 'gen', open: 'open' };

/** What the report of a turn says: how it ended, what it built and how often that failed, as `done_cad2_fail1`. */
export function tally() {
	const acts = new Map<string, number>();
	let failed = 0;
	const events: Events = {
		onAnswer() {},
		onAct(_, action) {
			acts.set(SHORT[action.kind], (acts.get(SHORT[action.kind]) ?? 0) + 1);
		},
		onOutcome(_, outcome) {
			if (outcome.failed) failed++;
		}
	};
	const code = (ending: string) => [ending, ...[...acts].map(([kind, n]) => `${kind}${n}`), failed ? `fail${failed}` : ''].filter(Boolean).join('_');
	return { events, code };
}

/** Runs a turn on top of `history`, which it extends. A picture stays in the conversation only until the next one: they cost the most. */
export async function turn(history: Message[], world: World, events: Events, signal: AbortSignal): Promise<Ending> {
	let failures = 0;
	for (let round = 0; round < ROUNDS; round++) {
		const answer = await world.ask(history, (text) => events.onAnswer(round, text), signal);
		signal.throwIfAborted();
		history.push({ role: 'assistant', content: answer });
		events.onAnswer(round, answer);
		const action = firstAction(answer);
		if (!action) return 'done';
		events.onAct(round, action);
		const outcome = await world.act(action);
		signal.throwIfAborted();
		events.onOutcome(round, outcome);
		failures = outcome.failed ? failures + 1 : 0;
		if (failures >= FAILURES) return 'failures';
		for (const message of history) {
			if (Array.isArray(message.content)) message.content = message.content.filter((c) => c.type === 'text');
		}
		history.push(reply(outcome, world.sees));
	}
	return 'rounds';
}
