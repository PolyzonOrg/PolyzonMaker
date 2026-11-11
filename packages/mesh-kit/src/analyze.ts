/**
 * What a model is before anything is changed: size, counts, parts, holes,
 * flipped and degenerate faces, and which checks ran. A check that did not
 * run says «not-checked» — never «passed»: no report is not no defect.
 * Pure; the closed-solid check runs only when the manifold-3d module is given.
 */
import type { ManifoldToplevel } from 'manifold-3d';
import { manifoldOf } from './manifold.js';
import { bounds, type Triangles, type Vec3 } from './stl.js';
import { unweld, weld, weldTolerance, type IndexedMesh } from './weld.js';

export type CheckId =
	| 'triangles'
	| 'open-edges'
	| 'non-manifold-edges'
	| 'orientation'
	| 'degenerate-faces'
	| 'components'
	| 'closed-solid'
	| 'flat-plate'
	| 'build-volume'
	| 'self-intersections'
	| 'wall-thickness';

export type CheckStatus = 'passed' | 'warning' | 'failed' | 'not-checked';

export interface Check {
	id: CheckId;
	status: CheckStatus;
	/** Counts towards the report's status. Self-intersections and wall thickness have no algorithm here yet. */
	basic: boolean;
	detail?: string;
}

export type ReportStatus = 'has-errors' | 'needs-check' | 'basic-passed';

/** The words for a status. There is deliberately no «will print». */
export const STATUS_TEXT: Record<ReportStatus, string> = {
	'has-errors': 'has file/geometry errors',
	'needs-check': 'needs a check before printing',
	'basic-passed': 'basic checks passed'
};

/** A hole: one connected run of open edges. */
export interface Hole {
	edges: number;
	/** Mean of its corners, mm: where to show it. */
	center: Vec3;
}

/** A separate part of the model (faces joined through shared corners). */
export interface Component {
	faces: number;
	/** mm³; meaningful only when `closed`. */
	volume: number;
	closed: boolean;
	center: Vec3;
	size: Vec3;
}

export interface Analysis {
	unit: 'mm';
	size: Vec3;
	min: Vec3;
	max: Vec3;
	/** After welding corners closer than `weldTolerance`. */
	vertices: number;
	faces: number;
	/** mm, from the model's size (`weldTolerance`). */
	weldTolerance: number;
	/** Largest first. */
	components: Component[];
	openEdges: number;
	holes: Hole[];
	nonManifoldEdges: number;
	/** Edges whose two faces run the same way along them: one of the two is flipped. */
	flippedEdges: number;
	/** Faces with (almost) no area, those that collapse when welded included. */
	degenerateFaces: number;
	/** The part of the surface, 0 to 1, in one axis-aligned plane: see `largestPlane`. */
	flatShare: number;
	checks: Check[];
	status: ReportStatus;
}

export { weldTolerance };

export interface AnalyzeOptions {
	/** The loaded manifold-3d module: runs the closed-solid check. */
	wasm?: ManifoldToplevel;
	/** Printer build volume X × Y × Z, mm: runs the fit check (turns about Z allowed). */
	buildVolume?: Vec3;
	/** Made to size, not generated: a plate is then what it was meant to be. */
	finished?: boolean;
}

