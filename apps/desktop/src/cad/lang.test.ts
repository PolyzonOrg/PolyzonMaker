// The language on the real kernels: what a program says against what comes out.
import { beforeAll, describe, expect, it } from 'vitest';
import * as replicad from 'replicad';
import opencascade from 'replicad-opencascadejs';
import Manifold from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { runCadProgram, type CadPart } from '../studio/cad/program';
import { withLanguage, type Param } from './lang';

let mf: ManifoldToplevel;

beforeAll(async () => {
	const oc = await opencascade();
	replicad.setOC(oc);
	mf = await Manifold();
	mf.setup();
	replicad.setManifold(mf);
}, 60_000);

async function build(code: string, extra: { values?: Record<string, number>; programs?: Record<string, string> } = {}) {
	const warnings: string[] = [];
	const params: Param[] = [];
	const parts = await runCadProgram(replicad, code, withLanguage({ ...extra, params }, { warnings, manifold: mf }, replicad));
	return { parts, warnings, params };
}

const box = (p: CadPart) => {
	const [min, max] = p.shape.boundingBox.bounds as number[][];
	return { min: min.map((v) => +v.toFixed(2) + 0), max: max.map((v) => +v.toFixed(2) + 0) };
};

describe('a new shape', () => {
	it('stands on the ground, centred', async () => {
		for (const code of ['box(10, 20, 30)', 'cyl(5, 30)', 'cone(5, 2, 30)', 'loft("z", [[0, 10, 10], [30, 10, 10]])', 'soft(10, 10, 30)']) {
			const { parts } = await build(`return ${code}`);
			const { min, max } = box(parts[0]);
			expect(min[2], code).toBeCloseTo(0, 0);
			expect(max[2], code).toBeCloseTo(30, 0);
			expect(min[0] + max[0], code).toBeCloseTo(0, 1);
			expect(min[1] + max[1], code).toBeCloseTo(0, 1);
		}
	});

	it('says what is wrong on the line it was called', async () => {
		await expect(build('const a = box(10, 20)\nreturn a')).rejects.toThrow(/box\(w, d, h, radius\): h must be a number above 0, got nothing/);
		await expect(build('const a = box(1, 1, 1)\nconst b = a.on(5)\nreturn b')).rejects.toThrow(/line 2/);
	});
});

describe('placing', () => {
	it('at means the middle of the underside', async () => {
		const { parts } = await build('return box(10, 10, 10).at(100, 50, 20)');
		expect(box(parts[0])).toEqual({ min: [95, 45, 20], max: [105, 55, 30] });
	});

	it('on stands a shape on top of another, centred', async () => {
		const { parts } = await build(`
			const base = box(100, 60, 10).at(30, 0, 0)
			const post = cyl(5, 40).on(base)
			return { post }`);
		expect(box(parts[0]).min[2]).toBeCloseTo(10);
		expect(box(parts[0]).max[2]).toBeCloseTo(50);
		expect(box(parts[0]).min[0]).toBeCloseTo(25);
	});

	it('on a side turns the shape to face out, with u to the right and v up as seen from outside', async () => {
		const { parts } = await build(`
			const tv = box(100, 10, 60)
			return { knob: cyl(2, 5).on(tv, 'front', 30, 10) }`);
		const { min, max } = box(parts[0]);
		expect(min[1]).toBeCloseTo(-10);
		expect(max[1]).toBeCloseTo(-5);
		expect((min[0] + max[0]) / 2).toBeCloseTo(30);
		expect((min[2] + max[2]) / 2).toBeCloseTo(40);
	});

	it('every side faces out of the shape', async () => {
		for (const [side, axis, sign] of [['back', 1, 1], ['left', 0, -1], ['right', 0, 1], ['bottom', 2, -1], ['top', 2, 1]] as const) {
			const { parts } = await build(`const b = box(100, 100, 100).mid(0, 0, 0)\nreturn cyl(2, 5).on(b, '${side}')`);
			const { min, max } = box(parts[0]);
			const far = sign > 0 ? max[axis] : -min[axis];
			expect(far, side).toBeCloseTo(55);
		}
	});

	it('lands on the real surface of a curved body', async () => {
		const { parts } = await build(`
			const hill = ball(50)
			return { flag: cyl(1, 20).on(hill, 'top', 30, 0) }`);
		expect(box(parts[0]).min[2]).toBeCloseTo(90, 0);
	});

	it('warns when there is nothing at that point of the surface', async () => {
		const { warnings } = await build(`
			const hill = ball(50)
			return { flag: cyl(1, 20).on(hill, 'top', 49.9, 49.9) }`);
		expect(warnings.join()).toMatch(/placed on its bounding box/);
	});

	it('to comes up against a side without turning', async () => {
		const { parts } = await build(`
			const wall = box(10, 100, 100)
			return { peg: box(20, 20, 40).to(wall, 'right') }`);
		const { min, max } = box(parts[0]);
		expect(min[0]).toBeCloseTo(5);
		expect(max[0]).toBeCloseTo(25);
		expect(max[2] - min[2]).toBeCloseTo(40);
	});

	it('sink goes into the surface', async () => {
		const { parts } = await build('return cyl(5, 10).on(box(50, 50, 10), "top", 0, 0, 2)');
		expect(box(parts[0]).min[2]).toBeCloseTo(8);
	});

	it('p gives points of the box by fractions', async () => {
		const { parts } = await build('const b = box(100, 60, 20)\nreturn cyl(1, 1).at(b.p(1, -1, 1))');
		expect(box(parts[0]).min[2]).toBeCloseTo(20);
		expect(box(parts[0]).min[0]).toBeCloseTo(49);
	});
});

