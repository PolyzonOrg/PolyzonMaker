import { describe, expect, it } from 'vitest';
import { alphaOf, feed, GONE, LIFE, spawn, step, TOP, warm } from './particles';

const sequence = (values: number[]) => {
	let i = 0;
	return () => values[i++ % values.length];
};

describe('specks gathering into what is being made', () => {
	it('come in from the edges', () => {
		for (const side of [0.1, 0.3, 0.6, 0.9]) {
			const s = spawn(800, 600, sequence([side, 0.5, 0.5, 0.5]));
			const onEdge = s.x <= 0 || s.x >= 800 || s.y <= 0 || s.y >= 600;
			expect(onEdge).toBe(true);
		}
	});

	it('reach the middle and are gone there', () => {
		const s = spawn(800, 600, sequence([0.1, 0.2, 0.9, 0.4]));
		let alive = true;
		let seconds = 0;
		while (alive && seconds < 60) {
			alive = step(s, 400, 300, 1 / 60);
			seconds += 1 / 60;
		}
		expect(alive).toBe(false);
		expect(seconds).toBeGreaterThan(2); // slowly, not at once
	});

	it('keep their way for a while: a push sideways bends the path, it does not stop at once', () => {
		const s = { x: 0, y: 300, vx: 0, vy: 60, size: 1, life: 0 };
		step(s, 400, 300, 0.1);
		expect(s.vy).toBeGreaterThan(50);
		expect(s.vx).toBeGreaterThan(0);
	});

	it('never rush', () => {
		const s = { x: 0, y: 0, vx: 5000, vy: 0, size: 1, life: 0 };
		step(s, 400, 300, 1 / 60);
		expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(TOP + 1e-6);
	});

	it('fade in as they come and out as they arrive', () => {
		expect(alphaOf({ x: 0, y: 0, vx: 0, vy: 0, size: 1, life: 0 }, 500)).toBe(0);
		expect(alphaOf({ x: 0, y: 0, vx: 0, vy: 0, size: 1, life: 5 }, 500)).toBe(1);
		expect(alphaOf({ x: 0, y: 0, vx: 0, vy: 0, size: 1, life: 5 }, GONE)).toBe(0);
	});
});

describe('specks gathering into a picture', () => {
	it('are gone at its edge, not over it', () => {
		const s = { x: 400 - 81, y: 300, vx: 0, vy: 0, size: 1, life: 1 };
		expect(step(s, 400, 300, 1 / 60, 80)).toBe(true);
		expect(alphaOf(s, 81, 80)).toBeLessThan(0.05);
		s.x = 400 - 79;
		expect(step(s, 400, 300, 1 / 60, 80)).toBe(false);
	});
});

describe('specks coming in steadily', () => {
	it('come at an even rate, not in waves', () => {
		const flow = { owed: 0 };
		const perSecond: number[] = [];
		for (let second = 0; second < 30; second++) {
			let n = 0;
			for (let f = 0; f < 60; f++) n += feed(flow, 1 / 60, 40);
			perSecond.push(n);
		}
		expect(Math.max(...perSecond) - Math.min(...perSecond)).toBeLessThanOrEqual(1);
		expect(perSecond.reduce((a, b) => a + b) / 30).toBeCloseTo(40 / LIFE, 0);
	});

	it('are already on their way when it starts, at every distance, not all at the edge', () => {
		const specks = warm(800, 600, 400, 300, GONE, 60, sequence([0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8]));
		expect(specks.length).toBeGreaterThan(40);
		const far = specks.map((s) => Math.hypot(400 - s.x, 300 - s.y));
		expect(Math.min(...far)).toBeLessThan(200);
		expect(Math.max(...far)).toBeGreaterThan(300);
	});
});