export function analyze(mesh: Triangles | IndexedMesh, o: AnalyzeOptions = {}): Analysis {
	const tris = mesh instanceof Float32Array ? mesh : unweld(mesh);
	const b = bounds(tris);
	const tolerance = weldTolerance(b.size);
	const welded = weld(tris, tolerance);
	const { positions: p, indices: f } = welded;
	const V = p.length / 3;
	const F = f.length / 3;
	let degenerate = Math.floor(tris.length / 9) - F;
	const eps = Math.max(Math.hypot(...b.size) * 1e-7, 1e-9);
	for (let t = 0; t < F; t++) {
		const [a, c, d] = [f[3 * t] * 3, f[3 * t + 1] * 3, f[3 * t + 2] * 3];
		const u = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
		const v = [p[d] - p[a], p[d + 1] - p[a + 1], p[d + 2] - p[a + 2]];
		const w = [p[d] - p[c], p[d + 1] - p[c + 1], p[d + 2] - p[c + 2]];
		const area2 = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
		const longest = Math.max(Math.hypot(...u), Math.hypot(...v), Math.hypot(...w));
		if (area2 <= eps * longest) degenerate++;
	}

	// Per edge: how many faces use it, and +1/−1 for each use from the lower/higher corner.
	const uses = new Map<number, number>();
	const ways = new Map<number, number>();
	for (let t = 0; t < F; t++)
		for (let k = 0; k < 3; k++) {
			const a = f[3 * t + k];
			const c = f[3 * t + ((k + 1) % 3)];
			const key = a < c ? a * V + c : c * V + a;
			uses.set(key, (uses.get(key) ?? 0) + 1);
			ways.set(key, (ways.get(key) ?? 0) + (a < c ? 1 : -1));
		}
	const vertexSets = unionFind(V);
	const holeSets = unionFind(V);
	let openEdges = 0;
	let nonManifoldEdges = 0;
	let flippedEdges = 0;
	const badCorner = new Uint8Array(V);
	for (const [key, n] of uses) {
		const a = Math.floor(key / V);
		const c = key - a * V;
		if (n === 1) {
			openEdges++;
			holeSets.join(a, c);
			badCorner[a] = badCorner[c] = 1;
		} else if (n > 2) {
			nonManifoldEdges++;
			badCorner[a] = badCorner[c] = 1;
		} else if (ways.get(key) !== 0) flippedEdges++;
	}
	for (let t = 0; t < F; t++) {
		vertexSets.join(f[3 * t], f[3 * t + 1]);
		vertexSets.join(f[3 * t], f[3 * t + 2]);
	}

	// Holes: open-edge corners grouped by the open edges between them.
	const holeAt = new Map<number, { edges: number; sum: Vec3; corners: Set<number> }>();
	for (const [key, n] of uses) {
		if (n !== 1) continue;
		const a = Math.floor(key / V);
		const root = holeSets.find(a);
		let h = holeAt.get(root);
		if (!h) holeAt.set(root, (h = { edges: 0, sum: [0, 0, 0], corners: new Set() }));
		h.edges++;
		for (const v of [a, key - a * V])
			if (!h.corners.has(v)) {
				h.corners.add(v);
				for (let k = 0; k < 3; k++) h.sum[k] += p[3 * v + k];
			}
	}
	const holes: Hole[] = [...holeAt.values()].map((h) => ({
		edges: h.edges,
		center: h.sum.map((s) => s / h.corners.size) as Vec3
	}));

	// Components: faces joined through shared corners.
	const parts = new Map<number, { faces: number; volume6: number; closed: boolean; lo: Vec3; hi: Vec3 }>();
	for (let t = 0; t < F; t++) {
		const root = vertexSets.find(f[3 * t]);
		let part = parts.get(root);
		if (!part)
			parts.set(
				root,
				(part = { faces: 0, volume6: 0, closed: true, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] })
			);
		part.faces++;
		const [a, c, d] = [f[3 * t] * 3, f[3 * t + 1] * 3, f[3 * t + 2] * 3];
		part.volume6 +=
			p[a] * (p[c + 1] * p[d + 2] - p[c + 2] * p[d + 1]) -
			p[a + 1] * (p[c] * p[d + 2] - p[c + 2] * p[d]) +
			p[a + 2] * (p[c] * p[d + 1] - p[c + 1] * p[d]);
		for (const v of [a, c, d])
			for (let k = 0; k < 3; k++) {
				part.lo[k] = Math.min(part.lo[k], p[v + k]);
				part.hi[k] = Math.max(part.hi[k], p[v + k]);
			}
		if (badCorner[f[3 * t]] || badCorner[f[3 * t + 1]] || badCorner[f[3 * t + 2]]) part.closed = false;
	}
	const components: Component[] = [...parts.values()]
		.map((c) => ({
			faces: c.faces,
			volume: c.closed ? c.volume6 / 6 : 0,
			closed: c.closed,
			center: c.lo.map((v, k) => (v + c.hi[k]) / 2) as Vec3,
			size: c.lo.map((v, k) => c.hi[k] - v) as Vec3
		}))
		.sort((x, y) => Math.abs(y.volume) - Math.abs(x.volume) || y.faces - x.faces);
	const insideOut = components.filter((c) => c.closed && c.volume < 0).length;

	const checks: Check[] = [];
	const add = (id: CheckId, status: CheckStatus, detail?: string, basic = true) =>
		checks.push({ id, status, basic, ...(detail ? { detail } : {}) });
	add('triangles', F > 0 ? 'passed' : 'failed', `${F} faces, ${V} vertices`);
	add(
		'open-edges',
		openEdges ? 'failed' : 'passed',
		openEdges ? `${openEdges} open edges in ${holes.length} holes` : undefined
	);
	add('non-manifold-edges', nonManifoldEdges ? 'failed' : 'passed', nonManifoldEdges ? `${nonManifoldEdges} edges of 3+ faces` : undefined);
	add(
		'orientation',
		flippedEdges || insideOut ? 'failed' : 'passed',
		flippedEdges || insideOut ? `${flippedEdges} edges between flipped faces, ${insideOut} parts inside out` : undefined
	);
	add('degenerate-faces', degenerate ? 'warning' : 'passed', degenerate ? `${degenerate} faces without area` : undefined);
	add(
		'components',
		components.length > 1 ? 'warning' : 'passed',
		`${components.length} separate parts`
	);
	if (o.wasm) {
		const solid = F ? manifoldOf(o.wasm, welded) : null;
		add('closed-solid', solid ? 'passed' : 'failed', solid ? undefined : 'manifold-3d does not accept it as a closed solid');
		solid?.delete();
	} else add('closed-solid', 'not-checked', 'needs the manifold-3d module');
	const flatShare = largestPlane(p, f, b.size, b.min);
	add(
		'flat-plate',
		flatShare >= FLAT_PLATE && !o.finished ? 'warning' : 'passed',
		`${Math.round(flatShare * 100)}% of the surface lies in one plane`
	);
	if (o.buildVolume) {
		const [x, y, z] = b.size;
		const [bx, by, bz] = o.buildVolume;
		const fits = z <= bz && ((x <= bx && y <= by) || (x <= by && y <= bx));
		add('build-volume', fits ? 'passed' : 'failed', `${b.size.map(mm).join(' × ')} mm in ${o.buildVolume.join(' × ')} mm`);
	} else add('build-volume', 'not-checked', 'no printer given', false);
	add('self-intersections', 'not-checked', 'no algorithm in this version', false);
	add('wall-thickness', 'not-checked', 'no algorithm in this version', false);

	const basic = checks.filter((c) => c.basic);
	const status: ReportStatus = basic.some((c) => c.status === 'failed')
		? 'has-errors'
		: basic.some((c) => c.status !== 'passed')
			? 'needs-check'
			: 'basic-passed';
	return {
		unit: 'mm',
		size: b.size,
		min: b.min,
		max: b.max,
		vertices: V,
		faces: F,
		weldTolerance: tolerance,
		components,
		openEdges,
		holes,
		nonManifoldEdges,
		flippedEdges,
		degenerateFaces: degenerate,
		flatShare,
		checks,
		status
	};
}

