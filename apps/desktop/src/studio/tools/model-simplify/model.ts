/**
 * «Упростить модель»: a dense mesh (an AI model, a scan) with far fewer
 * triangles, the surface moved by no more than the chosen tolerance —
 * manifold-3d's `simplify`. The page shows what it saved. Pure helpers.
 */
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/model-simplify';

/** How far the surface may move, mm. */
export const TOLERANCES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5] as const;
export const SIMPLIFY_DEFAULT = 0.05;

/** A binary STL: 84 bytes of header and count, 50 per triangle. */
export const stlBytes = (triangles: number) => 84 + 50 * triangles;

/** «1,2 млн треугольников», «180 400 треугольников», «12 треугольников». */
export function trianglesText(n: number): string {
	if (n >= 1_000_000) return m.t_model_simplify_triangles_millions({ n: num(n / 1_000_000, 1) });
	return m.t_model_simplify_triangles({ count: n, n: num(n) });
}

/** «в 1,5 раза», «в 2 раза», «в 12 раз». */
export function times(k: number): string {
	const r = Math.round(k * 10) / 10;
	return m.t_model_simplify_times({ count: r, n: num(r, 1) });
}

/** What simplifying gave, in one sentence for the form. */
export function simplifySummary(
	before: number,
	after: number,
	volumeBefore: number,
	volumeAfter: number
): string {
	if (after >= before * 0.98)
		return m.t_model_simplify_summary_simple({ triangles: trianglesText(before) });
	const change = volumeBefore > 0 ? (Math.abs(volumeAfter - volumeBefore) / volumeBefore) * 100 : 0;
	return m.t_model_simplify_summary({
		before: trianglesText(before),
		after: trianglesText(after),
		times: times(before / after),
		change: change < 0.1 ? m.t_model_simplify_change_tiny() : num(change, 1)
	});
}
