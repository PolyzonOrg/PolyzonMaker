import { describe, expect, it } from 'vitest';
import { checked, named } from './fields';

const number = { kind: 'number', label: 'Size', min: 10, max: 50 } as const;
const choice = { kind: 'choice', label: 'Shape', options: [{ value: 'round', label: 'Круглая' }] } as const;

describe('what an agent may put in a field', () => {
	it('stays inside what the form allows', () => {
		expect(checked('Size', number, 40)).toBe(40);
		expect(checked('Size', number, '40')).toBe(40);
		expect(() => checked('Size', number, 60)).toThrow('goes from 10 to 50');
		expect(() => checked('Size', number, 'big')).toThrow('needs a number');
	});

	it('takes a choice by its value or by what the person reads', () => {
		expect(checked('Shape', choice, 'round')).toBe('round');
		expect(checked('Shape', choice, 'Круглая')).toBe('round');
		expect(() => checked('Shape', choice, 'square')).toThrow('is one of round');
	});

	it('wants the right kind for a switch and for text', () => {
		expect(checked('Rim', { kind: 'toggle', label: 'Rim' }, false)).toBe(false);
		expect(() => checked('Rim', { kind: 'toggle', label: 'Rim' }, 'yes')).toThrow('true or false');
		expect(() => checked('Text', { kind: 'text', label: 'Text', maxlength: 3 }, 'long')).toThrow('holds 3 characters');
		expect(() => checked('Text', { kind: 'text', label: 'Text' }, 3)).toThrow('«Text»: needs text');
	});

	it('sends a file field to a finished job', () => {
		expect(() => checked('Model', { kind: 'file', label: 'Model' }, 'model.stl')).toThrow('«Model»: takes a finished job');
	});
});

describe('the names of the fields', () => {
	it('tell apart a label that repeats in a form', () => {
		const names = named([number, choice, { ...number }]).map(([name]) => name);
		expect(names).toEqual(['Size', 'Shape', 'Size (2)']);
	});
});
