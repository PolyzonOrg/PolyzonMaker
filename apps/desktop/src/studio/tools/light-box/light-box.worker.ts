/** Traces the tone levels and builds the plates and the box off the page. */
import { serveMeshJobs } from '../shared/mesh-worker-client';
import { loadManifold } from '../manifold';
import { fromManifold } from '../solid';
import { buildLightBox, type LightBoxLayout, type LightBoxParams } from './model';

export interface LightBoxJob {
	params: LightBoxParams;
	layout: LightBoxLayout;
	/** Grey, 0 black … 255 white, cols × rows */
	gray: Uint8Array;
}

export interface LightBoxPart {
	name: string;
	file: string;
	/** In the assembled box, for the scene */
	scene: Float32Array;
	/** On the bed, for the file */
	print: Float32Array;
	volume: number;
}

export interface LightBoxReply {
	parts: LightBoxPart[];
	dropped: number;
}

serveMeshJobs<LightBoxJob, LightBoxReply>(
	async (job) => {
		const wasm = await loadManifold();
		const { pieces, dropped } = buildLightBox(wasm, job.gray, job.params, job.layout);
		const parts = pieces.map(({ name, file, solid, place }) => {
			// A plate stands up in its groove: its face to the front, its top up.
			const moved = place.standing
				? solid
						.rotate([90, 0, 0])
						.translate([0, place.y + job.params.plate, place.z + job.layout.height / 2])
				: solid;
			const part = {
				name,
				file,
				scene: fromManifold(moved),
				print: fromManifold(solid),
				volume: solid.volume()
			};
			if (moved !== solid) moved.delete();
			solid.delete();
			return part;
		});
		return { parts, dropped };
	},
	(r) => r.parts.flatMap((p) => [p.scene.buffer, p.print.buffer])
);
