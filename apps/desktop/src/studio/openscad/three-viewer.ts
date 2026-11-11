// Three.js STL viewer. Encapsulates scene/camera/renderer + OrbitControls.
// Exposes setStl(bytes), exportGlb(): Promise<Blob>, snapshot(): Promise<Blob>, dispose().
//
// Rendering is on demand: a frame is drawn when something changed (camera,
// model, size, colour) and the rAF loop only keeps running while the camera
// is still moving (auto-rotate, damping). An idle viewer costs nothing, and a
// viewer scrolled/tabbed out of view stops drawing altogether.
import * as THREE from 'three';
import { fitToContainer } from '$lib/three-fit';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ToolWorker } from '$lib/tools/booleans/worker';
import { workerName } from '$lib/i18n/worker';
import type { ViewMesh } from './view-mesh';
import { addLights, disposeLines, edgeColor, segmentLines, surfaceMaterial } from './viewer-look';

type OrbitControlsConstructor = new (
	object: THREE.Camera,
	domElement?: HTMLElement
) => OrbitControls;

export interface ViewerOptions {
	background?: string;
	autoRotate?: boolean;
	color?: number;
	gridVisible?: boolean;
}

/** The holes of a mesh on the scene: a data colour, not an interface role. */
const MARK_COLOR = 0xff3b30;

export class ScadViewer {
	private renderer: THREE.WebGLRenderer;
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private controls: OrbitControls;
	private mesh: THREE.Mesh | null = null;
	private edges: THREE.LineSegments | null = null;
	private marks: THREE.LineSegments | null = null;
	private markPositions: Float32Array | null = null;
	/** What setStl moved the geometry by (after turning it Z-up → Y-up). */
	private shift = new THREE.Vector3();
	private grid: THREE.GridHelper | null = null;
	private animateId = 0;
	private dirty = true;
	private visible = true;
	private resizeObs: ResizeObserver;
	private visibilityObs: IntersectionObserver | null = null;
	private container: HTMLElement;
	private color = 0xa3a3a8;
	private modelBottom = 0;
	private modelMaxDim = 50;
	private meshWorker = new ToolWorker(
		() =>
			new Worker(new URL('./view-mesh.worker.ts', import.meta.url), {
				type: 'module',
				name: workerName('view-mesh')
			})
	);
	private disposed = false;
	/** The latest setStl(): export and snapshot wait for the model it brings. */
	private loading: Promise<unknown> = Promise.resolve();

	static async create(container: HTMLElement, opts: ViewerOptions = {}) {
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		return new ScadViewer(container, opts, OrbitControls);
	}

	private constructor(
		container: HTMLElement,
		opts: ViewerOptions,
		Controls: OrbitControlsConstructor
	) {
		this.container = container;
		// No preserveDrawingBuffer: it disables buffer-swap optimisations on many
		// GPUs and snapshot() renders a fresh frame right before reading pixels.
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.setSize(container.clientWidth || 600, container.clientHeight || 400);
		// Block-level canvas avoids inline-baseline gap inside flex/grid parents.
		this.renderer.domElement.style.display = 'block';
		container.appendChild(this.renderer.domElement);

		this.scene = new THREE.Scene();
		this.scene.background = null;

		this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
		this.camera.position.set(80, 60, 80);

		addLights(this.scene, this.camera);

		this.controls = new Controls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.1;
		this.controls.autoRotate = !!opts.autoRotate;
		this.controls.autoRotateSpeed = 1.2;

		if (typeof opts.color === 'number') this.color = opts.color;

		// Ground grid — model sits on top of it
		this.grid = new THREE.GridHelper(200, 20, 0x4a4a52, 0x2a2a30);
		(this.grid.material as THREE.Material).transparent = true;
		(this.grid.material as THREE.Material).opacity = 0.55;
		this.grid.visible = opts.gridVisible !== false;
		this.scene.add(this.grid);

		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(container);

		// User interaction (drag/zoom) and the damping tail both fire 'change'.
		this.controls.addEventListener('change', this.requestRender);
		if (typeof IntersectionObserver !== 'undefined') {
			this.visibilityObs = new IntersectionObserver(([entry]) => {
				this.visible = entry.isIntersecting;
				if (this.visible) this.requestRender();
			});
			this.visibilityObs.observe(container);
		}
		this.requestRender();
	}

