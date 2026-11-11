import { assert, test } from 'vitest';
import { meshStats, merge, translate, type Triangles } from '../src/stl.js';
import { weld } from '../src/weld.js';
import { earClip } from '../src/mesh-triangulate.js';
import {
	fillHoles,
	orientConsistently,
	removeDegenerate,
	removeDuplicates,
	repairMesh,
	toTriangles,
	toWorkMesh,
	type RepairOptions
} from '../src/mesh-repair.js';

type V = [number, number, number];

/** A 10 mm cube, 12 triangles wound counter-clockwise from outside. */
function cubeFaces(s = 10): V[][] {
	const v = (x: number, y: number, z: number): V => [x * s, y * s, z * s];
	return [
		[v(0, 0, 0), v(0, 1, 0), v(1, 1, 0)],
		[v(0, 0, 0), v(1, 1, 0), v(1, 0, 0)],
		[v(0, 0, 1), v(1, 0, 1), v(1, 1, 1)],
		[v(0, 0, 1), v(1, 1, 1), v(0, 1, 1)],
		[v(0, 0, 0), v(1, 0, 0), v(1, 0, 1)],
		[v(0, 0, 0), v(1, 0, 1), v(0, 0, 1)],
		[v(0, 1, 0), v(0, 1, 1), v(1, 1, 1)],
		[v(0, 1, 0), v(1, 1, 1), v(1, 1, 0)],
		[v(0, 0, 0), v(0, 0, 1), v(0, 1, 1)],
		[v(0, 0, 0), v(0, 1, 1), v(0, 1, 0)],
		[v(1, 0, 0), v(1, 1, 0), v(1, 1, 1)],
		[v(1, 0, 0), v(1, 1, 1), v(1, 0, 1)]
	];
}

const soup = (faces: V[][]): Triangles => new Float32Array(faces.flat(2));
const flipped = (f: V[]): V[] => [f[0], f[2], f[1]];

function signedVolume(tris: Triangles): number {
	let v = 0;
	for (let i = 0; i < tris.length; i += 9) {
		const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.subarray(i, i + 9);
		v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
	}
	return v / 6;
}

function consistentlyWound(tris: Triangles): boolean {
	const { indices } = weld(tris, 1e-4);
	const seen = new Set<string>();
	for (let t = 0; t < indices.length; t += 3) {
		for (let k = 0; k < 3; k++) {
			const key = `${indices[t + k]}>${indices[t + ((k + 1) % 3)]}`;
			if (seen.has(key)) return false;
			seen.add(key);
		}
	}
	for (const key of seen) {
		const [a, b] = key.split('>');
		if (!seen.has(`${b}>${a}`)) return false;
	}
	return true;
}

const STANDARD: RepairOptions = { mode: 'standard', removeShells: false };

function expectSolidCube(tris: Triangles, size = 10) {
	const stats = meshStats(tris);
	assert.equal(stats.watertight, true);
	assert.equal(consistentlyWound(tris), true);
	assert.ok(Math.abs(signedVolume(tris) - size ** 3) < 1e-3, `volume ${signedVolume(tris)}`);
	assert.equal(stats.degenerate, 0);
}

test('an intact cube passes through unchanged', () => {
	const { tris, report } = repairMesh(soup(cubeFaces()), STANDARD);
	expectSolidCube(tris);
	assert.equal(tris.length / 9, 12);
	assert.equal(report.weldedVertices, 36 - 8);
	assert.deepEqual(
		[report.degenerate, report.duplicates, report.flipped, report.holesFilled],
		[0, 0, 0, 0]
	);
});

test('a missing face is closed', () => {
	const open = cubeFaces().filter((_, i) => i !== 2 && i !== 3);
	assert.equal(meshStats(soup(open)).openEdges, 4);
	const { tris, report } = repairMesh(soup(open), STANDARD);
	expectSolidCube(tris);
	assert.equal(report.holesFilled, 1);
	assert.equal(report.holeTriangles, 2);
});

