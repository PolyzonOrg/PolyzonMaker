/**
 * The whole way from a model to files for a slicer, as Ark runs it: scale, repair what the report found,
 * and for a generated model fill what is hollow and join what lies over each other; take the crumbs off,
 * simplify within 0.05 mm, export, and check the result again. The surface stays where it was: a model is
 * rebuilt on a grid (solid.ts) only when the person asks for it. The original is never changed.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import type { ManifoldToplevel } from 'manifold-3d';
import { analyze, type Analysis } from './analyze.js';
import { exportModel, type ExportedFile } from './export-files.js';
import { fromManifold, manifoldOf } from './manifold.js';
import { apply, checkStatus, plan, simplifyOp } from './ops.js';
import type { Provenance } from './provenance.js';
import { solidify } from './solid.js';
import { bounds, type Triangles, type Vec3 } from './stl.js';
import { unweld, weld, weldTolerance } from './weld.js';

/** Far below a 0.4 mm nozzle's trace. */
const SIMPLIFY_MM = 0.05;
/** Under this share of the largest part's volume a part is a generator's speck: printed, it comes loose and gets in the nozzle's way. */
const CRUMB = 0.001;

export interface PrintOptions {
	wasm: ManifoldToplevel;
	/** mm along Z */
	height: number;
	buildVolume?: Vec3;
	/** See `AnalyzeOptions` */
	finished?: boolean;
	name?: string;
	/** The model rebuilt as one solid body (`makeSolid`), when the person asked: printed from instead of repairing it */
	solid?: SolidModel;
	/** Made by an AI: the files say so and carry the invisible mark */
	provenance?: Provenance;
	progress?: (stage: 'repair' | 'simplify' | 'export') => void;
}

/** Millimetres a solid is made at, along the model's longest side: a generator's units are anything from metres to its own. */
const SOLID_MM = 100;

export interface SolidModel {
	/** In mm, the model scaled to SOLID_MM along its longest side */
	mesh: Triangles;
	/** Grid step, mm at that size */
	voxel: number;
	/** How far the closing reached, mm at that size: tears up to twice this wide were sealed */
	close: number;
}

/** A generator's model as one solid body: made once, then printed at any size. */
export async function makeSolid(tris: Triangles, wasm: ManifoldToplevel, budget?: number): Promise<SolidModel> {
	const k = SOLID_MM / Math.max(...bounds(tris).size);
	const { solid, voxel, close } = await solidify(wasm, tris.map((v) => v * k) as Triangles, budget);
	try {
		return { mesh: fromManifold(solid), voxel, close };
	} finally {
		solid.delete();
	}
}

export interface PrintResult {
	/** The report of what the files hold */
	report: Analysis;
	/** What the files hold */
	mesh: Triangles;
	files: ExportedFile[];
	/** Rebuilt as one solid body on request: its grid step and the widest tear sealed, mm at the printed size; or null */
	solid: { voxel: number; sealed: number } | null;
	/** Hollows filled: shells a generator left inside the body */
	filled: number;
	/** How far the simplification moved the surface, mm */
	moved: number;
	/** Loose specks taken off a generated or mended model */
	crumbs: number;
	faces: { before: number; after: number };
	/** Closed for a slicer too, all files read back, and not a flat plate */
	ready: boolean;
	flat: boolean;
}

const closed = (r: Analysis) => checkStatus(r, 'closed-solid') === 'passed';
/** Closed for a slicer too: no edge left open, none shared by more than two faces. */
const sound = (r: Analysis) => closed(r) && !r.openEdges && !r.nonManifoldEdges;

function withoutCrumbs(mesh: Triangles, wasm: ManifoldToplevel): { mesh: Triangles; crumbs: number } {
	const solid = manifoldOf(wasm, weld(mesh, weldTolerance(bounds(mesh).size)));
	if (!solid) return { mesh, crumbs: 0 };
	const parts = solid.decompose();
	solid.delete();
	const size = (part: (typeof parts)[number]) => Math.abs(part.volume());
	const largest = parts.reduce((most, part) => Math.max(most, size(part)), 0); // a spread overflows past ~120 000 parts
	const kept = parts.filter((part) => size(part) >= largest * CRUMB);
	const crumbs = parts.length - kept.length;
	if (crumbs) {
		const whole = wasm.Manifold.compose(kept);
		mesh = fromManifold(whole);
		whole.delete();
	}
	for (const part of parts) part.delete();
	return { mesh, crumbs };
}

/** A crumb above or below a model counted in its height: without it the model is scaled back to the size asked for. */
function toHeight(mesh: Triangles, height: number): Triangles {
	let [low, high] = [Infinity, -Infinity];
	for (let i = 2; i < mesh.length; i += 3) {
		low = Math.min(low, mesh[i]);
		high = Math.max(high, mesh[i]);
	}
	const k = height / (high - low);
	return mesh.map((value, i) => (i % 3 === 2 ? (value - low) * k : value * k)) as Triangles;
}

export interface Closed {
	mesh: Triangles;
	report: Analysis;
	/** Hollows filled */
	filled: number;
}

