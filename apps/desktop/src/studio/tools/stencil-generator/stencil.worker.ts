/** Builds the stencil off the main thread (manifold-3d needs its own context). */
import { loadManifold } from '../manifold';
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { ringsToSvg } from '../shared/outline';
import { createKit } from '../shared/section';
import { writeStl } from '../stl';
import { runStencil, type StencilJob } from './model';

export interface StencilOutput {
	stl: Uint8Array;
	svg: string;
	islands: number;
	bridges: number;
}

serveMeshJobs<StencilJob, StencilOutput>(
	async (job) => {
		const kit = createKit(await loadManifold());
		try {
			const r = runStencil(kit, job);
			return {
				stl: writeStl(r.tris, 'Polyzon Studio stencil'),
				svg: ringsToSvg(r.sheet),
				islands: r.islands,
				bridges: r.bridges
			};
		} finally {
			kit.free();
		}
	},
	(out) => [out.stl.buffer]
);
