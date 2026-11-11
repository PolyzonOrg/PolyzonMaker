/**
 * manifold-3d (Apache-2.0, WASM): robust, fast booleans on an uploaded model
 * — the mold, the cutter, the hollow shell, the flexi joints. Loaded on
 * demand, once per JS context (page or worker). OpenSCAD's CGAL would take
 * minutes on a 100k-triangle STL; Manifold takes well under a second.
 *
 *   const wasm = await loadManifold();
 *   const { solid: model, note } = toManifold(wasm, triangles); // repairs, or throws ToolError
 *   const box = wasm.Manifold.cube([w, d, h], true);
 *   const result = fromManifold(box.subtract(model));
 */
import type { ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

export { DENSE_TRIANGLES, fromManifold, SIMPLIFY_TOLERANCE, toManifold } from './solid';

let instance: Promise<ManifoldToplevel> | null = null;

export function loadManifold(): Promise<ManifoldToplevel> {
	instance ??= import('manifold-3d').then(async ({ default: Module }) => {
		const wasm = await Module({ locateFile: () => wasmUrl });
		wasm.setup();
		return wasm;
	});
	return instance;
}
