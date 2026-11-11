/** Parse, check, repair and check again — off the main thread. */
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { importMesh } from '../shared/mesh-import';
import { repairMesh } from '../shared/mesh-repair';
import { meshStats, writeStl, type MeshStats, type Triangles } from '../stl';
import type { RepairJob, RepairResult } from './model';
import * as m from '$msg/tools/stl-repair';

// The same file is repaired again when the options change: keep it parsed.
let cache: { fileId: number; tris: Triangles; before: MeshStats; original: Uint8Array } | null =
	null;

serveMeshJobs<RepairJob, RepairResult>(
	async ({ fileId, name, bytes, options }, progress) => {
		if (cache?.fileId !== fileId) {
			cache = null;
			progress(m.t_stl_repair_stage_read());
			const tris = await importMesh(name, bytes);
			progress(m.t_stl_repair_stage_check());
			cache = { fileId, tris, before: meshStats(tris), original: writeStl(tris) };
		}
		const { tris, report } = repairMesh(cache.tris, options, progress);
		progress(m.t_stl_repair_stage_result());
		return {
			before: cache.before,
			after: meshStats(tris),
			report,
			original: cache.original.slice(),
			repaired: writeStl(tris)
		};
	},
	(result) => [result.original.buffer, result.repaired.buffer],
	m.t_stl_repair_failed()
);
