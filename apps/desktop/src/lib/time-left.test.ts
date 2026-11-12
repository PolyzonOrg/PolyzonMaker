import { describe, expect, it } from 'vitest';
import { timeLeft } from './catalog';

describe('what is left of a run, by its estimate for this computer', () => {
	it('is a range while the run is under the short end of it', () => {
		expect(timeLeft(100, [300, 600])).toEqual({ kind: 'range', seconds: [200, 500] });
		expect(timeLeft(0, [300, 600])).toEqual({ kind: 'range', seconds: [300, 600] });
	});

	it('is "up to" the long end once the short end has gone by', () => {
		expect(timeLeft(300, [300, 600])).toEqual({ kind: 'upto', seconds: 300 });
		expect(timeLeft(599, [300, 600])).toEqual({ kind: 'upto', seconds: 1 });
	});

	it('says it is longer than usual past the long end, and promises no time it does not know', () => {
		expect(timeLeft(600, [300, 600])).toEqual({ kind: 'over' });
		expect(timeLeft(5000, [300, 600])).toEqual({ kind: 'over' });
	});

	it('counts a second seed as a second run', () => {
		expect(timeLeft(700, [300, 600], true)).toEqual({ kind: 'upto', seconds: 500 });
	});
});
