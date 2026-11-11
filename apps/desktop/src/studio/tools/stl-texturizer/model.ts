/**
 * «Текстура на модели»: a relief pattern pressed into the surface of an
 * uploaded model. Our own pipeline, written from scratch:
 *
 * 1. weld the triangle soup, so neighbouring faces share their corners;
 * 2. mask faces that look straight down (and, if asked, straight up) — they
 *    stay flat, so the model still sits on the bed;
 * 3. split every edge longer than the target length at its midpoint — the
 *    decision belongs to the edge, so both of its triangles split it the same
 *    way and no crack can open;
 * 4. move every vertex along its smoothed (angle-weighted) normal by the
 *    pattern height at its texture coordinate. One vertex, one move: a closed
 *    model stays closed.
 *
 * Pure, no three.js — the worker and the tests share it.
 */
import { bounds, type Bounds, type Triangles } from '../stl';
import { weld } from '../weld';
import { MeshError, type Progress } from '../voxelizer/worker-job';
import { imageFn, patternFn, type HeightFn, type HeightImage, type PatternId } from './patterns';
import { num } from '$lib/i18n/current';
import * as msg from '$msg/tools/stl-texturizer';
import { clampTo as clamp, smoothstep as smooth } from '../shared/math';

/** auto — blended box projection; around — wrapped around the Z axis; radial —
 *  wrapped around the centre; top / front / side — one straight projection. */
export type Projection = 'auto' | 'around' | 'radial' | 'top' | 'front' | 'side';
export type ReliefSide = 'out' | 'in' | 'both';

export interface TextureParams {
	pattern: PatternId | 'image';
	/** Swap highs and lows of the pattern. */
	invert: boolean;
	/** Relief height, mm */
	depth: number;
	/** Out: adds material; in: pressed into the surface; both: half each way. */
	side: ReliefSide;
	/** One repeat of the pattern, mm */
	tile: number;
	/** Pattern rotation, degrees */
	rotation: number;
	projection: Projection;
	/** Faces looking down (the bed side) keep their shape. */
	smoothBottom: boolean;
	/** Faces looking up keep their shape. */
	smoothTop: boolean;
	/** How far a face may tilt from straight down / up and still count, degrees */
	flatTolerance: number;
	/** Longest edge after subdivision, mm */
	edge: number;
}

export const TEXTURE_DEFAULTS: TextureParams = {
	pattern: 'hexagons',
	invert: false,
	depth: 0.6,
	side: 'out',
	tile: 8,
	rotation: 0,
	projection: 'auto',
	smoothBottom: true,
	smoothTop: false,
	flatTolerance: 12,
	edge: 0.5
};

export const TEXTURE_LIMITS = {
	depth: [0.1, 5] as const,
	tile: [1, 100] as const,
	rotation: [-90, 90] as const,
	flatTolerance: [1, 60] as const,
	edge: [0.1, 5] as const,
	/** Triangles in the result (≈ 75 МБ of STL) */
	maxTriangles: 1_500_000
};

export interface TextureResult {
	tris: Triangles;
	/** Edge length actually used, mm */
	edge: number;
	warnings: string[];
}

/** Indexed mesh being refined; `masked` marks faces that keep their shape. */
export interface WorkMesh {
	pos: Float64Array;
	tri: Uint32Array;
	masked: Uint8Array;
}

/** Faces within `bottom`° of −Z or `top`° of +Z (0 switches a side off). */
export function maskFaces(pos: Float64Array, tri: Uint32Array, bottom: number, top: number) {
	const masked = new Uint8Array(tri.length / 3);
	const cb = bottom > 0 ? Math.cos((bottom * Math.PI) / 180) : 2;
	const ct = top > 0 ? Math.cos((top * Math.PI) / 180) : 2;
	for (let t = 0; t < masked.length; t++) {
		const a = tri[t * 3] * 3;
		const b = tri[t * 3 + 1] * 3;
		const c = tri[t * 3 + 2] * 3;
		const ux = pos[b] - pos[a];
		const uy = pos[b + 1] - pos[a + 1];
		const uz = pos[b + 2] - pos[a + 2];
		const vx = pos[c] - pos[a];
		const vy = pos[c + 1] - pos[a + 1];
		const vz = pos[c + 2] - pos[a + 2];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (!len) continue;
		const z = nz / len;
		if (-z >= cb || z >= ct) masked[t] = 1;
	}
	return masked;
}

