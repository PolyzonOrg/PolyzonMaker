import { assert, expect, test } from 'vitest';
import { analyze, STATUS_TEXT } from '../src/analyze.js';
import { exportModel, transferList } from '../src/export-files.js';
import { fromManifold } from '../src/manifold.js';
import { apply, checkStatus, plan, type Op } from '../src/ops.js';
import { closeUp, makeSolid, prepareForPrint, previewMesh } from '../src/print.js';
import { bounds, merge, parseStl } from '../src/stl.js';
import { boxTris, brokenEdges, damage, icosphere, inward, join, manifold, tear } from './helpers.js';

/**
 * A generated-looking model gone wrong: a 40 mm ball of 1280 faces with
 * two holes (one face missing; four faces missing in another place) and
 * three faces turned inside out, far from the holes and from each other.
 */
const ball = icosphere(20, 3);
const broken = damage(ball, [10, 768, 769, 770, 771], [300, 900, 1200]);

test('analyze warns of a flat plate, the way a generator fails, and not of a solid with flat faces', () => {
	const plate = analyze(boxTris(80, 1, 80));
	assert.equal(checkStatus(plate, 'flat-plate'), 'warning');
	assert.equal(plate.status, 'needs-check');
	// The other way it fails: the object stands in a corner of a floor and a wall.
	const floor = boxTris(100, 100, 1);
	const wall = boxTris(100, 1, 80).map((v, i) => (i % 3 === 2 ? v + 1 : v));
	assert.equal(checkStatus(analyze(merge([icosphere(20, 3, [50, 50, 21]), floor, wall])), 'flat-plate'), 'warning');
	assert.equal(checkStatus(analyze(boxTris(40, 40, 40)), 'flat-plate'), 'passed');
	assert.equal(checkStatus(analyze(icosphere(20, 3)), 'flat-plate'), 'passed');
});

test('a plate made to size is not a failed generation', async () => {
	const wasm = await manifold();
	const plate = boxTris(90, 90, 4);
	const before = analyze(plate, { wasm, finished: true });
	assert.equal(checkStatus(before, 'flat-plate'), 'passed');
	assert.equal(before.status, 'basic-passed');
	const result = await prepareForPrint(plate, before, { wasm, height: 4, finished: true });
	assert.equal(result.flat, false);
	assert.equal(result.ready, true);
	assert.equal(result.report.status, 'basic-passed');
});

test('crumbs around a generated model stay off the bed, and the report counts them', async () => {
	const wasm = await manifold();
	const speck = boxTris(1, 1, 1).map((v, i) => (i % 3 === 0 ? v + 30 : v));
	const crumbed = merge([ball, speck]);
	const result = await prepareForPrint(crumbed, analyze(crumbed, { wasm }), { wasm, height: 40 });
	assert.equal(result.crumbs, 1);
	assert.equal(result.report.components.length, 1);
	assert.equal(result.ready, true);

	// a part of a size that matters stays, and a model made to size is never touched
	const two = merge([ball, icosphere(8, 3, [40, 0, 0])]);
	const kept = await prepareForPrint(two, analyze(two, { wasm }), { wasm, height: 40 });
	assert.equal(kept.crumbs, 0);
	assert.equal(kept.report.components.length, 2);
	const made = await prepareForPrint(crumbed, analyze(crumbed, { wasm, finished: true }), { wasm, height: 40, finished: true });
	assert.equal(made.crumbs, 0);
	assert.equal(made.report.components.length, 2);
});

