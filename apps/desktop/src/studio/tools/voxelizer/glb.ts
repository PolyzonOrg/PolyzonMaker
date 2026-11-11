/**
 * Triangles (Z up, mm) → binary glTF for 3D programs: Y up and metres as
 * glTF wants (a 100 mm model opens 0.1 m tall, not 100 m), flat-shaded cubes. This module (and with it
 * three.js and the exporter) loads only when someone asks for a GLB. Named
 * imports keep three.js tree-shaken; `import('three')` would pull in all of it.
 */
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import type { Triangles } from '../stl';

export async function toGlb(tris: Triangles): Promise<Uint8Array> {
	const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
	const yUp = new Float32Array(tris.length);
	for (let i = 0; i < tris.length; i += 3) {
		yUp[i] = tris[i] / 1000;
		yUp[i + 1] = tris[i + 2] / 1000;
		yUp[i + 2] = -tris[i + 1] / 1000;
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(yUp, 3));
	geometry.computeVertexNormals(); // a vertex per corner: one normal per face
	const material = new MeshStandardMaterial({ color: 0xc9c9cc, roughness: 0.6 });
	const out = await new GLTFExporter().parseAsync(new Mesh(geometry, material), {
		binary: true
	});
	geometry.dispose();
	material.dispose();
	if (!(out instanceof ArrayBuffer)) throw new Error('GLB export failed');
	return new Uint8Array(out);
}
