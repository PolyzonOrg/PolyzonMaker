/**
 * The language CAD programs are written in: a shape in a few words, and shapes placed against each
 * other instead of worked out in coordinates. A model writes this, so what would make it count, guess
 * or repeat itself is here as one call, and a wrong call fails on its own line with its signature.
 *
 * Everything is in mm, X right, Y back, Z up, the front is at -Y. A new shape stands on Z = 0, centred on
 * X and Y, and `.at` always means «the middle of the shape's underside goes here». A Part is one or more
 * bodies, each with its colour; it never changes, every call answers with a new one.
 *
 * Solids live in OpenCascade and round and export to STEP; smooth bodies live in Manifold and are built
 * and cut in milliseconds. Studio's program.ts joins the two, and this file does not care which it has.
 */
import type * as Replicad from 'replicad';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { loftBody, type Station } from '../studio/cad/body';
import { rayHit, SHADOWED, type CadApi, type CadPart, type ProgramContext } from '../studio/cad/program';
import { sdfApi } from '../studio/cad/sculpt';
import { kit } from './kit';

type R = typeof Replicad;
export type V3 = [number, number, number];
type V2 = [number, number];
type Shape = Replicad.Shape3D | Replicad.MeshShape;
export type Axis = 'x' | 'y' | 'z';
export type Side = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface Body {
	shape: Shape;
	color?: string;
	/** Made of pieces on purpose, like the letters of a word. */
	loose?: boolean;
}

export interface Param {
	name: string;
	value: number;
	min: number;
	max: number;
	step: number;
}

export interface LangContext {
	r: R;
	mf: ManifoldToplevel;
	api: CadApi;
	warn: (text: string) => void;
	/** Values set from the window, by parameter name. */
	values: Record<string, number>;
	/** Filled by param() while the program runs. */
	params: Param[];
	/** Other programs this one may use(), by name. */
	programs: Record<string, string>;
	/** Names of the use() calls running now, to stop a program using itself. */
	using: string[];
	/** What the window said about parts, by name: where they are moved, their colour, whether they are gone. */
	marks: Marks;
	/** Parts a program named with part(), on top of what it returns. */
	named: Array<[string, unknown]>;
}

export interface Marks {
	places: Record<string, number[]>;
	paints: Record<string, string>;
	drops: Set<string>;
}

const COLORS: Record<string, string> = {
	black: '#1b1b1f',
	white: '#eeeeea',
	gray: '#8b8d92',
	dark: '#3a3b40',
	red: '#c8342c',
	orange: '#e0702a',
	yellow: '#e6bc2e',
	green: '#3f8f4f',
	blue: '#2f6bc4',
	navy: '#1f2f55',
	purple: '#7a4bb0',
	pink: '#e58fa8',
	brown: '#6f4a2f',
	wood: '#b08355',
	cream: '#e6dcc6',
	steel: '#a9adb3',
	brass: '#c9a24a',
	copper: '#b8703f',
	rubber: '#26262a',
	glass: '#20303a'
};

/** Each side as seen from outside: `u` goes right, `v` goes up, `n` comes out at the viewer. */
export const SIDES: Record<Side, { u: V3; v: V3; n: V3 }> = {
	top: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
	bottom: { u: [1, 0, 0], v: [0, -1, 0], n: [0, 0, -1] },
	front: { u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
	back: { u: [-1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
	left: { u: [0, -1, 0], v: [0, 0, 1], n: [-1, 0, 0] },
	right: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] }
};

const AXES: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const PLANES: Record<Axis, string> = { x: 'YZ', y: 'XZ', z: 'XY' };

const shown = (v: unknown) => (v === undefined ? 'nothing' : (JSON.stringify(v)?.slice(0, 50) ?? typeof v));

function number(sig: string, name: string, v: unknown, above?: number): number {
	if (typeof v !== 'number' || !Number.isFinite(v) || (above !== undefined && !(v > above))) {
		throw new Error(`${sig}: ${name} must be a number${above === undefined ? '' : ` above ${above}`}, got ${shown(v)}`);
	}
	return v;
}

function colorOf(sig: string, c: string): string {
	const hex = COLORS[c] ?? c;
	if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`${sig}: «${c}» is no colour: #rrggbb or one of ${Object.keys(COLORS).join(', ')}`);
	return hex;
}