test('fillHoles closes the loop with faces wound like their neighbours', () => {
	const { mesh } = toWorkMesh(soup(cubeFaces().slice(2)));
	const filled = fillHoles(mesh);
	assert.deepEqual(filled, { holes: 1, triangles: 2 });
	expectSolidCube(toTriangles(mesh));
});

test('a flipped face is turned back', () => {
	const faces = cubeFaces();
	faces[5] = flipped(faces[5]);
	assert.equal(consistentlyWound(soup(faces)), false);
	const { mesh } = toWorkMesh(soup(faces));
	assert.equal(orientConsistently(mesh), 1);
	const { tris, report } = repairMesh(soup(faces), STANDARD);
	expectSolidCube(tris);
	assert.equal(report.flipped, 1);
});

test('a cube turned inside out is turned outward', () => {
	const { tris, report } = repairMesh(soup(cubeFaces().map(flipped)), STANDARD);
	expectSolidCube(tris);
	assert.equal(report.flipped, 12);
});

test('a sealed cavity stays a cavity; one turned the wrong way is turned inward', () => {
	// A 30 mm cube with a 20 mm hollow inside: the inner surface faces inward.
	const outer = cubeFaces(3).map((f) => f.map(([x, y, z]): V => [x * 10, y * 10, z * 10]));
	const inner = cubeFaces(2).map((f) =>
		flipped(f).map(([x, y, z]): V => [x * 10 + 5, y * 10 + 5, z * 10 + 5])
	);
	const hollow = 30 ** 3 - 20 ** 3;
	const kept = repairMesh(soup([...outer, ...inner]), STANDARD);
	assert.equal(kept.report.flipped, 0);
	assert.ok(Math.abs(signedVolume(kept.tris) - hollow) < 1e-3, `${signedVolume(kept.tris)}`);
	// The cavity's surface turned outward by mistake is turned back in.
	const wrong = cubeFaces(2).map((f) =>
		f.map(([x, y, z]): V => [x * 10 + 5, y * 10 + 5, z * 10 + 5])
	);
	const fixed = repairMesh(soup([...outer, ...wrong]), STANDARD);
	assert.equal(fixed.report.flipped, 12);
	assert.ok(Math.abs(signedVolume(fixed.tris) - hollow) < 1e-3);
	assert.equal(meshStats(fixed.tris).misoriented, 0);
});

test('a part that only overlaps another is no cavity, though a corner of it is inside', () => {
	// CAD parts overlap on purpose: a blade root in the spinner, a cowl over the body
	const outer = cubeFaces(3).map((f) => f.map(([x, y, z]): V => [x * 10, y * 10, z * 10]));
	const through = cubeFaces(2).map((f) => f.map(([x, y, z]): V => [x * 10 + 15, y * 10 + 5, z * 10 + 5]));
	const { tris, report } = repairMesh(soup([...outer, ...through]), STANDARD);
	assert.equal(report.flipped, 0);
	assert.ok(Math.abs(signedVolume(tris) - (30 ** 3 + 20 ** 3)) < 1e-3, `${signedVolume(tris)}`);
});

test('inside-out faces are counted by the stats', () => {
	const faces = cubeFaces();
	faces[5] = flipped(faces[5]);
	const stats = meshStats(soup(faces));
	assert.equal(stats.watertight, true);
	assert.equal(stats.misoriented, 3);
	assert.equal(meshStats(soup(cubeFaces())).misoriented, 0);
});

test('duplicate faces are removed, in either winding', () => {
	const faces = cubeFaces();
	faces.push(faces[0], flipped(faces[7]));
	assert.equal(meshStats(soup(faces)).nonManifoldEdges > 0, true);
	const { mesh } = toWorkMesh(soup(faces));
	assert.equal(removeDuplicates(mesh), 2);
	const { tris, report } = repairMesh(soup(faces), STANDARD);
	expectSolidCube(tris);
	assert.equal(report.duplicates, 2);
});

