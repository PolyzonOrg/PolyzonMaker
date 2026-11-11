/**
 * What the viewer tells about a model: plastics for the weight estimate and
 * the worker job's shape. The numbers themselves come from `meshStats`.
 */
import type { MeshStats } from '../stl';
import * as m from '$msg/tools/stl-viewer';

export interface Material {
	id: string;
	label: string;
	/** g/cm³ */
	density: number;
}

export const MATERIALS: readonly Material[] = [
	{ id: 'pla', label: 'PLA', density: 1.24 },
	{ id: 'petg', label: 'PETG', density: 1.27 },
	{ id: 'abs', label: 'ABS', density: 1.04 },
	{ id: 'asa', label: 'ASA', density: 1.07 },
	{ id: 'tpu', label: 'TPU', density: 1.21 },
	{
		id: 'nylon',
		get label() {
			return m.t_stl_viewer_material_nylon();
		},
		density: 1.14
	},
	{ id: 'pc', label: 'PC', density: 1.2 }
];

/** Weight of a solid model, g (volume in mm³). */
export function weightGrams(volumeMm3: number, density: number): number {
	return (volumeMm3 / 1000) * density;
}

export interface AnalyzeJob {
	name: string;
	bytes: Uint8Array;
}

export interface AnalyzeResult {
	stats: MeshStats;
	/** The model as STL for the scene (the file itself when it is an STL). */
	stl: Uint8Array;
	/** The edges of the holes, as segments (STL coordinates), for the scene. */
	holes: Float32Array;
}
