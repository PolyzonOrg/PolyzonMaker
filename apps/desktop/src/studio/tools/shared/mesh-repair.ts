/**
 * Mesh repair, our own implementation (no third-party repair code): weld
 * the triangle soup, drop degenerate and duplicate faces, optionally cut
 * non-manifold fans, make the winding consistent (BFS over shared edges),
 * close holes (boundary loops → ear clipping, a centre fan as fallback),
 * turn every closed part outward (signed volume) and optionally drop loose
 * bits. Every step reports what it changed. Pure, runs in a worker.
 */
import type { Triangles } from '../stl';
import { earClip } from './mesh-triangulate';
import { unweld } from '../weld';
import * as tc from '$msg/tools/common';

export type RepairMode = 'standard' | 'aggressive' | 'minimal';

export interface RepairOptions {
	mode: RepairMode;
	/** Drop separate parts under 1 % of the largest part's volume. */
	removeShells: boolean;
}

export interface RepairReport {
	/** Copies of the same corner merged into one vertex. */
	weldedVertices: number;
	/** Zero-area triangles removed or folded into their neighbour. */
	degenerate: number;
	duplicates: number;
	/** Faces around edges shared by three or more triangles (aggressive mode). */
	nonManifold: number;
	/** Original faces turned over. */
	flipped: number;
	holesFilled: number;
	holeTriangles: number;
	shellsRemoved: number;
}

/** A mesh being repaired: positions may grow (patch centres), faces are index triplets. */
export interface WorkMesh {
	positions: number[];
	faces: number[];
	/** Per face: 0 original, 1 original turned over, 2 added by the repair. */
	tags: number[];
}

// ---------------------------------------------------------------- basics

/**
 * Weld the soup: corners on the same `tolerance` grid cell become one
 * vertex (as weld.ts does, with a numeric hash — big meshes weld in a blink);
 * triangles that collapse are dropped and counted.
 */
export function toWorkMesh(
	tris: Triangles,
	tolerance = 1e-4
): { mesh: WorkMesh; collapsed: number } {
	const corners = Math.floor(tris.length / 3);
	const inv = 1 / tolerance;
	let size = 1;
	while (size < corners * 2) size <<= 1;
	const mask = size - 1;
	const table = new Int32Array(size).fill(-1);
	const grid = new Float64Array(corners * 3);
	const pos = new Float64Array(corners * 3);
	const idx = new Int32Array(corners);
	let vertices = 0;
	let faceCorners = 0;
	const corner = [0, 0, 0];
	let collapsed = 0;
	for (let t = 0; t + 9 <= tris.length; t += 9) {
		for (let c = 0; c < 3; c++) {
			const x = tris[t + c * 3];
			const y = tris[t + c * 3 + 1];
			const z = tris[t + c * 3 + 2];
			const gx = Math.round(x * inv);
			const gy = Math.round(y * inv);
			const gz = Math.round(z * inv);
			let h =
				(Math.imul(gx | 0, 73856093) ^ Math.imul(gy | 0, 19349663) ^ Math.imul(gz | 0, 83492791)) &
				mask;
			let id = -1;
			for (;;) {
				const at = table[h];
				if (at < 0) {
					id = vertices++;
					table[h] = id;
					grid[3 * id] = gx;
					grid[3 * id + 1] = gy;
					grid[3 * id + 2] = gz;
					pos[3 * id] = x;
					pos[3 * id + 1] = y;
					pos[3 * id + 2] = z;
					break;
				}
				if (grid[3 * at] === gx && grid[3 * at + 1] === gy && grid[3 * at + 2] === gz) {
					id = at;
					break;
				}
				h = (h + 1) & mask;
			}
			corner[c] = id;
		}
		if (corner[0] === corner[1] || corner[1] === corner[2] || corner[0] === corner[2]) collapsed++;
		else {
			idx[faceCorners++] = corner[0];
			idx[faceCorners++] = corner[1];
			idx[faceCorners++] = corner[2];
		}
	}
	const positions = Array.from(pos.subarray(0, vertices * 3));
	const faces = Array.from(idx.subarray(0, faceCorners));
	return {
		mesh: { positions, faces, tags: new Array<number>(faceCorners / 3).fill(0) },
		collapsed
	};
}

