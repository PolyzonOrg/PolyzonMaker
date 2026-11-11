import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { distanceFor, percentOf, sideOf, type Look, type Side, type Viewable } from './view-kit';

/**
 * The model view: Z up, millimetres, and a frame only when something moved (TZ §17.2). A studio light:
 * a warm key that casts shadows on the model and the floor, a cool rim from behind that keeps the outline off
 * the background, and a soft room around it, so that every bump of a generated surface reads.
 */
export class Viewer implements Viewable {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
	private controls: OrbitControls;
	private mesh: THREE.Mesh | null = null;
	private observer: ResizeObserver;
	private key = new THREE.DirectionalLight(0xfff3e6, 2.1);
	private rim = new THREE.DirectionalLight(0xe4ecff, 1.4);
	private floor = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.ShadowMaterial({ opacity: 0.26 }));
	private grid: THREE.GridHelper | null = null;
	private gridOn = false;
	private environment: THREE.Texture;
	// a renderer stays tied to every material it drew, so these are not shared between views
	private looks = {
		clay: new THREE.MeshStandardMaterial({ color: 0xcfcbc1, roughness: 0.62, metalness: 0 }),
		glossy: new THREE.MeshStandardMaterial({ color: 0xcfcbc1, roughness: 0.2, metalness: 0.08 }),
		normals: new THREE.MeshNormalMaterial(),
		wire: new THREE.MeshBasicMaterial({ color: 0x9a978f, wireframe: true })
	};
	private painted = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.02 });
	private look: Look = 'clay';
	private fitDistance = 1;
	private center = new THREE.Vector3();
	private spinning = 0;
	private listeners: ((percent: number) => void)[] = [];

	constructor(private canvas: HTMLCanvasElement, background: string) {
		// three.js throws here when the system has no WebGL 2; the page then shows text instead
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		this.renderer.toneMapping = THREE.NeutralToneMapping;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.scene.background = new THREE.Color(background);
		const room = new RoomEnvironment();
		const prefilter = new THREE.PMREMGenerator(this.renderer);
		this.environment = prefilter.fromScene(room, 0.04).texture;
		prefilter.dispose();
		room.dispose();
		this.scene.environment = this.environment;
		this.scene.environmentIntensity = 0.38;
		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3c3a36, 0.35));
		this.key.castShadow = true;
		this.key.shadow.mapSize.set(2048, 2048);
		this.key.shadow.radius = 4;
		this.scene.add(this.key, this.key.target, this.rim, this.rim.target);
		this.floor.receiveShadow = true;
		this.floor.visible = false;
		this.scene.add(this.floor);
		this.scene.add(this.camera);
		this.camera.up.set(0, 0, 1);
		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.addEventListener('change', this.changed);
		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(canvas);
		canvas.addEventListener('webglcontextrestored', this.restored);
		this.resize();
	}

	setBackground(color: string) {
		this.scene.background = new THREE.Color(color);
		this.render();
	}

	render() {
		this.renderer.render(this.scene, this.camera);
	}

	private restored = () => this.render();

	private changed = () => {
		this.render();
		const percent = this.zoom();
		for (const listener of this.listeners) listener(percent);
	};

	/** `paint` gives every corner a colour, in the order of `tris`; `stay` keeps the camera where the person put it. */
	show(tris: Float32Array, paint?: Float32Array, stay = false) {
		this.resize();
		if (this.mesh) {
			this.scene.remove(this.mesh);
			this.mesh.geometry.dispose();
		}
		const soup = new THREE.BufferGeometry();
		soup.setAttribute('position', new THREE.BufferAttribute(tris, 3));
		if (paint) soup.setAttribute('color', new THREE.BufferAttribute(paint, 3));
		// Parts from CAD have sharp edges that matter; anything else reads better smooth than faceted.
		const geometry = paint ? toCreasedNormals(soup, (32 * Math.PI) / 180) : mergeVertices(soup, 1e-3);
		soup.dispose();
		if (!paint) geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
		geometry.computeBoundingBox();
		this.mesh = new THREE.Mesh(geometry, this.looks.clay);
		this.mesh.material = this.materialFor(this.look);
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = true;
		this.scene.add(this.mesh);
		const { center, radius } = geometry.boundingSphere!;
		this.center.copy(center);
		this.light(center, radius, geometry.boundingBox!.min.z);
		this.controls.target.copy(center);
		this.camera.near = radius / 100;
		this.camera.far = radius * 100;
		this.camera.updateProjectionMatrix();
		this.fitDistance = radius * 4.6;
		if (stay) this.render();
		else this.view('iso');
	}

	/** Lights, shadow and floor follow the model's size: a figurine of 28 mm and a vase of 300 look alike. */
	private light(center: THREE.Vector3, radius: number, bottom: number) {
		const from = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).multiplyScalar(radius * 3).add(center);
		this.key.position.copy(from(-0.75, -1.1, 1.6));
		this.key.target.position.copy(center);
		this.rim.position.copy(from(0.9, 1.4, 0.9));
		this.rim.target.position.copy(center);
		const shadow = this.key.shadow.camera;
		[shadow.left, shadow.right, shadow.top, shadow.bottom] = [-radius * 2.8, radius * 2.8, radius * 2.8, -radius * 2.8];
		shadow.near = radius * 0.5;
		shadow.far = radius * 9;
		shadow.updateProjectionMatrix();
		// enough to keep a dense surface from shading itself in stripes, small enough to keep the crevices
		this.key.shadow.bias = -0.0004;
		this.key.shadow.normalBias = radius * 0.012;
		this.floor.position.set(center.x, center.y, bottom - radius * 0.001);
		this.floor.scale.setScalar(radius * 4);
		this.floor.visible = this.key.castShadow;
		this.placeGrid(center, radius, bottom);
	}

	private placeGrid(center: THREE.Vector3, radius: number, bottom: number) {
		if (this.grid) {
			this.scene.remove(this.grid);
			this.grid.dispose();
		}
		this.grid = new THREE.GridHelper(radius * 4, 20, 0x8a8a92, 0x8a8a92);
		const lines = this.grid.material as THREE.Material;
		lines.transparent = true;
		lines.opacity = 0.22;
		this.grid.rotateX(Math.PI / 2);
		this.grid.position.set(center.x, center.y, bottom);
		this.grid.visible = this.gridOn;
		this.scene.add(this.grid);
	}

	private materialFor(look: Look): THREE.Material {
		if (this.mesh?.geometry.getAttribute('color') && (look === 'clay' || look === 'glossy')) return this.painted;
		return this.looks[look];
	}

	fit() {
		this.view('iso');
	}

	view(side: Side) {
		const [x, y, z] = sideOf(side, 'z');
		this.camera.position.copy(new THREE.Vector3(x, y, z).normalize().multiplyScalar(this.fitDistance).add(this.center));
		this.controls.target.copy(this.center);
		this.camera.lookAt(this.center);
		this.controls.update();
		this.changed();
	}

	zoom() {
		return percentOf(this.fitDistance, this.camera.position.distanceTo(this.controls.target));
	}

	setZoom(percent: number) {
		const away = this.camera.position.clone().sub(this.controls.target).normalize();
		this.camera.position.copy(away.multiplyScalar(distanceFor(this.fitDistance, percent)).add(this.controls.target));
		this.controls.update();
		this.changed();
	}

	setLook(look: Look) {
		this.look = look;
		if (this.mesh) this.mesh.material = this.materialFor(look);
		this.render();
	}

	setSpin(on: boolean) {
		this.controls.autoRotate = on;
		this.controls.autoRotateSpeed = 1.6;
		cancelAnimationFrame(this.spinning);
		const turn = () => {
			this.controls.update();
			this.spinning = requestAnimationFrame(turn);
		};
		if (on) this.spinning = requestAnimationFrame(turn);
	}

	setGrid(on: boolean) {
		this.gridOn = on;
		if (this.grid) this.grid.visible = on;
		this.render();
	}

	setPan(on: boolean) {
		this.controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
	}

	setShadows(on: boolean) {
		this.key.castShadow = on;
		this.floor.visible = on;
		this.render();
	}

	onZoom(listener: (percent: number) => void) {
		this.listeners.push(listener);
	}

	/** The current view as a small PNG, for the library. */
	async thumbnail(size = 360): Promise<Uint8Array | null> {
		this.render();
		const out = document.createElement('canvas');
		const { width, height } = this.canvas;
		const side = Math.min(width, height);
		out.width = out.height = size;
		out.getContext('2d')!.drawImage(this.canvas, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
		const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
		return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
	}

	dispose() {
		cancelAnimationFrame(this.spinning);
		this.listeners = [];
		this.observer.disconnect();
		this.controls.dispose();
		this.mesh?.geometry.dispose();
		for (const material of Object.values(this.looks)) material.dispose();
		this.painted.dispose();
		this.floor.geometry.dispose();
		(this.floor.material as THREE.Material).dispose();
		this.grid?.dispose();
		this.key.dispose();
		this.rim.dispose();
		this.environment.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss(); // a browser holds about 16 of these and drops the oldest, whatever it shows
		// three keeps every renderer it ever had through a texture of its own, so the canvas stays in memory:
		// it must hold on to nothing, and above all not to the page around it
		this.canvas.removeEventListener('webglcontextrestored', this.restored);
		this.canvas.remove();
	}

	private resize() {
		const { clientWidth: w, clientHeight: h } = this.canvas;
		if (!w || !h) return;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.render();
	}
}
