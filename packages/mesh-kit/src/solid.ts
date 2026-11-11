/**
 * A generator's model made one solid body for printing. What comes out of a generator is often a skin
 * rather than a body: hollow under it (an inner shell turned inward), torn, with loose flaps and layers
 * lying over each other. manifold may even call that closed; a slicer finds walls thinner than its nozzle
 * and prints a few scraps.
 *
 * So the surface is drawn into a voxel grid, everything the outside cannot reach is filled, and a new
 * surface is taken where the outside meets it (marching tetrahedra, closed by construction). Tears are
 * sealed by a closing: the surface is thickened by a radius before the outside floods in, and the outside
 * then grows back by the same radius. The radius grows only while a wider one fills clearly more of the
 * body, so gaps that need no sealing, between legs or fingers, stay open. Where the generator's surface is
 * the body's outside, the new one follows it by its exact distance, so the detail stays; the closing shapes
 * only what it filled. What is left inside, a skin under the skin or a void, is gone.
 */
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { MeshKitError } from './errors.js';
import { pointTriangle2 } from './sdf.js';
import { bounds, type Triangles } from './stl.js';

/** Voxels in the grid at most: 11 bytes each of work memory, and the new surface. */
export const MAX_SOLID_VOXELS = 12e6;
/** Closing radii tried, in voxels: the narrowest first. */
const CLOSINGS = [1.5, 3, 6, 12];
/** A wider closing is taken while the narrower one leaves the body under this share of the widest one's. */
const WHOLE = 0.7;
/** A voxel centre this close to a face is on the surface, voxels: half the cube's diagonal, so no ray slips through a face between voxels. */
const SHELL = 0.87;
/**
 * Where the outside ends, voxels beyond the closing radius: the surface's own thickness (SHELL) and half
 * a voxel, as distances run between voxel centres. Measured on a sphere (solid.test.ts).
 */
const OFFSET = 1;
const FAR = 1e20;
/** How far from the generator's surface its own distance is kept, voxels. */
const BAND = 2;

export interface Solid {
	solid: Manifold;
	/** Grid step, in the model's units */
	voxel: number;
	/** How far the closing reached from the surface, in the model's units: tears up to twice this wide were sealed */
	close: number;
}

/** The finest grid step for a model this size within `budget` voxels, the margin of `pad` voxels a side included. */
export function solidVoxel(size: readonly number[], budget = MAX_SOLID_VOXELS): number {
	const pad = margin();
	let voxel = Math.max(...size, 1e-6) / 64;
	// halving and back: a few steps to the finest that fits
	while (cells(size, voxel / 1.1, pad) <= budget) voxel /= 1.1;
	while (cells(size, voxel, pad) > budget) voxel *= 1.1;
	return voxel;
}

const margin = () => Math.ceil(CLOSINGS[CLOSINGS.length - 1] + SHELL + OFFSET) + 2;
const cells = (size: readonly number[], voxel: number, pad: number) => size.reduce((n, s) => n * (Math.ceil(s / voxel) + 2 * pad), 1);