export const toTriangles = (mesh: WorkMesh): Triangles =>
	unweld({ positions: mesh.positions, indices: mesh.faces });

/** Faces around each vertex (compressed rows). */
interface Adjacency {
	start: Int32Array;
	list: Int32Array;
}

function adjacency(mesh: WorkMesh): Adjacency {
	const V = mesh.positions.length / 3;
	const start = new Int32Array(V + 1);
	for (const v of mesh.faces) start[v + 1]++;
	for (let v = 0; v < V; v++) start[v + 1] += start[v];
	const fill = start.slice(0, V);
	const list = new Int32Array(mesh.faces.length);
	for (let i = 0; i < mesh.faces.length; i++) list[fill[mesh.faces[i]]++] = Math.floor(i / 3);
	return { start, list };
}

/** Faces using the edge a–b (either direction). */
function edgeFaces(mesh: WorkMesh, adj: Adjacency, a: number, b: number, out: number[]): number[] {
	out.length = 0;
	const f = mesh.faces;
	for (let k = adj.start[a]; k < adj.start[a + 1]; k++) {
		const t = adj.list[k];
		if (f[3 * t] === b || f[3 * t + 1] === b || f[3 * t + 2] === b) out.push(t);
	}
	return out;
}

/** Does face t run a → b? */
function runs(mesh: WorkMesh, t: number, a: number, b: number): boolean {
	const f = mesh.faces;
	const x = f[3 * t];
	const y = f[3 * t + 1];
	const z = f[3 * t + 2];
	return (x === a && y === b) || (y === a && z === b) || (z === a && x === b);
}

function flipFace(mesh: WorkMesh, t: number): void {
	const f = mesh.faces;
	const tmp = f[3 * t + 1];
	f[3 * t + 1] = f[3 * t + 2];
	f[3 * t + 2] = tmp;
	if (mesh.tags[t] < 2) mesh.tags[t] ^= 1;
}

function compact(mesh: WorkMesh, removed: Uint8Array): void {
	const faces: number[] = [];
	const tags: number[] = [];
	for (let t = 0; t < mesh.tags.length; t++) {
		if (removed[t]) continue;
		faces.push(mesh.faces[3 * t], mesh.faces[3 * t + 1], mesh.faces[3 * t + 2]);
		tags.push(mesh.tags[t]);
	}
	mesh.faces = faces;
	mesh.tags = tags;
}

function diagonal(mesh: WorkMesh): number {
	const p = mesh.positions;
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < p.length; i += 3) {
		for (let k = 0; k < 3; k++) {
			min[k] = Math.min(min[k], p[i + k]);
			max[k] = Math.max(max[k], p[i + k]);
		}
	}
	return p.length ? Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) : 0;
}

// ---------------------------------------------------------------- steps

/**
 * Zero-area triangles. A "cap" (three distinct points on one line) is folded
 * into the neighbour across its long edge — the neighbour is split at the
 * middle point, so no gap opens; caps without such a neighbour are dropped.
 */
