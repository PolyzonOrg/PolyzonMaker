/**
 * A CAD program the assistant writes: JavaScript over replicad (OpenCascade
 * B-rep) and Manifold meshes — loops, functions, math and parts, for models
 * a feature list cannot hold (an engine, a car, a helicopter). It runs only
 * in its own worker (cad.worker.ts), compiled first and then cut off from
 * the network, storage and code-from-strings (lockdown), and the server
 * refuses sources that try to reach around that (CAD_CODE_BANNED).
 *
 * The program is the body of an async function. It returns the part: a
 * shape, a list of shapes, or named parts — [{ name, shape, color }] or
 * { name: shape }. Inputs (the user's STL models) arrive as named meshes.
 */
import type * as Replicad from 'replicad';
import type { ManifoldToplevel } from 'manifold-3d';
import { HINTS, splineTo, sweepAlong } from './build';
const CAD_CODE_BANNED = /\bimport\b/;
import { meshSdf, sdfApi, type Sdf } from './sculpt';
import { loftBody, type Station } from './body';
import { track, wheel, wheelsOn } from './parts';

type R = typeof Replicad;
type Shape3D = Replicad.Shape3D;
type MeshShape = Replicad.MeshShape;
export type AnyPart = Shape3D | MeshShape;
type V3 = [number, number, number];

interface ManifoldLike {
	scale(v: V3): never;
	splitByPlane(normal: V3, offset: number): [never, never];
	trimByPlane(normal: V3, offset: number): never;
}

export interface CadPart {
	name: string;
	shape: AnyPart;
	color?: string;
}

export interface ProgramContext {
	/** The user's models by input name, as meshes. */
	meshes?: Record<string, MeshShape>;
	/** Filled while the program runs: what the guarded operations measured (a cut that cut nothing). */
	warnings?: string[];
	/** The Manifold kernel, for sculpted shapes (sdf.mesh). */
	manifold?: ManifoldToplevel;
	/** Adds the names of src/cad/lang.ts to what a program sees. */
	lang?: (api: CadApi) => CadApi;
	/** What the program returned, as parts. */
	finish?: (result: unknown) => unknown;
}

export class CadProgramError extends Error {
	constructor(
		message: string,
		/** 1-based line of the program, when known. */
		public readonly line: number | null
	) {
		super(line ? `line ${line}: ${message}${shownLine(line)}` : message);
	}
}

/** Lines the compiled wrapper adds before the program's first line. */
const WRAPPER_LINES = 3;
/** The compiled program's name in stack traces: its frames, never the kernels' own. */
const PROGRAM_URL = 'cad-program.js';
/** The running program's lines, for the line an error names. */
let source: string[] = [];

/**
 * The program's line under its number, as a compiler shows it: on prod the
 * model counted lines wrong and fixed another fillet than the one named.
 */
function shownLine(line: number): string {
	const text = source[line - 1]?.trim();
	return text ? `\n  ${line} | ${text.length > 90 ? `${text.slice(0, 90)}…` : text}` : '';
}
/**
 * Names a program must not reach — the global object, code from strings, the
 * network, timers that take strings. They are parameters of the wrapper
 * bound to undefined, so the program sees nothing under them while the
 * libraries (OpenCascade's bindings make functions at run time) keep theirs.
 */
export const SHADOWED = [
	'Function',
	'eval',
	'globalThis',
	'self',
	'window',
	'global',
	'fetch',
	'XMLHttpRequest',
	'WebSocket',
	'EventSource',
	'importScripts',
	'postMessage',
	'close',
	'setTimeout',
	'setInterval',
	'Worker',
	'navigator',
	'location',
	'indexedDB',
	'caches',
	'Reflect',
	'Proxy'
];

/**
 * The program's line in an error's stack. The program is compiled under its
 * own name (PROGRAM_URL): OpenCascade's bindings are compiled from strings
 * too, and their frames, all «<anonymous>», came first and named a wrong line.
 */
function programLine(err: unknown): number | null {
	const stack = err instanceof Error ? (err.stack ?? '') : '';
	for (const m of stack.matchAll(
		new RegExp(`${PROGRAM_URL.replace('.', '\\.')}:(\\d+):\\d+`, 'g')
	)) {
		const line = Number(m[1]) - WRAPPER_LINES;
		if (line >= 1) return line;
	}
	return null;
}

/** Operations OpenCascade fails with an opaque exception: rethrown as errors that say why. */
const GUARDED: Record<string, string> = {
	fillet: HINTS.fillet!,
	chamfer: HINTS.chamfer!,
	shell: HINTS.shell!,
	fuse: HINTS.union!,
	cut: HINTS.cut!,
	intersect: HINTS.intersect!,
	extrude: HINTS.extrude!,
	revolve: HINTS.revolve!,
	loftWith: HINTS.loft!,
	sweepSketch: HINTS.sweep!
};
let guarded = false;

/** The running program's warnings (ProgramContext.warnings), while it runs. */
let sink: string[] | null = null;
/** Cuts of one program whose volume is checked: each check costs two volume integrals. */
const CUTS_CHECKED = 40;
let cutsChecked = 0;
/** How long a failed fillet may spend finding the radius that works. */
const FILLET_SEARCH_MS = 6000;
/** …and all failed fillets of one program together: past it they only say the radius did not fit. */
const FILLET_SEARCH_TOTAL_MS = 15_000;
let searchLeft = 0;

function warn(text: string): void {
	if (sink && sink.length < 6 && !sink.includes(text)) sink.push(text);
}

