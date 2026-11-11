/**
 * Page side of the relief tools: text goes to OpenSCAD (its own worker),
 * everything else to the tool's relief worker (see relief-worker.ts).
 * Builds run one at a time and a new one cancels the old; downloads use a
 * second worker so they never interrupt a build.
 */
import { createWorkerRunner } from './mesh-worker-client';
import type { Layer, TextShapes } from './relief';
import type { ReliefJob, ReliefResult } from './relief-worker';
import { textShapes } from './text-outline';

export interface ReliefClient<P, I> {
	/** `font`: a family from shared/fonts.ts (Noto Sans when left out); `spacing`: text() step. */
	build(
		params: P,
		texts: readonly string[],
		signal: AbortSignal,
		font?: string,
		spacing?: number
	): Promise<ReliefResult<I>>;
	parts(layers: Layer[], name: string, colorChange: number | null): Promise<Uint8Array>;
	/** One 3MF model, a part per colour. */
	parts3mf(layers: Layer[], name: string): Promise<Uint8Array>;
	svg(layers: Layer[]): Promise<string>;
	dispose(): void;
}

export function createReliefClient<P, I>(create: () => Worker): ReliefClient<P, I> {
	const builds = createWorkerRunner<ReliefJob<P>, unknown>(create);
	const files = createWorkerRunner<ReliefJob<P>, unknown>(create);
	const never = new AbortController().signal;
	return {
		async build(params, texts, signal, font, spacing) {
			const text = await textShapes(
				texts,
				signal,
				(rings, missing, sig) =>
					builds.run({ type: 'glyphs', rings, texts: missing }, sig) as Promise<TextShapes>,
				font,
				spacing
			);
			return (await builds.run({ type: 'build', params, text }, signal)) as ReliefResult<I>;
		},
		parts: (layers, name, colorChange) =>
			files.run({ type: 'parts', layers, name, colorChange }, never) as Promise<Uint8Array>,
		parts3mf: (layers, name) =>
			files.run({ type: '3mf', layers, name }, never) as Promise<Uint8Array>,
		svg: (layers) => files.run({ type: 'svg', layers }, never) as Promise<string>,
		dispose() {
			builds.dispose();
			files.dispose();
		}
	};
}
