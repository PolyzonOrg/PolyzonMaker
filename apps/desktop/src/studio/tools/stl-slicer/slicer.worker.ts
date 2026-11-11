/** The slicer's manifold work off the main thread: check a model, cut a part. */
import { fromManifold, loadManifold, toManifold } from '../manifold';
import type { Plane } from '../booleans/plane';
import { serve } from '../booleans/worker';
import { cutPart, type ConnectorParams } from './model';

export type SlicerJob =
	| { op: 'prepare'; tris: Float32Array }
	| { op: 'cut'; tris: Float32Array; plane: Plane; connector: ConnectorParams };

export interface Piece {
	tris: Float32Array;
	volume: number;
}

/** The uploaded model as a closed solid, and what was done to make it one. */
export interface PreparedPiece extends Piece {
	note: string | null;
}

export interface CutReply {
	plus: Piece;
	minus: Piece;
	dowels: (Piece & { printTris: Float32Array }) | null;
	pins: number;
	note: string | null;
}

serve<SlicerJob>(async (job) => {
	const wasm = await loadManifold();
	const { solid: model, note } = toManifold(wasm, job.tris);
	if (job.op === 'prepare') {
		const piece: PreparedPiece = { tris: fromManifold(model), volume: model.volume(), note };
		model.delete();
		return [piece, [piece.tris.buffer]];
	}
	const r = cutPart(wasm, model, job.plane, job.connector);
	model.delete();
	const piece = (m: typeof r.plus): Piece => {
		const out = { tris: fromManifold(m), volume: m.volume() };
		m.delete();
		return out;
	};
	let dowels: CutReply['dowels'] = null;
	if (r.dowels && r.dowelsFlat) {
		const printTris = fromManifold(r.dowelsFlat);
		r.dowelsFlat.delete();
		dowels = { ...piece(r.dowels), printTris };
	}
	const reply: CutReply = {
		plus: piece(r.plus),
		minus: piece(r.minus),
		dowels,
		pins: r.pins,
		note: r.note
	};
	const transfer = [reply.plus.tris.buffer, reply.minus.tris.buffer];
	if (dowels) transfer.push(dowels.tris.buffer, dowels.printTris.buffer);
	return [reply, transfer];
});