export async function solidify(wasm: ManifoldToplevel, tris: Triangles, budget = MAX_SOLID_VOXELS): Promise<Solid> {
	if (tris.length < 9) throw new MeshKitError('empty-result', 'no faces');
	const b = bounds(tris);
	const voxel = solidVoxel(b.size, budget);
	const pad = margin();
	const dims = b.size.map((s) => Math.ceil(s / voxel) + 2 * pad) as [number, number, number];
	const origin = b.min.map((v) => v - pad * voxel) as [number, number, number];
	const grid: Grid = { dims, origin, voxel };
	const count = dims[0] * dims[1] * dims[2];

	// the generator's surface: how far each voxel near it is, and the voxels on it
	const surface = draw(tris, grid);
	const on = Math.floor((SHELL / BAND) * 254);
	// squared distance to the surface, voxels², kept up to 255: only the closings need it
	const work = new Float32Array(count);
	for (let i = 0; i < count; i++) work[i] = surface[i] <= on ? 0 : FAR;
	distances(work, dims);
	const near = new Uint8Array(count);
	for (let i = 0; i < count; i++) near[i] = Math.min(255, work[i]);

	const outside = new Uint8Array(count);
	const queue = new Int32Array(count);
	const bodyFor = (c: number) => {
		flood(near, c * c, dims, outside, queue);
		for (let i = 0; i < count; i++) work[i] = outside[i] ? 0 : FAR;
		distances(work, dims);
		const edge = (c + OFFSET) ** 2;
		let body = 0;
		for (let i = 0; i < count; i++) if (work[i] > edge) body++;
		return body;
	};
	const widest = bodyFor(CLOSINGS[CLOSINGS.length - 1]);
	if (!widest) throw new MeshKitError('empty-result', 'nothing to fill');
	let close = CLOSINGS[CLOSINGS.length - 1];
	for (const c of CLOSINGS.slice(0, -1))
		if (bodyFor(c) >= WHOLE * widest) {
			close = c;
			break;
		}
	if (close === CLOSINGS[CLOSINGS.length - 1]) bodyFor(close);

	// where the body is, voxels from its surface, positive inside: what the closing left, blurred, since distances
	// between voxel centres step by a fraction of a voxel along a slanted surface
	for (let i = 0; i < count; i++) work[i] = Math.sqrt(work[i]) - close - OFFSET;
	smooth(work, dims);
	smooth(work, dims);
	const field = new Float32Array(queue.buffer, 0, count);
	along(field, work, surface, dims);
	const { positions, indices } = march(field, grid);
	taubin(positions, indices, 10);
	// the surface kept within a tenth of a voxel: finer faces carry nothing a nozzle prints and slow every later step
	await MeshoptSimplifier.ready;
	const [fewer] = MeshoptSimplifier.simplify(indices, positions, 3, 0, voxel * 0.1, ['ErrorAbsolute']);
	const made = closedSolid(wasm, positions, fewer) ?? closedSolid(wasm, positions, indices);
	if (!made) throw new MeshKitError('empty-result', 'the solid is not closed');
	return { solid: filled(wasm, made), voxel, close: (close + SHELL) * voxel };
}

/** Without voids: a surface turned inward, wherever one came from, encloses nothing that is printed. */
function filled(wasm: ManifoldToplevel, solid: Manifold): Manifold {
	const parts = solid.decompose();
	const kept = parts.filter((part) => part.volume() > 0);
	if (kept.length === parts.length) {
		parts.forEach((part) => part.delete());
		return solid;
	}
	const whole = wasm.Manifold.compose(kept);
	parts.forEach((part) => part.delete());
	solid.delete();
	return whole;
}

/** A closed solid of positive volume from these faces, the corners they leave out dropped; or null. */
function closedSolid(wasm: ManifoldToplevel, positions: Float32Array, indices: Uint32Array): Manifold | null {
	const used = new Int32Array(positions.length / 3).fill(-1);
	const corners: number[] = [];
	const faces = new Uint32Array(indices.length);
	for (let i = 0; i < indices.length; i++) {
		const v = indices[i];
		if (used[v] < 0) {
			used[v] = corners.length / 3;
			corners.push(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
		}
		faces[i] = used[v];
	}
	let solid: Manifold;
	try {
		solid = new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: Float32Array.from(corners), triVerts: faces }));
	} catch {
		return null;
	}
	if (solid.status() === 'NoError' && !solid.isEmpty() && solid.volume() > 0) return solid;
	solid.delete();
	return null;
}

interface Grid {
	dims: [number, number, number];
	origin: [number, number, number];
	voxel: number;
}

/** The corners of a cube, x + 2y + 4z, in six tetrahedra around its diagonal: every cube is split alike, so the pieces meet. */
const TETS = [
	[0, 1, 3, 7],
	[0, 1, 5, 7],
	[0, 2, 3, 7],
	[0, 2, 6, 7],
	[0, 4, 5, 7],
	[0, 4, 6, 7]
];

/**
 * The surface where `f` (sampled at voxel centres) is 0, by marching tetrahedra: the zero set of a function
 * linear on each tetrahedron of a consistent split, so closed and manifold by construction, with corners
 * shared through the edge they lie on. Faces turn outward, toward negative `f`.
 */
