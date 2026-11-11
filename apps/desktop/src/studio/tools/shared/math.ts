/**
 * Small number rules every generator shares: one copy each, so a tool's
 * limits, its smooth ramps and its seeded patterns behave the same everywhere.
 */

/**
 * `v` kept within [lo, hi]; anything that is not a finite number (an empty
 * field, NaN from a typo) becomes `lo`. When a derived `hi` falls below `lo`,
 * a number comes out as `hi`.
 */
export const clamp = (v: number, lo: number, hi: number) =>
	Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/** {@link clamp} with the limits as one `[lo, hi]` pair, as the tools' limit tables keep them. */
export const clampTo = (v: number, [lo, hi]: readonly [number, number]) => clamp(v, lo, hi);

/** Hermite step: 0 up to `e0`, 1 from `e1`, smooth in between. */
export function smoothstep(e0: number, e1: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
	return t * t * (3 - 2 * t);
}

/**
 * Seeded random numbers in [0, 1) (mulberry32): the same seed gives the same
 * pattern on every machine. Seed 0 counts as 1.
 */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0 || 1;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
