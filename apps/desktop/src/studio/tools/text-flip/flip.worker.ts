/** Builds the two-word sculpture off the main thread (manifold-3d). */
import { loadManifold } from '../manifold';
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { createKit } from '../shared/section';
import type { Ring } from '../shared/trace';
import { writeStl } from '../stl';
import { buildTextFlip, type FlipParams } from './model';

export interface FlipJob {
	p: FlipParams;
	front: string[];
	frontGlyphs: Ring[][];
	side: string[];
	sideGlyphs: Ring[][];
}

export interface FlipOutput {
	stl: Uint8Array;
	pairs: [string, string][];
	empty: [string, string][];
}

serveMeshJobs<FlipJob, FlipOutput>(
	async (job) => {
		const kit = createKit(await loadManifold());
		try {
			const r = buildTextFlip(kit, job.front, job.frontGlyphs, job.side, job.sideGlyphs, job.p);
			return { stl: writeStl(r.tris, 'Polyzon Studio two words'), pairs: r.pairs, empty: r.empty };
		} finally {
			kit.free();
		}
	},
	(out) => [out.stl.buffer]
);
