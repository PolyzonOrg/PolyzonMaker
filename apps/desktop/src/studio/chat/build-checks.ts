/**
 * What the platform measures on every build (render_openscad, build_cad) and
 * tells the assistant as warnings: a doubt about the picture becomes a
 * number. Mesh-level, so it works the same for OpenSCAD and CAD; the CAD
 * worker adds what only the B-rep knows (parts that hang in the air, a cut
 * that cut nothing, the fillet radius that would work). Pure: unit-tested.
 */
import type { MeshStats, Triangles } from '$lib/tools/stl';
import { weld } from '$lib/tools/weld';
import { rayHit } from '$lib/cad/program';

/** Thinner than this a 0.4 mm nozzle prints a wall badly or not at all. */
export const MIN_WALL_MM = 0.8;
/** Faces looking down more steeply than 45° from the vertical need supports. */
const OVERHANG_NZ = -Math.SQRT1_2;
/** Overhangs worth a word: this share of the surface and more. */
const OVERHANG_SHARE = 0.08;
/** Thin samples worth a word: this share of them and more. */
const THIN_SHARE = 0.03;
/** Ray–triangle tests the wall probe may spend on one mesh (about a second in the page). */
const WALL_BUDGET = 6_000_000;

const mm = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');

/**
 * Bodies of a mesh that do not touch: shells joined through shared corners;
 * with `touching`, also shells whose boxes meet — parts set against each
 * other count as one.
 * ponytail: box contact, so a ring floating round a post counts as touching;
 * the CAD worker measures real distances between solid parts.
 */
export function separateBodies(tris: Triangles, touching = true): number {
	const { indices, positions } = weld(tris, 1e-3);
	const parent = Int32Array.from({ length: positions.length / 3 }, (_, i) => i);
	const find = (i: number): number => {
		while (parent[i] !== i) i = parent[i] = parent[parent[i]];
		return i;
	};
	for (let t = 0; t < indices.length; t += 3) {
		const a = find(indices[t]);
		parent[find(indices[t + 1])] = a;
		parent[find(indices[t + 2])] = a;
	}
	const boxes = new Map<number, number[]>();
	for (let t = 0; t < indices.length; t++) {
		const v = indices[t];
		const root = find(v);
		const b = boxes.get(root) ?? [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
		for (let k = 0; k < 3; k++) {
			b[k] = Math.min(b[k], positions[v * 3 + k]);
			b[k + 3] = Math.max(b[k + 3], positions[v * 3 + k]);
		}
		boxes.set(root, b);
	}
	const roots = [...boxes.keys()];
	if (touching) {
		const meet = (a: number[], b: number[]) =>
			[0, 1, 2].every((k) => a[k] <= b[k + 3] + 0.2 && b[k] <= a[k + 3] + 0.2);
		for (const a of roots) {
			for (const b of roots) {
				if (a < b && meet(boxes.get(a)!, boxes.get(b)!)) parent[find(b)] = find(a);
			}
		}
	}
	return new Set(roots.map(find)).size;
}

type V3 = [number, number, number];

/** How far apart two boxes are (0 when they meet or overlap). */
function boxGap(a: { min: V3; max: V3 }, b: { min: V3; max: V3 }): number {
	const d = [0, 1, 2].map((k) => Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]));
	return Math.hypot(d[0], d[1], d[2]);
}

/**
 * Parts of a CAD build that hang in the air: groups of parts that touch
 * each other (exact `distance` where boxes meet) but neither another group
 * nor the bed. Distances past `budgetMs` count as touching — a missed
 * warning, never a false one.
 */
