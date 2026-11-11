/**
 * `body` for CAD programs: a smooth body through cross-sections along an
 * axis — a car body, a fuselage, a wing, a bottle, a vase, a handle, a hull.
 * Each station is a superellipse (n = 2 an ellipse, 4–6 a rounded
 * rectangle), so a weak model fills a table of sizes instead of drawing
 * splines.
 *
 * Between stations every size runs on a monotone cubic — smooth, and never
 * past its neighbours, so the body cannot bulge out of its own sections — and
 * the surface is a mesh built here and handed to Manifold. An OpenCascade loft
 * of the same took seconds, a boolean between two of them eleven, a rounding
 * of one minutes: cars and gliders timed out on prod. A mesh body builds and
 * cuts in milliseconds; it has no edges to round and no STEP.
 */
import type * as Replicad from 'replicad';
import type { ManifoldToplevel } from 'manifold-3d';

type R = typeof Replicad;

export interface Station {
	/** Position along the axis, mm. */
	at: number;
	/** Width (across, first of the plane's two axes) and height (second), mm. */
	w: number;
	h: number;
	/** Superellipse exponent: 2 an ellipse (default), 3–6 a rounded rectangle. */
	n?: number;
	/** Centre of the section off the axis, mm (first and second plane axis). */
	u?: number;
	v?: number;
}

const SIG = "body([{ at, w, h, n, u, v }, …], { axis: 'x' | 'y' | 'z' })";
/** Points around each section. */
const AROUND = 48;
/** Sections along the whole body, at least: the stations plus as many between. */
const ALONG = 96;

/** A section point (a, b in the section's plane, `at` along the axis) in space. */
const PLACE = {
	x: (at: number, a: number, b: number) => [at, a, b],
	y: (at: number, a: number, b: number) => [a, at, b],
	z: (at: number, a: number, b: number) => [a, b, at]
} as const;

function checked(stations: unknown, axis: unknown): Required<Station>[] {
	if (!Array.isArray(stations) || stations.length < 2) {
		throw new Error(`${SIG}: needs at least two stations`);
	}
	if (!(typeof axis === 'string' && axis in PLACE)) {
		throw new Error(`${SIG}: axis must be 'x', 'y' or 'z', got ${JSON.stringify(axis)}`);
	}
	const out = stations.map((s: Station, i) => {
		const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
		if (
			!s ||
			!ok(s.at) ||
			!(s.w > 0) ||
			!(s.h > 0) ||
			[s.n, s.u, s.v].some((v) => v !== undefined && !ok(v))
		) {
			throw new Error(
				`${SIG}: station ${i + 1} needs at, and w and h above 0, got ${JSON.stringify(s)?.slice(0, 80)}`
			);
		}
		return {
			at: s.at,
			w: s.w,
			h: s.h,
			n: Math.min(Math.max(s.n ?? 2, 1.2), 12),
			u: s.u ?? 0,
			v: s.v ?? 0
		};
	});
	return out.sort((a, b) => a.at - b.at);
}

/**
 * Monotone cubic through (xs, ys) — Fritsch–Carlson: between two stations the
 * value stays between theirs.
 */
function monotone(xs: number[], ys: number[]): (x: number) => number {
	const k = xs.length;
	const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i] || 1));
	const m = xs.map((_, i) =>
		i === 0 ? d[0] : i === k - 1 ? d[k - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
	);
	for (let i = 0; i < k - 1; i++) {
		if (d[i] === 0) {
			m[i] = m[i + 1] = 0;
			continue;
		}
		const a = m[i] / d[i];
		const b = m[i + 1] / d[i];
		const s = a * a + b * b;
		if (s > 9) {
			m[i] = (3 * a * d[i]) / Math.sqrt(s);
			m[i + 1] = (3 * b * d[i]) / Math.sqrt(s);
		}
	}
	return (x) => {
		let i = 0;
		while (i < k - 2 && x > xs[i + 1]) i++;
		const hgt = xs[i + 1] - xs[i] || 1;
		const t = (x - xs[i]) / hgt;
		const t2 = t * t;
		const t3 = t2 * t;
		return (
			(2 * t3 - 3 * t2 + 1) * ys[i] +
			(t3 - 2 * t2 + t) * hgt * m[i] +
			(-2 * t3 + 3 * t2) * ys[i + 1] +
			(t3 - t2) * hgt * m[i + 1]
		);
	};
}