test('degenerate faces go: collapsed ones dropped, a flat cap folded into its neighbour', () => {
	const faces = cubeFaces();
	// Split the edge A–B of the first bottom triangle at its middle M and
	// close the T-junction with the flat cap (M, A, B).
	const [A, B, C] = faces[0];
	const M: V = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
	faces[0] = [A, M, C];
	faces.push([M, B, C], [M, A, B]);
	// And a sliver whose corners coincide.
	faces.push([A, A, C]);
	const before = meshStats(soup(faces));
	assert.equal(before.degenerate, 2);
	const { mesh } = toWorkMesh(soup(faces));
	assert.equal(removeDegenerate(mesh), 1);
	const { tris, report } = repairMesh(soup(faces), STANDARD);
	expectSolidCube(tris);
	assert.equal(report.degenerate, 2);
});

test('the minimal mode leaves holes and winding alone', () => {
	const faces = cubeFaces().filter((_, i) => i !== 2 && i !== 3);
	faces[0] = flipped(faces[0]);
	const { tris, report } = repairMesh(soup(faces), { mode: 'minimal', removeShells: false });
	assert.equal(meshStats(tris).openEdges, 4);
	assert.equal(report.holesFilled, 0);
	assert.equal(report.flipped, 0);
});

test('loose bits are dropped on request', () => {
	const model = merge([soup(cubeFaces()), translate(soup(cubeFaces(0.5)), 50, 0, 0)]);
	const kept = repairMesh(model, STANDARD);
	assert.equal(kept.tris.length / 9, 24);
	const { tris, report } = repairMesh(model, { mode: 'standard', removeShells: true });
	expectSolidCube(tris);
	assert.equal(report.shellsRemoved, 1);
});

test('a model in a cloud of 200 000 specks, as a noisy scan comes, keeps the model and drops the specks', () => {
	const specks = new Float32Array(200_000 * 9);
	for (let i = 0; i < 200_000; i++) {
		const [x, y] = [100 + (i % 500), Math.floor(i / 500)];
		specks.set([x, y, 0, x + 0.01, y, 0, x, y + 0.01, 0], i * 9);
	}
	const { tris, report } = repairMesh(merge([soup(cubeFaces()), specks]), { mode: 'minimal', removeShells: true });
	assert.equal(report.shellsRemoved, 200_000);
	assert.equal(tris.length / 9, 12);
});

test('the aggressive mode cuts out a fin on an edge and closes the gap', () => {
	const faces = cubeFaces();
	const [A, B] = [faces[4][0], faces[4][1]]; // the bottom front edge
	faces.push([A, B, [5, -10, -5]]);
	assert.ok(meshStats(soup(faces)).nonManifoldEdges > 0);
	const { tris, report } = repairMesh(soup(faces), { mode: 'aggressive', removeShells: false });
	const stats = meshStats(tris);
	assert.equal(stats.watertight, true);
	assert.equal(consistentlyWound(tris), true);
	assert.equal(report.nonManifold, 3);
	assert.ok(signedVolume(tris) > 0);
});

test('ear clipping handles concave outlines and collinear corners', () => {
	// An L shape, counter-clockwise.
	const l = [0, 0, 2, 0, 2, 1, 1, 1, 1, 2, 0, 2];
	const tl = earClip(l);
	assert.ok(tl);
	assert.equal(tl.length / 3, 4);
	// A triangle with two extra points on one edge: no flat triangles come out.
	const t = [0, 0, 4, 0, 0, 4, 0, 3, 0, 1];
	const tt = earClip(t);
	assert.ok(tt);
	for (let i = 0; i < tt.length; i += 3) {
		const [a, b, c] = [tt[i], tt[i + 1], tt[i + 2]];
		const area =
			(t[2 * b] - t[2 * a]) * (t[2 * c + 1] - t[2 * a + 1]) -
			(t[2 * b + 1] - t[2 * a + 1]) * (t[2 * c] - t[2 * a]);
		assert.ok(area > 0);
	}
});
