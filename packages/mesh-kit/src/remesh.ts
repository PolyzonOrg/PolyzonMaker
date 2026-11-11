/**
 * The last resort for a mesh no repair makes a solid of, and only on
 * request: rebuild its surface from a voxel grid. manifold's `levelSet`
 * samples a signed distance to the old triangles (`solidSdf`: inside by a
 * vote of six rays, so a hole or a flipped face misleads one or two rays,
 * not the answer) and marches out a new surface that is closed by
 * construction. Detail finer than the voxel is lost; the caller measures
 * how much with `surfaceDeviation`.
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { MeshKitError } from './errors.js';
import { solidSdf } from './sdf.js';
import { bounds, type Triangles } from './stl.js';

/** Distance samples levelSet takes for a model of this size, mm, on a `voxel` mm grid (two interleaved grids). */
export function remeshSamples(size: readonly number[], voxel: number): number {
	return 2 * size.reduce((n, s) => n * (s / voxel + 5), 1);
}

/** Past this many samples a remesh runs for minutes and gigabytes: refused. */
export const MAX_REMESH_SAMPLES = 2e7;

/** The model's surface rebuilt on a `voxel` mm grid. */
export function voxelRemesh(wasm: ManifoldToplevel, tris: Triangles, voxel: number): Manifold {
	const b = bounds(tris);
	if (!(voxel > 0) || remeshSamples(b.size, voxel) > MAX_REMESH_SAMPLES)
		throw new MeshKitError('remesh-too-fine', `${voxel} mm on ${b.size.join(' × ')} mm`);
	const sdf = solidSdf(tris, 2 * voxel);
	const box = {
		// An odd origin, as for the hollow cavity: grid planes never fall on a
		// flat face of the model, where the surface would land between samples.
		min: b.min.map((v) => v - voxel * 2.3719) as [number, number, number],
		max: b.max.map((v) => v + voxel * 2.2113) as [number, number, number]
	};
	const solid = wasm.Manifold.levelSet(sdf, box, voxel, 0);
	if (solid.isEmpty()) {
		solid.delete();
		throw new MeshKitError('empty-result', 'the remeshed surface is empty');
	}
	return solid;
}
