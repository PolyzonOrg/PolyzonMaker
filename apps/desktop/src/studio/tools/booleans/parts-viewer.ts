/**
 * Three.js scene for tools with several parts: each part its own colour and
 * visibility, an offset for «Раздвинуть на сцене», and translucent cut planes.
 * Geometry comes in Z-up millimetres (as in the STL) and stands on the grid.
 * Drawn on demand like ScadViewer: an idle scene costs nothing.
 */
import * as THREE from 'three';
import { fitToContainer } from '$lib/three-fit';
import {
	addLights,
	disposeLines,
	edgeColor,
	edgeLines,
	surfaceMaterial
} from '../../openscad/viewer-look';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from './plane';

export interface ViewPart {
	id: number;
	tris: Float32Array;
	color: string;
	visible: boolean;
	offset: Vec3;
}

export interface ViewPlane {
	point: Vec3;
	normal: Vec3;
	/** The side of a square; with `width`, the height of an upright rectangle (up Z, or Y for a level plane). */
	size: number;
	/** The rectangle's width, level across `size`. */
	width?: number;
}

const PLANE_COLOR = 0xe8e8ea;

export class PartsViewer {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
	private controls: OrbitControls;
	private root = new THREE.Group();
	private grid: THREE.GridHelper;
	private meshes = new Map<
		number,
		{ mesh: THREE.Mesh; tris: Float32Array; edges: THREE.LineSegments | null }
	>();
	private planes: THREE.Object3D[] = [];
	private resizeObs: ResizeObserver;
	private frameId = 0;
	private pick: ((point: Vec3) => void) | null = null;
	private pressed: { x: number; y: number; at: number } | null = null;
	private raycaster = new THREE.Raycaster();

	static async create(container: HTMLElement): Promise<PartsViewer> {
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		return new PartsViewer(container, OrbitControls);
	}

	private constructor(
		private container: HTMLElement,
		Controls: new (camera: THREE.Camera, element: HTMLElement) => OrbitControls
	) {
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.domElement.style.display = 'block';
		container.appendChild(this.renderer.domElement);

		addLights(this.scene, this.camera);

		// STL is Z-up, three.js is Y-up.
		this.root.rotation.x = -Math.PI / 2;
		this.scene.add(this.root);
		this.grid = this.makeGrid(200);
		this.scene.add(this.grid);

		this.camera.position.set(120, 90, 120);
		this.controls = new Controls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.1;
		this.controls.addEventListener('change', this.requestRender);

		this.renderer.domElement.addEventListener('pointerdown', this.onPress);
		this.renderer.domElement.addEventListener('pointerup', this.onRelease);

		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(container);
		this.resize();
	}

	private makeGrid(span: number): THREE.GridHelper {
		const grid = new THREE.GridHelper(span, 20, 0x4a4a52, 0x2a2a30);
		const material = grid.material as THREE.Material;
		material.transparent = true;
		material.opacity = 0.55;
		return grid;
	}

	private requestRender = () => {
		if (!this.frameId) this.frameId = requestAnimationFrame(this.frame);
	};

	private frame = () => {
		this.frameId = 0;
		const moving = this.controls.update();
		this.renderer.render(this.scene, this.camera);
		if (moving) this.requestRender();
	};

	private resize() {
		fitToContainer(this.renderer, this.camera, this.container);
		this.requestRender();
	}

	/** Show these parts; `fit` re-centres the model and the camera on them. */
	setParts(parts: readonly ViewPart[], fit: boolean): void {
		const keep = new Set(parts.map((p) => p.id));
		for (const [id, entry] of this.meshes) {
			if (keep.has(id)) continue;
			disposeLines(entry.edges);
			this.root.remove(entry.mesh);
			entry.mesh.geometry.dispose();
			(entry.mesh.material as THREE.Material).dispose();
			this.meshes.delete(id);
		}
		for (const part of parts) {
			let entry = this.meshes.get(part.id);
			if (!entry || entry.tris !== part.tris) {
				if (entry) {
					disposeLines(entry.edges);
					this.root.remove(entry.mesh);
					entry.mesh.geometry.dispose();
					(entry.mesh.material as THREE.Material).dispose();
				}
				const geometry = new THREE.BufferGeometry();
				geometry.setAttribute('position', new THREE.BufferAttribute(part.tris, 3));
				const mesh = new THREE.Mesh(geometry, surfaceMaterial());
				const edges = edgeLines(geometry, part.color);
				if (edges) mesh.add(edges);
				entry = { mesh, tris: part.tris, edges };
				this.meshes.set(part.id, entry);
				this.root.add(entry.mesh);
			}
			(entry.mesh.material as THREE.MeshStandardMaterial).color.set(part.color);
			(entry.edges?.material as THREE.LineBasicMaterial | undefined)?.color.copy(
				edgeColor(part.color)
			);
			entry.mesh.visible = part.visible;
			entry.mesh.position.set(...part.offset);
		}
		if (fit) this.fit(parts);
		this.requestRender();
	}

