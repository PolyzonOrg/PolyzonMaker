/**
 * The hollow tool's worker. It keeps the uploaded model and its cavity, so
 * moving the cut plane or changing the fit does not recompute the cavity.
 */
import type { Manifold } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import { fromManifold, loadManifold, toManifold } from '../manifold';
import { bounds, type Bounds } from '../stl';
import type { Plane } from '../booleans/plane';
import { serve } from '../booleans/worker';
import * as m from '$msg/tools/stl-hollow';
import {
	cavityEdge,
	cavitySamples,
	drainHole,
	makeBox,
	makeCavity,
	type HollowParams
} from './model';

export interface HollowJob {
	/** Identifies the uploaded file: the cache is kept while it is the same. */
	key: string;
	tris: Float32Array;
	params: HollowParams;
	plane: Plane | null;
}

export interface HollowPiece {
	role: 'shell' | 'lid' | 'base';
	tris: Float32Array;
	volume: number;
}

export interface HollowReply {
	pieces: HollowPiece[];
	note: string | null;
	/** Grid step of the cavity, mm */
	edge: number;
}

let model: {
	key: string;
	solid: Manifold;
	tris: Float32Array;
	box: Bounds;
	note: string | null;
} | null = null;
let cavity: { key: string; solid: Manifold } | null = null;

serve<HollowJob>(async (job, progress) => {
	const wasm = await loadManifold();
	if (model?.key !== job.key) {
		model?.solid.delete();
		cavity?.solid.delete();
		cavity = null;
		const { solid, note } = toManifold(wasm, job.tris);
		const tris = fromManifold(solid);
		model = { key: job.key, solid, tris, box: bounds(tris), note };
	}
	const p = job.params;
	const edge = cavityEdge(model.box, p.wall, p.detail);
	const cavityKey = `${p.wall}|${p.detail}`;
	if (cavity?.key !== cavityKey) {
		cavity?.solid.delete();
		cavity = null;
		const total = cavitySamples(model.box, edge);
		let n = 0;
		const solid = makeCavity(wasm, model.tris, model.box, p.wall, edge, () => {
			if (++n % 20000 === 0) progress(n / total);
		});
		cavity = { key: cavityKey, solid };
	}
	if (cavity.solid.isEmpty()) {
		throw new ToolError(m.t_stl_hollow_too_thin());
	}

	const out: { role: HollowPiece['role']; solid: Manifold }[] = [];
	let note: string | null = null;
	if (p.mode === 'box') {
		if (!job.plane) throw new ToolError(m.t_stl_hollow_no_plane());
		const box = makeBox(wasm, model.solid, cavity.solid, job.plane, p);
		out.push({ role: 'base', solid: box.base }, { role: 'lid', solid: box.lid });
		note = box.note;
	} else {
		let shell = model.solid.subtract(cavity.solid);
		if (p.drain) {
			const hole = drainHole(wasm, model.solid, cavity.solid, p.drainDiameter);
			if (hole) {
				const drilled = shell.subtract(hole);
				shell.delete();
				hole.delete();
				shell = drilled;
			} else note = m.t_stl_hollow_no_drain();
		}
		out.push({ role: 'shell', solid: shell });
	}
	const pieces = out.map(({ role, solid }) => {
		const piece = { role, tris: fromManifold(solid), volume: solid.volume() };
		solid.delete();
		return piece;
	});
	const reply: HollowReply = {
		pieces,
		note: [model.note, note].filter(Boolean).join(' ') || null,
		edge
	};
	return [reply, pieces.map((x) => x.tris.buffer)];
});