/** A warning about the program line that called a guarded operation, the line shown under it. */
function warnHere(text: string): void {
	const line = programLine(new Error());
	warn(line ? `line ${line}: ${text}${shownLine(line)}` : text);
}

/**
 * Whether a shape is sound B-rep (BRepCheck): a fillet too big for a thin
 * plate «succeeds» and returns a broken solid with the wrong volume.
 */
let sound: (shape: unknown) => boolean = () => true;

/** A fillet or chamfer that must also leave a sound solid; a broken one fails as OpenCascade fails. */
function rounded(run: (...a: unknown[]) => unknown, self: unknown, args: unknown[]): unknown {
	const result = run.apply(self, args);
	// A bare number is how OpenCascade's own failures arrive (see the guard below).
	if (!sound(result)) throw new Error('0');
	return result;
}

/** Edges that bound one face only — a cylinder's seam, a sphere's pole: no fillet rounds them. */
function seamsOf(shape: Shape3D): Replicad.Edge[] {
	const byHash = new Map<number, Array<{ edge: Replicad.Edge; faces: number }>>();
	for (const face of shape.faces) {
		for (const edge of face.edges) {
			const bucket = byHash.get(edge.hashCode) ?? [];
			const known = bucket.find((c) => c.edge.isSame(edge));
			if (known) known.faces++;
			else byHash.set(edge.hashCode, [...bucket, { edge, faces: 1 }]);
		}
	}
	return [...byHash.values()].flat().flatMap((c) => (c.faces === 1 ? [c.edge] : []));
}

/**
 * A fillet or chamfer OpenCascade cannot do: the part goes on with those
 * edges sharp and a warning says why and what fits — on prod one fillet of a
 * neck sank the whole Wall-E. A seam among the edges is left out first.
 */
function keptSharp(
	r: R,
	method: 'fillet' | 'chamfer',
	run: (...a: unknown[]) => unknown,
	self: unknown,
	args: unknown[]
): unknown {
	const shape = self as Shape3D;
	const [radius, filter] = args;
	let tried = args;
	if (typeof radius === 'number' && (filter === undefined || typeof filter === 'function')) {
		const pick = filter as
			| ((f: Replicad.EdgeFinder, s: Shape3D) => Replicad.EdgeFinder)
			| undefined;
		const selected = pick ? pick(new r.EdgeFinder(), shape).find(shape) : shape.edges;
		const seams = seamsOf(shape);
		const real = selected.filter((e) => !seams.some((s) => s.isSame(e)));
		if (real.length === 0) {
			warnHere(
				`${method}: the selected edges are only the seam of a round face (inDirection on a cylinder finds its seam line), so nothing was rounded — select its rims instead: (e) => e.inPlane('XY', [0, 0, z])`
			);
			return shape;
		}
		if (real.length < selected.length) {
			tried = [radius, (e: Replicad.EdgeFinder) => e.inList(real)];
			try {
				return rounded(run, self, tried);
			} catch {
				/* not the seam after all: said below */
			}
		}
	}
	if (method === 'chamfer') {
		warnHere(`chamfer failed, edges kept sharp: ${HINTS.chamfer}`);
		return shape;
	}
	const searched = typeof radius === 'number' && radius > 0 && searchLeft > 0;
	const works = searched ? workingFillet(run, self, tried) : null;
	warnHere(`fillet failed, edges kept sharp: ${filletFailure(radius, works)}`);
	return shape;
}

/**
 * After a failed fillet, the largest radius that does work on the same edges
 * (bisection, a few tries within FILLET_SEARCH_MS), so the fix is a number.
 */
function workingFillet(
	original: (...a: unknown[]) => unknown,
	self: unknown,
	args: unknown[]
): number | null {
	const asked = args[0] as number;
	const started = Date.now();
	const until = started + Math.min(FILLET_SEARCH_MS, searchLeft);
	let works = 0;
	let fails = asked;
	let tries = 0;
	for (; tries < 6 && Date.now() < until; tries++) {
		const mid = (works + fails) / 2;
		try {
			rounded(original, self, [mid, ...args.slice(1)]);
			works = mid;
		} catch {
			fails = mid;
		}
	}
	searchLeft -= Date.now() - started;
	// Out of time before any radius worked: whether a smaller one would is not known.
	if (works === 0 && tries < 6) return null;
	return Math.floor(works * 10) / 10;
}

/** Why a fillet of `asked` mm failed, from what the radius search found (null: no time to search). */
function filletFailure(asked: unknown, works: number | null): string {
	if (works === null) {
		return `radius ${String(asked)} is too big for these edges and there was no time to find one that fits — try a smaller one`;
	}
	if (works > 0) {
		return `radius ${String(asked)} is too big for these edges; the largest that works here is about ${works} mm — use it or less, or fillet fewer edges`;
	}
	return 'no radius works on these edges (they may meet tangent or along a seam) — choose other edges or round the 2D profile instead';
}

interface ManifoldMesh {
	translate(v: V3): ManifoldMesh;
	scale(k: number): ManifoldMesh;
	mirror(normal: V3): ManifoldMesh;
	transform(m: number[]): ManifoldMesh;
}

/** The normal of a mirror plane as replicad names it: 'YZ' mirrors X, and so on, or the normal itself. */
const MIRROR_NORMALS: Record<string, V3> = { YZ: [1, 0, 0], XZ: [0, 1, 0], XY: [0, 0, 1] };

