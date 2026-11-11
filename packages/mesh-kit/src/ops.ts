/**
 * Print preparation as explicit operations: `analyze` says what the model
 * is, `plan` turns the report and the user's choices into a list of
 * operations — each with its parameters in millimetres, its algorithm
 * version and the change to expect — and `apply` runs them and analyses
 * the result again. Nothing happens that the plan does not list: the
 * original bottom stays, parts are not merged or dropped, holes are filled
 * only where listed, a voxel remesh only on request. Scale comes first, so
 * every later length is in mm of the print.
 *
 * Every operation is a pure function: triangles in (mm), parameters,
 * optional progress, triangles out and what changed. Meshes are plain
 * Float32Arrays, so a worker can transfer them (`transferList`).
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { analyze, mm, weldTolerance, type Analysis, type CheckStatus } from './analyze.js';
import { MeshKitError } from './errors.js';
import { fromManifold, loadManifold, manifoldOf } from './manifold.js';
import {
	fillHoles,
	orientConsistently,
	orientOutward,
	removeDegenerate,
	removeDuplicates,
	removeNonManifold,
	toTriangles,
	toWorkMesh
} from './mesh-repair.js';
import { remeshSamples, voxelRemesh } from './remesh.js';
import { surfaceDeviation, type Deviation } from './sdf.js';
import { bounds, merge, placeOnBed, type Triangles, type Vec3 } from './stl.js';
import { unweld, weld, type IndexedMesh } from './weld.js';

/** Parameters of each operation; every length is in millimetres. */
export interface OpParams {
	/** To a height (the Z size after), or by a factor (1000 for a model in metres). About the origin. */
	scale: { height: number } | { factor: number };
	repair: {
		/** Corners closer than this become one, mm. */
		weldTolerance: number;
		/**
		 * Mend edges of 3+ faces. Surfaces that only touch there are a sound solid: they are parted
		 * and every face stays. What manifold refuses is cut out, and the gap is a hole to fill.
		 */
		nonManifold: boolean;
		/** Make neighbouring faces agree and every closed part face outward. */
		orientation: boolean;
		/** Holes to close: all, none, or those with these centres (`Hole.center`, mm, after scale). */
		fillHoles: 'all' | 'none' | Vec3[];
	};
	/** Rebuild the surface on a grid of `voxel` mm. */
	remesh: { voxel: number };
	/** Fewer faces where the surface moves less than `maxDeviation` mm. */
	simplify: { maxDeviation: number };
	/** Cut `cut` mm off the bottom so it stands flat. */
	'flat-bottom': { cut: number };
	/** Move it to stand on z = 0, centred on X and Y. */
	'place-on-bed': Record<string, never>;
}

export type OpKind = keyof OpParams;

/** The algorithm version of each operation: a plan made for another version is refused, not run differently. */
export const OP_VERSIONS: Record<OpKind, number> = {
	scale: 1,
	repair: 2,
	remesh: 1,
	simplify: 1,
	'flat-bottom': 1,
	'place-on-bed': 1
};

export type Op = {
	[K in OpKind]: {
		op: K;
		version: number;
		params: OpParams[K];
		units: 'mm';
		/** What it will change, for the person who approves the plan. */
		expected: string;
	};
}[OpKind];

export interface OpOutput {
	mesh: Triangles;
	/** What the operation changed: counts, mm, measured deviation. */
	changes: Record<string, unknown>;
}

export interface OpContext {
	/** Needed by remesh, simplify and flat-bottom. */
	wasm?: ManifoldToplevel;
	progress?: (fraction: number) => void;
}

// ---------------------------------------------------------------- operations

export function scaleOp(tris: Triangles, p: OpParams['scale']): OpOutput {
	const factor = 'height' in p ? p.height / bounds(tris).size[2] : p.factor;
	if (!(factor > 0 && Number.isFinite(factor))) throw new RangeError(`scale factor ${factor}`);
	const mesh = tris.map((v) => v * factor);
	return { mesh, changes: { factor, size: bounds(mesh).size } };
}

export function placeOnBedOp(tris: Triangles): OpOutput {
	const before = bounds(tris);
	const mesh = placeOnBed(tris);
	const after = bounds(mesh);
	return { mesh, changes: { moved: after.min.map((v, k) => v - before.min[k]) } };
}