export function removeDegenerate(mesh: WorkMesh): number {
	const eps = Math.max(diagonal(mesh) * 1e-7, 1e-9);
	let total = 0;
	for (let pass = 0; pass < 5; pass++) {
		const adj = adjacency(mesh);
		const count = mesh.tags.length;
		const removed = new Uint8Array(count + count);
		const touched = new Uint8Array(count + count);
		const p = mesh.positions;
		const f = mesh.faces;
		const scratch: number[] = [];
		let fixed = 0;
		for (let t = 0; t < count; t++) {
			if (removed[t] || touched[t]) continue;
			const i0 = 3 * f[3 * t];
			const i1 = 3 * f[3 * t + 1];
			const i2 = 3 * f[3 * t + 2];
			const ux = p[i1] - p[i0];
			const uy = p[i1 + 1] - p[i0 + 1];
			const uz = p[i1 + 2] - p[i0 + 2];
			const vx = p[i2] - p[i0];
			const vy = p[i2 + 1] - p[i0 + 1];
			const vz = p[i2 + 2] - p[i0 + 2];
			const wx = p[i2] - p[i1];
			const wy = p[i2 + 1] - p[i1 + 1];
			const wz = p[i2 + 2] - p[i1 + 2];
			const edges = [Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(vx, vy, vz)];
			const L = Math.max(edges[0], edges[1], edges[2]);
			const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
			if (L > 0 && area2 / L > eps) continue;
			const ids = [f[3 * t], f[3 * t + 1], f[3 * t + 2]];
			const longest = edges.indexOf(L);
			fixed++;
			removed[t] = 1;
			if (L === 0) continue;
			const u = ids[longest];
			const v = ids[(longest + 1) % 3];
			const mid = ids[(longest + 2) % 3];
			const across = edgeFaces(mesh, adj, u, v, scratch).filter((g) => g !== t);
			if (across.length !== 1) continue;
			const g = across[0];
			if (removed[g] || touched[g]) continue;
			const gi = [f[3 * g], f[3 * g + 1], f[3 * g + 2]];
			const d = gi.find((x) => x !== u && x !== v);
			if (d === undefined || d === mid) {
				removed[g] = 1;
				continue;
			}
			const [a, b] = runs(mesh, g, u, v) ? [u, v] : [v, u];
			f[3 * g] = a;
			f[3 * g + 1] = mid;
			f[3 * g + 2] = d;
			f.push(mid, b, d);
			mesh.tags.push(mesh.tags[g]);
			touched[g] = 1;
			touched[mesh.tags.length - 1] = 1;
		}
		compact(mesh, removed);
		total += fixed;
		if (fixed === 0) break;
	}
	return total;
}

/** The same three vertices twice (in any order): keep the first. */
export function removeDuplicates(mesh: WorkMesh): number {
	const adj = adjacency(mesh);
	const f = mesh.faces;
	const count = mesh.tags.length;
	const removed = new Uint8Array(count);
	let n = 0;
	// Same vertex set: same smallest, largest and sum of the three indices.
	const lo = (t: number) => Math.min(f[3 * t], f[3 * t + 1], f[3 * t + 2]);
	const hi = (t: number) => Math.max(f[3 * t], f[3 * t + 1], f[3 * t + 2]);
	const sum = (t: number) => f[3 * t] + f[3 * t + 1] + f[3 * t + 2];
	for (let t = 0; t < count; t++) {
		const a = lo(t);
		const b = hi(t);
		const c = sum(t);
		for (let k = adj.start[a]; k < adj.start[a + 1]; k++) {
			const g = adj.list[k];
			if (g >= t || removed[g]) continue;
			if (lo(g) === a && hi(g) === b && sum(g) === c) {
				removed[t] = 1;
				n++;
				break;
			}
		}
	}
	compact(mesh, removed);
	return n;
}

/** Faces around edges shared by three or more triangles are cut out (holes get closed later). */
export function removeNonManifold(mesh: WorkMesh): number {
	const adj = adjacency(mesh);
	const f = mesh.faces;
	const count = mesh.tags.length;
	const removed = new Uint8Array(count);
	const scratch: number[] = [];
	for (let t = 0; t < count; t++) {
		for (let k = 0; k < 3; k++) {
			const a = f[3 * t + k];
			const b = f[3 * t + ((k + 1) % 3)];
			if (a > b) continue;
			const around = edgeFaces(mesh, adj, a, b, scratch);
			if (around.length > 2) for (const g of around) removed[g] = 1;
		}
	}
	let n = 0;
	for (const r of removed) n += r;
	compact(mesh, removed);
	return n;
}

