// Geometry off the main thread: the sample model, reading model files and print preparation (mesh-kit).
import {
	analyze,
	apply,
	checkStatus,
	exportModel,
	loadManifold,
	plan,
	readModel,
	writeGlb,
	type Triangles
} from '@polyzon/mesh-kit';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

export type Request =
	| { op: 'sample'; triangles: number }
	| { op: 'read'; name: string; bytes: Uint8Array }
	| { op: 'prepare'; height: number };

export interface Read {
	tris: Triangles;
	ms: number;
}

export interface Prepared {
	stl: Uint8Array;
	triangles: number;
	holesBefore: number;
	closed: boolean;
	size: number[];
	repairMs: number;
	exportMs: number;
	ready: boolean;
	problems: string[];
}

const post = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void };
// The model the worker keeps: the page only gets a copy to draw.
let model: Triangles | null = null;

self.onmessage = async (e: MessageEvent<Request & { id: number }>) => {
	const { id, ...req } = e.data;
	try {
		const [value, transfer] = await run(req);
		post.postMessage({ id, value }, transfer);
	} catch (err) {
		post.postMessage({ id, error: err instanceof Error ? err.message : String(err) }, []);
	}
};

async function run(req: Request): Promise<[unknown, Transferable[]]> {
	switch (req.op) {
		case 'sample': {
			const glb = writeGlb([lumpyBall(req.triangles)]);
			return [glb, [glb.buffer]];
		}
		case 'read': {
			const t = performance.now();
			model = await readModel(req.name, req.bytes);
			const tris = model.slice();
			return [{ tris, ms: Math.round(performance.now() - t) } satisfies Read, [tris.buffer]];
		}
		case 'prepare':
			return prepare(req.height);
	}
}

/** What Ark does before a slicer: scale, repair what the report found, stand on the bed, STL read back. */
async function prepare(height: number): Promise<[Prepared, Transferable[]]> {
	if (!model) throw new Error('no model loaded');
	const wasm = await loadManifold({ locateFile: () => wasmUrl });
	const t0 = performance.now();
	const before = analyze(model, { wasm });
	const r = await apply(model, plan(before, { height }), { wasm });
	const t1 = performance.now();
	const [stl] = await exportModel(r.mesh, { formats: ['stl'], name: 'probe' });
	const t2 = performance.now();
	const bytes = stl.bytes ?? new Uint8Array();
	const out: Prepared = {
		stl: bytes,
		triangles: model.length / 9,
		holesBefore: before.holes.length,
		closed: checkStatus(r.report, 'closed-solid') === 'passed',
		size: r.report.size.map((v) => Math.round(v * 10) / 10),
		repairMs: Math.round(t1 - t0),
		exportMs: Math.round(t2 - t1),
		ready: stl.ready,
		problems: stl.problems
	};
	return [out, [bytes.buffer]];
}

/**
 * A lumpy ball of about `count` triangles, 80 mm across, Z up, with two holes cut in it: a stand-in
 * for a raw generated mesh, so the repair has something to do.
 */
function lumpyBall(count: number): Triangles {
	const lon = Math.round(Math.sqrt(count));
	const lat = Math.round(count / 2 / lon);
	const at = (i: number, j: number): [number, number, number] => {
		const t = (Math.PI * j) / lat;
		const f = (2 * Math.PI * (i % lon)) / lon;
		const r = 40 * (1 + 0.12 * Math.sin(3 * t) * Math.cos(4 * f) + 0.04 * Math.sin(11 * t) * Math.sin(9 * f));
		return [r * Math.sin(t) * Math.cos(f), r * Math.sin(t) * Math.sin(f), r * Math.cos(t)];
	};
	const hole = (i: number, j: number) =>
		(j >= lat * 0.35 && j < lat * 0.35 + 4 && i >= lon * 0.2 && i < lon * 0.2 + 6) ||
		(j >= lat * 0.6 && j < lat * 0.6 + 3 && i >= lon * 0.7 && i < lon * 0.7 + 9);
	const out = new Float32Array(lat * lon * 18);
	let n = 0;
	const tri = (...corners: [number, number, number][]) => {
		for (const p of corners) out.set(p, (n += 3) - 3);
	};
	for (let j = 0; j < lat; j++)
		for (let i = 0; i < lon; i++) {
			if (hole(i, j)) continue;
			const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
			// a→d runs down the meridian, a→b along the parallel: (d − a) × (b − a) points outwards.
			// At the poles a = b (top row) or c = d (bottom row): that triangle would have no area.
			if (j > 0) tri(a, d, b);
			if (j < lat - 1) tri(b, d, c);
		}
	return out.slice(0, n);
}
