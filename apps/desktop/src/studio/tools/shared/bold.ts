/**
 * A bolder face from a regular outline, as the text tools draw it: every
 * piece grown by `grow`. Grown blindly, pieces that sit close run together —
 * neighbouring letters, the dots of «ё», the breve of «й», the two strokes
 * of «ы». Here a piece stops growing where it would come within `gap` of
 * another one, and never gets thinner than drawn, so nothing that was apart
 * touches. Instance methods only: works with any manifold-3d CrossSection.
 */
import type { CrossSection } from 'manifold-3d';

export function growApart(
	cs: CrossSection,
	grow: number,
	gap: number,
	join: 'Round' | 'Miter' = 'Round',
	segments = 0
): CrossSection {
	const out = (shape: CrossSection, d: number) => shape.offset(d, join, 2, segments);
	const grown = out(cs, grow);
	const pieces = cs.decompose();
	const joined = grown.decompose();
	const merged = joined.length < pieces.length;
	for (const p of joined) p.delete();
	if (!merged) {
		for (const p of pieces) p.delete();
		return grown;
	}
	grown.delete();
	// Only pieces nearer than this can reach each other.
	const reach = 2 * grow + gap;
	const boxes = pieces.map((p) => p.bounds());
	const near = (a: number, b: number) =>
		boxes[a].min[0] - reach < boxes[b].max[0] &&
		boxes[b].min[0] - reach < boxes[a].max[0] &&
		boxes[a].min[1] - reach < boxes[b].max[1] &&
		boxes[b].min[1] - reach < boxes[a].max[1];
	// Starts with piece 0 as drawn, which its grown self covers anyway.
	let result = out(pieces[0], 0);
	for (let i = 0; i < pieces.length; i++) {
		let own = out(pieces[i], grow);
		const others = pieces.filter((_, j) => j !== i && near(i, j));
		if (others.length) {
			let around = others[0];
			for (const o of others.slice(1)) {
				const next = around.add(o);
				if (around !== others[0]) around.delete();
				around = next;
			}
			const keepOut = out(around, grow + gap);
			const trimmed = own.subtract(keepOut);
			const whole = trimmed.add(pieces[i]);
			for (const x of [keepOut, trimmed, own]) x.delete();
			if (around !== others[0]) around.delete();
			own = whole;
		}
		const next = result.add(own);
		result.delete();
		own.delete();
		result = next;
	}
	for (const p of pieces) p.delete();
	return result;
}