function march(f: Float32Array, { dims: [nx, ny, nz], origin, voxel }: Grid): { positions: Float32Array; indices: Uint32Array } {
	const slab = nx * ny;
	const offset = [0, 1, nx, 1 + nx, slab, 1 + slab, nx + slab, 1 + nx + slab];
	const positions: number[] = [];
	const indices: number[] = [];
	const made = new Map<number, number>();
	const at = new Array<number>(8);
	// the corner where the edge from corner u to corner v (u's bits within v's) crosses zero
	const cross = (base: number, u: number, v: number) => {
		const a = base + offset[u];
		const key = a * 8 + (u ^ v);
		let id = made.get(key);
		if (id === undefined) {
			const fa = f[a];
			const t = Math.min(0.99, Math.max(0.01, fa / (fa - f[base + offset[v]])));
			const i = a % nx;
			const j = ((a - i) / nx) % ny;
			const k = (a - i - j * nx) / slab;
			const d = u ^ v;
			id = positions.length / 3;
			positions.push(
				origin[0] + (i + 0.5 + t * (d & 1)) * voxel,
				origin[1] + (j + 0.5 + t * ((d >> 1) & 1)) * voxel,
				origin[2] + (k + 0.5 + t * ((d >> 2) & 1)) * voxel
			);
			made.set(key, id);
		}
		return id;
	};
	const face = (a: number, b: number, c: number, inside: number[], outside: number[]) => {
		// outward: toward the outside corners
		const p = (n: number, k: number) => positions[3 * n + k];
		const e1 = [0, 1, 2].map((k) => p(b, k) - p(a, k));
		const e2 = [0, 1, 2].map((k) => p(c, k) - p(a, k));
		const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
		let out = 0;
		for (let k = 0; k < 3; k++) {
			const bit = 1 << k;
			const toward = outside.reduce((s, c) => s + (c & bit ? 1 : 0), 0) / outside.length - inside.reduce((s, c) => s + (c & bit ? 1 : 0), 0) / inside.length;
			out += n[k] * toward;
		}
		if (out >= 0) indices.push(a, b, c);
		else indices.push(a, c, b);
	};
	for (let k = 0; k < nz - 1; k++)
		for (let j = 0; j < ny - 1; j++)
			for (let i = 0; i < nx - 1; i++) {
				const base = (k * ny + j) * nx + i;
				let inside = 0;
				for (let c = 0; c < 8; c++) {
					at[c] = f[base + offset[c]];
					if (at[c] > 0) inside++;
				}
				if (inside === 0 || inside === 8) continue;
				for (const tet of TETS) {
					const ins = tet.filter((c) => at[c] > 0);
					if (ins.length === 0 || ins.length === 4) continue;
					const outs = tet.filter((c) => at[c] <= 0);
					// an edge is always taken from the corner earlier in the tetrahedron, whose bits lie within the other's
					const edge = (u: number, v: number) => (u < v ? cross(base, u, v) : cross(base, v, u));
					if (ins.length === 2) {
						const [a, b] = ins;
						const [c, d] = outs;
						const q = [edge(a, c), edge(a, d), edge(b, d), edge(b, c)];
						face(q[0], q[1], q[2], ins, outs);
						face(q[0], q[2], q[3], ins, outs);
					} else {
						const lone = ins.length === 1 ? ins[0] : outs[0];
						const rest = tet.filter((c) => c !== lone);
						face(edge(lone, rest[0]), edge(lone, rest[1]), edge(lone, rest[2]), ins, outs);
					}
				}
			}
	return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** Each voxel's distance to the nearest face, in BAND / 254 steps of a voxel; 255 beyond BAND. */
function draw(tris: Triangles, { dims, origin, voxel }: Grid): Uint8Array {
	const [nx, ny, nz] = dims;
	const on = new Uint8Array(nx * ny * nz).fill(255);
	const reach = (BAND * voxel) ** 2;
	const step = 254 / (BAND * voxel);
	const lo = (v: number, k: number) => Math.max(0, Math.floor((v - origin[k]) / voxel - 0.5 - BAND));
	const hi = (v: number, k: number, n: number) => Math.min(n - 1, Math.ceil((v - origin[k]) / voxel - 0.5 + BAND));
	for (let t = 0; t + 8 < tris.length; t += 9) {
		const x0 = lo(Math.min(tris[t], tris[t + 3], tris[t + 6]), 0);
		const x1 = hi(Math.max(tris[t], tris[t + 3], tris[t + 6]), 0, nx);
		const y0 = lo(Math.min(tris[t + 1], tris[t + 4], tris[t + 7]), 1);
		const y1 = hi(Math.max(tris[t + 1], tris[t + 4], tris[t + 7]), 1, ny);
		const z0 = lo(Math.min(tris[t + 2], tris[t + 5], tris[t + 8]), 2);
		const z1 = hi(Math.max(tris[t + 2], tris[t + 5], tris[t + 8]), 2, nz);
		for (let k = z0; k <= z1; k++) {
			const pz = origin[2] + (k + 0.5) * voxel;
			for (let j = y0; j <= y1; j++) {
				const py = origin[1] + (j + 0.5) * voxel;
				const row = (k * ny + j) * nx;
				for (let i = x0; i <= x1; i++) {
					if (on[row + i] === 0) continue;
					const d2 = pointTriangle2(tris, t, origin[0] + (i + 0.5) * voxel, py, pz);
					if (d2 < reach) on[row + i] = Math.min(on[row + i], Math.round(Math.sqrt(d2) * step));
				}
			}
		}
	}
	return on;
}

/** The outside: voxels farther than √`free2` from the surface that the grid's border reaches through such voxels. */
function flood(near: Uint8Array, free2: number, [nx, ny, nz]: [number, number, number], outside: Uint8Array, queue: Int32Array) {
	outside.fill(0);
	let head = 0;
	let tail = 0;
	const visit = (i: number) => {
		if (!outside[i] && near[i] > free2) {
			outside[i] = 1;
			queue[tail++] = i;
		}
	};
	// the margin is wider than any closing, so the whole border is outside and starts the flood
	for (let k = 0; k < nz; k++)
		for (let j = 0; j < ny; j++)
			for (let i = 0; i < nx; i++)
				if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) visit((k * ny + j) * nx + i);
	const slab = nx * ny;
	while (head < tail) {
		const at = queue[head++];
		const i = at % nx;
		const j = ((at - i) / nx) % ny;
		const k = (at - i - j * nx) / slab;
		if (i > 0) visit(at - 1);
		if (i < nx - 1) visit(at + 1);
		if (j > 0) visit(at - nx);
		if (j < ny - 1) visit(at + nx);
		if (k > 0) visit(at - slab);
		if (k < nz - 1) visit(at + slab);
	}
}

