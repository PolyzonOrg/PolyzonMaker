/**
 * Uploaded triangles ↔ manifold-3d solids, without loading the WASM: the
 * page and the workers get the module from manifold.ts, the tests from the
 * package directly (node cannot read Vite's ?url import).
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { ToolError } from './build.svelte';
import { repairMesh } from './shared/mesh-repair';
import type { Triangles } from './stl';
import { weld } from './weld';
import { intlLocale, num } from '$lib/i18n/current';
import * as tc from '$msg/tools/common';

/**
 * Above this many triangles an uploaded model is simplified before the
 * booleans: AI-generated meshes come with millions of triangles the printer
 * cannot show, and they make every cut, shell and mold slow.
 */
export const DENSE_TRIANGLES = 800_000;
/** mm: how far a simplified surface may move — far below a 0.4 mm nozzle's trace. */
export const SIMPLIFY_TOLERANCE = 0.02;

function tryManifold(wasm: ManifoldToplevel, tris: Triangles): Manifold | null {
	const { positions, indices } = weld(tris);
	const mesh = new wasm.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
	mesh.merge();
	try {
		return new wasm.Manifold(mesh);
	} catch {
		return null;
	}
}

/** «1,2 млн», «1.2M», «120万»: the language's own short form of a big count. */
const triangles = (n: number) =>
	new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** How far the repair had to go: not at all, the gentle pass, or the aggressive one. */
export type RepairStep = 'as-is' | 'standard' | 'aggressive';

/**
 * An uploaded model as a closed solid for the booleans. Meshes with holes
 * (typical of AI generators) are repaired here, first gently, then with the
 * aggressive pass; very dense ones are simplified. `note` says what was done,
 * in one sentence for the form; null when the model was fine as it was.
 */
export function toManifold(
	wasm: ManifoldToplevel,
	tris: Triangles,
	dense = DENSE_TRIANGLES
): { solid: Manifold; note: string | null; step: RepairStep } {
	const notes: string[] = [];
	let step: RepairStep = 'as-is';
	let solid = tryManifold(wasm, tris);
	if (!solid) {
		for (const options of [
			{ mode: 'standard', removeShells: false },
			{ mode: 'aggressive', removeShells: true }
		] as const) {
			const fixed = repairMesh(tris, options);
			solid = tryManifold(wasm, fixed.tris);
			step = options.mode;
			if (solid) {
				const holes = fixed.report.holesFilled;
				notes.push(
					holes ? tc.tc_mesh_holes_fixed({ holes: num(holes, 0) }) : tc.tc_mesh_open_fixed()
				);
				break;
			}
		}
	}
	if (!solid) {
		throw new ToolError(tc.tc_mesh_beyond_repair());
	}
	const before = solid.numTri();
	if (before > dense) {
		const simpler = solid.simplify(SIMPLIFY_TOLERANCE);
		const after = simpler.numTri();
		if (after < before) {
			solid.delete();
			solid = simpler;
			notes.push(
				tc.tc_mesh_simplified({
					before: triangles(before),
					after: triangles(after),
					tolerance: num(SIMPLIFY_TOLERANCE)
				})
			);
		} else simpler.delete();
	}
	return { solid, note: notes.length ? notes.join(' ') : null, step };
}

/**
 * mm. Booleans leave corners a fraction of a micron apart. The float32 mesh
 * makes them one point, and a slicer joining equal corners then finds edges
 * of four faces: Bambu Studio says «non-manifold edges». Edges this short are
 * collapsed first, which moves no surface a printer could show.
 */
const EXPORT_TOLERANCE = 0.002;

/** A solid's surface as triangle soup: for STL, 3MF and the viewer. */
export function fromManifold(m: Manifold): Triangles {
	const clean = m.simplify(EXPORT_TOLERANCE);
	try {
		const { vertProperties: v, triVerts: t, numProp: stride } = clean.getMesh();
		const out = new Float32Array(t.length * 3);
		for (let i = 0; i < t.length; i++) {
			const at = t[i] * stride;
			out[i * 3] = v[at];
			out[i * 3 + 1] = v[at + 1];
			out[i * 3 + 2] = v[at + 2];
		}
		return out;
	} finally {
		clean.delete();
	}
}