/** Make neighbours agree: across every edge with two faces, one runs a→b, the other b→a. */
export function orientConsistently(mesh: WorkMesh): number {
	const adj = adjacency(mesh);
	const f = mesh.faces;
	const count = mesh.tags.length;
	const visited = new Uint8Array(count);
	const queue = new Int32Array(count);
	const scratch: number[] = [];
	let flips = 0;
	for (let seed = 0; seed < count; seed++) {
		if (visited[seed]) continue;
		visited[seed] = 1;
		let head = 0;
		let tail = 0;
		queue[tail++] = seed;
		while (head < tail) {
			const t = queue[head++];
			for (let k = 0; k < 3; k++) {
				const a = f[3 * t + k];
				const b = f[3 * t + ((k + 1) % 3)];
				const around = edgeFaces(mesh, adj, a, b, scratch);
				if (around.length !== 2) continue;
				const g = around[0] === t ? around[1] : around[0];
				if (visited[g]) continue;
				if (runs(mesh, g, a, b)) {
					flipFace(mesh, g);
					flips++;
				}
				visited[g] = 1;
				queue[tail++] = g;
			}
		}
	}
	return flips;
}

/** Close every boundary loop. Returns the number of holes and of triangles added. */
export function fillHoles(mesh: WorkMesh): { holes: number; triangles: number } {
	const adj = adjacency(mesh);
	const f = mesh.faces;
	const count = mesh.tags.length;
	const V = mesh.positions.length / 3;
	const scratch: number[] = [];
	const outgoing = new Map<number, number[]>();
	let boundary = 0;
	for (let t = 0; t < count; t++) {
		for (let k = 0; k < 3; k++) {
			const a = f[3 * t + k];
			const b = f[3 * t + ((k + 1) % 3)];
			if (edgeFaces(mesh, adj, a, b, scratch).length !== 1) continue;
			let list = outgoing.get(a);
			if (!list) outgoing.set(a, (list = []));
			list.push(b);
			boundary++;
		}
	}
	const used = new Set<number>();
	let holes = 0;
	let triangles = 0;
	for (const [start, targets] of outgoing) {
		for (const first of targets) {
			if (used.has(start * V + first)) continue;
			used.add(start * V + first);
			const loop = [start];
			let cur = first;
			let ok = true;
			while (cur !== start) {
				loop.push(cur);
				const next = outgoing.get(cur)?.find((n) => !used.has(cur * V + n));
				if (next === undefined || loop.length > boundary) {
					ok = false;
					break;
				}
				used.add(cur * V + next);
				cur = next;
			}
			if (!ok || loop.length < 3) continue;
			triangles += patch(mesh, loop.reverse());
			holes++;
		}
	}
	return { holes, triangles };
}

/** Triangulate a loop (already in the patch's winding) into the mesh. */
function patch(mesh: WorkMesh, loop: number[]): number {
	const p = mesh.positions;
	const add = (a: number, b: number, c: number) => {
		mesh.faces.push(a, b, c);
		mesh.tags.push(2);
	};
	if (loop.length === 3) {
		add(loop[0], loop[1], loop[2]);
		return 1;
	}
	// Project onto the loop's average plane (Newell normal) and ear-clip.
	let nx = 0;
	let ny = 0;
	let nz = 0;
	let cx = 0;
	let cy = 0;
	let cz = 0;
	const n = loop.length;
	for (let i = 0; i < n; i++) {
		const a = loop[i] * 3;
		const b = loop[(i + 1) % n] * 3;
		nx += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
		ny += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
		nz += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
		cx += p[a];
		cy += p[a + 1];
		cz += p[a + 2];
	}
	const ax = Math.abs(nx);
	const ay = Math.abs(ny);
	const az = Math.abs(nz);
	// Drop the dominant axis of the normal.
	const [i0, i1] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [2, 0];
	let tris: number[] | null = null;
	if (n <= 4000) {
		const xy = new Float64Array(n * 2);
		for (let i = 0; i < n; i++) {
			xy[2 * i] = p[loop[i] * 3 + i0];
			xy[2 * i + 1] = p[loop[i] * 3 + i1];
		}
		tris = earClip(xy);
	}
	if (tris) {
		for (let t = 0; t < tris.length; t += 3)
			add(loop[tris[t]], loop[tris[t + 1]], loop[tris[t + 2]]);
		return tris.length / 3;
	}
	// Fallback: a fan from the loop's centre.
	const c = p.length / 3;
	p.push(cx / n, cy / n, cz / n);
	for (let i = 0; i < n; i++) add(c, loop[i], loop[(i + 1) % n]);
	return n;
}

