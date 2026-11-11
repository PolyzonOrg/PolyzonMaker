// Print preparation: analyse → plan → apply → export.
export * from './analyze.js';
export * from './ops.js';
export * from './print.js';
export * from './export-files.js';
export * from './errors.js';

// Files.
export * from './model-file.js';
export * from './mesh-import.js';
export * from './glb.js';
export * from './stl.js';
export * from './threemf.js';
export * from './model-convert.js';
export * from './zip.js';
export * from './zip-read.js';

// Mesh building blocks.
export * from './weld.js';
export * from './mesh-triangulate.js';
export * from './mesh-repair.js';
export * from './sdf.js';
export * from './remesh.js';
export * from './solid.js';
export * from './provenance.js';

// manifold-3d tools.
export * from './manifold.js';
export * from './kit.js';
export * from './plane.js';
export * from './section.js';
export * from './hollow.js';
export * from './cut.js';
export * from './mini-base.js';
export * from './big-print.js';
// The cut planner counts axes 0 | 1 | 2 where plane.ts names them 'x' | 'y' | 'z'.
export {
	FACE_AXES,
	IDENTITY,
	boxOfPoints,
	cloudPoints,
	countParts,
	fits,
	leavesOf,
	orientations,
	partsFor,
	planCuts,
	principalAxes,
	rotatePoints,
	sizeOf,
	type Axis as AxisIndex,
	type Box,
	type Cell,
	type Mat3,
	type Orientation,
	type PlanNode,
	type PlanOptions as CutPlanOptions,
	type Sections
} from './big-print-plan.js';
