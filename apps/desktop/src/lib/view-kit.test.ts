import { describe, expect, it } from 'vitest';
import { distanceFor, percentOf, sideOf } from './view-kit';

describe('one set of view controls for every 3D view', () => {
	it('puts the camera on the same side whichever way a view counts up', () => {
		expect(sideOf('top', 'z')[2]).toBe(1);
		expect(sideOf('top', 'y')[1]).toBe(1);
		expect(sideOf('front', 'z')[1]).toBe(-1);
		expect(sideOf('front', 'y')[2]).toBe(1);
	});

	it('tells the zoom in percent of the distance the whole model fits at', () => {
		expect(percentOf(100, 100)).toBe(100);
		expect(percentOf(100, 50)).toBe(200);
		expect(percentOf(100, 0)).toBeGreaterThan(1000);
	});

	it('goes back from a percent to a distance, within sane limits', () => {
		expect(distanceFor(100, 200)).toBe(50);
		expect(distanceFor(100, 0)).toBe(2000);
		expect(percentOf(100, distanceFor(100, 400))).toBe(400);
	});
});