export function repairOp(tris: Triangles, p: OpParams['repair'], ctx: OpContext = {}): OpOutput {
	const solid = p.nonManifold && ctx.wasm ? manifoldOf(ctx.wasm, weld(tris, p.weldTolerance)) : null;
	const { mesh, collapsed } = toWorkMesh(solid ? fromManifold(solid) : tris, p.weldTolerance);
	const parted = solid !== null;
	solid?.delete();
	const weldedVertices = Math.floor(tris.length / 3) - mesh.positions.length / 3;
	ctx.progress?.(0.2);
	const degenerate = collapsed + removeDegenerate(mesh);
	const duplicates = removeDuplicates(mesh);
	const nonManifold = p.nonManifold && !parted ? removeNonManifold(mesh) : 0;
	ctx.progress?.(0.4);
	if (p.orientation) orientConsistently(mesh);
	let filled = { holes: 0, triangles: 0 };
	if (p.fillHoles !== 'none') {
		const wanted = p.fillHoles;
		const pos = mesh.positions;
		filled = fillHoles(mesh, (loop) => {
			if (wanted === 'all') return true;
			const c = [0, 1, 2].map((k) => loop.reduce((s, v) => s + pos[3 * v + k], 0) / loop.length);
			const radius = Math.max(
				...loop.map((v) => Math.hypot(pos[3 * v] - c[0], pos[3 * v + 1] - c[1], pos[3 * v + 2] - c[2]))
			);
			return wanted.some((w) => Math.hypot(w[0] - c[0], w[1] - c[1], w[2] - c[2]) <= radius / 4 + p.weldTolerance * 10);
		});
	}
	ctx.progress?.(0.8);
	if (p.orientation) orientOutward(mesh);
	return {
		mesh: toTriangles(mesh),
		changes: {
			weldedVertices,
			degenerate,
			duplicates,
			parted,
			nonManifold,
			/** Original faces turned over. */
			flipped: mesh.tags.filter((t) => t === 1).length,
			holesFilled: filled.holes,
			holeTriangles: filled.triangles
		}
	};
}

export function remeshOp(tris: Triangles, p: OpParams['remesh'], ctx: OpContext): OpOutput {
	const solid = voxelRemesh(needWasm(ctx), tris, p.voxel);
	const mesh = fromManifold(solid);
	solid.delete();
	return {
		mesh,
		changes: { triangles: mesh.length / 9, deviation: surfaceDeviation(tris, mesh, 4 * p.voxel) }
	};
}

type Fit = { mesh: Triangles; deviation: Deviation };
type Measure = (a: Triangles, b: Triangles) => Deviation;

// meshoptimizer's error is an estimate: the measured deviation decides, a
// tighter target is tried when it overshoots. A solid must stay closed.
function meshoptFit(
	wasm: ManifoldToplevel,
	welded: IndexedMesh,
	isSolid: boolean,
	targets: number[],
	measure: (mesh: Triangles) => Deviation
): Fit | null {
	for (const target of targets) {
		const [indices] = MeshoptSimplifier.simplify(
			welded.indices,
			welded.positions,
			3,
			0,
			target,
			// An open mesh keeps its open edges where they are.
			isSolid ? ['ErrorAbsolute'] : ['ErrorAbsolute', 'LockBorder']
		);
		const mesh = unweld({ positions: welded.positions, indices });
		const deviation = measure(mesh);
		if (deviation.max > targets[0]) continue;
		if (!isSolid) return { mesh, deviation };
		const closed = manifoldOf(wasm, weld(mesh, weldTolerance(bounds(mesh).size)));
		closed?.delete();
		return closed ? { mesh, deviation } : null;
	}
	return null;
}

// manifold's own simplification keeps a solid closed, but its tolerance is per step and they add up.
// Part by part: a generator leaves specks a tenth of a millimetre across, and one the tolerance
// swallows counts as moved as far as it floated from the body, which would fail the whole model.
// A part that fits no target stays as it was: parts are not dropped without a plan.
function manifoldFit(solid: Manifold, tris: Triangles, targets: number[], measure: Measure): Fit | null {
	const parts = solid.decompose();
	const meshes = parts.map((part) => {
		const exact = fromManifold(part);
		for (const target of targets) {
			const simpler = part.simplify(target);
			const mesh = fromManifold(simpler);
			simpler.delete();
			if (mesh.length && measure(exact, mesh).max <= targets[0]) return mesh;
		}
		return exact;
	});
	parts.forEach((part) => part.delete());
	const mesh = merge(meshes);
	const deviation = measure(tris, mesh);
	return mesh.length < tris.length && deviation.max <= targets[0] ? { mesh, deviation } : null;
}

