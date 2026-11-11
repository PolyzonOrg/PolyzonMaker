/** Builds the light-letter box and lid off the main thread (manifold-3d). */
import { loadManifold } from '../manifold';
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { createKit, trianglesOf } from '../shared/section';
import type { Ring } from '../shared/trace';
import { bounds, merge, translate, writeStl } from '../stl';
import { buildSign, layoutLetters, outlineShape, type SignParams } from './model';

export interface SignJob {
	p: SignParams;
	/** letters: chars + glyphs at GLYPH_SIZE; outline: rings in mm. */
	kind: 'letters' | 'outline';
	chars: string[];
	glyphs: Ring[][];
	rings: Ring[];
}

export interface SignOutput {
	corpus: Uint8Array;
	lid: Uint8Array | null;
	/** Box and lid side by side, for the scene. */
	preview: Uint8Array;
	bodies: number;
}

serveMeshJobs<SignJob, SignOutput>(
	async (job) => {
		const kit = createKit(await loadManifold());
		try {
			const shape =
				job.kind === 'letters'
					? layoutLetters(kit, job.chars, job.glyphs, job.p)
					: outlineShape(kit, job.rings, job.p);
			const r = buildSign(kit, shape, job.p);
			const corpus = trianglesOf(r.corpus);
			const lid = r.lid ? trianglesOf(r.lid) : null;
			let preview = corpus;
			if (lid) {
				// The lid in front of the box (towards the viewer), 15 mm apart.
				const a = bounds(corpus);
				const b = bounds(lid);
				preview = merge([corpus, translate(lid, 0, a.min[1] - b.max[1] - 15, -b.min[2])]);
			}
			return {
				corpus: writeStl(corpus, 'Polyzon Studio sign box'),
				lid: lid && writeStl(lid, 'Polyzon Studio sign lid'),
				preview: writeStl(preview, 'Polyzon Studio sign'),
				bodies: r.bodies
			};
		} finally {
			kit.free();
		}
	},
	(out) => [out.corpus.buffer, out.preview.buffer, ...(out.lid ? [out.lid.buffer] : [])]
);
