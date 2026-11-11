/** Repair tool: modes in words and the worker job's shape. */
import type { MeshStats } from '../stl';
import type { RepairMode, RepairOptions, RepairReport } from '../shared/mesh-repair';
import * as m from '$msg/tools/stl-repair';

export const REPAIR_MODES: readonly { value: RepairMode; label: string; hint: string }[] = [
	{
		value: 'standard',
		get label() {
			return m.t_stl_repair_mode_standard();
		},
		get hint() {
			return m.t_stl_repair_mode_standard_hint();
		}
	},
	{
		value: 'minimal',
		get label() {
			return m.t_stl_repair_mode_minimal();
		},
		get hint() {
			return m.t_stl_repair_mode_minimal_hint();
		}
	},
	{
		value: 'aggressive',
		get label() {
			return m.t_stl_repair_mode_aggressive();
		},
		get hint() {
			return m.t_stl_repair_mode_aggressive_hint();
		}
	}
];

export interface RepairJob {
	/** Changes with every new file: the worker keeps the parsed model for it. */
	fileId: number;
	name: string;
	bytes: Uint8Array;
	options: RepairOptions;
}

export interface RepairResult {
	before: MeshStats;
	after: MeshStats;
	report: RepairReport;
	original: Uint8Array;
	repaired: Uint8Array;
}

/** model.stl → model-fixed.stl (latin and digits only). */
export function repairedFileName(name: string): string {
	const base = name
		.replace(/\.[^.]+$/, '')
		.replace(/[^\w.-]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return `${base || 'model'}-fixed.stl`;
}
