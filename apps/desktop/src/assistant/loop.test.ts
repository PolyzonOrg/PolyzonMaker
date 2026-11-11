import { describe, expect, it } from 'vitest';
import { FAILURES, ROUNDS, tally, turn, type Events, type Message, type Outcome, type World } from './loop';

const quiet: Events = { onAnswer() {}, onAct() {}, onOutcome() {} };
const signal = new AbortController().signal;
const block = '```cad\nreturn box(1, 1, 1)\n```';

function world(answers: string[], outcomes: Outcome[] = [], sees = false) {
	const asked: Message[][] = [];
	const acted: unknown[] = [];
	const it: World = {
		sees,
		ask: async (messages) => {
			asked.push(structuredClone(messages));
			return answers[Math.min(asked.length - 1, answers.length - 1)];
		},
		act: async (action) => {
			acted.push(action);
			return outcomes[Math.min(acted.length - 1, outcomes.length - 1)] ?? { text: 'built', failed: false };
		}
	};
	return { it, asked, acted };
}

const start = (): Message[] => [{ role: 'user', content: 'сделай куб' }];

describe('a turn', () => {
	it('ends when the answer has nothing to do', async () => {
		const w = world(['Куб не нужен.']);
		expect(await turn(start(), w.it, quiet, signal)).toBe('done');
		expect(w.acted).toEqual([]);
	});

	it('builds, shows the result, and ends when the model is content', async () => {
		const w = world([block, 'Готово.']);
		const history = start();
		expect(await turn(history, w.it, quiet, signal)).toBe('done');
		expect(w.acted.length).toBe(1);
		expect(history[2].content).toMatch(/built/);
		expect(history.at(-1)).toEqual({ role: 'assistant', content: 'Готово.' });
	});

	it('stops at a question and waits for the person, with nothing done', async () => {
		const w = world(['Уточню.\n```ask\nКакого размера?\n- 5 см\n- 10 см\n```', block]);
		expect(await turn(start(), w.it, quiet, signal)).toBe('done');
		expect(w.acted).toEqual([]);
		expect(w.asked.length).toBe(1);
	});

	it('opens a page and hears that it did', async () => {
		const w = world(['```open\nopenscad\n```', 'Открыл.'], [{ text: 'The openscad page is open.', failed: false }]);
		const history = start();
		await turn(history, w.it, quiet, signal);
		expect(w.acted).toEqual([{ kind: 'open', page: 'openscad' }]);
		expect(history[2].content).toMatch(/openscad page is open/);
	});

	it('a plan before the program does not stop it from being built', async () => {
		const w = world(['```plan\n- [ ] Основание\n```\n' + block, 'Готово.']);
		await turn(start(), w.it, quiet, signal);
		expect(w.acted.length).toBe(1);
	});

	it('hands a failure back to be fixed', async () => {
		const w = world([block, block, 'Готово.'], [{ text: 'error: line 1', failed: true }, { text: 'built', failed: false }]);
		const history = start();
		await turn(history, w.it, quiet, signal);
		expect(history[2].content).toMatch(/error: line 1\nFix it/);
		expect(w.acted.length).toBe(2);
	});

	it('stops after failures in a row instead of going round', async () => {
		const w = world([block], [{ text: 'error', failed: true }]);
		expect(await turn(start(), w.it, quiet, signal)).toBe('failures');
		expect(w.acted.length).toBe(FAILURES);
	});

	it('has an end even when the model never is content', async () => {
		const w = world([block]);
		expect(await turn(start(), w.it, quiet, signal)).toBe('rounds');
		expect(w.acted.length).toBe(ROUNDS);
	});

	it('shows a picture only to a model that sees', async () => {
		const blind = world([block, 'ok'], [{ text: 'built', failed: false, picture: 'data:image/jpeg;base64,AA' }]);
		await turn(start(), blind.it, quiet, signal);
		expect(typeof blind.asked[1].at(-1)!.content).toBe('string');
		const seeing = world([block, 'ok'], [{ text: 'built', failed: false, picture: 'data:image/jpeg;base64,AA' }], true);
		await turn(start(), seeing.it, quiet, signal);
		expect(JSON.stringify(seeing.asked[1].at(-1))).toContain('image_url');
	});

	it('keeps only the newest picture in the conversation', async () => {
		const w = world([block, block, 'ok'], [{ text: 'built', failed: false, picture: 'data:x' }], true);
		await turn(start(), w.it, quiet, signal);
		const pictures = JSON.stringify(w.asked[2]).match(/image_url/g)?.length ?? 0;
		expect(pictures).toBe(2); // the part's type and its key, of one picture
	});
});

describe('stopping', () => {
	it('an answer stopped as it arrives is not carried out', async () => {
		const stop = new AbortController();
		const w = world([block]);
		const ask = w.it.ask;
		w.it.ask = async (messages, partial, signal) => {
			const answer = await ask(messages, partial, signal);
			stop.abort();
			return answer;
		};
		await expect(turn(start(), w.it, quiet, stop.signal)).rejects.toThrow();
		expect(w.acted).toEqual([]);
	});

	it('a stop during a build ends the turn, with no next round', async () => {
		const stop = new AbortController();
		const w = world([block]);
		const act = w.it.act;
		w.it.act = async (action) => {
			const outcome = await act(action);
			stop.abort();
			return outcome;
		};
		await expect(turn(start(), w.it, quiet, stop.signal)).rejects.toThrow();
		expect(w.asked.length).toBe(1);
	});
});

describe('the report of a turn', () => {
	it('says how it ended, what it built and how often that failed, in the letters the server takes', async () => {
		const failedOnce: Outcome[] = [{ text: 'error', failed: true }, { text: 'built', failed: false }];
		const { it: w } = world([block, block, 'Готово.'], failedOnce);
		const count = tally();
		const ending = await turn(start(), w, count.events, signal);
		expect(count.code(ending)).toBe('done_cad2_fail1');
		expect(tally().code('done')).toBe('done');
		const many = tally();
		for (const kind of ['cad', 'scad', 'edit', 'generate', 'open'] as const) for (let i = 0; i < 12; i++) many.events.onAct(i, { kind } as never);
		for (let i = 0; i < 12; i++) many.events.onOutcome(i, { text: '', failed: true });
		expect(many.code('failures')).toMatch(/^failures_cad12_scad12_edit12/);
		expect(many.code('failures')).toMatch(/^[A-Za-z0-9_]+$/);
	});
});
