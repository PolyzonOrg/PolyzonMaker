/** Colours, contours and solids of a picture off the main thread (manifold-3d needs its own context). */
import { loadManifold } from '../manifold';
import { writeStl } from '../stl';
import { ToolError } from '../build.svelte';
import { serveMeshJobs } from './mesh-worker-client';
import * as tc from '$msg/tools/common';
import { createKit } from './section';
import {
	buildPicture,
	clampPicture,
	quantize,
	type PictureJob,
	type PictureResult
} from './colour-picture';

export type PictureOutput = Omit<PictureResult, 'whole'> & { stl: Uint8Array };

serveMeshJobs<PictureJob, PictureOutput>(
	async (job) => {
		const kit = createKit(await loadManifold());
		try {
			const q = quantize(job.rgba, job.w * job.h, clampPicture(job.params).colours);
			if (!q.palette.length) throw new ToolError(tc.tc_picture_empty());
			const { whole, ...rest } = buildPicture(kit, job, q);
			return { ...rest, stl: writeStl(whole, 'Polyzon Studio picture') };
		} finally {
			kit.free();
		}
	},
	(out) => [out.stl.buffer, ...out.parts.map((p) => p.tris.buffer)]
);