/**
 * A generated model as one body: the shells left inside it (the repair keeps them turned inward, as a
 * cavity's) go, so it prints full, and parts lying over each other are joined. Faces stay where they
 * were, except along the lines where parts cross. Null when it is not a closed solid to begin with.
 */
function joinParts(wasm: ManifoldToplevel, mesh: Triangles): { mesh: Triangles; filled: number } | null {
	const whole = manifoldOf(wasm, weld(mesh, weldTolerance(bounds(mesh).size)));
	if (!whole) return null;
	const parts = whole.decompose();
	whole.delete();
	const bodies = parts.filter((part) => part.volume() > 0);
	const filled = parts.length - bodies.length;
	let joined = mesh;
	if (filled || bodies.length > 1) {
		const one = wasm.Manifold.union(bodies);
		joined = fromManifold(one);
		one.delete();
	}
	parts.forEach((part) => part.delete());
	return { mesh: joined, filled };
}

/**
 * Holes, cracks and loose seams closed, at `height` mm, without moving the surface: repair what the report
 * found; a generated model's hollows filled and its overlapping parts joined. What still is not closed
 * says so: rebuilding it on a grid smooths the detail away, and that is the person's call.
 */
export async function closeUp(tris: Triangles, before: Analysis, o: Pick<PrintOptions, 'wasm' | 'height' | 'buildVolume' | 'finished' | 'progress'>): Promise<Closed> {
	const { wasm, height, buildVolume, finished } = o;
	o.progress?.('repair');
	const repaired = await apply(tris, plan(before, { height }), { wasm, buildVolume, finished });
	const one = finished || !closed(repaired.report) ? null : joinParts(wasm, repaired.mesh);
	if (!one || (!one.filled && one.mesh === repaired.mesh)) return { mesh: repaired.mesh, report: repaired.report, filled: 0 };
	return { mesh: one.mesh, report: analyze(one.mesh, { wasm, buildVolume, finished }), filled: one.filled };
}

export async function prepareForPrint(tris: Triangles, before: Analysis, o: PrintOptions): Promise<PrintResult> {
	const { wasm, height, buildVolume, finished } = o;
	let solid: PrintResult['solid'] = null;
	let whole: Closed;
	if (o.solid) {
		o.progress?.('repair');
		const own = analyze(o.solid.mesh, { wasm });
		const k = height / own.size[2];
		const sized = await apply(o.solid.mesh, plan(own, { height, repair: false }), { wasm, buildVolume, finished });
		// a rebuilt body is full: the hollows it had are the ones filled
		whole = { mesh: sized.mesh, report: sized.report, filled: before.components.filter((c) => c.closed && c.volume < 0).length };
		solid = { voxel: o.solid.voxel * k, sealed: 2 * o.solid.close * k };
	} else whole = await closeUp(tris, before, o);
	let best = { mesh: whole.mesh, report: whole.report };
	let moved = 0;
	let crumbs = 0;
	// a generated model, or one made solid on request: its loose specks only get in the nozzle's way
	if ((!finished || o.solid) && closed(best.report)) {
		const clean = withoutCrumbs(best.mesh, wasm);
		crumbs = clean.crumbs;
		if (crumbs) {
			const whole = toHeight(clean.mesh, height);
			best = { ...best, mesh: whole, report: analyze(whole, { wasm, buildVolume, finished }) };
		}
	}
	let { mesh, report } = best;
	// a solid was thinned as it was made: a second pass would only blur what it kept
	if (!o.solid) {
		o.progress?.('simplify');
		const s = await simplifyOp(best.mesh, { maxDeviation: SIMPLIFY_MM }, { wasm });
		const simpler = analyze(s.mesh, { wasm, buildVolume, finished });
		if (sound(simpler) || !sound(best.report)) {
			[mesh, report] = [s.mesh, simpler];
			moved += (s.changes.deviation as { max: number }).max;
		}
	}
	o.progress?.('export');
	const files = await exportModel(mesh, { formats: ['stl', '3mf'], name: o.name ?? 'model', provenance: o.provenance });
	const flat = checkStatus(before, 'flat-plate') === 'warning';
	return {
		report,
		mesh,
		files,
		solid,
		filled: whole.filled,
		moved,
		crumbs,
		faces: { before: before.faces, after: report.faces },
		ready: sound(report) && !flat && files.length > 0 && files.every((f) => f.ready),
		flat
	};
}

/** A lighter copy for the screen; the exported files never come from it (TZ §17.2). */
export async function previewMesh(tris: Triangles, maxFaces = 200_000): Promise<Triangles> {
	if (tris.length / 9 <= maxFaces) return tris;
	await MeshoptSimplifier.ready;
	const size = [0, 1, 2].map((k) => {
		let lo = Infinity;
		let hi = -Infinity;
		for (let i = k; i < tris.length; i += 3) {
			if (tris[i] < lo) lo = tris[i];
			if (tris[i] > hi) hi = tris[i];
		}
		return hi - lo;
	});
	const welded = weld(tris, weldTolerance(size));
	const [indices] = MeshoptSimplifier.simplify(welded.indices, welded.positions, 3, maxFaces * 3, 0.05, ['ErrorAbsolute']);
	return unweld({ positions: welded.positions, indices });
}