	/** Ask for a frame; starts the loop if it is not already running. */
	private requestRender = () => {
		this.dirty = true;
		if (!this.animateId) this.animateId = requestAnimationFrame(this.frame);
	};

	private frame = () => {
		this.animateId = 0;
		if (!this.visible) return; // resumes via the IntersectionObserver
		// update() reports whether the camera still moves (auto-rotate, damping).
		const moving = this.controls.update();
		if (moving || this.dirty) {
			this.dirty = false;
			this.renderer.render(this.scene, this.camera);
		}
		if (moving || this.controls.autoRotate) this.animateId = requestAnimationFrame(this.frame);
	};

	setAutoRotate(v: boolean) {
		this.controls.autoRotate = v;
		if (v) this.requestRender();
	}

	resize() {
		// The canvas CSS size follows too: left fixed, a container shrunk by the
		// sidebar splitter made the canvas overflow and the model look distorted.
		fitToContainer(this.renderer, this.camera, this.container);
		this.requestRender();
	}

	/**
	 * Shows an STL. Resolves with the model's size in its own axes (mm), or
	 * null when a newer call took over before this one was ready.
	 */
	setStl(bytes: Uint8Array): Promise<[number, number, number] | null> {
		const shown = this.show(bytes);
		this.loading = shown.catch(() => null);
		return shown;
	}

	private async show(bytes: Uint8Array): Promise<[number, number, number] | null> {
		// The worker takes this copy's buffer; the caller keeps its bytes (they
		// may also sit on a SharedArrayBuffer, which a transfer cannot take).
		const copy = bytes.slice();
		let view: ViewMesh;
		try {
			view = await this.meshWorker.run<ViewMesh>({ stl: copy }, undefined, [copy.buffer]);
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') return null;
			throw e;
		}
		if (this.disposed) return null;

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(view.positions, 3));
		geometry.setIndex(new THREE.BufferAttribute(view.indices, 1));
		// OpenSCAD uses Z-up, three.js uses Y-up. Rotate geometry so the model
		// stands upright in the viewer instead of lying on its side.
		geometry.rotateX(-Math.PI / 2);
		geometry.computeBoundingBox();
		this.shift = geometry.boundingBox!.getCenter(new THREE.Vector3()).negate();
		geometry.center();

		const mesh = new THREE.Mesh(geometry, surfaceMaterial(this.color));

		// Remove previous mesh
		disposeLines(this.edges);
		if (this.mesh) {
			this.scene.remove(this.mesh);
			this.mesh.geometry.dispose();
			(this.mesh.material as THREE.Material).dispose();
		}
		this.mesh = mesh;
		this.scene.add(mesh);
		if (view.edges) {
			// Found by the worker in STL axes: turned and moved like the mesh.
			this.edges = segmentLines(view.edges, this.color);
			this.edges.geometry.rotateX(-Math.PI / 2);
			this.edges.geometry.translate(this.shift.x, this.shift.y, this.shift.z);
			mesh.add(this.edges);
		} else this.edges = null;
		this.drawMarks();

		// Fit camera to bounding box & place model on the grid plane (y=0)
		geometry.computeBoundingBox();
		const bbox = geometry.boundingBox!;
		const size = bbox.getSize(new THREE.Vector3());
		const halfY = size.y / 2;
		mesh.position.set(0, halfY, 0);
		this.modelBottom = 0;
		this.modelMaxDim = Math.max(size.x, size.y, size.z);

		// Scale grid roughly to model footprint (keeps grid spacing readable)
		this.updateGridScale();

