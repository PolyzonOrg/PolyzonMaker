/**
 * The simplifier's worker: keeps the uploaded model as a solid, so a new
 * tolerance does not repair and weld it again.
 */
import type { Manifold } from 'manifold-3d';
import { fromManifold, loadManifold, toManifold } from '../manifold';
import { serve } from '../booleans/worker';

export interface SimplifyJob {
	/** Identifies the uploaded file: the solid is kept while it is the same. */
	key: string;
	tris: Float32Array;
	tolerance: number;
}

export interface SimplifyReply {
	tris: Float32Array;
	before: number;
	after: number;
	volumeBefore: number;
	volumeAfter: number;
	/** What was done to the upload to make it a solid (repaired). */
	note: string | null;
}

let held: { key: string; solid: Manifold; note: string | null } | null = null;

serve<SimplifyJob>(async (job) => {
	const wasm = await loadManifold();
	if (held?.key !== job.key) {
		held?.solid.delete();
		held = null;
		// Not simplified on the way in: that is this tool's job, at the chosen tolerance.
		const { solid, note } = toManifold(wasm, job.tris, Infinity);
		held = { key: job.key, solid, note };
	}
	const simple = held.solid.simplify(job.tolerance);
	const reply: SimplifyReply = {
		tris: fromManifold(simple),
		before: held.solid.numTri(),
		after: simple.numTri(),
		volumeBefore: held.solid.volume(),
		volumeAfter: simple.volume(),
		note: held.note
	};
	simple.delete();
	return [reply, [reply.tris.buffer]];
});
