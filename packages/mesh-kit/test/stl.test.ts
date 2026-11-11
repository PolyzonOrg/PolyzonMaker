import { expect, test } from 'vitest';
import { bounds, meshStats, parseStl, placeOnBed, writeStl } from '../src/stl.js';
import { unweld, weld } from '../src/weld.js';
import { boxTris } from './helpers.js';

const box = () => boxTris(10, 20, 30);

test('binary STL round-trips through write and parse', () => {
	const tris = box();
	expect(Array.from(parseStl(writeStl(tris)))).toEqual(Array.from(tris));
});

test('ASCII STL is read too', () => {
	const ascii = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
	expect(parseStl(new TextEncoder().encode(ascii)).length).toBe(9);
	expect(() => parseStl(new TextEncoder().encode('hello'))).toThrow(
		expect.objectContaining({ code: 'not-stl' })
	);
});

test('stats of a closed box: volume, area, centre, watertight', () => {
	const s = meshStats(box());
	expect(s.triangles).toBe(12);
	expect(s.volume).toBeCloseTo(6000, 6);
	expect(s.area).toBeCloseTo(2 * (200 + 300 + 600), 6);
	expect(s.centerOfMass.map((c) => Math.round(c * 1000) / 1000)).toEqual([5, 10, 15]);
	expect(s.watertight).toBe(true);
	expect(s.openEdges).toBe(0);
});

test('a missing face shows up as open edges', () => {
	const s = meshStats(box().slice(0, 9 * 10));
	expect(s.watertight).toBe(false);
	expect(s.openEdges).toBe(4);
});

test('placement: on the bed and centred', () => {
	expect(bounds(placeOnBed(box())).min).toEqual([-5, -10, 0]);
});

test('weld: coincident corners become one vertex; the soup comes back unchanged', () => {
	// Two triangles sharing an edge: 6 corners, 4 distinct points.
	const tris = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
	const mesh = weld(tris);
	expect(mesh.positions.length / 3).toBe(4);
	expect(mesh.indices.length).toBe(6);
	expect(Array.from(unweld(mesh))).toEqual(Array.from(tris));
});

test('weld: corners within tolerance meet; collapsed triangles are dropped', () => {
	const tris = new Float32Array([0, 0, 0, 1, 0, 0, 0.00001, 0.00001, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
	expect(weld(tris, 1e-4).indices.length).toBe(3);
});
