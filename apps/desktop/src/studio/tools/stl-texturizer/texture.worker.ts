/** Textures a model in its own thread: triangles + params in, STL bytes out. */
import { writeStl } from '../stl';
import { serveJob } from '../voxelizer/worker-job';
import { texturize, type TextureParams } from './model';
import type { HeightImage } from './patterns';
import * as m from '$msg/tools/stl-texturizer';

export interface TextureJob {
	tris: Float32Array;
	params: TextureParams;
	image: HeightImage | null;
}

export interface TextureJobResult {
	stl: Uint8Array;
	triangles: number;
	edge: number;
	warnings: string[];
}

serveJob<TextureJob, TextureJobResult>(({ tris, params, image }, progress) => {
	const r = texturize(tris, params, image, progress);
	progress(m.t_stl_texturizer_stage_file(), 97);
	const stl = writeStl(r.tris);
	const result = { stl, triangles: r.tris.length / 9, edge: r.edge, warnings: r.warnings };
	return [result, [stl.buffer]];
});
