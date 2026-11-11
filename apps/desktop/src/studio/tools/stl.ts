import { saveFile } from '$lib/save';
/**
 * STL in, STL out, and the numbers people ask about a model. Geometry is a
 * plain triangle soup: `Float32Array` of xyz triples, 9 floats per triangle,
 * counter-clockwise seen from outside. Pure functions, no three.js — the
 * tools, the workers and the tests share them.
 */

import { ToolError } from './build.svelte';
import * as tc from '$msg/tools/common';

export type Triangles = Float32Array;

const textDecoder = new TextDecoder();

/** Binary or ASCII STL → triangles. Throws on anything that is not an STL. */
export function parseStl(input: ArrayBuffer | Uint8Array): Triangles {
	const steps = parseSteps(input);
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
	}
}

/**
 * parseStl for a request handler: an ASCII file (a 40 MB one is seconds of regex
 * work) gives the event loop a turn every 50 000 vertices instead of holding it.
 */
export async function parseStlYielding(input: ArrayBuffer | Uint8Array): Promise<Triangles> {
	const steps = parseSteps(input);
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

function* parseSteps(input: ArrayBuffer | Uint8Array): Generator<void, Triangles> {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	if (bytes.byteLength >= 84) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const count = view.getUint32(80, true);
		// A binary STL is exactly 84 + 50·n bytes; ASCII files start with «solid»
		// but so do some binary ones, so the size decides.
		if (84 + count * 50 === bytes.byteLength) {
			const out = new Float32Array(count * 9);
			for (let i = 0; i < count; i++) {
				const base = 84 + i * 50 + 12; // skip the stored normal
				for (let k = 0; k < 9; k++) out[i * 9 + k] = view.getFloat32(base + k * 4, true);
			}
			return out;
		}
	}
	const text = textDecoder.decode(bytes);
	if (!/^\s*solid/i.test(text)) throw new ToolError(tc.tc_not_stl());
	const values: number[] = [];
	const vertex = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
	for (let m, n = 0; (m = vertex.exec(text)); ) {
		values.push(+m[1], +m[2], +m[3]);
		if (++n % 50_000 === 0) yield;
	}
	if (values.length === 0 || values.length % 9 !== 0) throw new ToolError(tc.tc_stl_no_triangles());
	return new Float32Array(values);
}

/** Triangles → binary STL (facet normals computed from the winding). */
export function writeStl(tris: Triangles, header = 'Polyzon Studio'): Uint8Array {
	const count = Math.floor(tris.length / 9);
	const out = new Uint8Array(84 + count * 50);
	const view = new DataView(out.buffer);
	const head = new TextEncoder().encode(header.slice(0, 79));
	out.set(head, 0);
	view.setUint32(80, count, true);
	for (let i = 0; i < count; i++) {
		const t = i * 9;
		const ux = tris[t + 3] - tris[t];
		const uy = tris[t + 4] - tris[t + 1];
		const uz = tris[t + 5] - tris[t + 2];
		const vx = tris[t + 6] - tris[t];
		const vy = tris[t + 7] - tris[t + 1];
		const vz = tris[t + 8] - tris[t + 2];
		let nx = uy * vz - uz * vy;
		let ny = uz * vx - ux * vz;
		let nz = ux * vy - uy * vx;
		const len = Math.hypot(nx, ny, nz) || 1;
		nx /= len;
		ny /= len;
		nz /= len;
		const base = 84 + i * 50;
		view.setFloat32(base, nx, true);
		view.setFloat32(base + 4, ny, true);
		view.setFloat32(base + 8, nz, true);
		for (let k = 0; k < 9; k++) view.setFloat32(base + 12 + k * 4, tris[t + k], true);
	}
	return out;
}

export interface Bounds {
	min: [number, number, number];
	max: [number, number, number];
	size: [number, number, number];
}

export function bounds(tris: Triangles): Bounds {
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < tris.length; i += 3) {
		for (let k = 0; k < 3; k++) {
			const v = tris[i + k];
			if (v < min[k]) min[k] = v;
			if (v > max[k]) max[k] = v;
		}
	}
	if (tris.length === 0) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
	return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** A copy moved by (dx, dy, dz). */
export function translate(tris: Triangles, dx: number, dy: number, dz: number): Triangles {
	const out = new Float32Array(tris.length);
	for (let i = 0; i < tris.length; i += 3) {
		out[i] = tris[i] + dx;
		out[i + 1] = tris[i + 1] + dy;
		out[i + 2] = tris[i + 2] + dz;
	}
	return out;
}

/** A copy centred on X/Y and standing on Z = 0, as a slicer places it. */
export function placeOnBed(tris: Triangles): Triangles {
	const b = bounds(tris);
	return translate(tris, -(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]);
}

