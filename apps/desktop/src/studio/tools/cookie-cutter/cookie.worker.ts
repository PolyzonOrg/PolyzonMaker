/** Builds the cutter and its stamp off the main thread (manifold-3d). */
import { loadManifold } from '../manifold';
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { ringsToSvg } from '../shared/outline';
import { createKit, trianglesOf } from '../shared/section';
import { layoutInRow, writeStl } from '../stl';
import { buildCookie, type CookieJob } from './model';

export interface CookieOutput {
	cutter: Uint8Array;
	stamp: Uint8Array | null;
	/** Cutter and stamp side by side, for the scene. */
	preview: Uint8Array;
	svg: string;
	warnings: string[];
}

serveMeshJobs<CookieJob, CookieOutput>(
	async (job) => {
		const kit = createKit(await loadManifold());
		try {
			const r = buildCookie(kit, job);
			const cutter = trianglesOf(r.cutter);
			const stamp = r.stamp ? trianglesOf(r.stamp) : null;
			return {
				cutter: writeStl(cutter, 'Polyzon Studio cookie cutter'),
				stamp: stamp && writeStl(stamp, 'Polyzon Studio cookie stamp'),
				preview: writeStl(stamp ? layoutInRow([cutter, stamp], 12) : cutter, 'Polyzon Studio'),
				svg: ringsToSvg(r.outline),
				warnings: r.warnings
			};
		} finally {
			kit.free();
		}
	},
	(out) => [out.cutter.buffer, out.preview.buffer, ...(out.stamp ? [out.stamp.buffer] : [])]
);
