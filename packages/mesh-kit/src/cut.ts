/**
 * Cut a model: one cut of one part by a plane, with connector pins
 * placed inside the cut face. Pure geometry on manifold-3d objects.
 *
 * Pins: «peg» — a peg grows out of the part below the plane and
 * enters a socket in the part above; «dowel» — sockets in both parts and
 * loose dowels printed separately. Sockets are `clearance` wider all round
 * and deeper than the peg, pegs have a chamfered tip.
 */
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { MeshKitError } from './errors.js';
import { Bin, prism, segments } from './kit.js';
import { planeFrame, type Plane } from './plane.js';
import { spreadPoints, type Pt } from './section.js';

export type ConnectorMode = 'peg' | 'dowel';
export type ConnectorShape = 'round' | 'square';

export interface ConnectorParams {
	enabled: boolean;
	mode: ConnectorMode;
	shape: ConnectorShape;
	/** mm */
	diameter: number;
	/** How deep a pin goes into each part, mm */
	depth: number;
	/** 0 = as many as fit the face */
	count: number;
	/** Gap between pin and socket, mm */
	clearance: number;
}

/**
 * Loose 5 mm dowels, 6 mm into each part: both halves then print flat on the
 * cut face, and 0.2 mm all round is a push fit on most FDM printers.
 */
export const CONNECTOR_DEFAULTS: ConnectorParams = {
	enabled: true,
	mode: 'dowel',
	shape: 'round',
	diameter: 5,
	depth: 6,
	count: 0,
	clearance: 0.2
};

/** Pins were asked for but none (or fewer) fit the cut face; the cut is made anyway. */
export type CutNote =
	| { code: 'face-too-narrow' }
	| { code: 'pins-fitted'; fitted: number; asked: number };

export interface CutResult {
	/** The part on the side the normal points to. */
	plus: Manifold;
	minus: Manifold;
	/** Loose dowels in their sockets (preview) and standing in a row (print). */
	dowels: Manifold | null;
	dowelsFlat: Manifold | null;
	pins: number;
	note: CutNote | null;
}

/** Peg into socket: how far a peg reaches into the part it grows from, mm. */
const EMBED = 0.8;

export function clampConnector(c: ConnectorParams): ConnectorParams {
	const fit = (v: number, lo: number, hi: number) =>
		Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
	return {
		...c,
		diameter: fit(c.diameter, 2, 20),
		depth: fit(c.depth, 2, 30),
		count: Math.round(fit(c.count, 0, 16)),
		clearance: fit(c.clearance, 0, 0.8)
	};
}