/** Every call of the language goes through the world it was made in. */
export function language(ctx: LangContext) {
	const { r, mf, api, warn } = ctx;
	const isMesh = (s: Shape): s is Replicad.MeshShape => s instanceof r.MeshShape;
	const meshes = new WeakMap<object, { vertices: number[]; triangles: number[] }>();

	/** The surface as triangles, once per shape: a ray test on it is what makes `.on` land on curves. */
	function surface(s: Shape) {
		let m = meshes.get(s);
		if (!m) {
			// Coarse is enough to land on; a fine mesh of a smooth solid takes seconds.
			const [min, max] = s.boundingBox.bounds as [V3, V3];
			const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
			m = (isMesh(s) ? s.mesh() : s.mesh({ tolerance: span / 400, angularTolerance: 0.5 })) as { vertices: number[]; triangles: number[] };
			meshes.set(s, m);
		}
		return m;
	}

	const wrapManifold = (m: Manifold) => new r.MeshShape(m as never);

	/** The surface moved out along its normals: unlike scaling, the same distance everywhere. */
	function inflated(s: Shape, by: number): Shape {
		const mesh = ((isMesh(s) ? s : api.toMesh(s)) as unknown as { wrapped: Manifold }).wrapped.getMesh();
		const { vertProperties: at, triVerts, numProp } = mesh;
		const normals = new Float32Array((at.length / numProp) * 3);
		const point = (v: number) => [0, 1, 2].map((c) => at[v * numProp + c]);
		for (let t = 0; t < triVerts.length; t += 3) {
			const [a, b, c] = [triVerts[t], triVerts[t + 1], triVerts[t + 2]];
			const [p, q, w] = [point(a), point(b), point(c)];
			const [ux, uy, uz, vx, vy, vz] = [q[0] - p[0], q[1] - p[1], q[2] - p[2], w[0] - p[0], w[1] - p[1], w[2] - p[2]];
			const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
			for (const v of [a, b, c]) for (const i of [0, 1, 2]) normals[v * 3 + i] += n[i];
		}
		const moved = new Float32Array(at);
		for (let v = 0; v < normals.length / 3; v++) {
			const length = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
			for (const i of [0, 1, 2]) moved[v * numProp + i] += (normals[v * 3 + i] / length) * by;
		}
		return wrapManifold(new mf.Manifold(new mf.Mesh({ numProp, vertProperties: moved, triVerts })));
	}

	class Part {
		constructor(readonly bodies: Body[]) {}

		private each(change: (s: Shape) => Shape) {
			return new Part(this.bodies.map((b) => ({ ...b, shape: change(b.shape) })));
		}

		get box() {
			const min: V3 = [Infinity, Infinity, Infinity];
			const max: V3 = [-Infinity, -Infinity, -Infinity];
			for (const { shape } of this.bodies) {
				const [lo, hi] = shape.boundingBox.bounds as [V3, V3];
				for (const i of [0, 1, 2]) {
					min[i] = Math.min(min[i], lo[i]);
					max[i] = Math.max(max[i], hi[i]);
				}
			}
			return { min, max };
		}
		/** Sizes along X, Y and Z. */
		get w() {
			return this.box.max[0] - this.box.min[0];
		}
		get d() {
			return this.box.max[1] - this.box.min[1];
		}
		get h() {
			return this.box.max[2] - this.box.min[2];
		}
		get left() {
			return this.box.min[0];
		}
		get right() {
			return this.box.max[0];
		}
		get front() {
			return this.box.min[1];
		}
		get back() {
			return this.box.max[1];
		}
		get bottom() {
			return this.box.min[2];
		}
		get top() {
			return this.box.max[2];
		}
		/** A point of the bounding box by fractions, -1 to 1 from its centre: p(0, 0, 1) is the middle of the top. */
		p(x = 0, y = 0, z = 0): V3 {
			const { min, max } = this.box;
			return [x, y, z].map((k, i) => (min[i] + max[i]) / 2 + (k * (max[i] - min[i])) / 2) as V3;
		}

		move(x = 0, y = 0, z = 0) {
			return this.each((s) => s.translate(x, y, z) as Shape);
		}
		x(d: number) {
			return this.move(d, 0, 0);
		}
		y(d: number) {
			return this.move(0, d, 0);
		}
		z(d: number) {
			return this.move(0, 0, d);
		}
		/** The middle of the underside goes to this point. */
		at(x: number | V3 = 0, y = 0, z = 0) {
			const to = Array.isArray(x) ? x : ([x, y, z] as V3);
			const from = this.p(0, 0, -1);
			return this.move(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
		}
		/** The middle of the shape goes to this point. */
		mid(x: number | V3 = 0, y = 0, z = 0) {
			const to = Array.isArray(x) ? x : ([x, y, z] as V3);
			const from = this.p();
			return this.move(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
		}
		/** Turned about its own middle, in degrees: around X, then Y, then Z. */
		rot(x = 0, y = 0, z = 0) {
			return this.turn(x, 'x').turn(y, 'y').turn(z, 'z');
		}
		/** Turned about an axis through `pivot` (its own middle unless given). */
		turn(deg: number, axis: Axis | V3 = 'z', pivot?: V3) {
			if (!deg) return this;
			const dir = typeof axis === 'string' ? AXES[axis] : axis;
			const at = pivot ?? this.p();
			return this.each((s) => s.rotate(deg, at, dir) as Shape);
		}
		scale(k: number | V3) {
			const sig = '.scale(k | [x, y, z])';
			if (Array.isArray(k)) {
				const [x, y, z] = k.map((v, i) => number(sig, 'xyz'[i], v, 0));
				const at = this.p();
				return this.each((s) => api.stretch(s.translate(-at[0], -at[1], -at[2]) as Shape, [x, y, z]).translate(at[0], at[1], at[2]) as Shape);
			}
			number(sig, 'k', k, 0);
			const at = this.p();
			return this.each((s) => s.scale(k, at) as Shape);
		}
		/** Scaled as a whole to a size along one axis: fit({ z: 80 }). */
		fit(size: Partial<Record<Axis, number>>) {
			const axis = (['x', 'y', 'z'] as const).find((a) => size[a] !== undefined);
			if (!axis) throw new Error('.fit({ x | y | z: size }): no size given');
			return this.scale(number('.fit', axis, size[axis], 0) / [this.w, this.d, this.h]['xyz'.indexOf(axis)]);
		}
		/** The mirror image, in place. */
		flip(axis: Axis = 'x') {
			const at = this.p();
			return this.each((s) => s.mirror(PLANES[axis] as 'YZ', at) as Shape);
		}
		/** This and its mirror image across the plane x = at (or y, z). */
		both(axis: Axis = 'x', at = 0) {
			const origin = AXES[axis].map((k) => k * at) as V3;
			return group(this, this.each((s) => s.mirror(PLANES[axis] as 'YZ', origin) as Shape));
		}
		/** `n` copies `dx dy dz` apart, centred where this one is. */
		row(n: number, dx = 0, dy = 0, dz = 0) {
			const sig = '.row(n, dx, dy, dz)';
			number(sig, 'n', n, 0);
			const middle = (n - 1) / 2;
			return group(...Array.from({ length: n }, (_, i) => this.move((i - middle) * dx, (i - middle) * dy, (i - middle) * dz)));
		}
		/** nx by ny copies, centred where this one is. */
		grid(nx: number, ny: number, dx: number, dy: number) {
			return this.row(nx, dx).row(ny, 0, dy);
		}
		/** `n` copies turned around an axis through `pivot`, as it stands: fins, spokes, petals. */
		around(n: number, axis: Axis = 'z', pivot: V3 = [0, 0, 0]) {
			number('.around(n, axis, pivot)', 'n', n, 0);
			return group(...Array.from({ length: n }, (_, i) => this.turn((i * 360) / n, axis, pivot)));
		}
		/** `n` copies around an axis through this one's middle, `radius` out from it, each turned with the circle. */
		ring(n: number, radius: number, axis: Axis = 'z') {
			const sig = '.ring(n, radius, axis)';
			number(sig, 'n', n, 0);
			number(sig, 'radius', radius);
			const at = this.p();
			const out: V3 = axis === 'x' ? [0, radius, 0] : [radius, 0, 0];
			return group(...Array.from({ length: n }, (_, i) => this.move(...out).turn((i * 360) / n, axis, at)));
		}

		/** Joined into one body, in this one's colour. */
		add(...others: Part[]) {
			const all = [...this.bodies, ...others.flatMap((o) => partArg('.add', o).bodies)];
			return new Part([{ color: this.bodies[0].color, shape: api.union(all.map((b) => b.shape)) as Shape }]);
		}
		cut(...tools: Part[]) {
			const list = tools.flatMap((t) => partArg('.cut', t).bodies);
			return this.each((s) => list.reduce((left, t) => left.cut(t.shape as never) as Shape, s));
		}
		/** What this one and `other` share. */
		keep(other: Part) {
			const tool = partArg('.keep', other).bodies;
			return this.each((s) => s.intersect(api.union(tool.map((b) => b.shape)) as never) as Shape);
		}
		/** Holes of diameter `d` at [x, y] (from the middle of `side`, as seen from outside); through unless `depth` is given. */
		hole(d: number, points: V2[] = [[0, 0]], depth?: number, side: Side = 'top') {
			const sig = '.hole(d, [[x, y], …], depth, side)';
			number(sig, 'd', d, 0);
			if (!SIDES[side]) throw new Error(`${sig}: side must be ${Object.keys(SIDES).join(', ')}, got ${shown(side)}`);
			const { u, v, n } = SIDES[side];
			const across = [this.w, this.d, this.h][n.findIndex((k) => k !== 0)];
			const deep = depth ?? across + 2;
			const face = sidePoint(this, side);
			const drills = points.map(([a, b]) => {
				const at = [0, 1, 2].map((i) => face[i] + u[i] * a + v[i] * b + n[i]) as V3;
				return r.makeCylinder(d / 2, deep + 1, at, n.map((k) => -k) as V3) as Shape;
			});
			return this.each((s) => drills.reduce((left, t) => left.cut(t as never) as Shape, s));
		}
		/** The four corners of `side`, `inset` in from its edges, as [x, y] for .hole. */
		corners(inset = 0, side: Side = 'top'): V2[] {
			const { u, v } = SIDES[side];
			const size = [this.w, this.d, this.h];
			const a = size[u.findIndex((k) => k !== 0)] / 2 - inset;
			const b = size[v.findIndex((k) => k !== 0)] / 2 - inset;
			return [[-a, -b], [a, -b], [-a, b], [a, b]];
		}

		/** Rounds edges: all of them, or those of `top`, `bottom`, or the upright ones (`z`). */
		round(radius: number, which?: 'top' | 'bottom' | 'z') {
			number('.round(radius, which)', 'radius', radius, 0);
			return this.edges('fillet', radius, which);
		}
		/** Cuts edges at 45°, the same way. */
		bevel(size: number, which?: 'top' | 'bottom' | 'z') {
			number('.bevel(size, which)', 'size', size, 0);
			return this.edges('chamfer', size, which);
		}
		private edges(op: 'fillet' | 'chamfer', size: number, which?: 'top' | 'bottom' | 'z') {
			const top = this.top;
			const bottom = this.bottom;
			return this.each((s) => {
				if (isMesh(s)) {
					warn(`.${op === 'fillet' ? 'round' : 'bevel'}: a smooth body has no edges; it stays as it is.`);
					return s;
				}
				if (!which && op === 'fillet') return api.soften(s, size);
				const pick = (e: Replicad.EdgeFinder) => (which === 'z' ? e.inDirection('Z') : e.inPlane('XY', which === 'top' ? top : bottom));
				return (which ? s[op](size, pick as never) : s[op](size)) as Shape;
			});
		}
		/** Hollow, walls `wall` thick, open at `side`; a smooth body stays closed. */
		shell(wall: number, side: Side = 'top') {
			number('.shell(wall, side)', 'wall', wall, 0);
			const at = sidePoint(this, side);
			const k = (axis: number) => ([this.w, this.d, this.h][axis] - 2 * wall) / [this.w, this.d, this.h][axis];
			return this.each((s) => {
				if (isMesh(s)) return s.cut(api.stretch(s.translate(...negated(this.p())) as Shape, [k(0), k(1), k(2)]).translate(...this.p()) as never) as Shape;
				return s.shell(wall, ((f: Replicad.FaceFinder) => f.containsPoint(at)) as never) as Shape;
			});
		}
		/** The skin of this shape inside `region`, raised `lift` above it: windows, stripes and panels on any surface. */
		patch(region: Part, lift = 0.4, color = 'glass') {
			const sig = '.patch(region, lift, color)';
			number(sig, 'lift', lift, 0);
			const tool = api.union(partArg(sig, region).bodies.map((b) => b.shape)) as never;
			const paint = colorOf(sig, color);
			const skins = this.bodies.flatMap((b) => {
				const shape = inflated(b.shape, lift).intersect(tool) as Shape;
				return (shape.boundingBox.bounds as V3[]).flat().every(Number.isFinite) ? [{ shape, color: paint }] : [];
			});
			if (!skins.length) warn('.patch: the region touches nothing of this shape.');
			return new Part([...this.bodies, ...skins]);
		}

		color(c: string) {
			const color = colorOf('.color(name | #rrggbb)', c);
			return new Part(this.bodies.map((b) => ({ ...b, color })));
		}

		/** Stands on `side` of `other` with its underside down, turned to face out, at [u, v] from the middle of that side, sunk `sink`. It lands on the real surface. */
		on(other: Part, side: Side = 'top', u = 0, v = 0, sink = 0) {
			const sig = ".on(other, side, u, v, sink)";
			partArg(sig, other);
			turnFor(this, sideArg(sig, side));
			return seat(turnFor(this, side), other, side, u, v, sink);
		}
		/** Comes up against `side` of `other` as it is, without turning. */
		to(other: Part, side: Side = 'top', u = 0, v = 0, sink = 0) {
			const sig = '.to(other, side, u, v, sink)';
			return seat(this, partArg(sig, other), sideArg(sig, side), u, v, sink);
		}
	}

	function sideArg(sig: string, side: Side) {
		if (!SIDES[side]) throw new Error(`${sig}: side must be ${Object.keys(SIDES).join(', ')}, got ${shown(side)}`);
		return side;
	}

	function partArg(sig: string, v: unknown): Part {
		if (v instanceof Part) return v;
		if (v && typeof v === 'object' && 'boundingBox' in v) return make(v as Shape);
		throw new Error(`${sig}: this is not a shape, got ${shown(v)}`);
	}

	const negated = (p: V3): V3 => [-p[0], -p[1], -p[2]];

	/** The middle of a side of the bounding box. */
	function sidePoint(part: Part, side: Side): V3 {
		return part.p(...SIDES[side].n);
	}

	function turnFor(part: Part, side: Side): Part {
		const at: V3 = [0, 0, 0];
		const up = part.turn(side === 'bottom' ? 180 : side === 'top' ? 0 : 90, 'x', at);
		return side === 'back' ? up.turn(180, 'z', at) : side === 'left' ? up.turn(-90, 'z', at) : side === 'right' ? up.turn(90, 'z', at) : up;
	}

	/** Puts `part` against `side` of `other`: on the surface a ray meets there, or on the box when it meets none. */
	function seat(part: Part, other: Part, side: Side, u: number, v: number, sink: number): Part {
		const { u: across, v: up, n } = SIDES[side];
		const face = sidePoint(other, side);
		const start = [0, 1, 2].map((i) => face[i] + across[i] * u + up[i] * v) as V3;
		const reach = other.w + other.d + other.h + 1;
		const origin = [0, 1, 2].map((i) => start[i] + n[i] * reach) as V3;
		let target = start;
		let nearest = Infinity;
		for (const { shape } of other.bodies) {
			const { vertices, triangles } = surface(shape);
			const hit = rayHit(vertices, triangles, origin, negated(n));
			if (hit && hit.distance < nearest) {
				nearest = hit.distance;
				target = hit.point;
			}
		}
		if (nearest === Infinity) warn(`.on/.to: nothing of the shape is at [${u}, ${v}] on its ${side}; placed on its bounding box.`);
		const [a, b, c] = [across, up, n].map((axis) => axis.findIndex((k) => k !== 0));
		const from: V3 = [0, 0, 0];
		const middle = part.p();
		const low = part.p(...(n.map((k) => -k) as V3));
		from[a] = middle[a];
		from[b] = middle[b];
		from[c] = low[c];
		const by = [0, 1, 2].map((i) => target[i] - from[i] - n[i] * sink) as V3;
		return part.move(...by);
	}

	const make = (shape: Shape, color?: string) => new Part([{ shape, color }]);

	function group(...parts: Part[]) {
		const list = parts.flat(Infinity as 1) as Part[];
		return new Part(list.flatMap((p) => partArg('group(...parts)', p).bodies));
	}

	function box(w: number, d: number, h: number, radius = 0) {
		const sig = 'box(w, d, h, radius)';
		[w, d, h].forEach((v, i) => number(sig, 'wdh'[i], v, 0));
		const part = make(r.makeBaseBox(w, d, h) as Shape);
		return radius ? part.round(Math.min(radius, Math.min(w, d, h) / 2 - 0.001)) : part;
	}

	function cyl(radius: number, h: number) {
		const sig = 'cyl(radius, h)';
		return make(r.makeCylinder(number(sig, 'radius', radius, 0), number(sig, 'h', h, 0)) as Shape);
	}

	/** Turned around Z: points are [radius, z]. */
	function lathe(points: V2[], smooth = false) {
		const sig = 'lathe([[r, z], …], smooth)';
		if (!Array.isArray(points) || points.length < 3) throw new Error(`${sig}: needs at least three points`);
		const [first, ...rest] = points.map(([a, b]) => [number(sig, 'r', a), number(sig, 'z', b)] as V2);
		const pen = r.draw(first);
		if (smooth) api.spline(pen, rest);
		else for (const p of rest) pen.lineTo(p);
		return make(pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]) as Shape);
	}

	function cone(r1: number, r2: number, h: number) {
		const sig = 'cone(r1, r2, h)';
		number(sig, 'r1', r1);
		number(sig, 'r2', r2);
		number(sig, 'h', h, 0);
		const points: V2[] = [[0, 0], [r1, 0], [r2, h], [0, h]];
		if (r1 === 0) points.shift();
		else if (r2 === 0) points.splice(2, 1);
		return lathe(points);
	}

	function ball(radius: number) {
		return make(r.makeSphere(number('ball(radius)', 'radius', radius, 0)).translate(0, 0, radius) as Shape);
	}

	function torus(radius: number, tube: number) {
		const sig = 'torus(radius, tube)';
		number(sig, 'radius', radius, 0);
		number(sig, 'tube', tube, 0);
		const shape = r.drawCircle(tube).translate(radius, 0).sketchOnPlane('XZ').revolve([0, 0, 1]) as Shape;
		return make(shape).at(0, 0, 0);
	}

	/** A tube `h` tall: outer radius, wall. */
	function pipe(radius: number, wall: number, h: number) {
		const sig = 'pipe(radius, wall, h)';
		number(sig, 'wall', wall, 0);
		return cyl(radius, h).cut(cyl(number(sig, 'radius - wall', radius - wall, 0), h + 2).z(-1));
	}

	/** A closed outline as a drawing; `radius` rounds its corners. */
	function outline(sig: string, points: V2[], radius: number) {
		if (!Array.isArray(points) || points.length < 3) throw new Error(`${sig}: needs at least three points`);
		const pen = r.draw(points[0]);
		for (const p of points.slice(1)) pen.lineTo(p);
		return radius ? pen.close().offset(-radius, { endCap: 'round' } as never).offset(radius) : pen.close();
	}

	/** An outline in top view (x, y) raised `h`; `radius` rounds its corners. */
	function poly(points: V2[], h: number, radius = 0) {
		const sig = 'poly([[x, y], …], h, radius)';
		number(sig, 'h', h, 0);
		return make(outline(sig, points, radius).sketchOnPlane('XY').extrude(h) as Shape);
	}

	/** An outline seen along an axis, as thick as `depth` across it and centred on it: 'x' takes [y, z], 'y' takes [x, z], 'z' takes [x, y]. */
	function profile(axis: Axis, points: V2[], depth: number, radius = 0) {
		const sig = 'profile(axis, [[a, b], …], depth, radius)';
		if (!AXES[axis]) throw new Error(`${sig}: axis must be x, y or z, got ${shown(axis)}`);
		number(sig, 'depth', depth, 0);
		const flat = make(outline(sig, points, radius).sketchOnPlane('XY').extrude(depth) as Shape).move(0, 0, -depth / 2);
		const zero: V3 = [0, 0, 0];
		if (axis === 'z') return flat;
		// The sketch's x and y go to the two other axes, in the order the signature gives them.
		if (axis === 'y') return flat.turn(90, 'x', zero);
		return flat.turn(90, 'x', zero).turn(90, 'z', zero);
	}

	/** An outline swept along a path, turning with it; the outline is drawn across the start of the path. */
	function sweep(points: V2[], path: V3[], smooth = true) {
		const sig = 'sweep([[x, y], …], [[x, y, z], …], smooth)';
		if (!Array.isArray(path) || path.length < 2) throw new Error(`${sig}: the path needs at least two points`);
		return make(api.sweep(outline(sig, points, 0), path, smooth) as Shape);
	}

	/** A smooth body through sections along an axis; each row is [at, w, h, n, u, v]: n 2 is an ellipse, 4 to 6 a rounded box, u and v move the section off the axis. */
	function loft(axis: Axis, rows: number[][]) {
		const sig = 'loft(axis, [[at, w, h, n, u, v], …])';
		if (!AXES[axis]) throw new Error(`${sig}: axis must be x, y or z, got ${shown(axis)}`);
		if (!Array.isArray(rows)) throw new Error(`${sig}: rows must be a list`);
		const stations: Station[] = rows.map(([at, w, h, n, u, v]) => ({ at, w, h, n, u, v }));
		return make(loftBody(r, mf, stations, { axis }));
	}

	/** A pillow-like body: `n` 2 is an ellipsoid, 4 a cushion, 8 nearly a box. */
	function soft(w: number, d: number, h: number, n = 4) {
		const sig = 'soft(w, d, h, n)';
		[w, d, h].forEach((v, i) => number(sig, 'wdh'[i], v, 0));
		const steps = 20;
		const rows = Array.from({ length: 2 * steps + 1 }, (_, i) => {
			const z = i / steps - 1;
			const k = Math.max((1 - Math.abs(z) ** n) ** (1 / n), 0.02);
			return [(h / 2) * (1 + z), w * k, d * k, n];
		});
		return loft('z', rows);
	}

	/** The smallest convex shape around these. */
	function hull(...parts: (Part | Part[])[]) {
		const list = parts.flat().map((p) => partArg('hull(...parts)', p));
		return make(api.hull(list.flatMap((p) => p.bodies.map((b) => b.shape))) as Shape);
	}

	function samples(points: V3[], step: number, smooth: boolean): V3[] {
		if (!smooth || points.length < 3) return points;
		const out: V3[] = [];
		const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
		for (let i = 0; i + 1 < points.length; i++) {
			const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
			const length = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
			const count = Math.max(2, Math.ceil(length / step));
			for (let k = 0; k < count; k++) {
				const t = k / count;
				out.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t * t + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t * t * t)) as V3);
			}
		}
		out.push(points[points.length - 1]);
		return out;
	}

	/** A round bar along points, smooth through them: rails, skids, cables, frames. */
	function bar(points: V3[], radius: number, smooth = true) {
		const sig = 'bar([[x, y, z], …], radius, smooth)';
		number(sig, 'radius', radius, 0);
		if (!Array.isArray(points) || points.length < 2) throw new Error(`${sig}: needs at least two points`);
		const path = samples(points, Math.max(radius, 1), smooth);
		const ball = mf.Manifold.sphere(radius, 24);
		const links: Manifold[] = [];
		for (let i = 0; i + 1 < path.length; i++) links.push(mf.Manifold.hull([ball.translate(path[i]), ball.translate(path[i + 1])]));
		return make(wrapManifold(mf.Manifold.union(links)));
	}

	/** A straight rod with flat ends between two points. */
	function rod(a: V3, b: V3, radius: number) {
		const sig = 'rod([x, y, z], [x, y, z], radius)';
		number(sig, 'radius', radius, 0);
		const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as V3;
		const length = Math.hypot(...dir);
		if (!(length > 0)) throw new Error(`${sig}: the two ends are the same point`);
		return make(r.makeCylinder(radius, length, a, dir) as Shape);
	}

	function text(words: string, size = 10, depth = 2) {
		const sig = 'text(words, size, depth)';
		if (typeof words !== 'string' || !words) throw new Error(`${sig}: words must be text, got ${shown(words)}`);
		const shape = api.text3d(words, number(sig, 'size', size, 0), number(sig, 'depth', depth, 0)) as Shape;
		return new Part([{ shape, loose: true }]).at(0, 0, 0);
	}

	/** A number the window shows as a slider and agents can set by name. */
	function param(name: string, value: number, min = value / 2, max = value * 2, step?: number) {
		const sig = 'param(name, value, min, max, step)';
		if (typeof name !== 'string' || !name) throw new Error(`${sig}: name must be text, got ${shown(name)}`);
		number(sig, 'value', value);
		const set = ctx.values[name];
		const now = typeof set === 'number' && Number.isFinite(set) ? Math.min(Math.max(set, min), max) : value;
		if (!ctx.params.some((p) => p.name === name)) ctx.params.push({ name, value: now, min, max, step: step ?? (Math.abs(max - min) > 20 ? 1 : 0.1) });
		return now;
	}

	/** A model of the library by its title. */
	function model(name: string) {
		return make(api.mesh(name)).at(0, 0, 0);
	}

	/** Another program as one shape, with its parts in their colours: scenes are made of these. `values` set its param()s. */
	function use(name: string, values: Record<string, number> = {}) {
		const source = ctx.programs[name];
		if (source === undefined) throw new Error(`use: no program named «${name}». There are: ${Object.keys(ctx.programs).join(', ') || 'none'}`);
		if (ctx.using.includes(name)) throw new Error(`use: «${name}» uses itself.`);
		const inner = language({ ...ctx, values, params: [], marks: { places: {}, paints: {}, drops: new Set() }, named: [], using: [...ctx.using, name] });
		const seen = { ...api, ...inner.words } as Record<string, unknown>;
		const names = Object.keys(seen);
		// Sloppy around, strict inside: a parameter may not be called eval in strict code.
		const run = new Function(...names, ...SHADOWED, `return (() => { "use strict";\n${source}\n})();`) as (...a: unknown[]) => unknown;
		try {
			const parts = inner.finish(run.apply(Object.freeze({}), [...names.map((n) => seen[n]), ...SHADOWED.map(() => undefined)]));
			return new Part(parts.map((p) => ({ shape: p.shape, color: p.color, loose: (p as Body).loose })));
		} catch (e) {
			throw new Error(`use «${name}»: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/** A part by name, without going through return. */
	function part(name: string, shape: Part) {
		ctx.named.push([name, partArg('part(name, shape)', shape)]);
		return shape;
	}

	/** After everything: moves and turns the part called `name`. The window writes these lines. */
	function place(name: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
		ctx.marks.places[name] = [x, y, z, rx, ry, rz];
	}

	/** After everything: colours the part called `name`. */
	function paint(name: string, color: string) {
		ctx.marks.paints[name] = colorOf('paint(name, color)', color);
	}

	/** After everything: takes away the part called `name`. */
	function drop(name: string) {
		ctx.marks.drops.add(name);
	}

	const words = { box, cyl, cone, ball, torus, pipe, lathe, poly, profile, sweep, loft, soft, hull, bar, rod, text, group, param, model, use, part, place, paint, drop };
	const wrapped = { ...words, ...kit({ ...words, r, mf, api, make, wrapManifold, number, warn, Part }) };

	/** What is in a program's `return`: parts by name, in nested lists and objects too, split by body. */
	function finish(result: unknown): CadPart[] {
		const out: CadPart[] = [];
		const visit = (v: unknown, name: string) => {
			if (v === undefined || v === null || ctx.marks.drops.has(name)) return;
			if (v instanceof Part) {
				const placed = marked(v, name);
				const main = placed.bodies[0].color;
				for (const b of placed.bodies) out.push({ name, shape: b.shape, loose: b.loose, color: b.color === main ? (ctx.marks.paints[name] ?? b.color) : b.color } as CadPart);
			} else if (Array.isArray(v)) v.forEach((item, i) => visit(item, `${name} ${i + 1}`));
			else if (typeof v === 'object' && 'boundingBox' in v) out.push({ name, shape: v as Shape });
			else if (typeof v === 'object' && 'shape' in v) out.push(v as CadPart);
			else if (typeof v === 'object') for (const [k, item] of Object.entries(v)) visit(item, name ? `${name} ${k}` : k);
			else throw new Error(`return a shape, a list of them or { name: shape }, got ${shown(v)}`);
		};
		if (result === undefined && !ctx.named.length) throw new Error('the program returned nothing: end it with return { name: shape }');
		visit(result, Array.isArray(result) || result instanceof Part ? 'part' : '');
		for (const [name, shape] of ctx.named) visit(shape, name);
		if (!out.length) throw new Error('no parts are left');
		return out;
	}

	/** Where the window put this part, on top of what the program says. */
	function marked(part: Part, name: string) {
		const set = ctx.marks.places[name];
		if (!set) return part;
		const [x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0] = set;
		return part.rot(rx, ry, rz).move(x, y, z);
	}

	return { words: wrapped, finish, Part };
}

export type Language = ReturnType<typeof language>;
export type Words = Language['words'];

/** Adds the language to what a program sees. */
export function withLanguage(extra: { values?: Record<string, number>; params: Param[]; programs?: Record<string, string> }, program: ProgramContext, r: R): ProgramContext {
	const warn = (text: string) => void program.warnings?.push(text);
	let finish: Language['finish'];
	return {
		...program,
		lang: (api) => {
			const made = language({ r, mf: program.manifold!, api, warn, values: extra.values ?? {}, params: extra.params, programs: extra.programs ?? {}, using: [], marks: { places: {}, paints: {}, drops: new Set() }, named: [] });
			finish = made.finish;
			return { ...api, ...made.words, sdf: { ...api.sdf, ...sdfApi, mesh: (shape: never, detail?: number) => made.words.group(new made.Part([{ shape: api.sdf.mesh(shape, detail) }])) } } as unknown as CadApi;
		},
		finish: (result) => finish(result)
	};
}
