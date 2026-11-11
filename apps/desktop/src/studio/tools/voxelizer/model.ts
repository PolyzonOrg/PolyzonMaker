/**
 * «Вокселизатор»: a model → cubes on a regular grid, Minecraft style.
 *
 * Inside or outside is decided at every cell centre by ray parity: rays run
 * along each grid axis, every triangle flips the cells behind its hit, and
 * the majority of the three axes wins — a small hole in the mesh leaves no
 * streak. Only faces between a filled and an empty cell are written, so the
 * STL has no inner walls; cells that would meet only along an edge or at a
 * corner are joined first, so the surface closes on itself everywhere.
 * Pure, no three.js — the worker and the tests share it.
 */
import { bounds, type Triangles } from '../stl';
import { weld } from '../weld';
import * as m from '$msg/tools/voxelizer';
import { MeshError, type Progress } from './worker-job';
import { clampTo as clamp } from '../shared/math';

export type VoxelSizing = 'resolution' | 'size';

export interface VoxelParams {
	/** Set the cube by a count along the longest side or by its size in mm. */
	sizing: VoxelSizing;
	/** Cubes along the longest side of the model */
	resolution: number;
	/** Cube edge, mm */
	voxelSize: number;
	/** Keep only the outer layer of cubes (closed cavity inside). */
	hollow: boolean;
}

export const VOXEL_DEFAULTS: VoxelParams = {
	sizing: 'resolution',
	resolution: 48,
	voxelSize: 2,
	hollow: false
};

export const VOXEL_LIMITS = {
	resolution: [8, 200] as const,
	voxelSize: [0.2, 20] as const,
	/** Cells of the bounding grid (bytes of memory per array). */
	maxCells: 12_000_000,
	/** Square faces in the result: two triangles each, 50 bytes per triangle in STL. */
	maxFaces: 750_000
};

export interface VoxelGrid {
	n: [number, number, number];
	/** Cube edge, mm */
	size: number;
	/** Corner of cell (0, 0, 0), mm */
	origin: [number, number, number];
}

export interface VoxelModel {
	grid: VoxelGrid;
	/** 1 = filled, index x + nx·(y + ny·z) */
	cells: Uint8Array;
	/** Filled cells */
	voxels: number;
	/** The outer faces of the cubes as triangles */
	tris: Triangles;
}

/** The grid that covers the model, centred on its bounds. */
export function voxelGrid(tris: Triangles, p: VoxelParams): VoxelGrid {
	const b = bounds(tris);
	const longest = Math.max(...b.size);
	if (!(longest > 0)) throw new MeshError(m.t_voxelizer_empty_model());
	const size =
		p.sizing === 'size'
			? clamp(p.voxelSize, VOXEL_LIMITS.voxelSize)
			: longest / Math.round(clamp(p.resolution, VOXEL_LIMITS.resolution));
	const n = b.size.map((s) => Math.max(1, Math.ceil(s / size - 1e-6))) as [number, number, number];
	const origin = b.min.map((m, i) => m + (b.size[i] - n[i] * size) / 2) as [number, number, number];
	return { n, size, origin };
}

/**
 * Inside test along one axis: cells whose centre has an odd number of
 * surface crossings before it on the ray from the grid's start.
 */
function parityAlong(tris: Triangles, g: VoxelGrid, a: number, report: (f: number) => void) {
	const b = (a + 1) % 3;
	const c = (a + 2) % 3;
	const n = g.n;
	const stride = [1, n[0], n[0] * n[1]];
	const flips = new Uint8Array(n[0] * n[1] * n[2]);
	// Ray positions are nudged off the exact cell centre by an odd fraction so
	// a ray does not run exactly through an edge or a corner of a grid-aligned
	// model and count one crossing twice.
	const eb = 0.5 + 1.4142e-4;
	const ec = 0.5 + 1.7321e-4;
	const inv = 1 / g.size;
	const [oa, ob, oc] = [g.origin[a], g.origin[b], g.origin[c]];
	const count = tris.length / 9;
	for (let t = 0; t < count; t++) {
		if ((t & 0xffff) === 0) report(t / count);
		const o = t * 9;
		const a0 = (tris[o + a] - oa) * inv;
		const b0 = (tris[o + b] - ob) * inv;
		const c0 = (tris[o + c] - oc) * inv;
		const a1 = (tris[o + 3 + a] - oa) * inv;
		const b1 = (tris[o + 3 + b] - ob) * inv;
		const c1 = (tris[o + 3 + c] - oc) * inv;
		const a2 = (tris[o + 6 + a] - oa) * inv;
		const b2 = (tris[o + 6 + b] - ob) * inv;
		const c2 = (tris[o + 6 + c] - oc) * inv;
		const det = (b1 - b0) * (c2 - c0) - (b2 - b0) * (c1 - c0);
		if (Math.abs(det) < 1e-12) continue; // edge-on to the ray
		const j0 = Math.max(0, Math.ceil(Math.min(b0, b1, b2) - eb));
		const j1 = Math.min(n[b] - 1, Math.floor(Math.max(b0, b1, b2) - eb));
		const k0 = Math.max(0, Math.ceil(Math.min(c0, c1, c2) - ec));
		const k1 = Math.min(n[c] - 1, Math.floor(Math.max(c0, c1, c2) - ec));
		for (let j = j0; j <= j1; j++) {
			const pb = j + eb - b0;
			for (let k = k0; k <= k1; k++) {
				const pc = k + ec - c0;
				const w1 = (pb * (c2 - c0) - (b2 - b0) * pc) / det;
				const w2 = ((b1 - b0) * pc - pb * (c1 - c0)) / det;
				if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
				const hit = a0 + (a1 - a0) * w1 + (a2 - a0) * w2;
				// First cell whose centre lies beyond the hit.
				const i = Math.max(0, Math.floor(hit - 0.5) + 1);
				if (i >= n[a]) continue;
				flips[i * stride[a] + j * stride[b] + k * stride[c]] ^= 1;
			}
		}
	}
	// Running parity along every ray.
	for (let j = 0; j < n[b]; j++) {
		for (let k = 0; k < n[c]; k++) {
			let inside = 0;
			const base = j * stride[b] + k * stride[c];
			for (let i = 0; i < n[a]; i++) {
				const at = base + i * stride[a];
				inside ^= flips[at];
				flips[at] = inside;
			}
		}
	}
	return flips;
}

