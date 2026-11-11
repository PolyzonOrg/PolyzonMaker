import { describe, expect, it } from 'vitest';
import { ACTIONS, actionFor, clash, comboOf, handle, run, shown } from './keys';

const press = (key: string, o: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe('a key press', () => {
	it('is named the same on every system', () => {
		expect(comboOf(press('n', { ctrlKey: true }))).toBe('Mod+N');
		expect(comboOf(press('n', { metaKey: true }))).toBe('Mod+N');
		expect(comboOf(press('h', { altKey: true }))).toBe('Alt+H');
		expect(comboOf(press('Delete'))).toBe('Delete');
	});

	it('of a modifier alone is nothing', () => {
		expect(comboOf(press('Control', { ctrlKey: true }))).toBe('');
	});
});

describe('an action', () => {
	it('is found by its keys in its place', () => {
		expect(actionFor(press('g'), false, 'cad', {})?.id).toBe('cad.handleMove');
		expect(actionFor(press('g'), false, 'result', {})).toBeNull();
	});

	it('of the whole app works everywhere', () => {
		expect(actionFor(press('j', { ctrlKey: true }), false, null, {})?.id).toBe('assistant');
	});

	it('on a plain key waits while a person types', () => {
		expect(actionFor(press('g'), true, 'cad', {})).toBeNull();
		expect(actionFor(press('Delete'), true, 'cad', {})).toBeNull();
	});

	it('with Ctrl still works while typing', () => {
		expect(actionFor(press('Enter', { ctrlKey: true }), true, 'cad', {})?.id).toBe('cad.build');
	});

	it('takes the keys a person gave it, and leaves the old ones', () => {
		const mine = { 'cad.handleMove': 'M' };
		expect(actionFor(press('m'), false, 'cad', mine)?.id).toBe('cad.handleMove');
		expect(actionFor(press('g'), false, 'cad', mine)).toBeNull();
	});
});

describe('new keys', () => {
	it('that another action uses in the same place are named', () => {
		expect(clash('cad.handleMove', 'R', {})?.id).toBe('cad.handleTurn');
	});

	it('used only in another place are free', () => {
		expect(clash('result.saveStl', 'G', {})).toBeNull();
	});

	it('used by the whole app clash anywhere', () => {
		expect(clash('cad.hide', 'Mod+B', {})?.id).toBe('menu');
	});
});

describe('the table', () => {
	it('has no two actions on the same keys in one place', () => {
		for (const a of ACTIONS) expect(clash(a.id, a.keys, {}), a.id).toBeNull();
	});
});

describe('a page', () => {
	it('answers while it is open', () => {
		let pressed = 0;
		const leave = handle({ 'cad.fit': () => pressed++ });
		expect(run('cad.fit')).toBe(true);
		leave();
		expect(run('cad.fit')).toBe(false);
		expect(pressed).toBe(1);
	});
});

describe('keys on the screen', () => {
	it('read as the system writes them', () => {
		expect(shown('Mod+N', false)).toBe('Ctrl+N');
		expect(shown('Mod+N', true)).toBe('⌘+N');
		expect(shown('Delete', false)).toBe('Del');
	});
});

describe('in another alphabet', () => {
	const press = (key: string, code: string, ctrlKey = true) => ({ key, code, ctrlKey, metaKey: false, altKey: false, shiftKey: false });

	it('a shortcut answers to the key, not the letter it writes', () => {
		expect(comboOf(press('т', 'KeyN'))).toBe('Mod+N');
		expect(comboOf(press('р', 'KeyH', false))).toBe('H');
	});

	it('so do the punctuation keys', () => {
		expect(comboOf(press('б', 'Comma'))).toBe('Mod+,');
		expect(comboOf(press('.', 'Slash'))).toBe('Mod+.');
	});
});