export async function simplifyOp(
	tris: Triangles,
	p: OpParams['simplify'],
	ctx: OpContext
): Promise<OpOutput> {
	const wasm = needWasm(ctx);
	const welded = weld(tris, weldTolerance(bounds(tris).size));
	const solid = manifoldOf(wasm, welded);
	// A collapse can pinch a thin part, and a solid is written with one set of corners: through `fromManifold`.
	const done = ({ mesh, deviation }: Fit, method: string): OpOutput => {
		const closed = solid && manifoldOf(wasm, weld(mesh, weldTolerance(bounds(mesh).size)));
		const out = closed ? fromManifold(closed) : mesh;
		solid?.delete();
		closed?.delete();
		return { mesh: out, changes: { before: Math.floor(tris.length / 9), after: out.length / 9, method, deviation } };
	};
	await MeshoptSimplifier.ready;
	const targets = [1, 0.5, 0.25].map((k) => k * p.maxDeviation);
	const measure: Measure = (a, b) => surfaceDeviation(a, b, 4 * p.maxDeviation);
	const byMeshopt = meshoptFit(wasm, welded, solid !== null, targets, (mesh) => measure(tris, mesh));
	if (byMeshopt) return done(byMeshopt, 'meshoptimizer');
	const byManifold = solid && manifoldFit(solid, tris, targets, measure);
	if (byManifold) return done(byManifold, 'manifold');
	return done({ mesh: tris, deviation: { max: 0, mean: 0, capped: false } }, 'none: no result within the limit');
}

export function flatBottomOp(tris: Triangles, p: OpParams['flat-bottom'], ctx: OpContext): OpOutput {
	const solid = manifoldOf(needWasm(ctx), weld(tris, weldTolerance(bounds(tris).size)));
	if (!solid) throw new MeshKitError('not-a-solid');
	const box = solid.boundingBox();
	const cut = solid.trimByPlane([0, 0, 1], box.min[2] + p.cut);
	solid.delete();
	if (cut.isEmpty()) {
		cut.delete();
		throw new MeshKitError('empty-result');
	}
	const mesh = fromManifold(cut);
	cut.delete();
	return {
		mesh,
		changes: { cut: p.cut, height: { before: box.max[2] - box.min[2], after: bounds(mesh).size[2] } }
	};
}

function needWasm(ctx: OpContext): ManifoldToplevel {
	if (!ctx.wasm) throw new Error('this operation needs the manifold-3d module (loadManifold)');
	return ctx.wasm;
}

const OPS: { [K in OpKind]: (tris: Triangles, p: OpParams[K], ctx: OpContext) => OpOutput | Promise<OpOutput> } = {
	scale: scaleOp,
	'place-on-bed': placeOnBedOp,
	repair: repairOp,
	remesh: remeshOp,
	simplify: simplifyOp,
	'flat-bottom': flatBottomOp
};

// ---------------------------------------------------------------- plan and apply

export interface PlanOptions {
	/** Height of the print, mm. */
	height?: number;
	/** Or a scale factor (1000 for a model in metres); `height` wins. */
	factor?: number;
	/** Repair: on by default when the report has open, flipped, non-manifold or degenerate faces. */
	repair?: boolean | Partial<OpParams['repair']>;
	remesh?: OpParams['remesh'];
	simplify?: OpParams['simplify'];
	flatBottom?: OpParams['flat-bottom'];
	/** Stand it on z = 0, centred: on by default (the shape does not change). */
	placeOnBed?: boolean;
}

const op = <K extends OpKind>(kind: K, params: OpParams[K], expected: string): Op =>
	({ op: kind, version: OP_VERSIONS[kind], params, units: 'mm', expected }) as Op;

const size3 = (s: readonly number[]) => s.map(mm).join(' × ') + ' mm';