export function cutPart(
	wasm: ManifoldToplevel,
	part: Manifold,
	plane: Plane,
	connector: ConnectorParams
): CutResult {
	const bin = new Bin();
	const { toLocal, toWorld } = planeFrame(plane);
	const local = bin.add(part.transform(toLocal));
	const [plus, minus] = local.splitByPlane([0, 0, 1], 0).map((m) => bin.add(m));
	if (plus.isEmpty() || minus.isEmpty()) {
		bin.free();
		throw new MeshKitError('plane-misses-model');
	}

	const c = clampConnector(connector);
	let pinsAt: Pt[] = [];
	let note: CutNote | null = null;
	if (c.enabled) {
		pinsAt = placePins(wasm, local, c, bin);
		if (!pinsAt.length) note = { code: 'face-too-narrow' };
		else if (c.count && pinsAt.length < c.count)
			note = { code: 'pins-fitted', fitted: pinsAt.length, asked: c.count };
	}

	let outPlus = plus;
	let outMinus = minus;
	let dowels: Manifold | null = null;
	let dowelsFlat: Manifold | null = null;
	if (pinsAt.length) {
		const at = (m: Manifold, [x, y]: Pt) => bin.add(m.translate([x, y, 0]));
		if (c.mode === 'peg') {
			const peg = bin.add(pegShape(wasm, c));
			const socket = bin.add(socketShape(wasm, c, 0, c.depth + c.clearance));
			outMinus = bin.add(wasm.Manifold.union([minus, ...pinsAt.map((p) => at(peg, p))]));
			outPlus = bin.add(
				plus.subtract(bin.add(wasm.Manifold.union(pinsAt.map((p) => at(socket, p)))))
			);
		} else {
			const reach = c.depth + c.clearance;
			const socket = bin.add(socketShape(wasm, c, -reach, reach));
			const holes = bin.add(wasm.Manifold.union(pinsAt.map((p) => at(socket, p))));
			outPlus = bin.add(plus.subtract(holes));
			outMinus = bin.add(minus.subtract(holes));
			const dowel = bin.add(dowelShape(wasm, c));
			dowels = bin.add(wasm.Manifold.union(pinsAt.map((p) => at(dowel, p))));
			// For printing: standing on end, in a row.
			const standing = bin.add(dowel.translate([0, 0, c.depth]));
			const gap = c.diameter + 3;
			dowelsFlat = wasm.Manifold.union(
				pinsAt.map((_, i) => bin.add(standing.translate([i * gap, 0, 0])))
			);
		}
	}
	const result: CutResult = {
		plus: outPlus.transform(toWorld),
		minus: outMinus.transform(toWorld),
		dowels: dowels ? dowels.transform(toWorld) : null,
		dowelsFlat,
		pins: pinsAt.length,
		note
	};
	bin.free(result.plus, result.minus, result.dowels, result.dowelsFlat);
	return result;
}

/**
 * Pin centres on the cut face: inside the section at the plane and at the
 * full socket depth on both sides, with a wall around every socket. Each
 * separate island of the section gets at least one pin when there are
 * enough to go round.
 */
function placePins(wasm: ManifoldToplevel, local: Manifold, c: ConnectorParams, bin: Bin): Pt[] {
	const reach = pinReach(c);
	const sections = [0, reach, -reach].map((z) => bin.add(local.slice(z)));
	return pinsIn(bin.add(wasm.CrossSection.intersection(sections)), c, bin);
}

/** How far a socket reaches from the cut face into a part, with a floor under it, mm. */
export const pinReach = (c: ConnectorParams) => c.depth + c.clearance + 0.6;

/** The wall left around every socket, mm. */
export const pinWall = (c: ConnectorParams) => Math.max(1.2, 0.3 * c.diameter);

/**
 * Pin centres in `common` — the part of a cut face where both parts are
 * solid to the full socket depth — with a wall around every socket.
 */
export function pinsIn(common: CrossSection, c: ConnectorParams, bin: Bin): Pt[] {
	const half = c.shape === 'round' ? c.diameter / 2 : (c.diameter * Math.SQRT2) / 2;
	const footprint = half + c.clearance;
	const wall = pinWall(c);
	const region = bin.add(common.offset(-(footprint + wall), 'Round'));
	const islands = region
		.decompose()
		.map((cs) => bin.add(cs))
		.map((cs: CrossSection) => ({ polys: cs.toPolygons(), area: cs.area() }))
		.filter((i) => i.area > 1e-3)
		.sort((a, b) => b.area - a.area);
	if (!islands.length) return [];
	const counts = allocatePins(
		islands.map((i) => i.area),
		c.count,
		c.diameter
	);
	const minGap = 2 * footprint + wall;
	return islands.flatMap((island, i) => spreadPoints(island.polys, counts[i], minGap));
}

/**
 * How many pins each island gets. Auto: about one per 5 diameters of the
 * island's size, 1–4 each. A set count: one per island from the largest,
 * the rest by area.
 */