/**
 * One round of midpoint splits: every edge longer than √L2 that touches a
 * textured face is halved; triangles re-split by how many of their edges
 * were halved (1 → 2, 2 → 3, 3 → 4). Masked faces only follow the edges they
 * share with textured ones, so a flat bottom stays a few large triangles.
 * Returns null when no edge is long, 'cap' when the result would exceed
 * `maxTriangles`.
 */
export function splitLongEdges(m: WorkMesh, L2: number, maxTriangles: number) {
	const { pos, tri, masked } = m;
	const nv = pos.length / 3;
	const T = tri.length / 3;
	const mids = new Int32Array(tri.length).fill(-1);
	// Edge → midpoint id. Open addressing on typed arrays: a Map with millions
	// of large number keys spends most of its time in the garbage collector.
	let size = 1 << 12;
	while (size < T * 2) size <<= 1; // a closed mesh has 1.5 edges per triangle
	let keyLo = new Int32Array(size).fill(-1);
	let keyHi = new Int32Array(size);
	let value = new Int32Array(size);
	let added = 0;
	const slotOf = (lo: number, hi: number) => {
		let h = Math.imul(lo ^ Math.imul(hi, 0x85ebca6b), 0x9e3779b1);
		h = (h ^ (h >>> 15)) & (size - 1);
		while (keyLo[h] !== -1 && (keyLo[h] !== lo || keyHi[h] !== hi)) h = (h + 1) & (size - 1);
		return h;
	};
	const grow = () => {
		const [lo, hi, val] = [keyLo, keyHi, value];
		size <<= 1;
		keyLo = new Int32Array(size).fill(-1);
		keyHi = new Int32Array(size);
		value = new Int32Array(size);
		for (let i = 0; i < lo.length; i++) {
			if (lo[i] === -1) continue;
			const h = slotOf(lo[i], hi[i]);
			keyLo[h] = lo[i];
			keyHi[h] = hi[i];
			value[h] = val[i];
		}
	};
	for (let pass = 0; pass < 2; pass++) {
		for (let t = 0; t < T; t++) {
			if (masked[t] !== pass) continue;
			for (let e = 0; e < 3; e++) {
				const a = tri[t * 3 + e];
				const b = tri[t * 3 + ((e + 1) % 3)];
				const lo = a < b ? a : b;
				const hi = a < b ? b : a;
				let h = slotOf(lo, hi);
				if (keyLo[h] === -1) {
					if (pass === 1) continue;
					const dx = pos[a * 3] - pos[b * 3];
					const dy = pos[a * 3 + 1] - pos[b * 3 + 1];
					const dz = pos[a * 3 + 2] - pos[b * 3 + 2];
					if (dx * dx + dy * dy + dz * dz <= L2) continue;
					if (added * 4 > size * 3) {
						grow();
						h = slotOf(lo, hi);
					}
					keyLo[h] = lo;
					keyHi[h] = hi;
					value[h] = nv + added++;
				}
				mids[t * 3 + e] = value[h];
			}
		}
	}
	if (!added) return null;
	let count = 0;
	for (let t = 0; t < T; t++) {
		count += 1 + +(mids[t * 3] >= 0) + +(mids[t * 3 + 1] >= 0) + +(mids[t * 3 + 2] >= 0);
	}
	if (count > maxTriangles) return 'cap' as const;

	const nextPos = new Float64Array(pos.length + added * 3);
	nextPos.set(pos);
	for (let i = 0; i < size; i++) {
		if (keyLo[i] === -1) continue;
		const a = keyLo[i] * 3;
		const b = keyHi[i] * 3;
		const o = value[i] * 3;
		nextPos[o] = (pos[a] + pos[b]) / 2;
		nextPos[o + 1] = (pos[a + 1] + pos[b + 1]) / 2;
		nextPos[o + 2] = (pos[a + 2] + pos[b + 2]) / 2;
	}
	const nextTri = new Uint32Array(count * 3);
	const nextMasked = new Uint8Array(count);
	let w = 0;
	const emit = (a: number, b: number, c: number, mask: number) => {
		nextMasked[w / 3] = mask;
		nextTri[w++] = a;
		nextTri[w++] = b;
		nextTri[w++] = c;
	};
	const dist2 = (a: number, b: number) => {
		const dx = nextPos[a * 3] - nextPos[b * 3];
		const dy = nextPos[a * 3 + 1] - nextPos[b * 3 + 1];
		const dz = nextPos[a * 3 + 2] - nextPos[b * 3 + 2];
		return dx * dx + dy * dy + dz * dz;
	};
	const v = [0, 0, 0];
	const md = [0, 0, 0];
	for (let t = 0; t < T; t++) {
		const k = masked[t];
		let splits = 0;
		for (let e = 0; e < 3; e++) {
			v[e] = tri[t * 3 + e];
			md[e] = mids[t * 3 + e];
			if (md[e] >= 0) splits++;
		}
		if (splits === 0) emit(v[0], v[1], v[2], k);
		else if (splits === 3) {
			emit(v[0], md[0], md[2], k);
			emit(md[0], v[1], md[1], k);
			emit(md[2], md[1], v[2], k);
			emit(md[0], md[1], md[2], k);
		} else if (splits === 1) {
			// Turn the triangle so the halved edge is a→b.
			const r = md[0] >= 0 ? 0 : md[1] >= 0 ? 1 : 2;
			const a = v[r];
			const b = v[(r + 1) % 3];
			const c = v[(r + 2) % 3];
			emit(a, md[r], c, k);
			emit(md[r], b, c, k);
		} else {
			// Turn it so the whole edge is c→a; cut corner b, then the shorter diagonal.
			const r = md[0] < 0 ? 0 : md[1] < 0 ? 1 : 2;
			const c = v[r];
			const a = v[(r + 1) % 3];
			const b = v[(r + 2) % 3];
			const mab = md[(r + 1) % 3];
			const mbc = md[(r + 2) % 3];
			emit(mab, b, mbc, k);
			if (dist2(a, mbc) <= dist2(mab, c)) {
				emit(a, mab, mbc, k);
				emit(a, mbc, c, k);
			} else {
				emit(a, mab, c, k);
				emit(mab, mbc, c, k);
			}
		}
	}
	return { pos: nextPos, tri: nextTri, masked: nextMasked };
}