test('(a) analyze reports the holes and the flipped faces, and what it did not check', async () => {
	const wasm = await manifold();
	const r = analyze(broken, { wasm });
	assert.equal(r.holes.length, 2);
	assert.equal(r.openEdges, 3 + 6);
	assert.deepEqual(
		r.holes.map((h) => h.edges).sort(),
		[3, 6]
	);
	assert.equal(r.flippedEdges, 3 * 3);
	assert.equal(r.components.length, 1);
	assert.equal(r.unit, 'mm');
	r.size.forEach((v) => assert.ok(Math.abs(v - 40) < 0.5, `${r.size}`));
	assert.equal(checkStatus(r, 'open-edges'), 'failed');
	assert.equal(checkStatus(r, 'orientation'), 'failed');
	assert.equal(checkStatus(r, 'closed-solid'), 'failed');
	assert.equal(checkStatus(r, 'self-intersections'), 'not-checked');
	assert.equal(checkStatus(r, 'wall-thickness'), 'not-checked');
	assert.equal(r.status, 'has-errors');
	assert.equal(STATUS_TEXT[r.status], 'has file/geometry errors');
	// Without the WASM module the solid check did not run — and says so.
	assert.equal(checkStatus(analyze(broken), 'closed-solid'), 'not-checked');
	// An intact ball: the basic checks pass; a printer that is too small fails the fit.
	assert.equal(analyze(ball, { wasm }).status, 'basic-passed');
	assert.equal(checkStatus(analyze(ball, { buildVolume: [30, 30, 30] }), 'build-volume'), 'failed');
});