describe('copies', () => {
	it('both mirrors across the middle plane', async () => {
		const { parts } = await build('return { wheels: cyl(5, 5).at(50, 0, 0).both() }');
		expect(parts.length).toBe(2);
		expect(box(parts[1]).min[0]).toBeCloseTo(-55);
	});

	it('grid spreads copies around where the shape is', async () => {
		const { parts } = await build('return { legs: box(4, 4, 70).grid(2, 2, 100, 60) }');
		expect(parts.length).toBe(4);
		const all = parts.map(box);
		expect(Math.min(...all.map((b) => b.min[0]))).toBeCloseTo(-52);
		expect(Math.max(...all.map((b) => b.max[1]))).toBeCloseTo(32);
	});

	it('ring puts copies on a circle', async () => {
		const { parts } = await build('return { bolts: cyl(2, 5).ring(4, 40) }');
		expect(parts.length).toBe(4);
		expect(Math.max(...parts.map((p) => box(p).max[0]))).toBeCloseTo(42);
	});
});

describe('shaping', () => {
	const volume = (p: CadPart) => replicad.measureVolume(p.shape as replicad.Shape3D);

	it('hole goes through from the top at the given points', async () => {
		const { parts } = await build('const p = box(40, 40, 5)\nreturn p.hole(4, p.corners(5))');
		const hole = Math.PI * 2 * 2 * 5;
		expect(volume(parts[0])).toBeCloseTo(40 * 40 * 5 - 4 * hole, 0);
	});

	it('hole stops at its depth', async () => {
		const { parts } = await build('return box(40, 40, 20).hole(4, [[0, 0]], 10)');
		expect(volume(parts[0])).toBeCloseTo(40 * 40 * 20 - Math.PI * 4 * 10, 0);
	});

	it('hole drills from a side as seen from outside', async () => {
		const { parts } = await build('return box(40, 20, 40).hole(4, [[10, 5]], undefined, "front")');
		expect(volume(parts[0])).toBeCloseTo(40 * 20 * 40 - Math.PI * 4 * 20, 0);
	});

	it('add makes one body, cut takes away, keep leaves what is shared', async () => {
		const { parts } = await build(`
			const a = box(10, 10, 10)
			const b = box(10, 10, 10).x(5)
			return { joined: a.add(b), taken: a.cut(b), shared: a.keep(b) }`);
		expect(volume(parts[0])).toBeCloseTo(1500);
		expect(volume(parts[1])).toBeCloseTo(500);
		expect(volume(parts[2])).toBeCloseTo(500);
	});

	it('round on a box smooths it, and a radius too big for it still builds', async () => {
		const { parts } = await build('return { a: box(20, 20, 20, 3), b: box(20, 20, 4, 9) }');
		expect(volume(parts[0])).toBeLessThan(8000);
		expect(volume(parts[1])).toBeLessThan(1600);
	});

	it('shell leaves walls and an opening', async () => {
		const { parts } = await build('return box(40, 40, 40).shell(2)');
		expect(volume(parts[0])).toBeCloseTo(40 ** 3 - 36 * 36 * 38, 0);
	});

	it('patch lays a coloured skin on a curved body', async () => {
		const { parts } = await build(`
			const hull = loft('y', [[-50, 10, 10], [0, 40, 40], [50, 10, 10]])
			return { body: hull.patch(box(100, 30, 100).at(0, 0, 0).z(-20), 0.5, 'blue') }`);
		expect(parts.length).toBe(2);
		expect(parts[1].color).toBe('#2f6bc4');
	});

	it('patches stack, and a region that misses only warns', async () => {
		const { parts, warnings } = await build(`
			const hull = loft('y', [[-50, 10, 10], [0, 40, 40], [50, 10, 10]])
			return { body: hull.patch(box(100, 20, 100).at(0, -20, -20), .5, 'blue').patch(box(100, 20, 100).at(0, 20, -20), .5, 'red').patch(box(10, 10, 10).at(500, 0, 0)) }`);
		expect(parts.map((p) => p.color).filter(Boolean)).toEqual(['#2f6bc4', '#c8342c']);
		expect(warnings.join()).toMatch(/touches nothing/);
	});

	it('colours come by name and by #rrggbb, and a wrong one is refused', async () => {
		const { parts } = await build('return { a: box(1, 1, 1).color("red"), b: box(1, 1, 1).color("#123456") }');
		expect(parts[0].color).toBe('#c8342c');
		expect(parts[1].color).toBe('#123456');
		await expect(build('return box(1, 1, 1).color("nice")')).rejects.toThrow(/no colour/);
	});
});

