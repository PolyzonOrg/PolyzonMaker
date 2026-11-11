/**
 * Builds a CadModel (schema.ts) with replicad on OpenCascade. Pure over the
 * replicad module it is handed, so the worker and the node tests run the same
 * code. A feature that fails stops the build with its id and a hint the
 * assistant can act on; nothing here evaluates text as code.
 */
import type * as Replicad from 'replicad';
import type { CadFeature, CadModel, CadPlane, CadSelector, CadShape2D } from './schema';

type R = typeof Replicad;
type Shape3D = Replicad.Shape3D;
type Drawing = Replicad.Drawing;
type V3 = [number, number, number];

export class CadFeatureError extends Error {
	constructor(
		public readonly featureId: string,
		public readonly op: string,
		message: string
	) {
		super(`${featureId} (${op}): ${message}`);
	}
}

/** The normal each sketch plane extrudes along, and its 2D axes in 3D. */
const PLANE: Record<CadPlane, { normal: V3; x: V3; y: V3 }> = {
	XY: { normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
	XZ: { normal: [0, 1, 0], x: [1, 0, 0], y: [0, 0, 1] },
	YZ: { normal: [1, 0, 0], x: [0, 1, 0], y: [0, 0, 1] }
};

const scaled = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];
const axisVector = (a: 'X' | 'Y' | 'Z' | V3 | undefined): V3 =>
	a === undefined || a === 'Z' ? [0, 0, 1] : a === 'X' ? [1, 0, 0] : a === 'Y' ? [0, 1, 0] : a;

/** Why OpenCascade said no, in words the model can fix. */
export const HINTS: Partial<Record<CadFeature['op'], string>> = {
	fillet:
		'the radius is too big for the selected edges (an edge or face next to them is shorter than the radius), or the selection is empty — use a smaller radius or fewer edges, fillet before boolean cuts',
	chamfer: 'the distance is too big for the selected edges, or the selection is empty',
	shell: 'the thickness is too big for the smallest curvature, or the open face selection is empty',
	loft: 'sections must not cross each other; give every section the same kind of shape and order them along the loft',
	sweep: 'the profile must be small next to the path curvature; check the path points',
	union: 'the bodies did not combine — check that they touch or overlap',
	cut: 'the cut failed — check that the tools overlap the target',
	intersect: 'the intersection is empty — the bodies do not overlap',
	extrude: 'the profile is not a closed, non self-intersecting shape',
	revolve: 'the profile must lie on one side of the axis'
};

/**
 * One B-spline through the pen's point and `points`, added as a single edge.
 * A chain of smoothSplineTo pieces looks the same but leaves a seam at every
 * point, and OpenCascade cannot fillet the faces such a profile extrudes to.
 * replicad has no public call for this: the pen's saveCurve and pointer are
 * internals of the pinned replicad 1.1.0 (tests/cad-build.test.ts fillets one).
 */
export function splineTo(r: R, pen: Replicad.DrawingPen, points: [number, number][]): void {
	const inner = pen as unknown as {
		pointer: [number, number];
		saveCurve(curve: Replicad.Curve2D): void;
	};
	const through = r.drawPointsInterpolation([inner.pointer, ...points]);
	const curve = (through as unknown as { innerShape: Replicad.Blueprint }).innerShape.curves[0];
	inner.saveCurve(curve);
	inner.pointer = points[points.length - 1];
}

function drawShape(r: R, s: CadShape2D): Drawing {
	let d: Drawing;
	switch (s.type) {
		case 'rect':
			d = r.drawRoundedRectangle(s.width, s.height, s.radius || undefined);
			if (s.center) d = d.translate(s.center[0], s.center[1]);
			break;
		case 'circle':
			d = r.drawCircle(s.radius);
			if (s.center) d = d.translate(s.center[0], s.center[1]);
			break;
		case 'ellipse':
			// replicad wants the major radius first; turn it back when ry is larger.
			d = s.rx >= s.ry ? r.drawEllipse(s.rx, s.ry) : r.drawEllipse(s.ry, s.rx).rotate(90, [0, 0]);
			if (s.center) d = d.translate(s.center[0], s.center[1]);
			break;
		case 'polygon': {
			const pen = r.draw(s.points[0]);
			for (const p of s.points.slice(1)) pen.lineTo(p);
			d = pen.close();
			if (s.radius) d = d.fillet(s.radius);
			break;
		}
		case 'spline': {
			// One curve through every point and back to the first (which closes it).
			const pen = r.draw(s.points[0]);
			splineTo(r, pen, [...s.points.slice(1), s.points[0]]);
			d = pen.close();
			break;
		}
		case 'path': {
			const pen = r.draw(s.start);
			for (const seg of s.segments) {
				if ('line' in seg) pen.lineTo(seg.line);
				else if ('arc' in seg) pen.threePointsArcTo(seg.arc, seg.via);
				else if ('tangentArc' in seg) pen.tangentArcTo(seg.tangentArc);
				else if ('spline' in seg) splineTo(r, pen, seg.spline);
				else pen.cubicBezierCurveTo(seg.bezier, seg.c1, seg.c2);
			}
			d = s.mirror ? pen.closeWithMirror() : pen.close();
			if (s.radius) d = d.fillet(s.radius);
			break;
		}
	}
	for (const hole of s.holes ?? []) d = d.cut(drawShape(r, hole));
	return d;
}

