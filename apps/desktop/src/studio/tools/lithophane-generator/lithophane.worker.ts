/** Heights and mesh off the main thread: a fine lithophane is a million triangles. */
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { writeStl } from '../stl';
import { loadManifold } from '../manifold';
import {
	addHangTab,
	imageToHeights,
	isFlat,
	lithophaneBody,
	withStand,
	type LithoJob,
	type LithoResult
} from './model';

serveMeshJobs<LithoJob, LithoResult>(
	async (job) => {
		const heights = imageToHeights(job.rgba, job.layout.cols * job.layout.rows, job.params);
		let body = lithophaneBody(job.params, heights, job.layout);
		if (job.params.hang && isFlat(job.params.shape)) {
			body = addHangTab(await loadManifold(), job.params, body);
		}
		const tris = withStand(job.params, body);
		return { stl: writeStl(tris, 'Polyzon Studio lithophane'), triangles: tris.length / 9 };
	},
	(result) => [result.stl.buffer]
);
