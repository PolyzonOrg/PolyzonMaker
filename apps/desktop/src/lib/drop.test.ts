import { readGlb } from '@polyzon/mesh-kit';
import { describe, expect, it } from 'vitest';
import { isModelFile, libraryFile } from './drop';

const stl = new TextEncoder().encode('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t\n');
const obj = new TextEncoder().encode('v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n');

describe('a file dropped on the window', () => {
	it('is a 3D model by its name, in any case, and a picture is not one', () => {
		for (const name of ['part.stl', 'Part.STL', 'mug.obj', 'plate.3mf', 'scan.glb']) expect(isModelFile(name)).toBe(true);
		for (const name of ['cat.png', 'photo.jpeg', 'notes.txt', 'stl', 'model.gltf']) expect(isModelFile(name)).toBe(false);
	});

	it('goes into the library as the tools put a model there: the same triangles, at the same size', async () => {
		for (const [name, bytes] of [['part.stl', stl], ['mug.obj', obj]] as const) {
			const glb = await libraryFile(name, bytes);
			expect(new TextDecoder().decode(glb.subarray(0, 4))).toBe('glTF');
			expect([...readGlb(glb)].map((v) => Math.round(v * 1000) / 1000 + 0)).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]);
		}
	});

	it('keeps a GLB as it is, and refuses what is no model', async () => {
		const glb = await libraryFile('part.stl', stl);
		expect(await libraryFile('scan.glb', glb)).toBe(glb);
		await expect(libraryFile('broken.stl', new Uint8Array([1, 2, 3]))).rejects.toThrow();
	});
});
