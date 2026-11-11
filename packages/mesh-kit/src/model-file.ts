/**
 * A model file's bytes → triangle soup in millimetres, Z up. STL, OBJ and
 * 3MF go through our own readers (`mesh-import`), GLB through `glb`. Bytes
 * only: nothing is fetched or opened by path.
 */
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { MeshKitError } from './errors.js';
import { glbMesh } from './glb.js';
import { importMesh } from './mesh-import.js';
import { bounds, type Triangles } from './stl.js';
import { unweld, weld, weldTolerance, weldVertices, type IndexedMesh } from './weld.js';

export const MODEL_EXTENSIONS = ['stl', 'obj', '3mf', 'glb'] as const;

/**
 * More faces than a print shows, and more than the checks after can hold: raw TRELLIS output of
 * 11 million faces stopped at the size limit of a JavaScript Map, and the next steps would run out of
 * WebAssembly memory. Two million keep a face under 0.02 mm² on an 80 mm model.
 */
export const MAX_FACES = 2_000_000;

export interface ReadOptions {
	/** What a GLB's numbers are: glTF says metres (×1000 to mm); 'mm' takes them as they are. */
	glbUnit?: 'm' | 'mm';
	/** Over this many faces the model is simplified as it is read. */
	maxFaces?: number;
	/** Told how many faces the file had when it was simplified, so the screen can say so. */
	simplified?: (faces: number) => void;
}

export async function readModel(
	name: string,
	bytes: Uint8Array,
	{ glbUnit = 'm', maxFaces = MAX_FACES, simplified = () => {} }: ReadOptions = {}
): Promise<Triangles> {
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	const light = (mesh: IndexedMesh) => lighter(mesh, maxFaces, simplified);
	let tris: Triangles;
	if (ext === 'glb') tris = inMillimetres(unweld(await light(glbMesh(bytes))), glbUnit);
	else {
		tris = await importMesh(name, bytes);
		if (tris.length / 9 > maxFaces) tris = unweld(await light(weld(tris, weldTolerance(bounds(tris).size))));
	}
	if (tris.length < 9) throw new MeshKitError('no-triangles');
	return tris;
}

/** A GLB as triangles in mm, Z up; `unit` is what the file's numbers are. */
export function readGlb(bytes: Uint8Array, unit: 'm' | 'mm' = 'm'): Triangles {
	return inMillimetres(unweld(glbMesh(bytes)), unit);
}

function inMillimetres(tris: Triangles, unit: 'm' | 'mm'): Triangles {
	if (unit === 'm') for (let i = 0; i < tris.length; i++) tris[i] *= 1000;
	return tris;
}

/** The mesh simplified to `maxFaces`, its surface kept within a thousandth of the model's size. */
async function lighter(mesh: IndexedMesh, maxFaces: number, simplified: (faces: number) => void): Promise<IndexedMesh> {
	if (mesh.indices.length / 3 <= maxFaces) return mesh;
	simplified(mesh.indices.length / 3);
	// One vertex per spot first: a seam that splits vertices reads as an open edge, which the simplifier would part.
	const shared = weldVertices(mesh, weldTolerance(bounds(mesh.positions).size));
	await MeshoptSimplifier.ready;
	const [indices] = MeshoptSimplifier.simplify(shared.indices, shared.positions, 3, maxFaces * 3, 1e-3);
	return { positions: shared.positions, indices };
}