/**
 * Squared Euclidean distance, voxels², from every voxel to the nearest one at 0, in place
 * (Felzenszwalb and Huttenlocher, Distance Transforms of Sampled Functions, 2012): one pass per axis.
 */
function distances(grid: Float32Array, [nx, ny, nz]: [number, number, number]) {
	const longest = Math.max(nx, ny, nz);
	const line = new Float64Array(longest);
	const out = new Float64Array(longest);
	const v = new Int32Array(longest);
	const z = new Float64Array(longest + 1);
	const pass = (n: number, lines: number, start: (l: number) => number, stride: number) => {
		for (let l = 0; l < lines; l++) {
			const s = start(l);
			let any = false;
			for (let q = 0; q < n; q++) {
				line[q] = grid[s + q * stride];
				if (line[q] < FAR) any = true;
			}
			if (!any) continue;
			lower(line, n, out, v, z);
			for (let q = 0; q < n; q++) grid[s + q * stride] = out[q];
		}
	};
	pass(nx, ny * nz, (l) => l * nx, 1);
	pass(ny, nx * nz, (l) => (l % nx) + Math.floor(l / nx) * nx * ny, nx);
	pass(nz, nx * ny, (l) => l, nx * ny);
}

/**
 * The final distance, voxels, positive inside. Where the generator's surface is the body's outside, its own
 * exact distance, on the side the outside lies (the closing's distance falls that way); elsewhere, the
 * closing's distance: in a sealed hole, and around a skin left inside the body or a flap that is now in it.
 */