export function allocatePins(areas: number[], count: number, diameter: number): number[] {
	if (!count) {
		const out = areas.map((a) =>
			Math.max(1, Math.min(4, Math.round(Math.sqrt(a) / (5 * diameter))))
		);
		let total = out.reduce((s, n) => s + n, 0);
		// Never more than 12 in all: trim the smallest islands first.
		for (let i = out.length - 1; i >= 0 && total > 12; i--) {
			const cut = Math.min(out[i], total - 12);
			out[i] -= cut;
			total -= cut;
		}
		return out;
	}
	const out: number[] = areas.map((_, i) => (i < count ? 1 : 0));
	let left = count - out.reduce((s, n) => s + n, 0);
	const sum = areas.reduce((s, a) => s + a, 0);
	const share = areas.map((a) => (a / sum) * left);
	share.forEach((s, i) => (out[i] += Math.floor(s)));
	left = count - out.reduce((s, n) => s + n, 0);
	const order = share.map((s, i) => ({ i, r: s - Math.floor(s) })).sort((a, b) => b.r - a.r);
	for (let k = 0; k < left; k++) out[order[k % order.length].i]++;
	return out;
}

/** A peg standing on z = 0: embedded below, chamfered tip at `depth`. */
function pegShape(wasm: ManifoldToplevel, c: ConnectorParams): Manifold {
	const { Manifold, CrossSection } = wasm;
	if (c.shape === 'square') {
		// A frustum: half as wide at the tip, so it centres itself.
		const sq = CrossSection.square([c.diameter, c.diameter], true);
		const body = prism(wasm, sq, 0, c.depth, 0.5);
		const root = prism(wasm, sq, -EMBED, 0.01);
		const out = Manifold.union(body, root);
		out.numTri();
		sq.delete();
		body.delete();
		root.delete();
		return out;
	}
	const r = c.diameter / 2;
	const ch = Math.min(0.5, r / 3);
	const n = segments(r);
	const a = Manifold.cylinder(c.depth - ch + EMBED, r, r, n).translate([0, 0, -EMBED]);
	const b = Manifold.cylinder(c.depth + EMBED, r - ch, r - ch, n).translate([0, 0, -EMBED]);
	const out = Manifold.hull([a, b]);
	out.numTri();
	a.delete();
	b.delete();
	return out;
}

/** The hole a pin goes into, from z0 to z1, `clearance` wider all round. */
export function socketShape(
	wasm: ManifoldToplevel,
	c: ConnectorParams,
	z0: number,
	z1: number
): Manifold {
	const g = c.clearance;
	if (c.shape === 'square' && c.mode === 'peg') {
		// Follows the frustum: side D + 2g at the face, shrinking like the peg.
		const base = c.diameter + 2 * g;
		const height = z1 + 0.01;
		const top = Math.max(0.5, base - (c.diameter / 2) * (height / c.depth));
		const sq = wasm.CrossSection.square([base, base], true);
		const out = prism(wasm, sq, -0.01, height, top / base);
		sq.delete();
		return out;
	}
	if (c.shape === 'square') {
		const s = c.diameter + 2 * g;
		return wasm.Manifold.cube([s, s, z1 - z0], true).translate([0, 0, (z0 + z1) / 2]);
	}
	const r = c.diameter / 2 + g;
	const bottom = z0 === 0 ? -0.01 : z0;
	return wasm.Manifold.cylinder(z1 - bottom, r, r, segments(r)).translate([0, 0, bottom]);
}

/** A loose dowel centred on z = 0, `depth` into each part, chamfered ends. */
export function dowelShape(wasm: ManifoldToplevel, c: ConnectorParams): Manifold {
	const { Manifold } = wasm;
	if (c.shape === 'square') return Manifold.cube([c.diameter, c.diameter, 2 * c.depth], true);
	const r = c.diameter / 2;
	const ch = Math.min(0.5, r / 3);
	const n = segments(r);
	const a = Manifold.cylinder(2 * c.depth - 2 * ch, r, r, n, true);
	const b = Manifold.cylinder(2 * c.depth, r - ch, r - ch, n, true);
	const out = Manifold.hull([a, b]);
	out.numTri();
	a.delete();
	b.delete();
	return out;
}