/**
 * replicad 1.1 moves a mesh through an OpenCascade transformation that comes
 * out wrong for a mesh: scale(2) halves it and ignores the centre, rotate(90)
 * skews it. A remix («make it twice as big», «turn it over») broke the
 * user's model. Both are done on the Manifold mesh directly here.
 */
function fixMeshTransforms(r: R): void {
	const proto = r.MeshShape.prototype as unknown as Record<string, unknown>;
	const original = proto.rotate as (...a: unknown[]) => unknown;
	const of = (m: unknown) => (m as { wrapped: ManifoldMesh }).wrapped;
	const make = (m: ManifoldMesh) => new r.MeshShape(m as never);
	proto.scale = function (this: unknown, k: number, center: V3 = [0, 0, 0]) {
		const [cx, cy, cz] = center;
		return make(of(this).translate([-cx, -cy, -cz]).scale(k).translate([cx, cy, cz]));
	};
	// Its mirror read freed memory: a 10 × 2 × 2 box came back 1.4 mm tall.
	proto.mirror = function (this: unknown, plane: string | V3 = 'YZ', origin: V3 = [0, 0, 0]) {
		const normal = typeof plane === 'string' ? MIRROR_NORMALS[plane] : plane;
		if (!normal)
			throw new Error(
				`mirror('YZ' | 'XZ' | 'XY' | [normal], [origin]): got ${JSON.stringify(plane)}`
			);
		const [ox, oy, oz] = origin;
		return make(of(this).translate([-ox, -oy, -oz]).mirror(normal).translate([ox, oy, oz]));
	};
	proto.rotate = function (
		this: unknown,
		deg: unknown,
		position: V3 = [0, 0, 0],
		direction: V3 = [0, 0, 1]
	) {
		if (typeof deg !== 'number') return original.call(this, deg, position, direction);
		const len = Math.hypot(...direction) || 1;
		const [x, y, z] = direction.map((v) => v / len);
		const t = (deg * Math.PI) / 180;
		const c = Math.cos(t);
		const s = Math.sin(t);
		const k = 1 - c;
		// Rodrigues; rows of R.
		const R = [
			[c + x * x * k, x * y * k - z * s, x * z * k + y * s],
			[y * x * k + z * s, c + y * y * k, y * z * k - x * s],
			[z * x * k - y * s, z * y * k + x * s, c + z * z * k]
		];
		const [px, py, pz] = position;
		// Turned about the axis through `position`: p' = R (p − position) + position.
		const tr = [0, 1, 2].map((i) => position[i] - (R[i][0] * px + R[i][1] * py + R[i][2] * pz));
		// Manifold takes the matrix column by column.
		return make(
			of(this).transform([
				R[0][0],
				R[1][0],
				R[2][0],
				0,
				R[0][1],
				R[1][1],
				R[2][1],
				0,
				R[0][2],
				R[1][2],
				R[2][2],
				0,
				tr[0],
				tr[1],
				tr[2],
				1
			])
		);
	};
}

/** How finely a solid becomes a mesh: smooth for print, light for the viewer. */
const MESH_TOLERANCE = { tolerance: 0.03, angularTolerance: 0.12 };

/**
 * Solids and meshes in one boolean — a body (a mesh) cut by a box, a solid
 * joined to a sculpted figure: the solid is meshed first, the result is a
 * mesh. Without it a mixed cut failed deep in a kernel.
 */
function mixKernels(r: R): void {
	type Op = (this: unknown, ...a: unknown[]) => unknown;
	const isMesh = (s: unknown) => s instanceof r.MeshShape;
	const meshed = (s: unknown) => (isMesh(s) ? s : (s as Shape3D).meshShape(MESH_TOLERANCE));
	const mesh = r.MeshShape.prototype as unknown as Record<string, Op>;
	const solid = Object.getPrototypeOf(r.Solid.prototype) as Record<string, Op>;
	for (const op of ['fuse', 'cut', 'intersect']) {
		const ofMesh = mesh[op];
		mesh[op] = function (other, ...rest) {
			return ofMesh.call(this, meshed(other), ...rest);
		};
		const ofSolid = solid[op];
		solid[op] = function (other, ...rest) {
			return isMesh(other) ? ofMesh.call(meshed(this), other) : ofSolid.call(this, other, ...rest);
		};
	}
}

/** A solid's own fillet, before the guard wraps it (soften tries radii without the guard's search). */
let rawFillet: ((...a: unknown[]) => unknown) | null = null;

/**
 * Round every edge of a part by `radius`, or by the largest radius that
 * fits; said in the warnings when it had to be smaller or could not be done.
 * One call takes a part from «assembled of boxes» to «made».
 */
function soften(shape: Shape3D, radius: number): Shape3D {
	// A mesh (body, sdf.mesh, hull) is as smooth as it was made: nothing to do, and
	// nothing to say — in the exam a warning per build only drew the model off its work.
	if (typeof (shape as { fillet?: unknown }).fillet !== 'function') return shape;
	if (!rawFillet) return shape.fillet(radius);
	// The sharp edges are where a flat face meets another (caps, box edges); the
	// seam of a smooth loft or revolve cannot be rounded and only fails the fillet.
	const sharp = shape.faces.filter((f) => f.geomType === 'PLANE').flatMap((f) => f.edges);
	const args = (r: number): unknown[] =>
		sharp.length ? [r, (e: Replicad.EdgeFinder) => e.inList(sharp)] : [r];
	try {
		return rounded(rawFillet, shape, args(radius)) as Shape3D;
	} catch {
		/* searched below */
	}
	const works = workingFillet(rawFillet, shape, args(radius));
	if (works === null) {
		warnHere(
			`soften: ${radius} mm did not fit every edge and there was no time to find a smaller radius, so it stays sharp — try a smaller one.`
		);
		return shape;
	}
	if (works > 0) {
		warnHere(`soften: ${radius} mm did not fit every edge; rounded by ${works} mm.`);
		return rounded(rawFillet, shape, args(works)) as Shape3D;
	}
	warnHere(
		'soften: no radius fits every edge of this part, so it stays sharp — soften the bodies before joining them, or round the 2D profiles.'
	);
	return shape;
}