function along(field: Float32Array, body: Float32Array, surface: Uint8Array, [nx, ny]: [number, number, number]) {
	const slab = nx * ny;
	for (let i = 0; i < field.length; i++) {
		const g = body[i];
		const q = surface[i];
		let f = g;
		if (q < 255) {
			const d = (q / 254) * BAND;
			// only the body's own outside: a skin deeper in, under the outer one, is left to the closing
			if (g < 0.75 && Math.abs(Math.abs(g) - d) < 0.5) {
				// right by the surface the closing's sign is a guess: which way the surface's distance grows tells it
				let inside = g > 0;
				if (Math.abs(g) < 0.3) {
					const dot =
						(surface[i + 1] - surface[i - 1]) * (body[i + 1] - body[i - 1]) +
						(surface[i + nx] - surface[i - nx]) * (body[i + nx] - body[i - nx]) +
						(surface[i + slab] - surface[i - slab]) * (body[i + slab] - body[i - slab]);
					if (dot !== 0) inside = dot > 0;
				}
				f = inside ? d : -d;
			}
		}
		// never exactly on the surface, so every crossing lies between two corners
		field[i] = f || 1e-6;
	}
}

/**
 * Taubin's smoothing (Curve and Surface Smoothing Without Shrinkage, 1995) in place: each corner moves toward
 * the middle of its neighbours and back a little further, so the surface loses the tetrahedra's creases and keeps its size.
 */
function taubin(positions: Float32Array, indices: Uint32Array, rounds: number) {
	const n = positions.length / 3;
	const start = new Uint32Array(n + 1);
	for (let i = 0; i < indices.length; i++) start[indices[i] + 1] += 2;
	for (let v = 0; v < n; v++) start[v + 1] += start[v];
	const fill = start.slice(0, n);
	const next = new Uint32Array(start[n]);
	for (let t = 0; t < indices.length; t += 3)
		for (let e = 0; e < 3; e++) {
			const a = indices[t + e];
			const b = indices[t + (e === 2 ? 0 : e + 1)];
			const c = indices[t + (e === 0 ? 2 : e - 1)];
			next[fill[a]++] = b;
			next[fill[a]++] = c;
		}
	const moved = new Float32Array(positions.length);
	for (let r = 0; r < 2 * rounds; r++) {
		const k = r % 2 ? -0.53 : 0.5;
		for (let v = 0; v < n; v++) {
			let x = 0;
			let y = 0;
			let z = 0;
			const from = start[v];
			const to = start[v + 1];
			for (let i = from; i < to; i++) {
				const u = 3 * next[i];
				x += positions[u];
				y += positions[u + 1];
				z += positions[u + 2];
			}
			const m = to - from || 1;
			moved[3 * v] = positions[3 * v] + k * (x / m - positions[3 * v]);
			moved[3 * v + 1] = positions[3 * v + 1] + k * (y / m - positions[3 * v + 1]);
			moved[3 * v + 2] = positions[3 * v + 2] + k * (z / m - positions[3 * v + 2]);
		}
		positions.set(moved);
	}
}

/** A ¼ ½ ¼ blur along each axis in place, the ends held. */
function smooth(grid: Float32Array, [nx, ny, nz]: [number, number, number]) {
	const line = new Float32Array(Math.max(nx, ny, nz));
	const pass = (n: number, lines: number, start: (l: number) => number, stride: number) => {
		for (let l = 0; l < lines; l++) {
			const s = start(l);
			for (let q = 0; q < n; q++) line[q] = grid[s + q * stride];
			for (let q = 1; q < n - 1; q++) grid[s + q * stride] = 0.25 * line[q - 1] + 0.5 * line[q] + 0.25 * line[q + 1];
		}
	};
	pass(nx, ny * nz, (l) => l * nx, 1);
	pass(ny, nx * nz, (l) => (l % nx) + Math.floor(l / nx) * nx * ny, nx);
	pass(nz, nx * ny, (l) => l, nx * ny);
}

/** The lower envelope of parabolas over one line: d[q] = min over p of (q − p)² + f[p]. */
function lower(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
	let k = 0;
	let first = 0;
	while (first < n && f[first] >= FAR) first++;
	v[0] = first;
	z[0] = -Infinity;
	z[1] = Infinity;
	for (let q = first + 1; q < n; q++) {
		if (f[q] >= FAR) continue;
		let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
		while (s <= z[k]) {
			k--;
			s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
		}
		k++;
		v[k] = q;
		z[k] = s;
		z[k + 1] = Infinity;
	}
	k = 0;
	for (let q = 0; q < n; q++) {
		while (z[k + 1] < q) k++;
		d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
	}
}
