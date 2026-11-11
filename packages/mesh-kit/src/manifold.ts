/**
 * manifold-3d (Apache-2.0, WASM): robust, fast booleans on a model — the
 * cutter, the hollow shell, the dowels — and the check that a mesh is a
 * closed solid. Every function takes the loaded module, so the same code
 * runs in Node and in a worker:
 *
 *   const wasm = await loadManifold();
 *   const { solid, fixes } = toManifold(wasm, triangles); // repairs, or throws MeshKitError
 *   const box = wasm.Manifold.cube([w, d, h], true);
 *   const result = fromManifold(box.subtract(solid));
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { MeshKitError } from './errors.js';
import { repairMesh } from './mesh-repair.js';
import type { Triangles } from './stl.js';
import { partTouching, unweld, weld, weldTolerance, type IndexedMesh } from './weld.js';

let instance: Promise<ManifoldToplevel> | null = null;

/**
 * The WASM module, loaded once per JS context. In Node it finds its
 * `manifold.wasm` itself; a bundled page or worker passes `locateFile`
 * returning the URL the bundler gave the file (Vite: `manifold-3d/manifold.wasm?url`).
 */
export function loadManifold(config?: { locateFile: () => string }): Promise<ManifoldToplevel> {
	instance ??= import('manifold-3d').then(async ({ default: Module }) => {
		const wasm = await Module(config);
		wasm.setup();
		return wasm;
	});
	return instance;
}

/**
 * Above this many triangles `toManifold` simplifies a model: AI-generated
 * meshes come with millions of triangles the printer cannot show, and they
 * make every cut, shell and boolean slow.
 */
export const DENSE_TRIANGLES = 800_000;
/** mm: how far a simplified surface may move — far below a 0.4 mm nozzle's trace. */
export const SIMPLIFY_TOLERANCE = 0.02;

/** An indexed mesh as a solid, or null when it is not a closed, consistently wound surface. */
export function manifoldOf(wasm: ManifoldToplevel, { positions, indices }: IndexedMesh): Manifold | null {
	const mesh = new wasm.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
	mesh.merge();
	let solid: Manifold;
	try {
		solid = new wasm.Manifold(mesh);
	} catch {
		return null;
	}
	// Closed but inside out: a solid of negative volume, which the booleans get wrong.
	if (solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() < 0) {
		solid.delete();
		return null;
	}
	return solid;
}

export const tryManifold = (wasm: ManifoldToplevel, tris: Triangles) => manifoldOf(wasm, weld(tris));

/** What `toManifold` did to make a closed solid of the model; null where it did nothing. */
export interface SolidFixes {
	/** Repaired by `repairMesh`: how many holes were closed. */
	repaired: { holes: number; mode: 'standard' | 'aggressive' } | null;
	/** Simplified for being denser than `dense` triangles. */
	simplified: { before: number; after: number; tolerance: number } | null;
}

/**
 * A model as a closed solid for the booleans. Meshes with holes (typical of
 * AI generators) are repaired here, first gently, then with the aggressive
 * pass; very dense ones are simplified. Throws `beyond-repair` when no
 * repair makes it a solid (`voxelRemesh` still can).
 */
export function toManifold(
	wasm: ManifoldToplevel,
	tris: Triangles,
	dense = DENSE_TRIANGLES
): { solid: Manifold; fixes: SolidFixes } {
	const fixes: SolidFixes = { repaired: null, simplified: null };
	let solid = tryManifold(wasm, tris);
	if (!solid) {
		for (const options of [
			{ mode: 'standard', removeShells: false },
			{ mode: 'aggressive', removeShells: true }
		] as const) {
			const fixed = repairMesh(tris, options);
			solid = tryManifold(wasm, fixed.tris);
			if (solid) {
				fixes.repaired = { holes: fixed.report.holesFilled, mode: options.mode };
				break;
			}
		}
	}
	if (!solid) throw new MeshKitError('beyond-repair');
	const before = solid.numTri();
	if (before > dense) {
		const simpler = solid.simplify(SIMPLIFY_TOLERANCE);
		const after = simpler.numTri();
		if (after < before) {
			solid.delete();
			solid = simpler;
			fixes.simplified = { before, after, tolerance: SIMPLIFY_TOLERANCE };
		} else simpler.delete();
	}
	return { solid, fixes };
}

/**
 * mm. Booleans leave corners a fraction of a micron apart. The float32 mesh
 * makes them one point, and a slicer joining equal corners then finds edges
 * of four faces: Bambu Studio says «non-manifold edges». Edges this short are
 * collapsed first, which moves no surface a printer could show.
 */
const EXPORT_TOLERANCE = 0.002;

/** mm: how far surfaces that touch step apart, `partTouching`. No printer can show it. */
const PART_STEP = 0.005;

/** A solid's surface as triangle soup: for STL, 3MF and the viewer. */
export function fromManifold(m: Manifold): Triangles {
	const clean = m.simplify(EXPORT_TOLERANCE);
	try {
		const { vertProperties: v, triVerts: indices, numProp: stride } = clean.getMesh();
		const positions = new Float32Array((v.length / stride) * 3);
		for (let i = 0, o = 0; i < v.length; i += stride, o += 3) {
			positions[o] = v[i];
			positions[o + 1] = v[i + 1];
			positions[o + 2] = v[i + 2];
		}
		const { min, max } = clean.boundingBox();
		const tolerance = weldTolerance([max[0] - min[0], max[1] - min[1], max[2] - min[2]]);
		partTouching({ positions, indices }, tolerance, Math.max(PART_STEP, 10 * tolerance));
		return unweld({ positions, indices });
	} finally {
		clean.delete();
	}
}