/** Angle-weighted vertex normals: a corner of a box gets the true bisector. */
export function vertexNormals(pos: Float64Array, tri: Uint32Array): Float64Array {
	const n = new Float64Array(pos.length);
	const angle = (dot: number, l1: number, l2: number) =>
		Math.acos(Math.max(-1, Math.min(1, dot / (l1 * l2))));
	for (let t = 0; t < tri.length; t += 3) {
		const a = tri[t] * 3;
		const b = tri[t + 1] * 3;
		const c = tri[t + 2] * 3;
		// Edges a→b, b→c, c→a.
		const x0 = pos[b] - pos[a];
		const y0 = pos[b + 1] - pos[a + 1];
		const z0 = pos[b + 2] - pos[a + 2];
		const x1 = pos[c] - pos[b];
		const y1 = pos[c + 1] - pos[b + 1];
		const z1 = pos[c + 2] - pos[b + 2];
		const x2 = pos[a] - pos[c];
		const y2 = pos[a + 1] - pos[c + 1];
		const z2 = pos[a + 2] - pos[c + 2];
		const l0 = Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0);
		const l1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
		const l2 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2);
		let fx = y2 * z0 - z2 * y0;
		let fy = z2 * x0 - x2 * z0;
		let fz = x2 * y0 - y2 * x0;
		const len = Math.sqrt(fx * fx + fy * fy + fz * fz);
		if (!len || !l0 || !l1 || !l2) continue;
		fx /= len;
		fy /= len;
		fz /= len;
		const wa = angle(-(x0 * x2 + y0 * y2 + z0 * z2), l0, l2);
		const wb = angle(-(x1 * x0 + y1 * y0 + z1 * z0), l1, l0);
		const wc = angle(-(x2 * x1 + y2 * y1 + z2 * z1), l2, l1);
		n[a] += fx * wa;
		n[a + 1] += fy * wa;
		n[a + 2] += fz * wa;
		n[b] += fx * wb;
		n[b + 1] += fy * wb;
		n[b + 2] += fz * wb;
		n[c] += fx * wc;
		n[c + 1] += fy * wc;
		n[c + 2] += fz * wc;
	}
	for (let i = 0; i < n.length; i += 3) {
		const len = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1;
		n[i] /= len;
		n[i + 1] /= len;
		n[i + 2] /= len;
	}
	return n;
}