		const dist = Math.max(this.modelMaxDim * 2.2, 40);
		const targetY = halfY;
		this.camera.position.set(dist, dist * 0.75 + targetY, dist);
		this.controls.target.set(0, targetY, 0);
		this.controls.update();
		this.requestRender();
		return view.size;
	}

	private updateGridScale() {
		if (!this.grid) return;
		this.scene.remove(this.grid);
		(this.grid.material as THREE.Material).dispose();
		const span = Math.max(50, this.modelMaxDim * 4);
		const divisions = 20;
		const wasVisible = this.grid.visible;
		this.grid = new THREE.GridHelper(span, divisions, 0x4a4a52, 0x2a2a30);
		(this.grid.material as THREE.Material).transparent = true;
		(this.grid.material as THREE.Material).opacity = 0.55;
		this.grid.visible = wasVisible;
		this.scene.add(this.grid);
	}

	/**
	 * Line segments on the model, in its own (STL, Z-up) coordinates, drawn
	 * over it — the holes of the mesh; null clears them.
	 */
	setMarks(positions: Float32Array | null) {
		this.markPositions = positions && positions.length ? positions : null;
		this.drawMarks();
	}

	private drawMarks() {
		if (this.marks) {
			this.marks.removeFromParent();
			this.marks.geometry.dispose();
			(this.marks.material as THREE.Material).dispose();
			this.marks = null;
		}
		if (!this.mesh || !this.markPositions) {
			this.requestRender();
			return;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(this.markPositions.slice(), 3));
		geometry.rotateX(-Math.PI / 2);
		geometry.translate(this.shift.x, this.shift.y, this.shift.z);
		// Seen through the model too: a hole on the far side still shows.
		const material = new THREE.LineBasicMaterial({ color: MARK_COLOR, depthTest: false });
		this.marks = new THREE.LineSegments(geometry, material);
		this.marks.renderOrder = 1;
		this.mesh.add(this.marks);
		this.requestRender();
	}

	setColor(hex: number) {
		this.color = hex;
		if (this.mesh) {
			(this.mesh.material as THREE.MeshStandardMaterial).color.setHex(hex);
			(this.edges?.material as THREE.LineBasicMaterial | undefined)?.color.copy(edgeColor(hex));
			this.requestRender();
		}
	}

	setGridVisible(v: boolean) {
		if (this.grid) this.grid.visible = v;
		this.requestRender();
	}

	async exportGlb(): Promise<Blob> {
		await this.loading;
		if (!this.mesh) throw new Error('No mesh');
		// Export is an infrequent, user-triggered action. Keep the exporter out of
		// the already sizeable interactive viewer chunk and load it on demand.
		const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
		const exporter = new GLTFExporter();
		// The model alone: not its edge lines or hole marks. It is the scene's
		// mesh — simplified past VIEW_TRIANGLES: the GLB is the format to look
		// at, the STL keeps every triangle for printing.
		const model = new THREE.Mesh(this.mesh.geometry, this.mesh.material);
		model.position.copy(this.mesh.position);
		const result: ArrayBuffer = await new Promise((resolve, reject) => {
			exporter.parse(
				model,
				(out) => {
					if (out instanceof ArrayBuffer) resolve(out);
					else reject(new Error('Expected binary GLB'));
				},
				(error) => reject(error instanceof Error ? error : new Error('GLTF export failed')),
				{ binary: true }
			);
		});
		return new Blob([result], { type: 'model/gltf-binary' });
	}

	async snapshot(): Promise<Blob> {
		await this.loading;
		this.renderer.render(this.scene, this.camera);
		const canvas = this.renderer.domElement;
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
				'image/png',
				0.92
			);
		});
	}

	dispose() {
		this.disposed = true;
		this.meshWorker.dispose();
		cancelAnimationFrame(this.animateId);
		this.animateId = 0;
		this.resizeObs.disconnect();
		this.visibilityObs?.disconnect();
		this.controls.removeEventListener('change', this.requestRender);
		this.controls.dispose();
		disposeLines(this.edges);
		if (this.mesh) {
			this.scene.remove(this.mesh);
			this.mesh.geometry.dispose();
			(this.mesh.material as THREE.Material).dispose();
		}
		if (this.grid) {
			this.scene.remove(this.grid);
			(this.grid.material as THREE.Material).dispose();
		}
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		if (this.renderer.domElement.parentNode === this.container) {
			this.container.removeChild(this.renderer.domElement);
		}
	}
}
