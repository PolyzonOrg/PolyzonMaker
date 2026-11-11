/**
 * Small manifold-3d helpers shared by the mesh tools. Everything takes the
 * loaded module as an argument, so the same code runs in a worker (loaded
 * through `loadManifold`) and in Node.
 */
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';

/**
 * WASM objects are not garbage-collected: collect them and free at the end.
 * manifold-3d evaluates booleans lazily, and a result whose inputs were
 * freed before it was evaluated crashes the module (seen in 3.2.1), so the
 * results passed to `free` are evaluated first.
 */
export class Bin {
	private items: { delete(): void }[] = [];

	add<T extends { delete(): void }>(item: T): T {
		this.items.push(item);
		return item;
	}

	/** Evaluate the results in `keep`, then free everything else. */
	free(...keep: unknown[]): void {
		for (const k of keep) if (isManifold(k)) k.numTri();
		for (const item of this.items) if (!keep.includes(item)) item.delete();
		this.items = [];
	}
}

function isManifold(x: unknown): x is Manifold {
	return !!x && typeof (x as Manifold).numTri === 'function';
}

/**
 * A flat region pushed between two heights. Offsets of a sliced mesh leave
 * vertices a few nanometres apart; they are dropped first, or the extrusion
 * gets sliver triangles that weld into non-manifold edges in the STL.
 */
export function prism(
	wasm: ManifoldToplevel,
	region: CrossSection,
	z0: number,
	z1: number,
	scaleTop: number | [number, number] = 1
): Manifold {
	const clean = region.simplify(1e-3);
	// A bare number for scaleTop collapses the top in manifold-3d 3.2.1: pass x and y.
	const top: [number, number] = typeof scaleTop === 'number' ? [scaleTop, scaleTop] : scaleTop;
	const solid = wasm.Manifold.extrude(clean, Math.max(1e-3, z1 - z0), 0, 0, top);
	const moved = solid.translate([0, 0, z0]);
	moved.numTri(); // evaluate before the input goes (see Bin)
	clean.delete();
	solid.delete();
	return moved;
}

/** Round corners: segments for a circle of radius r (about 0.4 mm chords, 24–96). */
export function segments(r: number): number {
	return Math.max(24, Math.min(96, Math.round((2 * Math.PI * r) / 0.6 / 4) * 4));
}