/** A profile placed on its plane: the plane's origin moved `offset` along the normal. */
function sketchOn(r: R, profile: CadShape2D, plane: CadPlane, offset = 0) {
	// replicad's XZ plane maps x → X and y → Z as documented but faces −Y:
	// extrusions pass our normal explicitly, origins go as points.
	const origin = scaled(PLANE[plane].normal, offset);
	return drawShape(r, profile).sketchOnPlane(plane, origin) as Replicad.Sketch;
}

function edgeFilter(sel: CadSelector | undefined) {
	return (f: Replicad.EdgeFinder): Replicad.EdgeFinder => {
		if (!sel || sel.all) return f;
		if (sel.direction) f.inDirection(sel.direction);
		if (sel.inPlane) f.inPlane(sel.inPlane, scaled(PLANE[sel.inPlane].normal, sel.offset ?? 0));
		if (sel.inBox) f.inBox(sel.inBox[0], sel.inBox[1]);
		if (sel.near) f.withinDistance(sel.within ?? 1, sel.near);
		if (sel.curve)
			f.when(({ element }) => {
				const t = element.geomType;
				return sel.curve === 'line'
					? t === 'LINE'
					: sel.curve === 'circle'
						? t === 'CIRCLE'
						: t !== 'LINE';
			});
		if (sel.not) {
			const inner = edgeFilter(sel.not);
			f.not((g) => inner(g));
		}
		if (sel.and) f.and(sel.and.map((s) => (g: Replicad.EdgeFinder) => edgeFilter(s)(g)));
		if (sel.or) f.either(sel.or.map((s) => (g: Replicad.EdgeFinder) => edgeFilter(s)(g)));
		return f;
	};
}

function faceFilter(sel: CadSelector) {
	return (f: Replicad.FaceFinder): Replicad.FaceFinder => {
		if (sel.all) return f;
		if (sel.inPlane) f.inPlane(sel.inPlane, scaled(PLANE[sel.inPlane].normal, sel.offset ?? 0));
		if (sel.parallelTo) f.parallelTo(sel.parallelTo);
		if (sel.inBox) f.inBox(sel.inBox[0], sel.inBox[1]);
		if (sel.near) f.withinDistance(sel.within ?? 1, sel.near);
		if (sel.surface)
			f.when(({ element }) => {
				const t = element.geomType;
				return sel.surface === 'plane'
					? t === 'PLANE'
					: sel.surface === 'cylinder'
						? t === 'CYLINDRE'
						: t !== 'PLANE';
			});
		if (sel.not) {
			const inner = faceFilter(sel.not);
			f.not((g) => inner(g));
		}
		if (sel.and) f.and(sel.and.map((s) => (g: Replicad.FaceFinder) => faceFilter(s)(g)));
		if (sel.or) f.either(sel.or.map((s) => (g: Replicad.FaceFinder) => faceFilter(s)(g)));
		return f;
	};
}

/** A 2D profile swept along a 3D path (a smooth curve through the points, or straight segments). */
export function sweepAlong(r: R, profile: Drawing, path: V3[], smooth = true): Shape3D {
	const edges = smooth
		? [r.makeBSplineApproximation(path)]
		: path.slice(1).map((p, i) => r.makeLine(path[i], p));
	const spine = new r.Sketch(r.assembleWire(edges));
	return spine.sweepSketch(
		// The Plane overload; the union signature only names plane names.
		(plane) => profile.sketchOnPlane(plane) as Replicad.Sketch,
		{ transitionMode: 'round' }
	);
}