/** Connected parts (through shared vertices): part id per face. */
function parts(mesh: WorkMesh): { part: Int32Array; count: number } {
	const V = mesh.positions.length / 3;
	const parent = new Int32Array(V);
	for (let i = 0; i < V; i++) parent[i] = i;
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	};
	const f = mesh.faces;
	for (let i = 0; i < f.length; i += 3) {
		const a = find(f[i]);
		parent[find(f[i + 1])] = a;
		parent[find(f[i + 2])] = a;
	}
	const ids = new Map<number, number>();
	const part = new Int32Array(mesh.tags.length);
	for (let t = 0; t < mesh.tags.length; t++) {
		const root = find(f[3 * t]);
		let id = ids.get(root);
		if (id === undefined) ids.set(root, (id = ids.size));
		part[t] = id;
	}
	return { part, count: ids.size };
}

function signedVolumes(mesh: WorkMesh, part: Int32Array, count: number): Float64Array {
	const vol = new Float64Array(count);
	const p = mesh.positions;
	const f = mesh.faces;
	for (let t = 0; t < mesh.tags.length; t++) {
		const a = f[3 * t] * 3;
		const b = f[3 * t + 1] * 3;
		const c = f[3 * t + 2] * 3;
		vol[part[t]] +=
			(p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
				p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
				p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
			6;
	}
	return vol;
}

/**
 * How many times a ray from `o` crosses the faces of part `which`: odd means
 * `o` is inside that part. The direction is skewed so it misses edges.
 */
function crossings(mesh: WorkMesh, part: Int32Array, which: number, o: number[]): number {
	const p = mesh.positions;
	const f = mesh.faces;
	const d = [1, 0.000731, 0.000419];
	let n = 0;
	for (let t = 0; t < part.length; t++) {
		if (part[t] !== which) continue;
		const a = f[3 * t] * 3;
		const b = f[3 * t + 1] * 3;
		const c = f[3 * t + 2] * 3;
		const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
		const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
		const h = [
			d[1] * e2[2] - d[2] * e2[1],
			d[2] * e2[0] - d[0] * e2[2],
			d[0] * e2[1] - d[1] * e2[0]
		];
		const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
		if (Math.abs(det) < 1e-12) continue;
		const s = [o[0] - p[a], o[1] - p[a + 1], o[2] - p[a + 2]];
		const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
		if (u < 0 || u > 1) continue;
		const q = [
			s[1] * e1[2] - s[2] * e1[1],
			s[2] * e1[0] - s[0] * e1[2],
			s[0] * e1[1] - s[1] * e1[0]
		];
		const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
		if (v < 0 || u + v > 1) continue;
		if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 0) n++;
	}
	return n;
}

/**
 * Turn each part the right way: outward, or inward for a part nested inside
 * an odd number of others — the inner surface of a cavity, which must stay
 * a cavity. Only parts the wrong way round are turned.
 */