/** Filled cells of a closed (or nearly closed) mesh: majority of three axes. */
export function fillCells(tris: Triangles, g: VoxelGrid, progress?: Progress): Uint8Array {
	const votes = new Uint8Array(g.n[0] * g.n[1] * g.n[2]);
	for (let a = 0; a < 3; a++) {
		const along = parityAlong(tris, g, a, (f) =>
			progress?.(m.t_voxelizer_stage_layout(), (a + f) * 30)
		);
		for (let i = 0; i < votes.length; i++) votes[i] += along[i];
	}
	for (let i = 0; i < votes.length; i++) votes[i] = votes[i] >= 2 ? 1 : 0;
	return votes;
}

/** The cells whose six neighbours are all filled (one layer peeled off). */
function erode(cells: Uint8Array, g: VoxelGrid): Uint8Array {
	const [nx, ny, nz] = g.n;
	const sy = nx;
	const sz = nx * ny;
	const out = new Uint8Array(cells.length);
	for (let z = 1; z < nz - 1; z++) {
		for (let y = 1; y < ny - 1; y++) {
			for (let x = 1; x < nx - 1; x++) {
				const i = x + y * sy + z * sz;
				if (
					cells[i] &&
					cells[i - 1] &&
					cells[i + 1] &&
					cells[i - sy] &&
					cells[i + sy] &&
					cells[i - sz] &&
					cells[i + sz]
				)
					out[i] = 1;
			}
		}
	}
	return out;
}

/**
 * Only a shell of cells next to the outside stays: as many layers as make
 * 0.8 mm (two nozzle lines), so small cubes still give a wall a slicer prints.
 */
export function hollowCells(cells: Uint8Array, g: VoxelGrid): Uint8Array {
	const layers = Math.max(1, Math.ceil(0.8 / g.size - 1e-9));
	let core = cells;
	for (let k = 0; k < layers; k++) core = erode(core, g);
	const out = cells.slice();
	for (let i = 0; i < out.length; i++) if (core[i]) out[i] = 0;
	return out;
}

/**
 * Join cells that meet only along an edge or at a corner (and empty cells
 * that do the same): such an edge would carry four faces and such a corner
 * two separate fans — a slicer reads both as broken geometry. Adds cells
 * until no such place is left.
 */
export function joinTouchingCells(cells: Uint8Array, g: VoxelGrid): number {
	const [nx, ny, nz] = g.n;
	const s = [1, nx, nx * ny];
	let added = 0;
	for (let round = 0; round < 64; round++) {
		let changed = 0;
		// Edges: a 2×2 block across each axis with filled cells on one diagonal only.
		for (let e = 0; e < 3; e++) {
			const p = (e + 1) % 3;
			const q = (e + 2) % 3;
			const sp = s[p];
			const sq = s[q];
			const lim = [nx, ny, nz];
			lim[p]--;
			lim[q]--;
			for (let z = 0; z < lim[2]; z++) {
				for (let y = 0; y < lim[1]; y++) {
					for (let x = 0; x < lim[0]; x++) {
						const i = x + y * s[1] + z * s[2];
						const a = cells[i];
						const d = cells[i + sp + sq];
						const b = cells[i + sp];
						const c = cells[i + sq];
						if (a === d && b === c && a !== b) {
							cells[a ? i + sp : i] = 1;
							changed++;
						}
					}
				}
			}
		}
		// Corners: a 2×2×2 block where two opposite cells differ from the other six.
		for (let z = 0; z < nz - 1; z++) {
			for (let y = 0; y < ny - 1; y++) {
				for (let x = 0; x < nx - 1; x++) {
					const i = x + y * s[1] + z * s[2];
					let filled = 0;
					let mask = 0;
					for (let k = 0; k < 8; k++) {
						if (cells[i + (k & 1) * s[0] + ((k >> 1) & 1) * s[1] + (k >> 2) * s[2]]) {
							filled++;
							mask |= 1 << k;
						}
					}
					if (filled !== 2 && filled !== 6) continue;
					const odd = filled === 2 ? mask : ~mask & 0xff;
					const k = Math.log2(odd & -odd);
					if (odd !== ((1 << k) | (1 << (7 - k)))) continue;
					// Fill a neighbour of the lone filled cell, or the lone empty cell.
					const fill = filled === 2 ? k ^ 1 : k;
					cells[i + (fill & 1) * s[0] + ((fill >> 1) & 1) * s[1] + (fill >> 2) * s[2]] = 1;
					changed++;
				}
			}
		}
		added += changed;
		if (!changed) break;
	}
	return added;
}