/**
 * Make OpenCascade failures readable and locatable (a JS Error carries the
 * program's line); a failed fillet says which radius would work, and a cut
 * that removed nothing is reported as a warning.
 */
function guardOperations(r: R): void {
	if (guarded) return;
	guarded = true;
	const oc = r.getOC() as unknown as {
		BRepCheck_Analyzer: new (
			shape: unknown,
			geometry: boolean,
			parallel: boolean,
			exact: boolean
		) => { IsValid(): boolean; delete(): void };
	};
	sound = (shape) => {
		const wrapped = (shape as { wrapped?: unknown } | null)?.wrapped;
		if (!wrapped) return true;
		const check = new oc.BRepCheck_Analyzer(wrapped, true, false, false);
		try {
			return check.IsValid();
		} finally {
			check.delete();
		}
	};
	fixMeshTransforms(r);
	mixKernels(r);
	// replicad frees the input of a transform, a loft or an extrusion (mirror,
	// translate, loftWith…): on prod a wing used again after its mirror failed
	// with «This object has been deleted». Inside a worker nothing is freed; the
	// memory goes with the worker after its one build (client.ts).
	// ponytail: a program looping thousands of booleans keeps them all; free per part if that bites.
	(Object.getPrototypeOf(r.Shape.prototype) as { delete: () => void }).delete = () => undefined;
	const owners = [
		Object.getPrototypeOf(r.Solid.prototype) as Record<string, unknown>,
		r.Sketch.prototype as unknown as Record<string, unknown>
	];
	const volume = (s: unknown) => {
		try {
			return Math.abs(r.measureVolume(s as Shape3D));
		} catch {
			return NaN;
		}
	};
	for (const proto of owners) {
		for (const [method, hint] of Object.entries(GUARDED)) {
			const original = proto[method];
			if (typeof original !== 'function') continue;
			const run = original as (...a: unknown[]) => unknown;
			if (method === 'fillet' && proto === owners[0]) rawFillet = run;
			proto[method] = function (this: unknown, ...args: unknown[]) {
				let result: unknown;
				try {
					result =
						method === 'fillet' || method === 'chamfer'
							? rounded(run, this, args)
							: run.apply(this, args);
				} catch (e) {
					if (e instanceof Error && /no edge was selected/i.test(e.message)) {
						warnHere(
							`${method}: the selector matched no edges, nothing was rounded. After a cut or union with curved faces, round edges are often BSPLINE_CURVE rather than CIRCLE — select by position (inBox, withinDistance, inPlane) instead of curve type.`
						);
						return this;
					}
					if (e instanceof Error && !/^\d+$/.test(e.message)) throw e;
					if (method === 'fillet' || method === 'chamfer') {
						return keptSharp(r, method, run, this, args);
					}
					throw new Error(`${method} failed: ${hint}`);
				}
				if (method === 'cut' && sink && cutsChecked < CUTS_CHECKED) {
					cutsChecked++;
					const before = volume(this);
					const after = volume(result);
					if (before > 0 && Math.abs(before - after) <= before * 1e-6) {
						warnHere(
							'cut removed nothing: the cutting body does not overlap this one — check its position and size.'
						);
					}
				}
				return result;
			};
		}
	}
}

export interface RayHit {
	point: V3;
	/** The surface normal there (outward on a closed part). */
	normal: V3;
	distance: number;
}

/** The nearest triangle a ray meets (Möller–Trumbore); null when it misses. */
export function rayHit(
	vertices: number[],
	triangles: number[],
	origin: V3,
	direction: V3
): RayHit | null {
	const len = Math.hypot(...direction) || 1;
	const d: V3 = [direction[0] / len, direction[1] / len, direction[2] / len];
	let best: RayHit | null = null;
	for (let t = 0; t < triangles.length; t += 3) {
		const a = triangles[t] * 3;
		const b = triangles[t + 1] * 3;
		const c = triangles[t + 2] * 3;
		const e1: V3 = [
			vertices[b] - vertices[a],
			vertices[b + 1] - vertices[a + 1],
			vertices[b + 2] - vertices[a + 2]
		];
		const e2: V3 = [
			vertices[c] - vertices[a],
			vertices[c + 1] - vertices[a + 1],
			vertices[c + 2] - vertices[a + 2]
		];
		const p: V3 = [
			d[1] * e2[2] - d[2] * e2[1],
			d[2] * e2[0] - d[0] * e2[2],
			d[0] * e2[1] - d[1] * e2[0]
		];
		const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
		if (Math.abs(det) < 1e-12) continue;
		const inv = 1 / det;
		const s: V3 = [
			origin[0] - vertices[a],
			origin[1] - vertices[a + 1],
			origin[2] - vertices[a + 2]
		];
		const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
		if (u < 0 || u > 1) continue;
		const q: V3 = [
			s[1] * e1[2] - s[2] * e1[1],
			s[2] * e1[0] - s[0] * e1[2],
			s[0] * e1[1] - s[1] * e1[0]
		];
		const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
		if (v < 0 || u + v > 1) continue;
		const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
		if (dist < 1e-9 || (best && dist >= best.distance)) continue;
		const n: V3 = [
			e1[1] * e2[2] - e1[2] * e2[1],
			e1[2] * e2[0] - e1[0] * e2[2],
			e1[0] * e2[1] - e1[1] * e2[0]
		];
		const nl = Math.hypot(...n) || 1;
		best = {
			point: [origin[0] + d[0] * dist, origin[1] + d[1] * dist, origin[2] + d[2] * dist],
			normal: [n[0] / nl, n[1] / nl, n[2] / nl],
			distance: dist
		};
	}
	return best;
}