/** Pattern height at a surface point, by the chosen projection. */
export function projector(
	p: Pick<TextureParams, 'tile' | 'rotation' | 'projection'>,
	height: HeightFn,
	b: Bounds
): (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number {
	const tile = clamp(p.tile, TEXTURE_LIMITS.tile);
	const rad = (clamp(p.rotation, TEXTURE_LIMITS.rotation) * Math.PI) / 180;
	const cos = Math.cos(rad) / tile;
	const sin = Math.sin(rad) / tile;
	// Texture coordinates in mm → rotated → tiles.
	const plane = (s: number, t: number) => height(s * cos - t * sin, s * sin + t * cos);
	const [x0, y0, z0] = b.min;
	const cx = (b.min[0] + b.max[0]) / 2;
	const cy = (b.min[1] + b.max[1]) / 2;
	const cz = (b.min[2] + b.max[2]) / 2;
	// Whole tiles around, so the seam of the wrap is invisible.
	const around = (radius: number) => Math.max(1, Math.round((2 * Math.PI * radius) / tile)) * tile;
	const cylR = Math.max((b.size[0] + b.size[1]) / 4, 1e-6);
	const sphR = Math.max((b.size[0] + b.size[1] + b.size[2]) / 6, 1e-6);
	const cylAround = around(cylR) / (2 * Math.PI);
	const sphAround = around(sphR) / (2 * Math.PI);
	// Each side of the box projection is read from outside, so a picture is not mirrored.
	const side = (x: number, y: number, z: number, axis: number, sign: number) =>
		axis === 0
			? plane(sign * (y - y0), z - z0)
			: axis === 1
				? plane(-sign * (x - x0), z - z0)
				: plane(x - x0, sign * (y - y0));
	switch (p.projection) {
		case 'top':
			return (x, y) => plane(x - x0, y - y0);
		case 'front':
			return (x, _y, z) => plane(x - x0, z - z0);
		case 'side':
			return (_x, y, z) => plane(y - y0, z - z0);
		case 'around':
			return (x, y, z, _nx, _ny, nz) => {
				const wrapAround = plane(Math.atan2(y - cy, x - cx) * cylAround, z - z0);
				// The caps take a top-down projection, blended in over a band of slopes.
				const cap = smooth(0.55, 0.8, Math.abs(nz));
				return cap ? (1 - cap) * wrapAround + cap * plane(x - x0, y - y0) : wrapAround;
			};
		case 'radial':
			return (x, y, z) => {
				const dx = x - cx;
				const dy = y - cy;
				const dz = z - cz;
				const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
				return plane(Math.atan2(dy, dx) * sphAround, Math.acos(dz / r) * sphR);
			};
		default:
			return (x, y, z, nx, ny, nz) => {
				// Auto: three box projections blended by how the surface faces.
				const wx = nx ** 4;
				const wy = ny ** 4;
				const wz = nz ** 4;
				const sum = wx + wy + wz || 1;
				let h = 0;
				if (wx > 1e-3) h += wx * side(x, y, z, 0, Math.sign(nx) || 1);
				if (wy > 1e-3) h += wy * side(x, y, z, 1, Math.sign(ny) || 1);
				if (wz > 1e-3) h += wz * side(x, y, z, 2, Math.sign(nz) || 1);
				return h / sum;
			};
	}
}

const dist = (pos: Float64Array, i: number, j: number) => {
	const dx = pos[i] - pos[j];
	const dy = pos[i + 1] - pos[j + 1];
	const dz = pos[i + 2] - pos[j + 2];
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/** Mean area of a triangle once its longest edge is at most L, ≈ k·L². */
const AREA_PER_TRIANGLE = 0.17;

export function texturize(
	tris: Triangles,
	params: TextureParams,
	image: HeightImage | null = null,
	progress?: Progress
): TextureResult {
	const warnings: string[] = [];
	const depth = clamp(params.depth, TEXTURE_LIMITS.depth);
	const b = bounds(tris);
	const welded = weld(tris);
	if (!welded.indices.length) throw new MeshError(msg.t_stl_texturizer_no_triangles());
	if (welded.indices.length / 3 > TEXTURE_LIMITS.maxTriangles * 0.8) {
		throw new MeshError(msg.t_stl_texturizer_too_many_triangles());
	}
	let m: WorkMesh = {
		pos: Float64Array.from(welded.positions),
		tri: welded.indices,
		masked: new Uint8Array(0)
	};
	m.masked = maskFaces(
		m.pos,
		m.tri,
		params.smoothBottom ? clamp(params.flatTolerance, TEXTURE_LIMITS.flatTolerance) : 0,
		params.smoothTop ? clamp(params.flatTolerance, TEXTURE_LIMITS.flatTolerance) : 0
	);

	// Area to texture → how fine the mesh can get within the triangle budget.
	let area = 0;
	let longest = 0;
	for (let t = 0; t < m.masked.length; t++) {
		if (m.masked[t]) continue;
		const p = m.tri[t * 3] * 3;
		const q = m.tri[t * 3 + 1] * 3;
		const r = m.tri[t * 3 + 2] * 3;
		const ab = dist(m.pos, p, q);
		const bc = dist(m.pos, q, r);
		const ca = dist(m.pos, r, p);
		const s = (ab + bc + ca) / 2;
		area += Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)));
		longest = Math.max(longest, ab, bc, ca);
	}
	if (!area) {
		throw new MeshError(msg.t_stl_texturizer_nothing_to_texture());
	}
	let edge = clamp(params.edge, TEXTURE_LIMITS.edge);
	const budget = TEXTURE_LIMITS.maxTriangles * 0.9 - m.masked.length;
	const finest = Math.sqrt(area / (AREA_PER_TRIANGLE * Math.max(budget, 1)));
	const enlarged = finest > edge;
	if (enlarged) edge = Math.ceil(finest * 100) / 100;

	const passes = Math.max(1, Math.ceil(Math.log2(Math.max(longest / edge, 1))));
	let capped = false;
	for (let pass = 0; ; pass++) {
		progress?.(msg.t_stl_texturizer_stage_split(), Math.min(60, (pass / passes) * 60));
		const next = splitLongEdges(m, edge * edge, TEXTURE_LIMITS.maxTriangles);
		if (!next) break;
		if (next === 'cap') {
			capped = true;
			break;
		}
		m = next;
	}
	const limit = fmt(TEXTURE_LIMITS.maxTriangles / 1e6);
	if (capped) {
		warnings.push(msg.t_stl_texturizer_warn_capped({ limit }));
	} else if (enlarged) {
		warnings.push(msg.t_stl_texturizer_warn_enlarged({ edge: fmt(edge), limit }));
	}

	const stageRelief = msg.t_stl_texturizer_stage_relief();
	progress?.(stageRelief, 65);
	const normals = vertexNormals(m.pos, m.tri);
	const nv = m.pos.length / 3;
	const pinned = new Uint8Array(nv);
	for (let t = 0; t < m.masked.length; t++) {
		if (!m.masked[t]) continue;
		pinned[m.tri[t * 3]] = 1;
		pinned[m.tri[t * 3 + 1]] = 1;
		pinned[m.tri[t * 3 + 2]] = 1;
	}
	const height = projector(
		params,
		params.pattern === 'image' && image ? imageFn(image) : patternFn(params.pattern as PatternId),
		b
	);
	const pos = m.pos;
	for (let v = 0; v < nv; v++) {
		if ((v & 0x3ffff) === 0) progress?.(stageRelief, 65 + (v / nv) * 30);
		if (pinned[v]) continue;
		const i = v * 3;
		const nx = normals[i];
		const ny = normals[i + 1];
		const nz = normals[i + 2];
		let h = height(pos[i], pos[i + 1], pos[i + 2], nx, ny, nz);
		if (params.invert) h = 1 - h;
		const offset =
			params.side === 'in'
				? -depth * (1 - h)
				: params.side === 'both'
					? depth * (h - 0.5)
					: depth * h;
		pos[i] += nx * offset;
		pos[i + 1] += ny * offset;
		pos[i + 2] += nz * offset;
	}

	if (depth > 0.2 * Math.min(...b.size.filter((s) => s > 0))) {
		warnings.push(msg.t_stl_texturizer_warn_thin());
	}
	if (edge > clamp(params.tile, TEXTURE_LIMITS.tile) / 6) {
		warnings.push(msg.t_stl_texturizer_warn_coarse());
	}

	const out = new Float32Array(m.tri.length * 3);
	for (let i = 0; i < m.tri.length; i++) {
		const v = m.tri[i] * 3;
		out[i * 3] = pos[v];
		out[i * 3 + 1] = pos[v + 1];
		out[i * 3 + 2] = pos[v + 2];
	}
	return { tris: out, edge, warnings };
}

const fmt = (n: number) => num(n, 2);
