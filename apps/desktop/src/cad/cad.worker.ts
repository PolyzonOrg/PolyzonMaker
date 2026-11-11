/**
 * Runs one CAD program on the two kernels and ends. The kernels load as soon as the worker starts, so a
 * spare worker is ready when the next build comes (client.ts); a program never shares one with another,
 * and it runs locked down, after compiling: no network, storage or code from strings.
 */
import * as replicad from 'replicad';
import opencascade from 'replicad-opencascadejs';
import occtWasm from 'replicad-opencascadejs/wasm?url';
import Manifold from 'manifold-3d';
import manifoldWasm from 'manifold-3d/manifold.wasm?url';
import type { Manifold as ManifoldMesh, ManifoldToplevel } from 'manifold-3d';
import { floatingParts, separateBodies } from '../studio/chat/build-checks';
import { CadProgramError, lockdown, outward, runCadProgram, type CadPart } from '../studio/cad/program';
import { fromManifold, toManifold } from '../studio/tools/solid';
import { withLanguage, type Param } from './lang';

export interface CadRequest {
	code: string;
	/** Models of the library the program asks for, as triangles, by name. */
	models?: Record<string, Float32Array>;
	/** Other programs it uses, by name. */
	programs?: Record<string, string>;
	/** Values set in the window, by parameter name. */
	values?: Record<string, number>;
	step?: boolean;
}

export interface BuiltPart {
	name: string;
	color?: string;
	min: [number, number, number];
	max: [number, number, number];
	volume: number;
	/** Exact solid (rounds, exports to STEP) or smooth mesh. */
	kind: 'solid' | 'mesh';
	triangles: Float32Array;
}

export interface Built {
	parts: BuiltPart[];
	params: Param[];
	warnings: string[];
	step: Uint8Array | null;
}

export type CadResponse = { ready: true } | ({ ok: true } & Built) | { ok: false; error: string; line: number | null; params: Param[] };

const FONT = '/openscad/NotoSans-Regular.ttf';
const post = (message: CadResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

let mf: ManifoldToplevel;
const ready = (async () => {
	const [oc, manifold] = await Promise.all([opencascade({ locateFile: () => occtWasm }), Manifold({ locateFile: () => manifoldWasm })]);
	replicad.setOC(oc);
	mf = manifold;
	mf.setup();
	replicad.setManifold(mf);
	post({ ready: true });
})();

/** Fine enough to print, by the size of the whole: a sofa does not need a phone's facets. */
function tolerance(parts: CadPart[]) {
	const boxes = parts.map((p) => p.shape.boundingBox.bounds as number[][]);
	const span = Math.max(...[0, 1, 2].map((i) => Math.max(...boxes.map((b) => b[1][i])) - Math.min(...boxes.map((b) => b[0][i]))));
	return { tolerance: Math.max(0.02, span / 5000), angularTolerance: 0.3 };
}

function trianglesOf(part: CadPart, quality: ReturnType<typeof tolerance>): Float32Array {
	if (part.shape instanceof replicad.MeshShape) return fromManifold((part.shape as unknown as { wrapped: ManifoldMesh }).wrapped);
	const { vertices, triangles } = part.shape.mesh(quality) as { vertices: number[]; triangles: number[] };
	const out = new Float32Array(triangles.length * 3);
	triangles.forEach((v, i) => out.set([vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]], i * 3));
	return out;
}

/** What the solids say is wrong: a part in pieces, a part in the air. */
function check(parts: CadPart[], built: BuiltPart[], warnings: string[]) {
	parts.forEach((p, i) => {
		if (p.shape instanceof replicad.MeshShape || (p as { loose?: boolean }).loose) return;
		const pieces = separateBodies(built[i].triangles, false);
		if (pieces > 1) warnings.push(`«${p.name}» is ${pieces} pieces that do not touch: joined shapes never met.`);
	});
	// One entry a name: copies of a part hang together, and the warning names them once.
	const names = [...new Set(built.map((p) => p.name))];
	const bodies = names.map((name) => built.flatMap((p, i) => (p.name === name ? [i] : [])));
	const boxes = bodies.map((list) => ({
		name: names[bodies.indexOf(list)],
		min: [0, 1, 2].map((c) => Math.min(...list.map((i) => built[i].min[c]))) as BuiltPart['min'],
		max: [0, 1, 2].map((c) => Math.max(...list.map((i) => built[i].max[c]))) as BuiltPart['max']
	}));
	warnings.push(
		...floatingParts(boxes, (i, j) => {
			let nearest = Infinity;
			for (const a of bodies[i]) {
				for (const b of bodies[j]) {
					const [p, q] = [parts[a].shape, parts[b].shape];
					if (p instanceof replicad.MeshShape || q instanceof replicad.MeshShape) return 0;
					nearest = Math.min(nearest, replicad.measureDistanceBetween(p, q));
				}
			}
			return nearest;
		})
	);
}

self.onmessage = async (e: MessageEvent<CadRequest>) => {
	const { code, models = {}, programs, values, step } = e.data;
	const params: Param[] = [];
	try {
		await ready;
		if (/\btext\s*\(|text3d|sketchText|drawText/.test(code)) await replicad.loadFont(await (await fetch(FONT)).arrayBuffer());
		const meshes: Record<string, replicad.MeshShape> = {};
		for (const [name, triangles] of Object.entries(models)) meshes[name] = new replicad.MeshShape(toManifold(mf, outward(triangles)).solid as never);
		const warnings: string[] = [];
		const context = withLanguage({ values, params, programs }, { meshes, warnings, manifold: mf }, replicad);
		let parts = await runCadProgram(replicad, code, context, () => lockdown(self as unknown as Record<string, unknown>));
		const lowest = Math.min(...parts.map((p) => (p.shape.boundingBox.bounds as number[][])[0][2]));
		if (Number.isFinite(lowest) && Math.abs(lowest) > 0.05) parts = parts.map((p) => ({ ...p, shape: p.shape.translate(0, 0, -lowest) }));
		const quality = tolerance(parts);
		const built: BuiltPart[] = parts.map((p) => {
			const [min, max] = p.shape.boundingBox.bounds as BuiltPart['min'][];
			if (![...min, ...max].every(Number.isFinite)) throw new Error(`part «${p.name}» is empty: a cut took all of it?`);
			const volume = p.shape instanceof replicad.MeshShape ? p.shape.volume() : replicad.measureVolume(p.shape);
			return { name: p.name, color: p.color, min, max, volume: Math.round(Math.abs(volume)), kind: p.shape instanceof replicad.MeshShape ? 'mesh' : 'solid', triangles: trianglesOf(p, quality) };
		});
		check(parts, built, warnings);
		const solids = parts.filter((p) => !(p.shape instanceof replicad.MeshShape));
		const file = step && solids.length === parts.length ? new Uint8Array(await replicad.exportSTEP(solids.map((p) => ({ shape: p.shape as replicad.Shape3D, name: p.name, ...(p.color ? { color: p.color } : {}) }))).arrayBuffer()) : null;
		post({ ok: true, parts: built, params, warnings, step: file }, [...built.map((p) => p.triangles.buffer), ...(file ? [file.buffer] : [])]);
	} catch (error) {
		post({ ok: false, error: error instanceof Error ? error.message : String(error), line: error instanceof CadProgramError ? error.line : null, params });
	}
};
