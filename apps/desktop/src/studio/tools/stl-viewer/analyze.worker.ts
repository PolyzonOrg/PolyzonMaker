/** Reads the file and measures the mesh off the main thread: big files take seconds. */
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { importMesh } from '../shared/mesh-import';
import { meshStats, writeStl } from '../stl';
import { holeSegments } from '../weld';
import type { AnalyzeJob, AnalyzeResult } from './model';
import * as m from '$msg/tools/stl-viewer';

serveMeshJobs<AnalyzeJob, AnalyzeResult>(
	async ({ name, bytes }, progress) => {
		progress(m.t_stl_viewer_stage_reading());
		const tris = await importMesh(name, bytes);
		progress(m.t_stl_viewer_stage_measuring());
		const stats = meshStats(tris);
		const stl = name.toLowerCase().endsWith('.stl') ? bytes : writeStl(tris);
		// The holes, to draw on the model: only when there are any.
		const holes = stats.openEdges ? holeSegments(tris) : new Float32Array(0);
		return { stats, stl, holes };
	},
	(result) => [result.stl.buffer, result.holes.buffer],
	m.t_stl_viewer_read_failed()
);