describe('parts', () => {
	it('are named by what is returned, nested too', async () => {
		const { parts } = await build('return { body: box(1, 1, 1), door: { left: box(1, 1, 1), right: box(1, 1, 1) }, wheels: [box(1, 1, 1), box(1, 1, 1)] }');
		expect(parts.map((p) => p.name)).toEqual(['body', 'door left', 'door right', 'wheels 1', 'wheels 2']);
	});

	it('a group keeps its bodies and colours', async () => {
		const { parts } = await build(`
			const lamp = group(cyl(10, 2).color('black'), ball(8).at(0, 0, 2).color('yellow'))
			return { lamp: lamp.at(100, 0, 0) }`);
		expect(parts.map((p) => p.color)).toEqual(['#1b1b1f', '#e6bc2e']);
		expect(box(parts[1]).min[0]).toBeCloseTo(92);
	});

	it('take place, paint and drop from anywhere in the program', async () => {
		const { parts } = await build(`
			place('b', 0, 0, 100)
			paint('b', 'red')
			drop('c')
			return { a: box(10, 10, 10), b: box(10, 10, 10), c: box(10, 10, 10) }`);
		expect(parts.map((p) => p.name)).toEqual(['a', 'b']);
		expect(box(parts[1]).min[2]).toBeCloseTo(100);
		expect(parts[1].color).toBe('#c8342c');
	});

	it('can be named on the way, with no return at all', async () => {
		const { parts } = await build("part('plate', box(10, 10, 1))\npart('peg', cyl(1, 5))");
		expect(parts.map((p) => p.name)).toEqual(['plate', 'peg']);
	});
});

describe('scenes', () => {
	const programs = { table: "const w = param('width', 100, 50, 200)\nreturn { top: box(w, 60, 4).at(0, 0, 70).color('wood'), legs: box(4, 4, 70).grid(2, 2, w - 10, 50) }" };

	it('use another program as one shape, with its colours', async () => {
		const { parts } = await build("return { table: use('table').at(200, 0, 0) }", { programs });
		expect(parts.length).toBe(5);
		expect(parts[0].color).toBe('#b08355');
		expect(box(parts[0]).min[0]).toBeCloseTo(150);
	});

	it('set its parameters', async () => {
		const { parts } = await build("return { table: use('table', { width: 160 }) }", { programs });
		expect(box(parts[0]).max[0]).toBeCloseTo(80);
	});

	it('say what is missing, and refuse a program using itself', async () => {
		await expect(build("return use('chair')", { programs })).rejects.toThrow(/no program named «chair»/);
		await expect(build("return use('a')", { programs: { a: "return use('a')" } })).rejects.toThrow(/uses itself/);
	});
});