export function orientOutward(mesh: WorkMesh): number {
	const { part, count } = parts(mesh);
	const vol = signedVolumes(mesh, part, count);
	// A corner of each part, to test how deep it is nested.
	const corner: number[][] = [];
	for (let t = 0; t < part.length; t++) {
		if (corner[part[t]]) continue;
		const a = mesh.faces[3 * t] * 3;
		corner[part[t]] = [mesh.positions[a], mesh.positions[a + 1], mesh.positions[a + 2]];
	}
	const wrong = new Uint8Array(count);
	for (let i = 0; i < count; i++) {
		if (Math.abs(vol[i]) < 1e-9) continue;
		let depth = 0;
		// ponytail: n² part tests; past 50 parts every part is taken as outermost.
		if (count > 1 && count <= 50)
			for (let j = 0; j < count; j++)
				if (j !== i && Math.abs(vol[j]) > 1e-9 && crossings(mesh, part, j, corner[i]) % 2) depth++;
		wrong[i] = vol[i] < 0 === (depth % 2 === 0) ? 1 : 0;
	}
	let flips = 0;
	for (let t = 0; t < mesh.tags.length; t++) {
		if (wrong[part[t]]) {
			flipFace(mesh, t);
			flips++;
		}
	}
	return flips;
}

/** Drop separate parts under `share` of the largest part (by volume, or by faces for open sheets). */
export function removeSmallShells(mesh: WorkMesh, share = 0.01): number {
	const { part, count } = parts(mesh);
	if (count < 2) return 0;
	const vol = signedVolumes(mesh, part, count).map(Math.abs);
	const faces = new Float64Array(count);
	for (let t = 0; t < part.length; t++) faces[part[t]]++;
	// Not Math.max(...): one argument per part overflows the stack on a shattered model.
	const largest = (values: Float64Array) => values.reduce((a, b) => Math.max(a, b));
	const measure = largest(vol) > 1e-9 ? vol : faces;
	const max = largest(measure);
	const drop = measure.map((m) => (m < max * share ? 1 : 0));
	const removed = new Uint8Array(part.length);
	for (let t = 0; t < part.length; t++) removed[t] = drop[part[t]];
	compact(mesh, removed);
	return drop.reduce((s, d) => s + d, 0);
}

// ---------------------------------------------------------------- pipeline

export function repairMesh(
	tris: Triangles,
	options: RepairOptions,
	progress: (stage: string) => void = () => {}
): { tris: Triangles; report: RepairReport } {
	progress(tc.tc_repair_weld());
	const { mesh, collapsed } = toWorkMesh(tris, options.mode === 'aggressive' ? 0.01 : 1e-4);
	const report: RepairReport = {
		weldedVertices: Math.floor(tris.length / 3) - mesh.positions.length / 3,
		degenerate: collapsed,
		duplicates: 0,
		nonManifold: 0,
		flipped: 0,
		holesFilled: 0,
		holeTriangles: 0,
		shellsRemoved: 0
	};
	progress(tc.tc_repair_degenerate());
	report.degenerate += removeDegenerate(mesh);
	progress(tc.tc_repair_duplicates());
	report.duplicates = removeDuplicates(mesh);
	if (options.mode === 'aggressive') {
		progress(tc.tc_repair_non_manifold());
		report.nonManifold = removeNonManifold(mesh);
	}
	if (options.mode !== 'minimal') {
		progress(tc.tc_repair_orient());
		orientConsistently(mesh);
		progress(tc.tc_repair_holes());
		const filled = fillHoles(mesh);
		report.holesFilled = filled.holes;
		report.holeTriangles = filled.triangles;
		orientOutward(mesh);
		report.flipped = mesh.tags.filter((t) => t === 1).length;
	}
	if (options.removeShells) {
		progress(tc.tc_repair_shells());
		report.shellsRemoved = removeSmallShells(mesh);
	}
	return { tris: toTriangles(mesh), report };
}