/** Everything a program can name. */
export function cadApi(r: R, ctx: ProgramContext = {}) {
	const isMesh = (s: unknown): s is MeshShape => s instanceof r.MeshShape;
	const toMesh = (s: AnyPart): MeshShape => (isMesh(s) ? s : s.meshShape(MESH_TOLERANCE));
	// The Manifold object a MeshShape wraps: per-axis scale and plane cuts live there.
	const manifoldOf = (m: MeshShape) => (m as unknown as { wrapped: ManifoldLike }).wrapped;
	const bbox = (s: AnyPart) => {
		const [min, max] = s.boundingBox.bounds as [V3, V3];
		const size: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
		const center: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
		return { min, max, size, center };
	};
	const union = (shapes: AnyPart[]): AnyPart => {
		if (shapes.length === 0) throw new Error('union of nothing');
		if (shapes.some(isMesh)) {
			const meshes = shapes.map(toMesh);
			return meshes.slice(1).reduce((a, b) => a.fuse(b), meshes[0]);
		}
		const solids = shapes as Shape3D[];
		return solids.slice(1).reduce((a, b) => a.fuse(b), solids[0]);
	};
	return {
		// 2D drawing → sketch → solid
		draw: r.draw,
		drawRoundedRectangle: r.drawRoundedRectangle,
		drawRectangle: r.drawRectangle,
		drawCircle: r.drawCircle,
		drawEllipse: r.drawEllipse,
		drawPolysides: r.drawPolysides,
		drawPointsInterpolation: r.drawPointsInterpolation,
		drawParametricFunction: r.drawParametricFunction,
		drawText: r.drawText,
		sketchCircle: r.sketchCircle,
		sketchRectangle: r.sketchRectangle,
		sketchRoundedRectangle: r.sketchRoundedRectangle,
		sketchEllipse: r.sketchEllipse,
		sketchPolysides: r.sketchPolysides,
		sketchHelix: r.sketchHelix,
		sketchText: r.sketchText,
		/** Append one smooth B-spline through `points` to a pen (draw(…)). */
		spline: (pen: Replicad.DrawingPen, points: [number, number][]) => {
			splineTo(r, pen, points);
			return pen;
		},
		/** A 2D drawing swept along a 3D path (smooth through the points by default). */
		sweep: (profile: Replicad.Drawing, path: V3[], smooth = true) =>
			sweepAlong(r, profile, path, smooth),
		// solids
		makeBox: r.makeBox,
		makeBaseBox: r.makeBaseBox,
		makeCylinder: r.makeCylinder,
		makeSphere: r.makeSphere,
		makeEllipsoid: r.makeEllipsoid,
		makeOffset: r.makeOffset,
		makeHelix: r.makeHelix,
		makeLine: r.makeLine,
		makeThreePointArc: r.makeThreePointArc,
		makeBSplineApproximation: r.makeBSplineApproximation,
		assembleWire: r.assembleWire,
		loft: r.loft,
		Sketch: r.Sketch,
		EdgeFinder: r.EdgeFinder,
		FaceFinder: r.FaceFinder,
		measureVolume: r.measureVolume,
		measureArea: r.measureArea,
		// helpers
		union,
		/** Linear copies fused: count copies `step` apart. */
		pattern: (shape: AnyPart, count: number, step: V3): AnyPart =>
			union(
				Array.from({ length: count }, (_, i) =>
					i === 0 ? shape : shape.clone().translate(step[0] * i, step[1] * i, step[2] * i)
				)
			),
		/**
		 * The convex hull of shapes, as a mesh: two wheels wrapped into a track, a
		 * blob around points. hull(a, b, …) or hull([a, b, …]).
		 */
		hull: (...shapes: Array<AnyPart | AnyPart[]>): MeshShape => {
			const list = shapes.flat();
			if (!ctx.manifold) throw new Error('hull is not available here');
			if (list.length === 0 || !list.every((s) => isMesh(s) || (s && 'fuse' in s))) {
				throw new Error('hull(a, b, …) takes shapes');
			}
			const meshes = list.map((s) => manifoldOf(toMesh(s)));
			return new r.MeshShape(ctx.manifold.Manifold.hull(meshes as never));
		},
		/** Copies turned around an axis through `center`, spread over `angle` degrees. */
		circular: (
			shape: AnyPart,
			count: number,
			axis: V3 = [0, 0, 1],
			center: V3 = [0, 0, 0],
			angle = 360
		): AnyPart => {
			const each = angle >= 360 ? angle / count : angle / Math.max(count - 1, 1);
			return union(
				Array.from({ length: count }, (_, i) =>
					i === 0 ? shape : shape.clone().rotate(each * i, center, axis)
				)
			);
		},
		bbox,
		/**
		 * Scaled as a whole so its size along one axis is exact ({ z: 80 } — the
		 * first one given), then stood on Z=0: a sculpted figure's size follows
		 * its blends, and chasing it by hand goes round in circles.
		 */
		fit: (s: AnyPart, size: { x?: number; y?: number; z?: number }): AnyPart => {
			const axis = (['x', 'y', 'z'] as const).find((k) => typeof size[k] === 'number');
			if (!axis || !(size[axis]! > 0))
				throw new Error('fit(part, { z: height }) needs a size above 0');
			const i = { x: 0, y: 1, z: 2 }[axis];
			const now = bbox(s).size[i];
			if (!(now > 0)) throw new Error('fit: the part has no size along ' + axis);
			const scaled = s.scale(size[axis]! / now, bbox(s).center);
			return scaled.translate(0, 0, -bbox(scaled).min[2]);
		},
		/** Text as a solid standing on Z=0, height = cap height `size` mm, `depth` thick. */
		text3d: (text: string, size = 10, depth = 2) =>
			r.sketchText(text, { fontSize: size }).extrude(depth) as Shape3D,
		/** The user's model by input name, as a mesh. */
		mesh: (name: string): MeshShape => {
			const m = ctx.meshes?.[name];
			if (!m) {
				const known = Object.keys(ctx.meshes ?? {});
				throw new Error(
					`no input named ${name}${known.length ? `; inputs: ${known.join(', ')}` : ' — no models were attached'}`
				);
			}
			return m.clone();
		},
		toMesh,
		/** Cast a ray at a part: where it meets the surface first (and the normal there), or null. */
		hit: (s: AnyPart, origin: V3, direction: V3): RayHit | null => {
			const m = toMesh(s).mesh();
			return rayHit(m.vertices, m.triangles, origin, direction);
		},
		/** Scale per axis (stretch or squash); a solid becomes a mesh. */
		stretch: (s: AnyPart, factors: V3): MeshShape =>
			new r.MeshShape(manifoldOf(toMesh(s)).scale(factors)),
		/** Cut by a plane: [the side the normal points away from, the side it points to]. */
		split: (s: AnyPart, normal: V3, offset = 0): [MeshShape, MeshShape] => {
			const [below, above] = manifoldOf(toMesh(s)).splitByPlane(normal, offset);
			return [new r.MeshShape(below), new r.MeshShape(above)];
		},
		/** Keep only the part on the side the normal points to. */
		trim: (s: AnyPart, normal: V3, offset = 0): MeshShape =>
			new r.MeshShape(manifoldOf(toMesh(s)).trimByPlane(normal, offset)),
		/** Sculpting (sculpt.ts): distance-field shapes blended like clay, meshed for print. */
		sdf: {
			...sdfApi,
			/** The sculpted shape as a closed mesh part; `detail` — cell size in mm. */
			mesh: (shape: Sdf, detail?: number): MeshShape => {
				if (!ctx.manifold) throw new Error('sculpting is not available here');
				return new r.MeshShape(meshSdf(ctx.manifold, shape, detail));
			}
		},
		/** A smooth body lofted through superellipse stations along an axis (body.ts). */
		body: (stations: Station[], opts?: { axis?: 'x' | 'y' | 'z' }) =>
			loftBody(r, ctx.manifold, stations, opts),
		/** A caterpillar track wrapping wheels [y, z, r] seen from the side, `width` across X at `x` (parts.ts). */
		track: (opts: Parameters<typeof track>[2]) => track(r, ctx.manifold, opts),
		/** A wheel on its axle: a rounded tyre, a dished rim and a hub (parts.ts). */
		wheel: (opts: Parameters<typeof wheel>[1]) => wheel(r, opts),
		/** A car's wheels on its body: arches cut through the sides, a wheel pair per axle (parts.ts). */
		wheelsOn: (body: Shape3D, opts: Parameters<typeof wheelsOn>[2]) =>
			wheelsOn(r, body, opts, warnHere),
		/** Every edge rounded by `radius` or by the largest radius that fits. */
		soften: (shape: Shape3D, radius: number) => soften(shape, radius),
		Math,
		console: { log: () => undefined }
	};
}

