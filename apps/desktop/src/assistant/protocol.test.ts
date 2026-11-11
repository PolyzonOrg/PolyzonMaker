import { describe, expect, it } from 'vitest';
import { firstAction, read, spoken } from './protocol';

describe('an answer', () => {
	it('with a program asks to build it', () => {
		expect(firstAction('Сейчас соберу.\n```cad\nreturn box(1, 2, 3)\n```\n')).toEqual({ kind: 'cad', code: 'return box(1, 2, 3)\n' });
		expect(firstAction('```scad\ncube(10);\n```')).toEqual({ kind: 'scad', code: 'cube(10);\n' });
	});

	it('with no block ends the turn', () => {
		expect(firstAction('Готово, модель на месте.')).toBeNull();
	});

	it('with another kind of block ends it too', () => {
		expect(firstAction('```js\nconsole.log(1)\n```')).toBeNull();
	});

	it('carries out only the first block', () => {
		expect(firstAction('```cad\nreturn a\n```\nа потом\n```cad\nreturn b\n```')).toEqual({ kind: 'cad', code: 'return a\n' });
	});

	it('can change a few words', () => {
		expect(firstAction('```edit\nbox(1, 2)\n===\nbox(3, 4)\n---\ncyl(5)\n===\ncyl(6)\n```')).toEqual({
			kind: 'edit',
			edits: [
				{ find: 'box(1, 2)', put: 'box(3, 4)' },
				{ find: 'cyl(5)', put: 'cyl(6)' }
			]
		});
	});

	it('with a broken edit does nothing', () => {
		expect(firstAction('```edit\nno separator here\n```')).toBeNull();
	});

	it('can ask for a generated model', () => {
		expect(firstAction('```generate\nсиний дракон\n```')).toEqual({ kind: 'generate', prompt: 'синий дракон' });
	});

	it('shows only the words', () => {
		expect(spoken('Соберу.\n```cad\nreturn x\n```\nСмотрю.')).toBe('Соберу.\n\nСмотрю.');
	});

	it('hides a block still being written', () => {
		expect(spoken('Соберу.\n```cad\nreturn x')).toBe('Соберу.');
	});
});

describe('what small models really write', () => {
	it('a fence still arriving shows nothing, not even its name', () => {
		for (const partial of ['```generate', '```gen', '```', '``', 'Делаю.\n```generate']) expect(spoken(partial)).toBe(partial.startsWith('Делаю') ? 'Делаю.' : '');
	});

	it('a block on one line is carried out and hidden', () => {
		const answer = 'Сделаю кота. ```generate a ginger cat sitting```';
		expect(firstAction(answer)).toEqual({ kind: 'generate', prompt: 'a ginger cat sitting' });
		expect(spoken(answer)).toBe('Сделаю кота.');
	});

	it('a closing fence glued to the last line still closes it', () => {
		const answer = '```generate\na ginger cat```\nГотовлю.';
		expect(firstAction(answer)).toEqual({ kind: 'generate', prompt: 'a ginger cat' });
		expect(spoken(answer)).toBe('Готовлю.');
	});

	it('an indented fence or a capital name counts', () => {
		expect(firstAction('  ```Generate\n  a cat\n  ```')).toEqual({ kind: 'generate', prompt: 'a cat' });
	});

	it('a block that never closes is carried out once the answer is over', () => {
		expect(firstAction('```generate\na cat')).toEqual({ kind: 'generate', prompt: 'a cat' });
	});

	it('a program keeps the backticks of its own strings', () => {
		expect(firstAction('```cad\nconst s = `a`\nreturn box(1, 1, 1)\n```')).toEqual({ kind: 'cad', code: 'const s = `a`\nreturn box(1, 1, 1)\n' });
	});
});

describe('what the assistant is doing while it writes', () => {
	it('names the block it is in the middle of', () => {
		expect(read('Сейчас.\n```cad\nconst a').writing).toBe('cad');
		expect(read('```gene').writing).toBe(null);
		expect(read('```generate').writing).toBe('generate');
		expect(read('```cad\nreturn x\n```\nГотово').writing).toBe(null);
		expect(read('Просто слова').writing).toBe(null);
	});
});

describe('a plan', () => {
	it('is a checklist the assistant writes and checks off', () => {
		const answer = 'План такой:\n```plan\n- [x] Основание 80 мм\n- [ ] Стойка\n3. Проверить устойчивость\n```\n```cad\nreturn box(1, 1, 1)\n```';
		const { plan, action, words } = read(answer);
		expect(plan).toEqual([
			{ text: 'Основание 80 мм', done: true },
			{ text: 'Стойка', done: false },
			{ text: 'Проверить устойчивость', done: false }
		]);
		expect(action?.kind).toBe('cad');
		expect(words).toBe('План такой:');
	});

	it('is not something to carry out', () => {
		expect(firstAction('```plan\n- [ ] one\n```')).toBeNull();
	});
});

describe('a question', () => {
	it('comes with the answers to pick from', () => {
		const { ask, action, words } = read('Уточню.\n```ask\nКакого размера кот?\n- 5 см, брелок\n- 10 см\n* 20 см, на полку\n```');
		expect(ask).toEqual({ question: 'Какого размера кот?', options: ['5 см, брелок', '10 см', '20 см, на полку'] });
		expect(action).toBeNull();
		expect(words).toBe('Уточню.');
	});

	it('can come without options', () => {
		expect(read('```ask\nДля чего он нужен?\n```').ask).toEqual({ question: 'Для чего он нужен?', options: [] });
	});
});

describe('opening a page', () => {
	it('goes to a page of the program by any of its names', () => {
		expect(firstAction('```open\ncad\n```')).toEqual({ kind: 'open', page: 'cad' });
		expect(firstAction('```open\nOpenSCAD\n```')).toEqual({ kind: 'open', page: 'openscad' });
		expect(firstAction('```open\nlibrary\n```')).toEqual({ kind: 'open', page: 'library' });
		expect(firstAction('```open\ngenerate\n```')).toEqual({ kind: 'open', page: 'create' });
	});

	it('or to a tool found by words', () => {
		expect(firstAction('```open\ntool gridfinity box\n```')).toEqual({ kind: 'open', tool: 'gridfinity box' });
	});

	it('anything else is nothing to do', () => {
		expect(firstAction('```open\nthe moon\n```')).toBeNull();
	});
});
