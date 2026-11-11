/**
 * Worker side of the relief tools. manifold-3d's bindings compile helper
 * functions at run time, which the page's Content Security Policy forbids
 * (no 'unsafe-eval'); a worker has no such policy, so every manifold call
 * of these tools happens here. A tool's worker file is one line:
 *
 *   serveRelief((s, params, text) => buildTagLayers(s, params, text));
 */
import { ToolError } from '../build.svelte';
import { loadManifold } from '../manifold';
import { writeStl } from '../stl';
import { serveMeshJobs } from './mesh-worker-client';
import * as tc from '$msg/tools/common';
import {
	layersToSvg,
	meshTriangles,
	parts3mf,
	partsZip,
	solidOf,
	textShapesFromRings,
	withScope,
	type Layer,
	type Scope,
	type TextShapes
} from './relief';

export type ReliefJob<P> =
	| { type: 'glyphs'; rings: [number, number][][]; texts: string[] }
	| { type: 'build'; params: P; text: TextShapes | null }
	| { type: 'parts'; layers: Layer[]; name: string; colorChange: number | null }
	| { type: '3mf'; layers: Layer[]; name: string }
	| { type: 'svg'; layers: Layer[] };

/** What a tool's model returns: the layers and anything for its form. */
export interface ReliefModel<I> {
	layers: Layer[];
	info: I;
}

export interface ReliefResult<I> {
	stl: Uint8Array;
	layers: Layer[];
	info: I;
}

export function serveRelief<P, I>(
	model: (s: Scope, params: P, text: TextShapes | null) => ReliefModel<I>
): void {
	serveMeshJobs<ReliefJob<P>, unknown>(
		async (job) => {
			const wasm = await loadManifold();
			return withScope(wasm, (s) => {
				switch (job.type) {
					case 'glyphs':
						return textShapesFromRings(s, job.rings, job.texts);
					case 'parts':
						return partsZip(s, job.layers, job.name, job.colorChange);
					case '3mf':
						return parts3mf(s, job.layers, job.name);
					case 'svg':
						return layersToSvg(s, job.layers);
					default: {
						const out = model(s, job.params, job.text);
						const solid = solidOf(s, out.layers);
						if (!solid || solid.isEmpty()) throw new ToolError(tc.tc_part_failed());
						const result: ReliefResult<I> = {
							stl: writeStl(meshTriangles(solid), 'Polyzon Studio'),
							layers: out.layers,
							info: out.info
						};
						return result;
					}
				}
			});
		},
		(r) =>
			r instanceof Uint8Array
				? [r.buffer as ArrayBuffer]
				: r && typeof r === 'object' && 'stl' in r
					? [(r as ReliefResult<I>).stl.buffer as ArrayBuffer]
					: []
	);
}