	private fit(parts: readonly ViewPart[]) {
		const box = new THREE.Box3();
		for (const p of parts) {
			const entry = this.meshes.get(p.id);
			if (!entry) continue;
			entry.mesh.geometry.computeBoundingBox();
			box.union(entry.mesh.geometry.boundingBox!);
		}
		if (box.isEmpty()) return;
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		// Model coordinates are Z-up: stand the lowest point on the grid, centre X/Y.
		this.root.position.set(-center.x, -box.min.z, center.y);
		const maxDim = Math.max(size.x, size.y, size.z, 1);
		this.scene.remove(this.grid);
		(this.grid.material as THREE.Material).dispose();
		this.grid.geometry.dispose();
		this.grid = this.makeGrid(Math.max(50, maxDim * 4));
		this.scene.add(this.grid);
		const dist = Math.max(maxDim * 2.2, 40);
		const targetY = size.z / 2;
		this.camera.position.set(dist, dist * 0.75 + targetY, dist);
		this.controls.target.set(0, targetY, 0);
		this.controls.update();
	}

	/**
	 * A click (not a drag of the camera) on a visible part reports the point,
	 * in model coordinates; null switches it off.
	 */
	setPick(fn: ((point: Vec3) => void) | null): void {
		this.pick = fn;
		this.renderer.domElement.style.cursor = fn ? 'crosshair' : '';
	}

	private onPress = (e: PointerEvent) => {
		this.pressed = { x: e.clientX, y: e.clientY, at: performance.now() };
	};

	private onRelease = (e: PointerEvent) => {
		const down = this.pressed;
		this.pressed = null;
		if (!this.pick || !down) return;
		if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
		if (performance.now() - down.at > 500) return;
		const rect = this.renderer.domElement.getBoundingClientRect();
		this.raycaster.setFromCamera(
			new THREE.Vector2(
				((e.clientX - rect.left) / rect.width) * 2 - 1,
				-((e.clientY - rect.top) / rect.height) * 2 + 1
			),
			this.camera
		);
		const shown = [...this.meshes.values()].map((x) => x.mesh).filter((m) => m.visible);
		const hit = this.raycaster.intersectObjects(shown, false)[0];
		if (!hit) return;
		// The geometry is in model coordinates: the mesh's own frame.
		const at = hit.object.worldToLocal(hit.point.clone());
		this.pick([at.x, at.y, at.z]);
	};

	setPlanes(planes: readonly ViewPlane[]): void {
		for (const object of this.planes) {
			this.root.remove(object);
			object.traverse((o) => {
				if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
					const drawn = o as THREE.Mesh | THREE.LineSegments;
					drawn.geometry.dispose();
					(drawn.material as THREE.Material).dispose();
				}
			});
		}
		this.planes = planes.map((plane) => {
			const geometry = new THREE.PlaneGeometry(plane.width ?? plane.size, plane.size);
			const fill = new THREE.Mesh(
				geometry,
				new THREE.MeshBasicMaterial({
					color: PLANE_COLOR,
					transparent: true,
					opacity: 0.16,
					side: THREE.DoubleSide,
					depthWrite: false
				})
			);
			const edge = new THREE.LineSegments(
				new THREE.EdgesGeometry(geometry),
				new THREE.LineBasicMaterial({ color: PLANE_COLOR, transparent: true, opacity: 0.6 })
			);
			const group = new THREE.Group();
			group.add(fill, edge);
			group.position.set(...plane.point);
			// Upright: the plane's height runs up Z (along Y for a level plane), its width level.
			const normal = new THREE.Vector3(...plane.normal).normalize();
			const level = Math.abs(normal.z) > 0.999;
			const up = level ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
			const across = new THREE.Vector3().crossVectors(up, normal).normalize();
			group.quaternion.setFromRotationMatrix(
				new THREE.Matrix4().makeBasis(
					across,
					new THREE.Vector3().crossVectors(normal, across),
					normal
				)
			);
			this.root.add(group);
			return group;
		});
		this.requestRender();
	}

	dispose(): void {
		cancelAnimationFrame(this.frameId);
		this.resizeObs.disconnect();
		this.renderer.domElement.removeEventListener('pointerdown', this.onPress);
		this.renderer.domElement.removeEventListener('pointerup', this.onRelease);
		this.controls.removeEventListener('change', this.requestRender);
		this.controls.dispose();
		this.setPlanes([]);
		this.setParts([], false);
		(this.grid.material as THREE.Material).dispose();
		this.grid.geometry.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		this.renderer.domElement.remove();
	}
}