export function plan(report: Analysis, o: PlanOptions = {}): Op[] {
	const ops: Op[] = [];
	let k = 1;
	if (o.height !== undefined || o.factor !== undefined) {
		const params: OpParams['scale'] =
			o.height !== undefined ? { height: o.height } : { factor: o.factor! };
		k = 'height' in params ? params.height / report.size[2] : params.factor;
		ops.push(
			op('scale', params, `size ${size3(report.size)} → ${size3(report.size.map((v) => v * k))} (×${+k.toPrecision(4)}), about the origin`)
		);
	}
	const size = report.size.map((v) => v * k);
	const fixable =
		report.openEdges + report.flippedEdges + report.nonManifoldEdges + report.degenerateFaces > 0 ||
		report.checks.some((c) => c.id === 'orientation' && c.status === 'failed');
	if (o.repair ?? fixable) {
		const chosen = typeof o.repair === 'object' ? o.repair : {};
		const params: OpParams['repair'] = {
			weldTolerance: weldTolerance(size),
			nonManifold: report.nonManifoldEdges > 0,
			orientation: true,
			fillHoles: report.holes.length || report.nonManifoldEdges ? 'all' : 'none',
			...chosen,
			...(Array.isArray(chosen.fillHoles)
				? { fillHoles: chosen.fillHoles.map((c) => c.map((v) => v * k) as Vec3) }
				: {})
		};
		const holes =
			params.fillHoles === 'all'
				? report.holes
				: params.fillHoles === 'none'
					? []
					: report.holes.filter((h) =>
							(params.fillHoles as Vec3[]).some((c) => Math.hypot(...c.map((v, i) => v - h.center[i] * k)) < 1e-6 + params.weldTolerance * 10)
						);
		const lines = [`weld corners closer than ${params.weldTolerance.toPrecision(2)} mm`];
		if (report.degenerateFaces) lines.push(`remove ${report.degenerateFaces} faces without area`);
		if (params.nonManifold && report.nonManifoldEdges)
			lines.push(
				checkStatus(report, 'closed-solid') === 'passed'
					? `part the surfaces that touch along ${report.nonManifoldEdges} edges`
					: `cut out the faces around ${report.nonManifoldEdges} edges of 3+ faces and close the gaps`
			);
		if (params.orientation)
			lines.push(`turn faces to agree with their neighbours (${report.flippedEdges} edges between flipped faces) and face outward`);
		lines.push(
			holes.length
				? `close ${holes.length} of ${report.holes.length} holes: ` +
						holes.map((h) => `${h.edges} edges at (${h.center.map((v) => mm(v * k)).join(', ')})`).join('; ')
				: report.holes.length
					? `leave ${report.holes.length} holes open`
					: 'no holes to close'
		);
		ops.push(op('repair', params, lines.join('; ')));
	}
	if (o.remesh)
		ops.push(
			op(
				'remesh',
				o.remesh,
				`rebuild the whole surface on a ${mm(o.remesh.voxel)} mm grid (about ${Math.round(remeshSamples(size, o.remesh.voxel) / 1e6)} M samples): ` +
					`detail under ${mm(o.remesh.voxel)} mm is lost, separate parts may join; the deviation is measured`
			)
		);
	if (o.simplify)
		ops.push(
			op('simplify', o.simplify, `fewer faces where the surface moves less than ${mm(o.simplify.maxDeviation)} mm; the deviation is measured`)
		);
	if (o.flatBottom)
		ops.push(
			op('flat-bottom', o.flatBottom, `cut ${mm(o.flatBottom.cut)} mm off the bottom: height ${mm(size[2])} → ${mm(size[2] - o.flatBottom.cut)} mm`)
		);
	if (o.placeOnBed ?? true)
		ops.push(op('place-on-bed', {}, 'move to stand on z = 0, centred on X and Y; the shape does not change'));
	return ops;
}

export interface StepReport {
	op: OpKind;
	version: number;
	params: Op['params'];
	ms: number;
	changes: Record<string, unknown>;
}

export interface ApplyOptions {
	/** The loaded manifold-3d module; `loadManifold()` when not given. */
	wasm?: ManifoldToplevel;
	/** Per operation, 0…1. */
	progress?: (step: { index: number; op: OpKind; fraction: number }) => void;
	/** Checked between operations; a running WASM call is not interrupted (end the worker for that). */
	signal?: AbortSignal;
	/** For the build-volume check of the final report, mm. */
	buildVolume?: Vec3;
	/** See `AnalyzeOptions` */
	finished?: boolean;
}

export interface ApplyResult {
	mesh: Triangles;
	steps: StepReport[];
	/** The result analysed again, closed-solid check included. */
	report: Analysis;
}

/** Run the operations in order on a copy of the mesh; the input is never changed. */
export async function apply(
	input: Triangles | IndexedMesh,
	ops: readonly Op[],
	o: ApplyOptions = {}
): Promise<ApplyResult> {
	const wasm = o.wasm ?? (await loadManifold());
	let mesh = input instanceof Float32Array ? input : unweld(input);
	const steps: StepReport[] = [];
	for (const [index, step] of ops.entries()) {
		o.signal?.throwIfAborted();
		const run = OPS[step.op] as (tris: Triangles, p: unknown, ctx: OpContext) => OpOutput | Promise<OpOutput>;
		if (!run || OP_VERSIONS[step.op] !== step.version)
			throw new MeshKitError('unknown-op', `${step.op} v${step.version}`);
		const started = performance.now();
		const progress = (fraction: number) => o.progress?.({ index, op: step.op, fraction });
		progress(0);
		const out = await run(mesh, step.params, { wasm, progress });
		progress(1);
		steps.push({
			op: step.op,
			version: step.version,
			params: step.params,
			ms: Math.round(performance.now() - started),
			changes: out.changes
		});
		mesh = out.mesh;
	}
	o.signal?.throwIfAborted();
	return { mesh, steps, report: analyze(mesh, { wasm, buildVolume: o.buildVolume, finished: o.finished }) };
}

/** Status of one check in a report, for tests and UIs. */
export const checkStatus = (report: Analysis, id: Analysis['checks'][number]['id']): CheckStatus =>
	report.checks.find((c) => c.id === id)?.status ?? 'not-checked';