export function floatingParts(
	parts: Array<{ name: string; min: V3; max: V3 }>,
	distance: (i: number, j: number) => number,
	budgetMs = 3000
): string[] {
	if (parts.length < 2) return [];
	const parent = parts.map((_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	const until = Date.now() + budgetMs;
	for (let i = 0; i < parts.length; i++) {
		for (let j = i + 1; j < parts.length; j++) {
			if (find(i) === find(j) || boxGap(parts[i], parts[j]) > 0.1) continue;
			if (Date.now() > until || distance(i, j) <= 0.05) parent[find(j)] = find(i);
		}
	}
	const bed = Math.min(...parts.map((p) => p.min[2]));
	const groups = new Map<number, number[]>();
	parts.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
	const out: string[] = [];
	for (const members of groups.values()) {
		if (members.some((i) => parts[i].min[2] <= bed + 0.05)) continue;
		let nearest = -1;
		let gap = Infinity;
		for (const i of members) {
			parts.forEach((p, j) => {
				if (members.includes(j)) return;
				const g = boxGap(parts[i], p);
				if (g < gap) [gap, nearest] = [g, j];
			});
		}
		const names = members.map((i) => `«${parts[i].name}»`).join(', ');
		out.push(
			`${names} ${members.length > 1 ? 'hang' : 'hangs'} in the air: touching neither the bed nor the other parts` +
				(nearest >= 0
					? ` (nearest: «${parts[nearest].name}»${gap > 0 ? `, gap ≈ ${mm(gap)} mm` : ''})`
					: '') +
				'. Move it into contact or join it with a connecting piece.'
		);
	}
	return out;
}

/** Warnings about a closed or open mesh; `hasParts`: the CAD worker reports bodies per part itself. */
export function meshWarnings(tris: Triangles, stats: MeshStats, hasParts = false): string[] {
	const out: string[] = [];
	const minZ = stats.bounds.min[2];
	if (Math.abs(minZ) > 0.05) {
		out.push(
			`The part does not stand on the bed: its lowest point is at Z = ${mm(minZ)} mm, not 0. Move it so the bottom is at Z = 0.`
		);
	}
	if (!hasParts) {
		const bodies = separateBodies(tris);
		if (bodies > 1) {
			out.push(
				`${bodies} separate bodies that do not touch each other. If this is meant to be one part, some piece hangs apart (a gap or a missing join); parts meant to print side by side are fine.`
			);
		}
	}
	const over = overhangs(tris, minZ, stats.area);
	if (over) out.push(over);
	if (stats.watertight) {
		const thin = thinWalls(tris);
		if (thin) out.push(thin);
	}
	return out;
}

function overhangs(tris: Triangles, minZ: number, area: number): string | null {
	let down = 0;
	let low = Infinity;
	let high = -Infinity;
	for (let t = 0; t + 8 < tris.length; t += 9) {
		const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.subarray(t, t + 9);
		// Faces lying on the bed are the first layer, not an overhang.
		if (Math.max(az, bz, cz) - minZ < 0.3) continue;
		const ux = bx - ax,
			uy = by - ay,
			uz = bz - az;
		const vx = cx - ax,
			vy = cy - ay,
			vz = cz - az;
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		const len = Math.hypot(nx, ny, nz);
		if (len === 0 || nz / len > OVERHANG_NZ) continue;
		down += len / 2;
		low = Math.min(low, az, bz, cz);
		high = Math.max(high, az, bz, cz);
	}
	if (area <= 0 || down / area < OVERHANG_SHARE) return null;
	return `For printing: about ${Math.round((100 * down) / area)} % of the surface overhangs more than 45° (faces looking down above the bed, Z ${mm(low)}–${mm(high)} mm), so it needs supports. Normal for a figurine or a curved body; a technical part avoids them with a 45° slope or another way up.`;
}

/**
 * Wall thickness where it matters: from points spread over the surface by
 * area, a ray goes inward and meets the other side of the wall.
 */
function thinWalls(tris: Triangles): string | null {
	const count = Math.floor(tris.length / 9);
	if (count === 0) return null;
	const samples = Math.max(32, Math.min(256, Math.floor(WALL_BUDGET / count)));
	const areas = new Float64Array(count);
	let total = 0;
	for (let t = 0; t < count; t++) {
		const o = t * 9;
		const ux = tris[o + 3] - tris[o],
			uy = tris[o + 4] - tris[o + 1],
			uz = tris[o + 5] - tris[o + 2];
		const vx = tris[o + 6] - tris[o],
			vy = tris[o + 7] - tris[o + 1],
			vz = tris[o + 8] - tris[o + 2];
		total += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
		areas[t] = total;
	}
	const vertices = Array.from(tris);
	const triangles = Array.from({ length: count * 3 }, (_, i) => i);
	let thin = 0;
	let probed = 0;
	let thinnest = Infinity;
	let where: number[] = [];
	for (let s = 0; s < samples; s++) {
		// Evenly by area: the sample lands on the face that holds this share of it.
		const target = ((s + 0.5) / samples) * total;
		let lo = 0;
		let hi = count - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (areas[mid] < target) lo = mid + 1;
			else hi = mid;
		}
		const o = lo * 9;
		const c = [0, 1, 2].map((k) => (tris[o + k] + tris[o + 3 + k] + tris[o + 6 + k]) / 3);
		const u = [0, 1, 2].map((k) => tris[o + 3 + k] - tris[o + k]);
		const v = [0, 1, 2].map((k) => tris[o + 6 + k] - tris[o + k]);
		const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
		const len = Math.hypot(n[0], n[1], n[2]);
		if (len === 0) continue;
		const inward: [number, number, number] = [-n[0] / len, -n[1] / len, -n[2] / len];
		const start: [number, number, number] = [
			c[0] + inward[0] * 1e-3,
			c[1] + inward[1] * 1e-3,
			c[2] + inward[2] * 1e-3
		];
		const hit = rayHit(vertices, triangles, start, inward);
		if (!hit) continue;
		probed++;
		if (hit.distance < MIN_WALL_MM) {
			thin++;
			if (hit.distance < thinnest) {
				thinnest = hit.distance;
				where = c;
			}
		}
	}
	if (probed === 0 || thin / probed < THIN_SHARE) return null;
	return `Walls thinner than ${mm(MIN_WALL_MM)} mm in about ${Math.round((100 * thin) / probed)} % of the surface (thinnest ≈ ${mm(thinnest)} mm, near X ${mm(where[0])}, Y ${mm(where[1])}, Z ${mm(where[2])}): a 0.4 mm nozzle prints them poorly or not at all. Thicken them, unless they are meant as fine detail.`;
}