describe('outlines', () => {
	it('stand along their axis, centred across it', async () => {
		const { parts } = await build(`return {
			side: profile('x', [[0, 0], [100, 0], [100, 20], [0, 20]], 10),
			front: profile('y', [[0, 0], [100, 0], [100, 20], [0, 20]], 10),
			top: profile('z', [[0, 0], [100, 0], [100, 20], [0, 20]], 10)
		}`);
		const [side, front, top] = parts.map(box);
		expect(side.min).toEqual([-5, 0, 0]);
		expect(side.max).toEqual([5, 100, 20]);
		expect(front.min).toEqual([0, -5, 0]);
		expect(front.max).toEqual([100, 5, 20]);
		expect(top.max).toEqual([100, 20, 5]);
	});

	it('sweep along a path', async () => {
		const { parts } = await build('return sweep([[-2, -2], [2, -2], [2, 2], [-2, 2]], [[0, 0, 0], [0, 0, 50], [0, 30, 80]])');
		expect(box(parts[0]).max[2]).toBeGreaterThan(70);
	});
});

describe('params', () => {
	it('are listed with their limits and take values from the window, kept inside them', async () => {
		const first = await build('const w = param("width", 100, 40, 300)\nreturn box(w, 10, 10)');
		expect(first.params).toEqual([{ name: 'width', value: 100, min: 40, max: 300, step: 1 }]);
		const set = await build('const w = param("width", 100, 40, 300)\nreturn box(w, 10, 10)', { values: { width: 500 } });
		expect(box(set.parts[0]).max[0]).toBeCloseTo(150);
	});
});

describe('ready parts', () => {
	it('wing goes out along X with its chord along Y', async () => {
		const { parts } = await build('return wing(100, 40, 20, { sweep: 10, rise: 5 })');
		const { min, max } = box(parts[0]);
		expect(min[0]).toBeCloseTo(0);
		expect(max[0]).toBeCloseTo(100);
		expect(max[1] - min[1]).toBeGreaterThan(38);
	});

	it('wing and rotor face outward, as a slicer reads them', async () => {
		// an inside-out wing that overlaps the body cancels it there: the slicer prints holes
		const signed = (p: CadPart) => {
			const { vertProperties: v, triVerts: t, numProp: n } = (p.shape as unknown as { wrapped: { getMesh(): { vertProperties: Float32Array; triVerts: Uint32Array; numProp: number } } }).wrapped.getMesh();
			let sum = 0;
			for (let i = 0; i < t.length; i += 3) {
				const [a, b, c] = [t[i] * n, t[i + 1] * n, t[i + 2] * n];
				sum += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
			}
			return sum / 6;
		};
		const { parts } = await build('return { w: wing(100, 40, 20, { twist: -3 }), r: rotor(2, 80, 12) }');
		const meshes = parts.filter((p) => p.shape instanceof replicad.MeshShape);
		expect(meshes.length).toBeGreaterThan(1);
		for (const p of meshes) expect(signed(p), p.name).toBeGreaterThan(0);
	});

	it('wheel stands on the ground with its axle along X', async () => {
		const { parts } = await build('return wheel(30, 20)');
		const { min, max } = box(parts[0]);
		expect(min[2]).toBeCloseTo(0);
		expect(max[2]).toBeCloseTo(60);
		expect(max[0] - min[0]).toBeCloseTo(20);
	});

	it('rotor, gear, spring and bar build', async () => {
		const { parts } = await build('return { a: rotor(3, 100, 12), b: gear(16, 2, 6, 5), c: spring(10, 2, 5, 40), d: bar([[0, 0, 0], [0, 50, 20], [50, 50, 40]], 3) }');
		expect(parts.length).toBeGreaterThanOrEqual(4);
	});
});