export type CadApi = ReturnType<typeof cadApi>;

/** Compile the program against the API; compiling happens before lockdown. */
export function compileProgram(code: string, api: CadApi): () => Promise<unknown> {
	const names = [...Object.keys(api), ...SHADOWED];
	let fn: (...args: unknown[]) => Promise<unknown>;
	try {
		// The wrapper stays sloppy (a parameter may not be called eval in strict
		// code); the program inside is strict. With the two lines new Function
		// adds, the program starts on line WRAPPER_LINES + 1.
		// eslint-disable-next-line @typescript-eslint/no-implied-eval -- compiling the program is the point; lockdown and SHADOWED bound it
		fn = new Function(
			...names,
			`return (async () => { "use strict";\n${code}\n})();\n//# sourceURL=${PROGRAM_URL}`
		) as typeof fn;
	} catch (e) {
		throw new CadProgramError(e instanceof Error ? e.message : String(e), null);
	}
	const values = [...Object.values(api), ...SHADOWED.map(() => undefined)];
	// A sloppy wrapper's `this` would be the global object: give it nothing.
	const self = Object.freeze({});
	return () => fn.apply(self, values);
}

/** The program's result as named parts. */
export function partsOf(r: R, result: unknown): CadPart[] {
	const isShape = (v: unknown): v is AnyPart =>
		v instanceof r.MeshShape ||
		(typeof v === 'object' && v !== null && 'fuse' in v && 'boundingBox' in v);
	// A name goes into the report as JSON: bounded, without control characters
	// (each would grow sixfold in the report, SCAD_REPORT_MAX_CHARS).
	const clean = (name: unknown, fallback: string) => {
		// eslint-disable-next-line no-control-regex -- matching control characters is the point
		const text = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
		return (text || fallback).slice(0, 60);
	};
	const named = (v: unknown, fallback: string): CadPart => {
		if (isShape(v)) return { name: clean(fallback, 'part'), shape: v };
		if (v && typeof v === 'object' && 'shape' in v && isShape((v as CadPart).shape)) {
			const p = v as Partial<CadPart>;
			return {
				...p,
				name: clean(p.name, clean(fallback, 'part')),
				shape: p.shape!,
				color: typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : undefined
			};
		}
		throw new Error(
			'return a shape, a list of shapes, [{ name, shape, color }] or { name: shape }'
		);
	};
	let parts: CadPart[];
	if (Array.isArray(result)) parts = result.map((v, i) => named(v, `part ${i + 1}`));
	else if (isShape(result) || (result && typeof result === 'object' && 'shape' in result))
		parts = [named(result, 'part')];
	else if (result && typeof result === 'object')
		parts = Object.entries(result).map(([k, v]) => named(v, k));
	else if (result === undefined)
		throw new Error('the program returned nothing: end it with return <shape>');
	else parts = [named(result, 'part')];
	if (parts.length === 0) throw new Error('the program returned no parts');
	if (parts.length > 4000) throw new Error('at most 4000 bodies');
	return parts;
}

