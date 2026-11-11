// The view commands for the scenes this program does not draw itself: OpenSCAD's and the tools' viewer comes
// from Studio and is copied as it is, so the commands reach into it from here instead of being written into it.
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ScadViewer } from '../studio/openscad/three-viewer';
import { distanceFor, percentOf, sideOf, type Look, type Side, type Viewable } from './view-kit';

/** A surface look on every mesh under `root`; each keeps its own material and gets it back. */
export function applyLook(root: THREE.Object3D, look: Look) {
	const normals = (root.userData.normals ??= new THREE.MeshNormalMaterial()) as THREE.MeshNormalMaterial;
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const own = (o.userData.own ??= o.material) as THREE.MeshStandardMaterial;
		o.userData.rough ??= own.roughness;
		o.material = look === 'normals' ? normals : own;
		if ('roughness' in own) own.roughness = look === 'glossy' ? 0.18 : o.userData.rough;
		own.wireframe = look === 'wire';
	});
}

/** What the Studio viewer keeps to itself; the fields are there at run time. */
interface Inside {
	camera: THREE.PerspectiveCamera;
	controls: OrbitControls;
	mesh: THREE.Mesh | null;
	requestRender: () => void;
}

export type SceneView = Viewable & {
	/** After a new model came in: the look chosen stays. */
	again(): void;
};

export function sceneView(viewer: ScadViewer): SceneView {
	const inside = viewer as unknown as Inside;
	const listeners: ((percent: number) => void)[] = [];
	let look: Look = 'clay';
	let framed = false;
	const sphere = () => (inside.mesh ? new THREE.Box3().setFromObject(inside.mesh).getBoundingSphere(new THREE.Sphere()) : null);
	const fitDistance = () => {
		const s = sphere();
		return s ? (s.radius * 1.15) / Math.sin(THREE.MathUtils.degToRad(inside.camera.fov / 2)) : 100;
	};
	const zoom = () => percentOf(fitDistance(), inside.camera.position.distanceTo(inside.controls.target));
	const told = () => listeners.forEach((listener) => listener(zoom()));
	inside.controls.addEventListener('change', told);
	const view = (side: Side) => {
		const s = sphere();
		if (!s) return;
		const away = new THREE.Vector3(...sideOf(side, 'y')).normalize().multiplyScalar(fitDistance());
		inside.controls.target.copy(s.center);
		inside.camera.position.copy(s.center).add(away);
		inside.controls.update();
		inside.requestRender();
		told();
	};
	return {
		fit: () => view('iso'),
		view,
		zoom,
		setZoom(percent) {
			const away = inside.camera.position.clone().sub(inside.controls.target).normalize();
			inside.camera.position.copy(away.multiplyScalar(distanceFor(fitDistance(), percent)).add(inside.controls.target));
			inside.controls.update();
			inside.requestRender();
			told();
		},
		setLook(next) {
			look = next;
			if (inside.mesh) applyLook(inside.mesh, look);
			inside.requestRender();
		},
		setSpin: (on) => viewer.setAutoRotate(on),
		setGrid: (on) => viewer.setGridVisible(on),
		setPan(on) {
			inside.controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
		},
		onZoom: (listener) => void listeners.push(listener),
		again() {
			if (inside.mesh) applyLook(inside.mesh, look);
			// the first model is framed as every view frames it; later ones keep the person's camera
			if (inside.mesh && !framed) {
				framed = true;
				return view('iso');
			}
			inside.requestRender();
			told();
		}
	};
}