/** Several parts in one STL (e.g. a box and its lid side by side). */
export function merge(parts: Triangles[]): Triangles {
	const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** Parts laid out along X with a gap, all on the bed, centred as a group. */
export function layoutInRow(parts: Triangles[], gap = 10): Triangles {
	let x = 0;
	const placed = parts.map((p) => {
		const b = bounds(p);
		const moved = translate(p, x - b.min[0], -(b.min[1] + b.max[1]) / 2, -b.min[2]);
		x += b.size[0] + gap;
		return moved;
	});
	const all = merge(placed);
	const b = bounds(all);
	return translate(all, -(b.min[0] + b.max[0]) / 2, 0, 0);
}

/**
 * A set of parts on printer beds of `bed` × `bed` mm: rows left to right,
 * a new row when one is full, a new bed when the rows are; centred on each.
 * A part larger than the bed gets a bed of its own.
 */
export function packOnBeds(parts: Triangles[], bed: number, gap = 4): Triangles[] {
	const beds: Triangles[][] = [[]];
	let x = 0;
	let y = 0;
	let row = 0;
	for (const p of parts) {
		const b = bounds(p);
		if (x > 0 && x + b.size[0] > bed) {
			x = 0;
			y += row + gap;
			row = 0;
		}
		if (y > 0 && y + b.size[1] > bed) {
			beds.push([]);
			x = y = row = 0;
		}
		beds[beds.length - 1].push(translate(p, x - b.min[0], y - b.min[1], -b.min[2]));
		x += b.size[0] + gap;
		row = Math.max(row, b.size[1]);
	}
	return beds.filter((set) => set.length).map((set) => placeOnBed(merge(set)));
}

export interface MeshStats {
	triangles: number;
	bounds: Bounds;
	/** mm² */
	area: number;
	/** mm³, absolute (a mesh turned inside out still reports its volume) */
	volume: number;
	/** Volume-weighted centre; the bounds centre for an open mesh. */
	centerOfMass: [number, number, number];
	/** Edges used by one triangle only — holes in the surface. */
	openEdges: number;
	/** Edges shared by three or more triangles. */
	nonManifoldEdges: number;
	/** Triangles with (almost) zero area. */
	degenerate: number;
	/**
	 * Edges whose two triangles run the same way along them: one of the two is
	 * turned inside out, so the volume (and the slicer) cannot be trusted.
	 */
	misoriented: number;
	/** The mesh closes on itself: no open or non-manifold edges. */
	watertight: boolean;
}

/** Vertex key on a 1 µm grid, so coincident corners of separate triangles meet. */
function key(x: number, y: number, z: number): string {
	return `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
}

export function meshStats(tris: Triangles): MeshStats {
	const count = Math.floor(tris.length / 9);
	let area = 0;
	let volume6 = 0;
	let cx = 0;
	let cy = 0;
	let cz = 0;
	let degenerate = 0;
	const edges = new Map<string, number>();
	/** Per edge: +1 for each use from the lower vertex id, −1 the other way. */
	const ways = new Map<string, number>();
	const ids = new Map<string, number>();
	const id = (x: number, y: number, z: number) => {
		const k = key(x, y, z);
		let v = ids.get(k);
		if (v === undefined) {
			v = ids.size;
			ids.set(k, v);
		}
		return v;
	};
	for (let i = 0; i < count; i++) {
		const t = i * 9;
		const ax = tris[t];
		const ay = tris[t + 1];
		const az = tris[t + 2];
		const bx = tris[t + 3];
		const by = tris[t + 4];
		const bz = tris[t + 5];
		const qx = tris[t + 6];
		const qy = tris[t + 7];
		const qz = tris[t + 8];
		const ux = bx - ax;
		const uy = by - ay;
		const uz = bz - az;
		const vx = qx - ax;
		const vy = qy - ay;
		const vz = qz - az;
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		const a2 = Math.hypot(nx, ny, nz);
		if (a2 < 1e-9) degenerate++;
		area += a2 / 2;
		// Signed tetrahedron volume against the origin (×6).
		const v6 = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
		volume6 += v6;
		cx += v6 * (ax + bx + qx);
		cy += v6 * (ay + by + qy);
		cz += v6 * (az + bz + qz);
		const a = id(ax, ay, az);
		const b = id(bx, by, bz);
		const c = id(qx, qy, qz);
		// A sliver whose corners meet on the grid would count its one real edge
		// twice, and a closed CAD mesh would read as non-manifold: it is no face.
		if (a === b || b === c || c === a) continue;
		for (const [p, q] of [
			[a, b],
			[b, c],
			[c, a]
		]) {
			const ek = p < q ? `${p}_${q}` : `${q}_${p}`;
			edges.set(ek, (edges.get(ek) ?? 0) + 1);
			ways.set(ek, (ways.get(ek) ?? 0) + (p < q ? 1 : -1));
		}
	}
	let openEdges = 0;
	let nonManifoldEdges = 0;
	let misoriented = 0;
	for (const [ek, n] of edges) {
		if (n === 1) openEdges++;
		else if (n > 2) nonManifoldEdges++;
		else if (ways.get(ek) !== 0) misoriented++;
	}
	const b = bounds(tris);
	const volume = Math.abs(volume6) / 6;
	const center: [number, number, number] =
		Math.abs(volume6) > 1e-9
			? [cx / (4 * volume6), cy / (4 * volume6), cz / (4 * volume6)]
			: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
	return {
		triangles: count,
		bounds: b,
		area,
		volume,
		centerOfMass: center,
		openEdges,
		nonManifoldEdges,
		degenerate,
		misoriented,
		watertight: openEdges === 0 && nonManifoldEdges === 0
	};
}

/**
 * The app whose built-in browser this page is open in, or null. Telegram's
 * and VK's in-app browsers mostly ignore a download link, so a tool says so
 * up front (ToolShell) and offers the system share sheet where it exists.
 */
export function inAppBrowser(): string | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as Record<string, unknown>;
	const ua = navigator.userAgent;
	if (w.TelegramWebviewProxy || w.TelegramWebview || /Telegram/i.test(ua)) return 'Telegram';
	if (/VKAndroidApp|VKClient|vkontakte/i.test(ua)) return 'VK';
	if (/Instagram/i.test(ua)) return 'Instagram';
	if (/FBAN|FBAV/.test(ua)) return 'Facebook';
	return null;
}

/** Save bytes as a file in the browser. */
export function downloadBytes(bytes: Uint8Array | string, filename: string, _mime: string): void {
	void saveFile(filename, bytes);
}