test('(b) the planned repair lists what it touches, then fixes it: no open edges, a closed solid', async () => {
	const wasm = await manifold();
	const report = analyze(broken, { wasm });
	const ops = plan(report);
	assert.deepEqual(
		ops.map((o) => o.op),
		['repair', 'place-on-bed']
	);
	const repair = ops[0] as Extract<Op, { op: 'repair' }>;
	assert.equal(repair.units, 'mm');
	assert.equal(repair.version, 2);
	assert.equal(repair.params.fillHoles, 'all');
	assert.match(repair.expected, /close 2 of 2 holes: \d edges at \(/);
	assert.match(repair.expected, /9 edges between flipped faces/);
	const { mesh, steps, report: after } = await apply(broken, ops, { wasm });
	assert.equal(steps[0].changes.holesFilled, 2);
	assert.equal(steps[0].changes.flipped, 3);
	assert.equal(after.openEdges, 0);
	assert.equal(after.flippedEdges, 0);
	assert.equal(checkStatus(after, 'closed-solid'), 'passed');
	assert.equal(after.status, 'basic-passed');
	assert.equal(STATUS_TEXT[after.status], 'basic checks passed');
	// The input is never changed; the result stands on the bed.
	assert.equal(analyze(broken).openEdges, 9);
	assert.ok(Math.abs(bounds(mesh).min[2]) < 1e-6);
});

test('only the holes chosen are closed', async () => {
	const report = analyze(broken);
	const small = report.holes.find((h) => h.edges === 3)!;
	const ops = plan(report, { repair: { fillHoles: [small.center] } });
	assert.match(ops[0].expected, /close 1 of 2 holes: 3 edges/);
	const { report: after } = await apply(broken, ops);
	assert.equal(after.holes.length, 1);
	assert.equal(after.openEdges, 6);
	assert.equal(after.status, 'has-errors');
});

test('(c) scale comes first and gives the requested height', async () => {
	const report = analyze(broken);
	const ops = plan(report, { height: 32 });
	assert.deepEqual(
		ops.map((o) => o.op),
		['scale', 'repair', 'place-on-bed']
	);
	assert.match(ops[0].expected, /→ 32 × 32 × 32 mm/);
	// The weld tolerance is planned for the scaled size.
	const repair = ops[1] as Extract<Op, { op: 'repair' }>;
	assert.ok(Math.abs(repair.params.weldTolerance - Math.hypot(32, 32, 32) * 1e-6) < 1e-9);
	const { report: after } = await apply(broken, ops);
	assert.ok(Math.abs(after.size[2] - 32) <= 0.5, `height ${after.size[2]}`);
	assert.equal(after.openEdges, 0);
});

test('non-destructive by default: a sound model gets no repair, no cut, no remesh', () => {
	const ops = plan(analyze(ball), { height: 50 });
	assert.deepEqual(
		ops.map((o) => o.op),
		['scale', 'place-on-bed']
	);
	assert.deepEqual(
		plan(analyze(ball), { placeOnBed: false }),
		[]
	);
});

test('chosen operations: simplify and remesh measure the deviation in mm; a flat bottom cuts what it says', async () => {
	const wasm = await manifold();
	const fine = icosphere(20, 4);
	const ops = plan(analyze(fine), {
		simplify: { maxDeviation: 0.3 },
		flatBottom: { cut: 2 },
		placeOnBed: false
	});
	assert.match(ops[0].expected, /less than 0\.3 mm/);
	assert.match(ops[1].expected, /cut 2 mm off the bottom: height 40 → 38 mm/);
	const { steps, report } = await apply(fine, ops, { wasm });
	const simplified = steps[0].changes as { before: number; after: number; deviation: { max: number } };
	assert.ok(simplified.after < simplified.before / 2, `${simplified.before} → ${simplified.after}`);
	assert.ok(simplified.deviation.max < 0.3 * 1.5, `deviation ${simplified.deviation.max}`);
	const height = steps[1].changes.height as { before: number; after: number };
	assert.ok(Math.abs(height.before - height.after - 2) < 1e-3, JSON.stringify(height));
	assert.ok(Math.abs(report.size[2] - height.after) < 1e-6);
	assert.equal(checkStatus(report, 'closed-solid'), 'passed');

	const remeshed = await apply(broken, plan(analyze(broken), { height: 32, repair: false, remesh: { voxel: 0.6 } }), { wasm });
	assert.deepEqual(
		remeshed.steps.map((s) => s.op),
		['scale', 'remesh', 'place-on-bed']
	);
	const deviation = remeshed.steps[1].changes.deviation as { max: number; mean: number };
	assert.ok(deviation.max < 2 && deviation.mean < 0.3, JSON.stringify(deviation));
	assert.equal(checkStatus(remeshed.report, 'closed-solid'), 'passed');
	assert.equal(remeshed.report.openEdges, 0);
});

test('an operation from another version is refused, and a cancelled run stops', async () => {
	const ops = plan(analyze(ball), { height: 30 });
	await expect(apply(ball, [{ ...ops[0], version: 99 } as Op])).rejects.toMatchObject({ code: 'unknown-op' });
	const stop = new AbortController();
	stop.abort();
	await expect(apply(ball, ops, { signal: stop.signal })).rejects.toThrow();
});

test('(d) STL, 3MF and GLB read back with their size and object count, or are not ready', async () => {
	const { mesh } = await apply(broken, plan(analyze(broken), { height: 32 }));
	const files = await exportModel(mesh, { formats: ['stl', '3mf', 'glb'], name: 'Шар' });
	for (const f of files) {
		assert.ok(f.ready, `${f.format}: ${f.problems.join('; ')}`);
		assert.ok(f.bytes && f.bytes.length > 0);
		assert.equal(f.readBack!.objects, 1, f.format);
		f.readBack!.size.forEach((v, k) => assert.ok(Math.abs(v - f.expected.size[k]) < 1e-3, `${f.format} ${f.readBack!.size}`));
		assert.ok(Math.abs(f.readBack!.size[2] - 32) <= 0.5);
		assert.equal(f.readBack!.openEdges, 0);
	}
	const xml = new TextDecoder().decode(files[1].bytes!);
	assert.match(xml, /unit="millimeter"/);
	assert.notMatch(xml, /basematerials|displaycolor|<components>/, 'plain 3MF profile');

	// Two parts: one STL soup, two objects in 3MF and GLB.
	const other = ball.map((v, i) => (i % 3 === 0 ? v + 60 : v));
	const two = await exportModel(
		[
			{ name: 'a', tris: mesh },
			{ name: 'b', tris: other }
		],
		{ formats: ['stl', '3mf', 'glb'] }
	);
	assert.deepEqual(
		two.map((f) => [f.format, f.ready, f.readBack!.objects]),
		[
			['stl', true, 1],
			['3mf', true, 2],
			['glb', true, 2]
		]
	);
	// The files move to a worker's caller without a copy.
	assert.equal(transferList(two).length, 3);
});

/** A lumpy solid: more surface to simplify than a ball, and closed. */
function lumpyBall() {
	const lumpy = icosphere(40, 6);
	for (let i = 0; i < lumpy.length; i += 3) {
		const [x, y, z] = lumpy.subarray(i, i + 3);
		const k = 1 + 0.1 * Math.sin(x / 5) * Math.sin(y / 5) * Math.sin(z / 5);
		lumpy.set([x * k, y * k, z * k], i);
	}
	return lumpy;
}

test('simplify keeps to its limit: a result that moved the surface further is not used', async () => {
	const wasm = await manifold();
	const lumpy = lumpyBall();
	const { steps } = await apply(lumpy, plan(analyze(lumpy), { simplify: { maxDeviation: 0.05 }, placeOnBed: false }), { wasm });
	const { before, after, deviation } = steps[0].changes as { before: number; after: number; deviation: { max: number } };
	assert.ok(deviation.max <= 0.05, `${before} → ${after}: moved ${deviation.max} mm`);
});

test('simplify: a speck that would vanish does not cost the rest of the model its simplification', async () => {
	const wasm = await manifold();
	// A flat speck 0.2 mm wide, as marching cubes leaves them: both simplifiers collapse it at every target.
	const corners = [[0.1, 0, 0], [-0.1, 0, 0], [0, 0.1, 0], [0, -0.1, 0], [0, 0, 0.005], [0, 0, -0.005]];
	const faces = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
	const speck = new Float32Array(faces.flat().flatMap((c) => [corners[c][0] + 50, corners[c][1], corners[c][2]]));
	const model = merge([lumpyBall(), speck]);
	const { steps, report } = await apply(model, plan(analyze(model), { simplify: { maxDeviation: 0.05 }, placeOnBed: false }), { wasm });
	const { before, after, deviation } = steps[0].changes as { before: number; after: number; deviation: { max: number } };
	assert.ok(after < 0.9 * before, `${before} → ${after}`);
	assert.ok(deviation.max <= 0.05, `moved ${deviation.max} mm`);
	assert.equal(report.components.length, 2, 'parts are not dropped without a plan');
});

/** Two solid boxes standing corner to corner: their surfaces touch along one vertical edge, of four faces. */
const touching = merge([boxTris(20, 20, 20), boxTris(20, 20, 20).map((v, i) => (i % 3 === 2 ? v : v + 20))]);

test('repair parts surfaces that touch along an edge: every face stays, nothing is cut open or rebuilt', async () => {
	const wasm = await manifold();
	const before = analyze(touching, { wasm });
	assert.ok(before.nonManifoldEdges > 0 && before.openEdges === 0, 'what a TRELLIS mesh comes as');
	assert.equal(checkStatus(before, 'closed-solid'), 'passed');
	const { mesh, report } = await apply(touching, plan(before, { placeOnBed: false }), { wasm });
	assert.equal(report.nonManifoldEdges, 0);
	assert.equal(report.openEdges, 0);
	assert.equal(checkStatus(report, 'closed-solid'), 'passed');
	assert.equal(brokenEdges(mesh), 0, 'as a slicer joins the corners of the STL');
	assert.equal(report.faces, before.faces);
	report.size.forEach((v, k) => assert.ok(Math.abs(v - before.size[k]) < 0.02, `${report.size}`));
});

test('repair closes what it cuts out: a wall inside a box, which manifold refuses', async () => {
	const wasm = await manifold();
	const right = damage(boxTris(10, 20, 20), [10, 11], []).map((v, i) => (i % 3 === 0 ? v + 10 : v));
	const walled = merge([boxTris(10, 20, 20), right]);
	const before = analyze(walled, { wasm });
	assert.ok(before.nonManifoldEdges > 0 && before.openEdges === 0, `${before.nonManifoldEdges} / ${before.openEdges}`);
	assert.equal(checkStatus(before, 'closed-solid'), 'failed');
	const { report } = await apply(walled, plan(before, { placeOnBed: false }), { wasm });
	assert.equal(report.openEdges, 0);
	assert.equal(report.nonManifoldEdges, 0);
	assert.equal(checkStatus(report, 'closed-solid'), 'passed');
});

test('simplify leaves no edges of four faces: a wire thinner than the limit pinches as it collapses', async () => {
	const wasm = await manifold();
	const { Manifold, CrossSection } = wasm;
	const wire = Manifold.revolve(CrossSection.circle(0.03, 6).translate([10, 0]), 300);
	const model = fromManifold(Manifold.union(wire, Manifold.sphere(6, 256)));
	const { mesh, report } = await apply(model, plan(analyze(model), { simplify: { maxDeviation: 0.05 }, placeOnBed: false }), { wasm });
	assert.ok(report.faces < model.length / 9 / 2, `${report.faces} faces`);
	assert.equal(report.nonManifoldEdges, 0);
	assert.equal(brokenEdges(mesh), 0);
	assert.equal(checkStatus(report, 'closed-solid'), 'passed');
});

test('a solid written out has no corners a slicer would join: remesh of what touches', async () => {
	const wasm = await manifold();
	for (const voxel of [0.5, 0.7, 1.3, 1.9]) {
		const { mesh } = await apply(touching, plan(analyze(touching), { repair: false, remesh: { voxel }, placeOnBed: false }), { wasm });
		assert.equal(brokenEdges(mesh), 0, `voxel ${voxel}`);
	}
});

test('from a broken model to files: closed, read back, within the limit, and the original untouched', async () => {
	const wasm = await manifold();
	const copy = broken.slice();
	const before = analyze(broken, { wasm });
	const result = await prepareForPrint(broken, before, { wasm, height: 60, buildVolume: [256, 256, 256] });
	assert.deepEqual(copy, broken);
	assert.ok(result.ready, JSON.stringify(result.report.checks));
	assert.equal(result.files.length, 2);
	assert.ok(result.files.every((f) => f.bytes && f.bytes.length > 100));
	assert.ok(Math.abs(result.report.size[2] - 60) < 0.2, `${result.report.size}`);
	assert.equal(result.flat, false);
});

test('a flat plate is never called ready, however clean', async () => {
	const wasm = await manifold();
	const plate = boxTris(80, 1, 80);
	const result = await prepareForPrint(plate, analyze(plate, { wasm }), { wasm, height: 80 });
	assert.equal(result.flat, true);
	assert.equal(result.ready, false);
});

test('the preview of a heavy model is lighter, and a light model stays itself', async () => {
	const light = icosphere(20, 3);
	assert.equal(await previewMesh(light), light);
	const heavy = icosphere(20, 6);
	const preview = await previewMesh(heavy, 5000);
	assert.ok(preview.length / 9 <= 5000 && preview.length / 9 > 100, `${preview.length / 9}`);
});

test('a crumb above a model does not cost it its height', async () => {
	const wasm = await manifold();
	const speck = boxTris(1, 1, 1).map((v, i) => (i % 3 === 2 ? v + 30 : v));
	const crumbed = merge([ball, speck]);
	const result = await prepareForPrint(crumbed, analyze(crumbed, { wasm }), { wasm, height: 40 });
	assert.equal(result.crumbs, 1);
	assert.ok(Math.abs(result.report.size[2] - 40) < 0.2, `height ${result.report.size[2]}`);
});

test('a torn model is closed at the size it was, and a whole one is left as it was', async () => {
	const wasm = await manifold();
	const whole = icosphere(20, 4);
	const torn = damage(whole, Array.from({ length: 60 }, (_, i) => 200 + i * 7), []);
	const before = analyze(torn, { wasm });
	assert.notEqual(checkStatus(before, 'closed-solid'), 'passed');
	const fixed = await closeUp(torn, before, { wasm, height: before.size[2] });
	assert.equal(checkStatus(fixed.report, 'closed-solid'), 'passed');
	assert.equal(brokenEdges(fixed.mesh), 0);
	assert.ok(Math.abs(fixed.report.size[2] - before.size[2]) < 0.5, `height ${fixed.report.size[2]} from ${before.size[2]}`);

	const untouched = await closeUp(whole, analyze(whole, { wasm }), { wasm, height: 40 });
	assert.equal(untouched.mesh.length, whole.length);
});

test('a generated skin, hollow and torn, is printed as one solid body at the size asked for', async () => {
	const wasm = await manifold();
	let outer = icosphere(20, 4);
	for (const at of [
		[20, 0, 0],
		[0, -20, 0]
	])
		outer = tear(outer, at, 2);
	const skin = join(outer, inward(icosphere(19.6, 4)));
	const before = analyze(skin, { wasm });
	const solid = await makeSolid(skin, wasm, 2e6);
	const r = await prepareForPrint(skin, before, { wasm, height: 80, buildVolume: [256, 256, 256], solid });
	assert.ok(r.ready, r.report.status);
	assert.equal(r.report.components.length, 1);
	assert.equal(r.report.components.filter((c) => c.volume < 0).length, 0);
	assert.ok(Math.abs(r.report.size[2] - 80) < 0.01, `height ${r.report.size[2]}`);
	// a full ball of 40 mm, not a skin: (4/3)π·40³ mm³
	assert.ok(Math.abs(r.report.components[0].volume / ((4 / 3) * Math.PI * 40 ** 3) - 1) < 0.04, `volume ${r.report.components[0].volume}`);
	assert.ok(r.solid && r.solid.voxel > 0 && r.solid.sealed > 3, JSON.stringify(r.solid));
	const stl = r.files.find((f) => f.format === 'stl');
	assert.ok(stl?.ready);
	// as a slicer reads the file: its corners joined exactly
	assert.equal(brokenEdges(parseStl(stl!.bytes!)), 0);
});

test('a model in metres keeps its detail: the solid is made in millimetres', async () => {
	const wasm = await manifold();
	const metres = icosphere(0.02, 5);
	const solid = await makeSolid(metres, wasm, 2e6);
	const r = await prepareForPrint(metres, analyze(metres, { wasm }), { wasm, height: 40, solid });
	assert.ok(r.ready, r.report.status);
	// a ball of 40 mm stays a ball, not a few dozen flat faces
	assert.ok(r.report.faces > 1000, `faces ${r.report.faces}`);
	assert.ok(Math.abs(r.report.components[0].volume / ((4 / 3) * Math.PI * 20 ** 3) - 1) < 0.02, `volume ${r.report.components[0].volume}`);
});

test('a generated skin, hollow and torn, is closed and filled with its surface where it was', async () => {
	const wasm = await manifold();
	let outer = icosphere(20, 4);
	for (const at of [
		[20, 0, 0],
		[0, -20, 0]
	])
		outer = tear(outer, at, 2);
	const skin = join(outer, inward(icosphere(19.6, 4)));
	const before = analyze(skin, { wasm });
	const r = await prepareForPrint(skin, before, { wasm, height: 80, buildVolume: [256, 256, 256] });
	assert.ok(r.ready, r.report.status);
	assert.equal(r.report.components.length, 1);
	assert.equal(r.filled, 1);
	// no grid: away from the two patched tears every corner is still on the ball, twice its size at 80 mm
	const b = bounds(r.mesh);
	// the centre from the sides with no tear: a patched hole flattens the box on its own side
	const centre = [b.min[0] + 40, b.max[1] - 40, b.min[2] + 40];
	const tears = [
		[centre[0] + 40, centre[1], centre[2]],
		[centre[0], centre[1] - 40, centre[2]]
	];
	let worst = 0;
	for (let i = 0; i < r.mesh.length; i += 3) {
		const p = [r.mesh[i], r.mesh[i + 1], r.mesh[i + 2]];
		if (tears.some((t) => Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]) < 6)) continue;
		worst = Math.max(worst, Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]) - 40));
	}
	assert.ok(worst < 0.01, `a corner moved ${worst} mm`);
	assert.equal(r.solid, null);
});
