/**
 * «Большая модель по частям» off the main thread. The worker keeps the
 * uploaded model as a closed solid, a simplified copy for judging cut faces
 * and its plan points, so another size or printer does not repair the file
 * again.
 */
import type { Manifold } from 'manifold-3d';
import { ToolError } from '../build.svelte';
import { loadManifold, toManifold } from '../manifold';
import { serve } from '../booleans/worker';
import {
	bigPrint,
	planCloud,
	usableBed,
	type BigPrintParams,
	type BigPrintResult,
	type PlanCloud
} from './model';
import { partsFor, type Vec3 } from './plan';
import * as m from '$msg/tools/big-print';

export interface BigPrintJob {
	/** Identifies the uploaded file: the cache is kept while it is the same. */
	key: string;
	tris: Float32Array;
	/** The model's scale, 1 = as in the file. */
	scale: number;
	params: BigPrintParams;
}

export interface BigPrintReply extends BigPrintResult {
	/** The file these parts are of: the scene fits its camera to a new one. */
	key: string;
	/** What was done to the file to make it a closed solid. */
	note: string | null;
}

/** More parts than this is a size mistake, not a print: the planner would take minutes. */
const MAX_PARTS = 80;

let model: {
	key: string;
	solid: Manifold;
	coarse: Manifold;
	cloud: PlanCloud;
	note: string | null;
} | null = null;

serve<BigPrintJob>(async (job, progress) => {
	const wasm = await loadManifold();
	if (model?.key !== job.key) {
		if (model?.coarse !== model?.solid) model?.coarse.delete();
		model?.solid.delete();
		model = null;
		const { solid, note } = toManifold(wasm, job.tris);
		const box = solid.boundingBox();
		const size = Math.max(...[0, 1, 2].map((k) => box.max[k] - box.min[k]));
		// Cut faces are judged on a copy a few tenths of a percent coarser: fast at any detail.
		const coarse = solid.numTri() > 60_000 ? solid.simplify(size * 0.003) : solid;
		model = { key: job.key, solid, coarse, cloud: planCloud(solid), note };
	}
	const s = job.scale;
	const box = model.solid.boundingBox();
	const size = [0, 1, 2].map((k) => (box.max[k] - box.min[k]) * s) as Vec3;
	if (partsFor(size, usableBed(job.params)) > MAX_PARTS) {
		throw new ToolError(m.t_big_print_too_many_parts({ max: MAX_PARTS }));
	}
	const scaled = model.solid.scale(s);
	const coarse = model.coarse === model.solid ? scaled : model.coarse.scale(s);
	const cloud = {
		vertices: model.cloud.vertices.map((v) => v * s),
		points: model.cloud.points.map((v) => v * s)
	};
	try {
		const result = bigPrint(wasm, scaled, coarse, cloud, job.params, progress);
		const reply: BigPrintReply = { ...result, key: job.key, note: model.note };
		const transfer = result.parts.flatMap((p) => [p.tris.buffer, p.printTris.buffer]);
		if (result.dowels) transfer.push(result.dowels.tris.buffer, result.dowels.printTris.buffer);
		return [reply, transfer];
	} finally {
		if (coarse !== scaled) coarse.delete();
		scaled.delete();
	}
});