const SIDES = [-1, 1];

/** Faces between a filled and an empty cell, two triangles each, wound outwards. */
export function cellFaces(cells: Uint8Array, g: VoxelGrid): Triangles {
	const [nx, ny, nz] = g.n;
	const s = [1, nx, nx * ny];
	const filled = (x: number, y: number, z: number) =>
		x >= 0 &&
		y >= 0 &&
		z >= 0 &&
		x < nx &&
		y < ny &&
		z < nz &&
		cells[x + y * s[1] + z * s[2]] === 1;
	let faces = 0;
	for (let z = 0; z < nz; z++)
		for (let y = 0; y < ny; y++)
			for (let x = 0; x < nx; x++) {
				if (!cells[x + y * s[1] + z * s[2]]) continue;
				faces +=
					+!filled(x - 1, y, z) +
					+!filled(x + 1, y, z) +
					+!filled(x, y - 1, z) +
					+!filled(x, y + 1, z) +
					+!filled(x, y, z - 1) +
					+!filled(x, y, z + 1);
			}
	if (faces > VOXEL_LIMITS.maxFaces) {
		throw new MeshError(m.t_voxelizer_too_many_faces());
	}
	const out = new Float32Array(faces * 18);
	let w = 0;
	const corner = [0, 0, 0];
	const put = (a: number, b: number, c: number, pa: number, pb: number, pc: number) => {
		corner[a] = pa;
		corner[b] = pb;
		corner[c] = pc;
		for (let k = 0; k < 3; k++) out[w++] = g.origin[k] + corner[k] * g.size;
	};
	// Corner order of the face seen from outside (counter-clockwise).
	const plus = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
	const minus = [0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1];
	const at = [0, 0, 0];
	for (let z = 0; z < nz; z++)
		for (let y = 0; y < ny; y++)
			for (let x = 0; x < nx; x++) {
				if (!cells[x + y * s[1] + z * s[2]]) continue;
				at[0] = x;
				at[1] = y;
				at[2] = z;
				for (let a = 0; a < 3; a++) {
					const b = (a + 1) % 3;
					const c = (a + 2) % 3;
					for (const side of SIDES) {
						at[a] += side;
						const open = !filled(at[0], at[1], at[2]);
						at[a] -= side;
						if (!open) continue;
						const plane = at[a] + (side > 0 ? 1 : 0);
						const order = side > 0 ? plus : minus;
						for (let v = 0; v < 6; v++) {
							put(a, b, c, plane, at[b] + order[v * 2], at[c] + order[v * 2 + 1]);
						}
					}
				}
			}
	return out;
}

/** The whole pipeline, as the worker runs it. */
export function voxelize(tris: Triangles, p: VoxelParams, progress?: Progress): VoxelModel {
	const grid = voxelGrid(tris, p);
	if (grid.n[0] * grid.n[1] * grid.n[2] > VOXEL_LIMITS.maxCells) {
		throw new MeshError(m.t_voxelizer_grid_too_big());
	}
	let cells = fillCells(tris, grid, progress);
	progress?.(m.t_voxelizer_stage_stitch(), 90);
	if (p.hollow) cells = hollowCells(cells, grid);
	joinTouchingCells(cells, grid);
	let voxels = 0;
	for (let i = 0; i < cells.length; i++) voxels += cells[i];
	if (!voxels) {
		throw new MeshError(m.t_voxelizer_no_cubes());
	}
	progress?.(m.t_voxelizer_stage_stitch(), 95);
	return { grid, cells, voxels, tris: cellFaces(cells, grid) };
}

/** Wavefront OBJ with shared vertices (much smaller than the triangle soup). */
export function toObj(tris: Triangles, name = 'voxels'): string {
	const mesh = weld(tris);
	const lines: string[] = [`# Polyzon Studio`, `o ${name}`];
	const p = mesh.positions;
	const r = (v: number) => String(Math.round(v * 1e4) / 1e4);
	for (let i = 0; i < p.length; i += 3) lines.push(`v ${r(p[i])} ${r(p[i + 1])} ${r(p[i + 2])}`);
	const f = mesh.indices;
	for (let i = 0; i < f.length; i += 3) lines.push(`f ${f[i] + 1} ${f[i + 1] + 1} ${f[i + 2] + 1}`);
	return lines.join('\n') + '\n';
}