function fuseAll(shape: Shape3D, others: Shape3D[]): Shape3D {
	return others.reduce((acc, s) => acc.fuse(s), shape);
}

function runFeature(r: R, f: CadFeature, get: (id: string) => Shape3D): Shape3D {
	switch (f.op) {
		case 'extrude': {
			const normal = PLANE[f.plane].normal;
			const start = (f.offset ?? 0) - (f.symmetric ? f.distance / 2 : 0);
			return sketchOn(r, f.profile, f.plane, start).extrude(f.distance, {
				extrusionDirection: normal,
				...(f.twist ? { twistAngle: f.twist } : {}),
				...(f.scaleEnd !== undefined && f.scaleEnd !== 1
					? { extrusionProfile: { profile: 'linear' as const, endFactor: f.scaleEnd } }
					: {})
			});
		}
		case 'revolve': {
			const p = PLANE[f.plane];
			return sketchOn(r, f.profile, f.plane, f.offset).revolve(f.axis === 'x' ? p.x : p.y, {
				origin: scaled(p.normal, f.offset ?? 0),
				angle: f.angle ?? 360
			});
		}
		case 'loft': {
			const [first, ...rest] = f.sections.map((s) => sketchOn(r, s.profile, s.plane, s.offset));
			return first.loftWith(rest, { ruled: f.ruled ?? false });
		}
		case 'sweep':
			return sweepAlong(r, drawShape(r, f.profile), f.path, f.smooth !== false);
		case 'box':
			return r.makeBox(f.from, f.to);
		case 'cylinder':
			return r.makeCylinder(f.radius, f.height, f.base ?? [0, 0, 0], axisVector(f.axis));
		case 'sphere': {
			const s = r.makeSphere(f.radius);
			return f.center ? s.translate(...f.center) : s;
		}
		case 'union':
			return fuseAll(get(f.target), f.tools.map(get));
		case 'cut':
			return f.tools.reduce((acc, t) => acc.cut(get(t)), get(f.target));
		case 'intersect':
			return f.tools.reduce((acc, t) => acc.intersect(get(t)), get(f.target));
		case 'fillet':
			return get(f.target).fillet(f.radius, edgeFilter(f.edges));
		case 'chamfer':
			return get(f.target).chamfer(f.distance, edgeFilter(f.edges));
		case 'shell':
			return get(f.target).shell(f.thickness, faceFilter(f.faces));
		case 'transform': {
			let s = get(f.target).clone();
			if (f.scale !== undefined) s = s.scale(f.scale, [0, 0, 0]);
			if (f.rotate)
				s = s.rotate(f.rotate.angle, f.rotate.origin ?? [0, 0, 0], axisVector(f.rotate.axis));
			if (f.translate) s = s.translate(...f.translate);
			return s;
		}
		case 'mirror': {
			const base = get(f.target);
			const image = base.clone().mirror(f.plane, scaled(PLANE[f.plane].normal, f.offset ?? 0));
			return f.keepOriginal === false ? image : base.fuse(image);
		}
		case 'pattern': {
			const base = get(f.target);
			const copies: Shape3D[] = [];
			for (let i = 1; i < f.count; i++) {
				const c = base.clone();
				if (f.step) copies.push(c.translate(...scaled(f.step, i)));
				else {
					const total = f.angle ?? 360;
					const each = total >= 360 ? total / f.count : total / (f.count - 1);
					copies.push(c.rotate(each * i, f.origin ?? [0, 0, 0], axisVector(f.axis)));
				}
			}
			return fuseAll(base, copies);
		}
	}
}

/** Build every feature in order; the part is `result` or the last feature. */
export function buildCadShape(r: R, model: CadModel): Shape3D {
	const shapes = new Map<string, Shape3D>();
	const get = (id: string) => {
		const s = shapes.get(id);
		if (!s) throw new Error(`${id} is not built`);
		return s;
	};
	for (const f of model.features) {
		let shape: Shape3D;
		try {
			shape = runFeature(r, f, get);
		} catch (e) {
			// OpenCascade throws WebAssembly exceptions or bare numbers with nothing to
			// read: say what usually causes the failure of this operation.
			const raw = e instanceof Error && !/^\d+$/.test(e.message) ? e.message : '';
			const hint = HINTS[f.op] ?? 'OpenCascade refused this step';
			throw new CadFeatureError(f.id, f.op, raw ? `${raw} — ${hint}` : hint);
		}
		shapes.set(f.id, shape);
	}
	return get(model.result ?? model.features[model.features.length - 1].id);
}