/**
 * Run a program to its parts. `beforeRun` is where the worker locks itself
 * down — after compiling (which needs Function), before the program runs.
 */
export async function runCadProgram(
	r: R,
	code: string,
	ctx: ProgramContext = {},
	beforeRun?: () => void
): Promise<CadPart[]> {
	if (CAD_CODE_BANNED.test(code)) throw new CadProgramError('import is not available', null);
	guardOperations(r);
	const run = compileProgram(code, ctx.lang ? ctx.lang(cadApi(r, ctx)) : cadApi(r, ctx));
	beforeRun?.();
	let result: unknown;
	source = code.split('\n');
	sink = ctx.warnings ?? null;
	cutsChecked = 0;
	searchLeft = FILLET_SEARCH_TOTAL_MS;
	try {
		result = await settleParts(await run(), ctx.warnings);
	} catch (e) {
		if (e instanceof CadProgramError) throw e;
		throw new CadProgramError(failureText(e), programLine(e));
	} finally {
		sink = null;
	}
	try {
		return partsOf(r, ctx.finish ? ctx.finish(result) : result);
	} catch (e) {
		throw new CadProgramError(e instanceof Error ? e.message : String(e), null);
	}
}

/** The usual slips of a program (prod, the exam), each with how to fix it. */
const SLIPS: Array<[RegExp, string]> = [
	[
		/sketchOnPlane is not a function/,
		'draw(…) is a pen: close it first (.close(), or .done() for an open line), then .sketchOnPlane(…)'
	],
	[
		/\.(fillet|chamfer|shell) is not a function/,
		'a mesh (body, sdf.mesh, hull, toMesh, a user’s model) cannot be filleted or shelled — round the solids before they become a mesh, or shape it smooth (body stations, sdf)'
	],
	[
		/^\w+ is not defined$/,
		'not in the API: the helpers are in the CAD section of your instructions (union, pattern, circular, hull, bbox, fit, soften, body, sdf, sweep…)'
	],
	[
		/\.delete is not a function|reading 'wrapped'|reading 'boundingBox'|reading 'fuse'/,
		'something that is not a shape went into a shape operation: an undefined in a list, or a function that forgot to return'
	]
];

/** What a failure says: OpenCascade's own arrive as a bare number; a usual slip says the fix. */
function failureText(e: unknown): string {
	const message = e instanceof Error ? e.message : String(e);
	if (/^\d+$/.test(message) || message === '[object WebAssembly.Exception]') {
		return 'OpenCascade failed in this step (often a fillet radius too big, a boolean of bodies that do not overlap, or a self-intersecting profile)';
	}
	const slip = SLIPS.find(([re]) => re.test(message));
	return slip ? `${message} — ${slip[1]}` : message;
}

/**
 * Parts given as functions — { Корпус: () => …, Голова: () => … } or
 * [{ name, shape: () => … }] — build one by one: a part that fails is left
 * out and said first among the warnings, the rest is shown. On prod one
 * failing call sank a whole model, and the model then took it apart in probes.
 */