/** From this share of the surface in one plane a model is taken for a plate: tune on real generated models. */
export const FLAT_PLATE = 0.3;

/**
 * How much of the surface lies in one axis-aligned plane: a generator's failed
 * run is a flat plate, or a floor and a wall around the object, and no other
 * check sees it, since a plate is a fine closed solid. The plane is two slabs
 * of a 32nd of the model thick, so both sides of a thin plate count.
 */
function largestPlane(p: Float32Array, f: Uint32Array, size: Vec3, min: Vec3): number {
	const slab = Math.max(...size) / 32;
	const perAxis = 34;
	const slabs = new Float64Array(3 * perAxis);
	let total = 0;
	for (let t = 0; t < f.length; t += 3) {
		const [a, c, d] = [f[t] * 3, f[t + 1] * 3, f[t + 2] * 3];
		const u = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
		const v = [p[d] - p[a], p[d + 1] - p[a + 1], p[d + 2] - p[a + 2]];
		const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map(Math.abs);
		const area = Math.hypot(...normal);
		total += area;
		const axis = normal.indexOf(Math.max(...normal));
		if (normal[axis] >= 0.95 * area) slabs[axis * perAxis + Math.floor((p[a + axis] - min[axis]) / slab)] += area;
	}
	let most = 0;
	for (let i = 0; i + 1 < slabs.length; i++) most = Math.max(most, slabs[i] + slabs[i + 1]);
	return total ? most / total : 0;
}

/** mm with at most 3 decimals. */
export const mm = (v: number) => String(Math.round(v * 1000) / 1000);

function unionFind(n: number) {
	const parent = new Int32Array(n);
	for (let i = 0; i < n; i++) parent[i] = i;
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	};
	return { find, join: (a: number, b: number) => void (parent[find(a)] = find(b)) };
}
