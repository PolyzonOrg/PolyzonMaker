import { describe, expect, it } from 'vitest';
import { wrap } from './modal';

describe('Tab inside a modal', () => {
	it('goes round past the last stop and back past the first', () => {
		expect(wrap(3, 2, false)).toBe(0);
		expect(wrap(3, 0, true)).toBe(2);
	});

	it('leaves the steps between to the browser', () => {
		expect(wrap(3, 0, false)).toBeNull();
		expect(wrap(3, 1, false)).toBeNull();
		expect(wrap(3, 2, true)).toBeNull();
	});

	it('comes in from outside its stops at the first, or with Shift at the last', () => {
		expect(wrap(3, -1, false)).toBe(0);
		expect(wrap(3, -1, true)).toBe(2);
	});

	it('stays on a modal of one stop', () => {
		expect(wrap(1, 0, false)).toBe(0);
		expect(wrap(1, 0, true)).toBe(0);
	});
});