async function settleParts(result: unknown, warnings?: string[]): Promise<unknown> {
	const failed: string[] = [];
	const settle = async (name: string, make: () => unknown): Promise<unknown> => {
		try {
			return await make();
		} catch (e) {
			const line = e instanceof CadProgramError ? e.line : programLine(e);
			const text = failureText(e);
			failed.push(
				`part «${name}» did not build — ${line ? `line ${line}: ` : ''}${text.length > 160 ? `${text.slice(0, 160)}…` : text}; the other parts are shown, fix this one and build again.${line ? shownLine(line) : ''}`
			);
			return undefined;
		}
	};
	let settled: unknown = result;
	if (Array.isArray(result)) {
		const items: unknown[] = [];
		for (const [i, v] of result.entries()) {
			const p = v as { name?: unknown; shape?: unknown } | null;
			if (typeof v === 'function') items.push(await settle(`part ${i + 1}`, v as () => unknown));
			else if (p && typeof p === 'object' && typeof p.shape === 'function') {
				const name = typeof p.name === 'string' ? p.name : `part ${i + 1}`;
				const shape = await settle(name, p.shape as () => unknown);
				items.push(shape === undefined ? undefined : { ...p, shape });
			} else items.push(v);
		}
		settled = items.filter((v) => v !== undefined);
	} else if (
		result &&
		typeof result === 'object' &&
		Object.getPrototypeOf(result) === Object.prototype
	) {
		const entries: Array<[string, unknown]> = [];
		for (const [k, v] of Object.entries(result)) {
			entries.push([k, typeof v === 'function' ? await settle(k, v as () => unknown) : v]);
		}
		settled = Object.fromEntries(entries.filter(([, v]) => v !== undefined));
	}
	if (failed.length === 0) return settled;
	const left = Array.isArray(settled) ? settled.length : Object.keys(settled as object).length;
	if (left === 0) throw new CadProgramError(failed[0], null);
	warnings?.unshift(...failed);
	return settled;
}

/**
 * Close the worker to everything but computing: no network, storage,
 * workers, or code from strings. Called after compiling, before running.
 */
export function lockdown(scope: Record<string, unknown>): void {
	const names = [
		'fetch',
		'XMLHttpRequest',
		'WebSocket',
		'EventSource',
		'WebTransport',
		'importScripts',
		'indexedDB',
		'caches',
		'Worker',
		'SharedWorker',
		'BroadcastChannel',
		'Request',
		'Response',
		'Headers',
		'FileReaderSync',
		// A font face loads its url() — a request to any host.
		'FontFace',
		'fonts',
		'WebSocketStream'
	];
	// Every owner of `name` up the global's chain gets `value` (undefined: gone).
	const replace = (name: string, value: unknown) => {
		for (
			let o: object | null = scope;
			o && o !== Object.prototype;
			o = Object.getPrototypeOf(o) as object | null
		) {
			if (!Object.prototype.hasOwnProperty.call(o, name)) continue;
			if (value === undefined) {
				try {
					delete (o as Record<string, unknown>)[name];
				} catch {
					/* not configurable: overwritten below */
				}
			}
			if (value !== undefined || Object.prototype.hasOwnProperty.call(o, name)) {
				try {
					Object.defineProperty(o, name, { value, writable: false, configurable: false });
				} catch {
					/* frozen: nothing more to do */
				}
			}
		}
	};
	for (const name of names) replace(name, undefined);
	// The global object stays reachable however the names are shadowed (an
	// event's target is one way), and the kernels still build functions from
	// strings at run time (embind). So strings may become code, only never
	// `import(…)` — the one way to the network left — and timers take functions.
	const noImport = (source: unknown) => {
		if (/\bimport\b/.test(String(source))) throw new TypeError('import is not available here');
	};
	const realFunction = scope.Function as FunctionConstructor;
	const safeFunction = function (...args: string[]) {
		args.forEach(noImport);
		return realFunction(...args);
	};
	safeFunction.prototype = realFunction.prototype;
	replace('Function', safeFunction);
	const realEval = scope.eval as (source: string) => unknown;
	replace('eval', (source: string) => (noImport(source), realEval(source)));
	for (const name of ['setTimeout', 'setInterval']) {
		const real = scope[name] as (handler: unknown, ...rest: unknown[]) => unknown;
		replace(name, (handler: unknown, ...rest: unknown[]) => {
			if (typeof handler !== 'function') throw new TypeError('timers take a function here');
			return real(handler, ...rest);
		});
	}
	// Every function kind can make code from a string through its constructor.
	const kinds = [function () {}, async function () {}, function* () {}, async function* () {}];
	for (const fn of kinds) {
		Object.defineProperty(Object.getPrototypeOf(fn), 'constructor', {
			value: undefined,
			writable: false,
			configurable: false
		});
	}
}

/**
 * A user's triangles facing out. Files saved inside out (negative volume)
 * are common, and on such a mesh a union cuts and a cut adds. The sign is
 * the whole file's: one inverted shell among good ones is left as it is.
 */
export function outward(tris: Float32Array): Float32Array {
	let volume6 = 0;
	for (let t = 0; t < tris.length; t += 9) {
		const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.subarray(t, t + 9);
		volume6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
	}
	if (volume6 >= 0) return tris;
	const out = tris.slice();
	for (let t = 0; t < out.length; t += 9) {
		const b = out.slice(t + 3, t + 6);
		out.copyWithin(t + 3, t + 6, t + 9);
		out.set(b, t + 6);
	}
	return out;
}

/** One binary STL out of several (parts printed together). */
export function mergeBinaryStl(files: Uint8Array[]): Uint8Array {
	const countOf = (f: Uint8Array) => new DataView(f.buffer, f.byteOffset).getUint32(80, true);
	const out = new Uint8Array(84 + files.reduce((n, f) => n + countOf(f), 0) * 50);
	const view = new DataView(out.buffer);
	let count = 0;
	let at = 84;
	for (const f of files) {
		const n = countOf(f);
		out.set(f.subarray(84, 84 + n * 50), at);
		at += n * 50;
		count += n;
	}
	view.setUint32(80, count, true);
	return out;
}
