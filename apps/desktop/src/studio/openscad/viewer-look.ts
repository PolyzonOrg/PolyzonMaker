// The look both 3D viewers share (ScadViewer, PartsViewer): light that moves
// with the camera, so faces turned different ways never shade alike, and thin
// lines on sharp edges, so raised text, a QR code or a rim reads even from
// straight above, where every top face gets the same light.
import * as THREE from 'three';
import { weld } from '$lib/tools/weld';
import { sharpEdges, VIEW_TRIANGLES } from './view-mesh';

/** Above this a mesh is a scan or an AI model: the edges cost too much and say little. */
const EDGE_MAX_TRIANGLES = VIEW_TRIANGLES;

/** Sky and ground light, plus a key light over the viewer's left shoulder. */
export function addLights(scene: THREE.Scene, camera: THREE.Camera): void {
	scene.add(new THREE.HemisphereLight(0xffffff, 0x404046, 1.1));
	const key = new THREE.DirectionalLight(0xffffff, 1.5);
	key.position.set(-0.6, 0.9, 0.4);
	key.target.position.set(0, 0, -1);
	camera.add(key, key.target);
	// Lights on the camera only shine once the camera is in the scene.
	scene.add(camera);
}

/** A mesh material that leaves room for edge lines drawn on its surface. */
export function surfaceMaterial(color?: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.6,
		metalness: 0,
		// Each face lit by its own plane, as an STL's facets are: the geometry
		// needs no normals, and corners can be shared between faces.
		flatShading: true,
		// Pushes the faces back a hair, so the lines on them never flicker.
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1
	});
}

/** The colour of a mesh's edge lines: the same hue, much darker (lighter on a dark mesh). */
export function edgeColor(color: THREE.ColorRepresentation): THREE.Color {
	const c = new THREE.Color(color);
	const hsl = c.getHSL({ h: 0, s: 0, l: 0 });
	return c.setHSL(hsl.h, hsl.s, hsl.l > 0.3 ? hsl.l * 0.42 : Math.min(1, hsl.l + 0.35));
}

/** Lines on the sharp edges of a triangle-soup `geometry`, or null for a mesh too dense to bother. */
export function edgeLines(
	geometry: THREE.BufferGeometry,
	color: THREE.ColorRepresentation
): THREE.LineSegments | null {
	const tris = geometry.getAttribute('position').array as Float32Array;
	if (tris.length / 9 > EDGE_MAX_TRIANGLES) return null;
	return segmentLines(sharpEdges(weld(tris)), color);
}

/** Line segments (six floats each, as sharpEdges() gives them) in the edge colour. */
export function segmentLines(
	segments: Float32Array,
	color: THREE.ColorRepresentation
): THREE.LineSegments {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(segments, 3));
	return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: edgeColor(color) }));
}

/** Frees an edge-line object made by edgeLines(). */
export function disposeLines(lines: THREE.LineSegments | null): void {
	if (!lines) return;
	lines.removeFromParent();
	lines.geometry.dispose();
	(lines.material as THREE.Material).dispose();
}
