/** Voxelizes in its own thread: triangles + params in, STL bytes + counts out. */
import * as m from '$msg/tools/voxelizer';
import { writeStl } from '../stl';
import { voxelize, type VoxelGrid, type VoxelParams } from './model';
import { serveJob } from './worker-job';

export interface VoxelJob {
	tris: Float32Array;
	params: VoxelParams;
}

export interface VoxelResult {
	stl: Uint8Array;
	grid: VoxelGrid;
	voxels: number;
	triangles: number;
}

serveJob<VoxelJob, VoxelResult>(({ tris, params }, progress) => {
	const model = voxelize(tris, params, progress);
	progress(m.t_voxelizer_stage_file(), 98);
	const stl = writeStl(model.tris);
	const result = { stl, grid: model.grid, voxels: model.voxels, triangles: model.tris.length / 9 };
	return [result, [stl.buffer]];
});
