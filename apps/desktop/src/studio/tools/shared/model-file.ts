/**
 * An uploaded model → triangle soup in millimetres, Z up, for every tool that
 * takes a model. STL, OBJ and 3MF go through our own readers (`mesh-import`);
 * GLB through the three.js loader, loaded only when such a file arrives.
 * The file never leaves the browser.
 */
import type { Mesh, Object3D } from 'three';
import { ToolError } from '../build.svelte';
import { merge, writeStl, type Triangles } from '../stl';
import { importMesh } from './mesh-import';
import * as tc from '$msg/tools/common';

export const MODEL_ACCEPT = '.stl,.obj,.3mf,.glb';
export const modelHint = () => tc.tc_model_hint();

export async function readModelFile(file: File): Promise<Triangles> {
	const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
	const buffer = await file.arrayBuffer();
	try {
		const tris =
			ext === 'glb' ? await readGlb(buffer) : await importMesh(file.name, new Uint8Array(buffer));
		if (tris.length < 9) throw new ToolError(tc.tc_file_no_triangles());
		return tris;
	} catch (e) {
		if (e instanceof ToolError) throw e;
		// importMesh says what is wrong in a ToolError; anything else is a parser crash.
		throw new ToolError(tc.tc_file_unreadable());
	}
}

/**
 * The file as a worker reads it with `importMesh`: as it is, except GLB,
 * whose loader needs the page — it arrives already turned into STL.
 */
export async function modelForWorker(file: File): Promise<{ name: string; bytes: Uint8Array }> {
	if (!/\.glb$/i.test(file.name))
		return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
	return { name: file.name.replace(/\.glb$/i, '.stl'), bytes: writeStl(await readModelFile(file)) };
}

/** glTF is Y-up by definition; turned to Z-up like every other format here. */
async function readGlb(buffer: ArrayBuffer): Promise<Triangles> {
	const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
	const root: Object3D = (await new GLTFLoader().parseAsync(buffer, '')).scene;
	root.updateMatrixWorld(true);
	const parts: Float32Array[] = [];
	root.traverse((object) => {
		const mesh = object as Mesh;
		if (!mesh.isMesh) return;
		let geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
		if (geometry.index) geometry = geometry.toNonIndexed();
		const position = geometry.getAttribute('position');
		const count = position.count - (position.count % 3);
		const out = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			out[i * 3] = position.getX(i);
			out[i * 3 + 1] = -position.getZ(i);
			out[i * 3 + 2] = position.getY(i);
		}
		geometry.dispose();
		parts.push(out);
	});
	const tris = merge(parts);
	// glTF counts in metres: a model under 2 units across is in metres (a 5 cm
	// figurine is 0.05) and becomes millimetres; a bigger one was saved in mm.
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < tris.length; i++) {
		const k = i % 3;
		if (tris[i] < lo[k]) lo[k] = tris[i];
		if (tris[i] > hi[k]) hi[k] = tris[i];
	}
	const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
	if (size > 0 && size < 2) for (let i = 0; i < tris.length; i++) tris[i] *= 1000;
	return tris;
}
