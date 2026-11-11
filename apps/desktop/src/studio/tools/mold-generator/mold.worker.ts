/** The mold tool's worker: the box around an uploaded master, or the pour mold. */
import type { Manifold } from 'manifold-3d';
import { fromManifold, loadManifold, toManifold } from '../manifold';
import { openEdges } from '../weld';
import { serve } from '../booleans/worker';
import { moldBox, pourMold, type MoldBoxParams, type PourParams } from './model';
import { currentLocale } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as msg from '$msg/tools/mold-generator';

export type MoldJob =
	| { op: 'box'; key: string; tris: Float32Array; params: MoldBoxParams }
	/** text: the engraving's outline (rings at size 10, OpenSCAD axes) */
	| { op: 'pour'; params: PourParams; text: [number, number][][] | null };

export interface MoldPiece {
	role: 'box' | 'lid' | 'base' | 'master' | 'mold';
	tris: Float32Array;
	volume: number;
	/** Where the part moves in «Раздвинуть». */
	dir: [number, number, number];
}

export interface MoldReply {
	pieces: MoldPiece[];
	/** mm³: silicone for the box, one cast for the pour mold */
	silicone: number | null;
	cast: number;
	cavities: number;
	note: string | null;
	/**
	 * The check before printing (the box): the thinnest silicone around the
	 * master, mm, and the box parts whose STL has holes (indexes in pieces).
	 */
	check: { clearance: number; open: number[] } | null;
	/** The master's cavity was filled to the neck: it is printed anew, not a reference. */
	masterFixed: boolean;
	/** The box: how far its cut may move off the middle of this master, mm. */
	shiftLimit: number | null;
}

let master: { key: string; solid: Manifold; note: string | null } | null = null;
const joinNotes = (...notes: (string | null)[]) =>
	notes.filter(Boolean).join(sentenceGap(currentLocale())) || null;

serve<MoldJob>(async (job) => {
	const wasm = await loadManifold();
	const out: { role: MoldPiece['role']; solid: Manifold; dir?: MoldPiece['dir'] }[] = [];
	let reply: Omit<MoldReply, 'pieces'>;
	if (job.op === 'box') {
		if (master?.key !== job.key) {
			master?.solid.delete();
			master = null;
			const loaded = toManifold(wasm, job.tris);
			master = { key: job.key, solid: loaded.solid, note: loaded.note };
		}
		const r = moldBox(wasm, master.solid, job.params);
		for (const part of r.parts) out.push({ role: 'box', ...part });
		if (r.lid) out.push({ role: 'lid', solid: r.lid, dir: [0, 0, 1] });
		if (r.base) out.push({ role: 'base', solid: r.base, dir: [0, 0, -1] });
		out.push({ role: 'master', solid: r.master });
		reply = {
			silicone: r.silicone,
			cast: r.master.volume(),
			cavities: 1,
			note: joinNotes(master.note, r.note),
			check: { clearance: r.clearance, open: [] },
			masterFixed: r.straightened,
			shiftLimit: r.shiftLimit
		};
	} else {
		let text: Manifold | null = null;
		let note: string | null = null;
		try {
			if (job.text?.length) {
				const outline = new wasm.CrossSection(job.text, 'NonZero');
				text = outline.extrude(1);
				outline.delete();
			}
		} catch {
			note = msg.t_mold_generator_note_text_failed();
		}
		const r = pourMold(wasm, job.params, text);
		text?.delete();
		out.push({ role: 'mold', solid: r.mold });
		reply = {
			silicone: null,
			cast: r.castVolume,
			cavities: r.cavities,
			note,
			check: null,
			masterFixed: false,
			shiftLimit: null
		};
	}
	const pieces = out.map(({ role, solid, dir = [0, 0, 0] }) => {
		const piece: MoldPiece = { role, tris: fromManifold(solid), volume: solid.volume(), dir };
		solid.delete();
		return piece;
	});
	// What the slicer would complain about, before the plastic and the silicone are spent.
	if (reply.check) {
		reply.check.open = pieces.flatMap((piece, k) =>
			(piece.role === 'master' ? reply.masterFixed : piece.role !== 'mold') &&
			openEdges(piece.tris) > 0
				? [k]
				: []
		);
	}
	return [{ ...reply, pieces } satisfies MoldReply, pieces.map((x) => x.tris.buffer)];
});