/** Where sections go along the axis: every station, and evenly between them. */
function positions(stations: Required<Station>[]): number[] {
	const first = stations[0].at;
	const step = (stations.at(-1)!.at - first) / ALONG || 1;
	const out: number[] = [];
	stations.forEach((s, i) => {
		out.push(s.at);
		const next = stations[i + 1];
		if (!next) return;
		const between = Math.max(1, Math.ceil((next.at - s.at) / step));
		for (let j = 1; j < between; j++) out.push(s.at + ((next.at - s.at) * j) / between);
	});
	return out;
}

export function loftBody(
	r: R,
	mf: ManifoldToplevel | undefined,
	stations: Station[],
	opts: { axis?: 'x' | 'y' | 'z' } = {}
): Replicad.MeshShape {
	if (!mf) throw new Error('body is not available here');
	const sorted = checked(stations, opts?.axis ?? 'x');
	const place = PLACE[opts?.axis ?? 'x'];
	const xs = sorted.map((s) => s.at);
	const curve = (key: 'w' | 'h' | 'n' | 'u' | 'v') =>
		monotone(
			xs,
			sorted.map((s) => s[key])
		);
	const [w, h, n, u, v] = (['w', 'h', 'n', 'u', 'v'] as const).map(curve);
	const ats = positions(sorted);
	const verts: number[] = [];
	for (const at of ats) {
		const e = 2 / n(at);
		for (let j = 0; j < AROUND; j++) {
			const t = (j / AROUND) * 2 * Math.PI;
			const c = Math.cos(t);
			const sn = Math.sin(t);
			const a = u(at) + (w(at) / 2) * Math.sign(c) * Math.abs(c) ** e;
			const b = v(at) + (h(at) / 2) * Math.sign(sn) * Math.abs(sn) ** e;
			verts.push(...place(at, a, b));
		}
	}
	// The two end caps close on a centre point each.
	const caps = [0, ats.length - 1].map((i) => {
		verts.push(...place(ats[i], u(ats[i]), v(ats[i])));
		return verts.length / 3 - 1;
	});
	const tris: number[] = [];
	const idx = (i: number, j: number) => i * AROUND + (j % AROUND);
	for (let i = 0; i + 1 < ats.length; i++) {
		for (let j = 0; j < AROUND; j++) {
			tris.push(
				idx(i, j),
				idx(i + 1, j),
				idx(i + 1, j + 1),
				idx(i, j),
				idx(i + 1, j + 1),
				idx(i, j + 1)
			);
		}
	}
	for (let j = 0; j < AROUND; j++) {
		tris.push(caps[0], idx(0, j), idx(0, j + 1));
		tris.push(caps[1], idx(ats.length - 1, j + 1), idx(ats.length - 1, j));
	}
	// Facing out whichever way the axis and the plane turn: flipped when the volume comes out negative.
	let volume6 = 0;
	for (let t = 0; t < tris.length; t += 3) {
		const [p, q, s] = [tris[t], tris[t + 1], tris[t + 2]].map((k) => verts.slice(k * 3, k * 3 + 3));
		volume6 +=
			p[0] * (q[1] * s[2] - q[2] * s[1]) -
			p[1] * (q[0] * s[2] - q[2] * s[0]) +
			p[2] * (q[0] * s[1] - q[1] * s[0]);
	}
	if (volume6 < 0) {
		for (let t = 0; t < tris.length; t += 3)
			[tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
	}
	const mesh = new mf.Mesh({
		numProp: 3,
		vertProperties: new Float32Array(verts),
		triVerts: new Uint32Array(tris)
	});
	mesh.merge();
	return new r.MeshShape(new mf.Manifold(mesh));
}
