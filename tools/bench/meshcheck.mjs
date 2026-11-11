// One generated model through Ark's print path: what @polyzon/mesh-kit makes of it.
//   node meshcheck.mjs MODEL.glb OUT_DIR [HEIGHT_MM]
// Prints one JSON line {"stages": {...seconds}, "meshkit": {...}} for spike.py and writes
// OUT_DIR/<name>.stl (and .3mf): the file a slicer would get.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
	MAX_REMESH_SAMPLES,
	analyze,
	apply,
	checkStatus,
	exportModel,
	loadManifold,
	plan,
	readModel,
	remeshSamples,
	simplifyOp
} from '@polyzon/mesh-kit';

const [src, outDir, height = '80'] = process.argv.slice(2);
const name = basename(src).replace(/\.glb$/i, '');
const bed = [256, 256, 256];
const stages = {};
let t = performance.now();
const mark = (k) => {
	const now = performance.now();
	stages[k] = Math.round(now - t) / 1000;
	t = now;
};
const brief = (r) => ({
	status: r.status,
	faces: r.faces,
	components: r.components.length,
	closedComponents: r.components.filter((c) => c.closed).length,
	holes: r.holes.length,
	openEdges: r.openEdges,
	nonManifoldEdges: r.nonManifoldEdges,
	flippedEdges: r.flippedEdges,
	flatShare: Math.round(r.flatShare * 100) / 100,
	size: r.size.map((v) => Math.round(v * 10) / 10),
	checks: Object.fromEntries(r.checks.map((c) => [c.id, c.status]))
});
const closed = (r) => checkStatus(r, 'closed-solid') === 'passed';
const failed = (e) => ({ error: String(e?.code ?? '') + ' ' + String(e?.message ?? e).slice(0, 300) });

const wasm = await loadManifold();
const tris = await readModel(basename(src), new Uint8Array(await readFile(src)), { glbUnit: 'm' });
mark('read');
const before = analyze(tris, { wasm, buildVolume: bed });
mark('analyze');
const out = { before: brief(before) };
let best = null;

// 1. What Ark does by default: scale, repair only what the report found, stand on the bed.
try {
	const r = await apply(tris, plan(before, { height: +height }), { wasm, buildVolume: bed });
	out.repair = { ...brief(r.report), steps: r.steps.map((s) => ({ op: s.op, ms: Math.round(s.ms), changes: s.changes })) };
	best = r;
} catch (e) {
	out.repair = failed(e);
}
mark('repair');

// 2. Still no closed solid: rebuild the surface on the finest grid mesh-kit allows; it measures how far it moved.
if (!best || !closed(best.report)) {
	const k = +height / before.size[2];
	const voxel = [0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2].find(
		(v) => remeshSamples(before.size.map((s) => s * k), v) <= MAX_REMESH_SAMPLES
	);
	try {
		const r = await apply(tris, plan(before, { height: +height, repair: false, remesh: { voxel } }), {
			wasm,
			buildVolume: bed
		});
		out.remesh = { voxel, ...brief(r.report), changes: r.steps.find((s) => s.op === 'remesh')?.changes };
		if (closed(r.report) || !best) best = r;
	} catch (e) {
		out.remesh = { voxel, ...failed(e) };
	}
	mark('remesh');
}

// 3. What a slicer gets: fewer faces where the surface moves under 0.05 mm (a 0.4 mm nozzle cannot show it).
let mesh = best?.mesh;
let final = best?.report; // what the files hold
if (mesh) {
	try {
		const s = await simplifyOp(mesh, { maxDeviation: 0.05 }, { wasm });
		out.simplify = s.changes;
		const r = analyze(s.mesh, { wasm, buildVolume: bed });
		out.simplify.status = r.status;
		if (closed(r) || !closed(best.report)) {
			mesh = s.mesh;
			final = r;
		}
	} catch (e) {
		out.simplify = failed(e);
	}
	mark('simplify');
	let files = [];
	try {
		files = await exportModel(mesh, { formats: ['stl', '3mf'], name });
	} catch (e) {
		out.export = failed(e); // what was found above still goes in the report
	}
	mark('export');
	out.files = files.map((f) => ({ format: f.format, ready: f.ready, bytes: f.bytes?.length ?? 0, problems: f.problems }));
	await mkdir(outDir, { recursive: true });
	for (const f of files) if (f.ready) await writeFile(join(outDir, `${name}.${f.format}`), f.bytes);
}
// A flat plate is a fine closed solid, and not the model that was asked for. And manifold takes
// surfaces that touch for sound, while a slicer joining equal corners finds edges of four faces.
const flat = checkStatus(before, 'flat-plate') === 'warning';
out.final = final && { openEdges: final.openEdges, nonManifoldEdges: final.nonManifoldEdges };
const sound = final && closed(final) && !final.openEdges && !final.nonManifoldEdges;
out.printable = Boolean(sound && out.files?.length && out.files.every((f) => f.ready) && !flat);
console.log(JSON.stringify({ stages, meshkit: out }));
