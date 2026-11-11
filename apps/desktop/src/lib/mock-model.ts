// A small sample model for the browser stand-in.
import { writeGlb } from '@polyzon/mesh-kit';

/**
 * A lumpy ball with a head: closed, curved, and small enough to load at once. `torn`: as a generator may leave
 * it, its top open and a skin turned inward under it.
 */
export function boxGlb(torn = false): Uint8Array {
	const out: number[] = [];
	const ball = (cx: number, cy: number, cz: number, r: number, bumps: number, from = 0, inward = false) => {
		const n = 80;
		const at = (i: number, j: number) => {
			const a = (i / n) * Math.PI;
			const b = (j / n) * 2 * Math.PI;
			const k = r * (1 + 0.07 * Math.sin(bumps * a) * Math.cos(bumps * b) + 0.02 * Math.sin(19 * a) * Math.cos(23 * b));
			return [cx + k * Math.sin(a) * Math.cos(b), cy + k * Math.sin(a) * Math.sin(b), cz + k * Math.cos(a)];
		};
		for (let i = 0; i < n; i++)
			for (let j = 0; j < n; j++) {
				const [p, q, s, t] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
				if (i < from) continue;
				if (i > 0) out.push(...(inward ? [...p, ...t, ...q] : [...p, ...q, ...t]));
				if (i < n - 1) out.push(...(inward ? [...q, ...t, ...s] : [...q, ...s, ...t]));
			}
	};
	ball(0, 0, 30, 30, 5, torn ? 6 : 0);
	if (torn) ball(0, 0, 30, 27, 5, 0, true);
	ball(0, 30, 62, 16, 4);
	return writeGlb([new Float32Array(out)]);
}
