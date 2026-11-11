import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Field } from './fields';
import { Memory, type Form } from './memory';

/** This window's storage, as a map. */
function shelf() {
	const kept = new Map<string, string>();
	return {
		kept,
		get: () => ({
			getItem: (key: string) => kept.get(key) ?? null,
			setItem: (key: string, value: string) => void kept.set(key, value),
			removeItem: (key: string) => void kept.delete(key)
		})
	};
}

/** A tool's form as it opens: its own values in every field. */
const open = () => ({
	shape: { kind: 'choice', label: 'Shape', value: 'round', options: [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }] } as Field,
	size: { kind: 'number', label: 'Size', value: 20, min: 5, max: 60 } as Field,
	rim: { kind: 'toggle', label: 'Rim', value: true } as Field,
	/** Only for a square */
	corner: { kind: 'number', label: 'Corner', value: 2, min: 0, max: 10 } as Field,
	file: { kind: 'file', label: 'Model' } as Field
});

const form = (...fields: Field[]): Form => fields.map((f) => [f.label, f]);

/** The person leaves a square 40 with a 6 mm corner and no rim. */
function leave(store: ReturnType<typeof shelf>) {
	const memory = new Memory('box', store.get);
	const f = open();
	memory.join(form(f.shape, f.size, f.rim, f.file));
	f.shape.value = 'square';
	memory.join(form(f.shape, f.size, f.rim, f.corner, f.file));
	f.size.value = 40;
	f.rim.value = false;
	f.corner.value = 6;
	memory.keep(form(f.shape, f.size, f.rim, f.corner, f.file));
	vi.runAllTimers();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a tool comes back as it was left', () => {
	it('puts back every value, a field that its choice brings up among them', () => {
		const store = shelf();
		leave(store);
		const memory = new Memory('box', store.get);
		const f = open();
		memory.join(form(f.shape, f.size, f.rim, f.file));
		expect([f.shape.value, f.size.value, f.rim.value]).toEqual(['square', 40, false]);
		// the square's own field comes up in the next update
		memory.join(form(f.shape, f.size, f.rim, f.corner, f.file));
		expect(f.corner.value).toBe(6);
	});

	it('puts a value back once: what changes it while the tool opens stays', () => {
		const store = shelf();
		leave(store);
		const memory = new Memory('box', store.get);
		const f = open();
		memory.join(form(f.shape, f.size));
		expect(f.size.value).toBe(40);
		// an agent sets the size before the square's field comes up
		f.size.value = 25;
		memory.join(form(f.shape, f.size, f.corner));
		expect([f.size.value, f.corner.value]).toEqual([25, 6]);
	});

	it('keeps each tool apart', () => {
		const store = shelf();
		leave(store);
		const f = open();
		new Memory('vase', store.get).join(form(f.shape, f.size));
		expect([f.shape.value, f.size.value]).toEqual(['round', 20]);
	});

	it('once open, lets a field that comes up later keep what the tool gave it', () => {
		const store = shelf();
		leave(store);
		const memory = new Memory('box', store.get);
		const f = open();
		f.shape.value = 'round';
		memory.join(form(f.size));
		vi.runAllTimers();
		// a preset makes it a square with a 1 mm corner
		f.corner.value = 1;
		memory.join(form(f.size, f.corner));
		expect(f.corner.value).toBe(1);
	});

	it('skips a value the tool no longer takes and puts back the rest', () => {
		const store = shelf();
		store.kept.set('maker-tool:box', JSON.stringify({ Shape: 'hexagon', Size: 400, Rim: false }));
		const f = open();
		new Memory('box', store.get).join(form(f.shape, f.size, f.rim));
		expect([f.shape.value, f.size.value, f.rim.value]).toEqual(['round', 20, false]);
	});

	it('opens with the tool’s own values when the storage is broken or empty', () => {
		const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full'); }, removeItem: () => {} };
		const memory = new Memory('box', () => broken);
		const f = open();
		memory.join(form(f.shape, f.size));
		f.size.value = 30;
		expect(() => memory.keep(form(f.shape, f.size))).not.toThrow();
		expect(f.shape.value).toBe('round');
		expect(() => new Memory('box', () => { throw new Error('blocked'); })).not.toThrow();
	});

	it('does not keep a number while it is typed', () => {
		const store = shelf();
		const memory = new Memory('box', store.get);
		const f = open();
		memory.join(form(f.size));
		f.size.value = Number.NaN;
		memory.keep(form(f.size));
		expect(store.kept.size).toBe(0);
	});

	it('takes no room for a tool left as it came', () => {
		const store = shelf();
		const memory = new Memory('box', store.get);
		const f = open();
		memory.join(form(f.shape, f.size));
		memory.keep(form(f.shape, f.size));
		expect(store.kept.size).toBe(0);
	});
});

describe('one click back to the tool’s own values', () => {
	it('says when there is something to reset', () => {
		const memory = new Memory('box', shelf().get);
		const f = open();
		memory.join(form(f.shape, f.size));
		expect(memory.changed(form(f.shape, f.size))).toBe(false);
		f.size.value = 30;
		expect(memory.changed(form(f.shape, f.size))).toBe(true);
	});

	it('brings the values back, forgets what was kept, and an undo brings it all back', () => {
		const store = shelf();
		leave(store);
		const memory = new Memory('box', store.get);
		const f = open();
		memory.join(form(f.shape, f.size, f.rim));
		memory.join(form(f.shape, f.size, f.rim, f.corner));
		vi.runAllTimers();
		expect(memory.changed(form(f.shape, f.size, f.rim, f.corner))).toBe(true);

		const had = memory.reset(form(f.shape, f.size, f.rim, f.corner));
		expect([f.shape.value, f.size.value, f.rim.value]).toEqual(['round', 20, true]);
		expect(memory.changed(form(f.shape, f.size, f.rim))).toBe(false);
		expect(store.kept.size).toBe(0);
		vi.runAllTimers();

		memory.put(form(f.shape, f.size, f.rim), had);
		expect([f.shape.value, f.size.value, f.rim.value]).toEqual(['square', 40, false]);
		memory.join(form(f.shape, f.size, f.rim, f.corner));
		expect(f.corner.value).toBe(6);
	});

	it('also resets a field out of sight, so its choice brings it back with the tool’s value', () => {
		const memory = new Memory('box', shelf().get);
		const f = open();
		memory.join(form(f.shape, f.size));
		vi.runAllTimers();
		f.shape.value = 'square';
		memory.join(form(f.shape, f.size, f.corner));
		f.corner.value = 8;
		f.shape.value = 'round';
		f.size.value = 30;
		// the corner's field has gone with the square
		memory.reset(form(f.shape, f.size));
		expect([f.size.value, f.corner.value]).toEqual([20, 2]);
	});

	it('puts back into the fields of a reset only, not a form that came after it', () => {
		const store = shelf();
		leave(store);
		const memory = new Memory('box', store.get);
		const f = open();
		memory.join(form(f.shape, f.size));
		vi.runAllTimers();
		const later = { kind: 'number', label: 'Size', value: 99, min: 5, max: 200 } as Field;
		memory.put(form(later), { Size: 40 });
		expect(later.value).toBe(40);
		memory.close();
		memory.put(form(later), { Size: 50 });
		expect(later.value).toBe(40);
	});
});
