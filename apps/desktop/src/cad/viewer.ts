/**
 * The CAD scene: every part in its colour, Z up as in the program. A part can be picked, hidden and moved
 * with handles; a move does not change anything here, it is told to the page, which changes the program.
 * A frame is drawn only when something changed.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { distanceFor, percentOf, sideOf, type Look, type Side, type Viewable } from '../lib/view-kit';
import { applyLook } from '../lib/view-scene';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { addLights, edgeLines } from '../studio/openscad/viewer-look';
import type { BuiltPart } from './client';

const CREASE = (32 * Math.PI) / 180;
const PICKED = 0x2a6df4;
/** A click that moved further than this was a turn of the camera. */
const CLICK_PX = 4;

export type Handle = 'translate' | 'rotate';

export interface ViewerEvents {
	/** Clicked on a part, or on nothing. */
	onPick(name: string | null): void;
	/** A part was moved by these mm and turned by these degrees. */
	onMove(name: string, by: number[]): void;
}

export class CadViewer implements Viewable {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(35, 1, 1, 100_000);
	private controls: OrbitControls;
	private handles: TransformControls;
	private root = new THREE.Group();
	private groups = new Map<string, THREE.Group>();
	private grid: THREE.GridHelper | null = null;
	private span = 100;
	private picked: string | null = null;
	private hidden = new Set<string>();
	private dirty = true;
	private frameId = 0;
	private sizeWatch: ResizeObserver;
	private down: { x: number; y: number } | null = null;
	private look: Look = 'clay';
	private gridOn = true;
	private fitDistance = 100;
	private listeners: ((percent: number) => void)[] = [];

	constructor(
		private host: HTMLElement,
		private events: ViewerEvents
	) {
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.domElement.style.display = 'block';
		host.appendChild(this.renderer.domElement);
		this.camera.up.set(0, 0, 1);
		this.camera.position.set(200, -300, 200);
		addLights(this.scene, this.camera);
		this.scene.add(this.root);
		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.12;
		this.controls.addEventListener('change', this.draw);
		this.controls.addEventListener('change', this.told);
		this.handles = new TransformControls(this.camera, this.renderer.domElement);
		this.handles.setTranslationSnap(1);
		this.handles.setRotationSnap(THREE.MathUtils.degToRad(15));
		this.handles.addEventListener('change', this.draw);
		this.handles.addEventListener('dragging-changed', (e) => this.dragged(e.value as boolean));
		this.scene.add(this.handles.getHelper());
		const canvas = this.renderer.domElement;
		canvas.addEventListener('pointerdown', this.pressed);
		canvas.addEventListener('pointerup', this.released);
		this.sizeWatch = new ResizeObserver(() => this.resize());
		this.sizeWatch.observe(host);
		this.resize();
	}

	private draw = () => {
		this.dirty = true;
		if (!this.frameId) this.frameId = requestAnimationFrame(this.frame);
	};

	private frame = () => {
		this.frameId = 0;
		const moving = this.controls.update();
		if (moving || this.dirty) {
			this.dirty = false;
			this.renderer.render(this.scene, this.camera);
		}
		if (moving || this.controls.autoRotate) this.frameId = requestAnimationFrame(this.frame);
	};

	private resize() {
		const width = this.host.clientWidth || 600;
		const height = this.host.clientHeight || 400;
		this.renderer.setSize(width, height);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.draw();
	}

	/** Shows new parts. The camera stays where it is unless the model changed a lot or asked to fit. */
	show(parts: BuiltPart[], fit: boolean) {
		const picked = this.picked;
		this.handles.detach();
		this.clear();
		for (const part of parts) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(part.triangles.slice(), 3));
			const smooth = toCreasedNormals(geometry, CREASE);
			const color = new THREE.Color(part.color ?? '#b9babd');
			const material = new THREE.MeshStandardMaterial({ color, roughness: part.color === '#20303a' ? 0.15 : 0.55, metalness: 0.05, side: THREE.DoubleSide });
			const mesh = new THREE.Mesh(smooth, material);
			mesh.userData.part = part.name;
			// Lines on the sharp edges of solids: a black part on a dark scene still reads.
			if (part.kind === 'solid') {
				const lines = edgeLines(geometry, color);
				if (lines) mesh.add(lines);
			}
			geometry.dispose();
			let group = this.groups.get(part.name);
			if (!group) {
				group = new THREE.Group();
				group.userData.part = part.name;
				group.visible = !this.hidden.has(part.name);
				this.groups.set(part.name, group);
				this.root.add(group);
			}
			group.add(mesh);
		}
		applyLook(this.root, this.look);
		const bounds = new THREE.Box3().setFromObject(this.root);
		this.placeGrid(bounds);
		if (fit) this.fit();
		if (picked && this.groups.has(picked)) this.pick(picked);
		else this.picked = null;
		this.draw();
	}

	private clear() {
		for (const group of this.groups.values()) {
			this.root.remove(group);
			group.traverse((o) => {
				if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
					o.geometry.dispose();
					(o.material as THREE.Material).dispose();
				}
			});
		}
		this.groups.clear();
	}

	private placeGrid(bounds: THREE.Box3) {
		if (this.grid) {
			this.scene.remove(this.grid);
			(this.grid.material as THREE.Material).dispose();
			this.grid.geometry.dispose();
		}
		const size = bounds.getSize(new THREE.Vector3());
		this.span = Math.max(size.x, size.y, size.z, 10);
		const step = 10 ** Math.ceil(Math.log10(this.span / 10));
		const extent = Math.ceil((this.span * 2) / step) * step;
		this.grid = new THREE.GridHelper(extent, Math.round(extent / step), 0x56565e, 0x33333a);
		this.grid.rotation.x = Math.PI / 2;
		this.grid.position.z = -0.02;
		(this.grid.material as THREE.Material).transparent = true;
		(this.grid.material as THREE.Material).opacity = 0.5;
		this.grid.visible = this.gridOn;
		this.scene.add(this.grid);
	}

	/** Frames the model; `from` is a direction to look from. */
	fit(from: [number, number, number] = [0.75, -1, 0.65]) {
		const bounds = new THREE.Box3().setFromObject(this.root);
		if (bounds.isEmpty()) return;
		const sphere = bounds.getBoundingSphere(new THREE.Sphere());
		const distance = (sphere.radius * 1.15) / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.min(1, this.camera.aspect);
		this.fitDistance = distance;
		this.controls.target.copy(sphere.center);
		this.camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(...from).normalize(), distance);
		this.camera.near = distance / 100;
		this.camera.far = distance * 20;
		this.camera.updateProjectionMatrix();
		this.controls.update();
		this.draw();
		this.told();
	}

	view(side: Side) {
		this.fit(sideOf(side, 'z'));
	}

	zoom() {
		return percentOf(this.fitDistance, this.camera.position.distanceTo(this.controls.target));
	}

	setZoom(percent: number) {
		const away = this.camera.position.clone().sub(this.controls.target).normalize();
		this.camera.position.copy(away.multiplyScalar(distanceFor(this.fitDistance, percent)).add(this.controls.target));
		this.controls.update();
		this.draw();
		this.told();
	}

	setLook(look: Look) {
		this.look = look;
		applyLook(this.root, look);
		this.draw();
	}

	setSpin(on: boolean) {
		this.controls.autoRotate = on;
		this.controls.autoRotateSpeed = 1.6;
		this.draw();
	}

	setGrid(on: boolean) {
		this.gridOn = on;
		if (this.grid) this.grid.visible = on;
		this.draw();
	}

	setPan(on: boolean) {
		this.controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
	}

	onZoom(listener: (percent: number) => void) {
		this.listeners.push(listener);
	}

	private told = () => {
		const percent = this.zoom();
		for (const listener of this.listeners) listener(percent);
	};

	setHidden(names: Set<string>) {
		this.hidden = names;
		for (const [name, group] of this.groups) group.visible = !names.has(name);
		this.draw();
	}

	pick(name: string | null) {
		const previous = this.picked ? this.groups.get(this.picked) : null;
		this.tint(previous, 0x000000);
		this.picked = name;
		const group = name ? this.groups.get(name) : null;
		this.tint(group, PICKED);
		if (group) {
			const middle = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
			for (const child of group.children) child.position.sub(middle);
			group.position.copy(middle);
			this.handles.attach(group);
		} else this.handles.detach();
		this.draw();
	}

	private tint(group: THREE.Group | null | undefined, color: number) {
		group?.traverse((o) => {
			if (o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).emissive.setHex(color).multiplyScalar(0.35);
		});
	}

	handle(mode: Handle) {
		this.handles.setMode(mode);
	}

	private start = new THREE.Vector3();
	private startTurn = new THREE.Euler();

	private dragged(active: boolean) {
		this.controls.enabled = !active;
		const group = this.handles.object;
		if (!group) return;
		if (active) {
			this.start.copy(group.position);
			this.startTurn.copy(group.rotation);
			return;
		}
		const move = group.position.clone().sub(this.start);
		const degrees = (from: number, to: number) => THREE.MathUtils.radToDeg(to - from);
		const by = [move.x, move.y, move.z, degrees(this.startTurn.x, group.rotation.x), degrees(this.startTurn.y, group.rotation.y), degrees(this.startTurn.z, group.rotation.z)];
		if (by.some((v) => Math.abs(v) > 1e-6)) this.events.onMove(group.userData.part as string, by);
	}

	private pressed = (e: PointerEvent) => {
		this.down = { x: e.clientX, y: e.clientY };
	};

	private released = (e: PointerEvent) => {
		if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > CLICK_PX || this.handles.dragging) return;
		const rect = this.renderer.domElement.getBoundingClientRect();
		const point = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
		const ray = new THREE.Raycaster();
		ray.setFromCamera(point, this.camera);
		const hit = ray.intersectObjects([...this.groups.values()].filter((g) => g.visible), true)[0];
		this.events.onPick((hit?.object.userData.part as string | undefined) ?? null);
	};

	dispose() {
		cancelAnimationFrame(this.frameId);
		this.sizeWatch.disconnect();
		this.handles.dispose();
		this.controls.dispose();
		this.clear();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		// three keeps every renderer it ever had, so the canvas stays in memory and must hold on to nothing
		this.renderer.domElement.removeEventListener('pointerdown', this.pressed);
		this.renderer.domElement.removeEventListener('pointerup', this.released);
		this.renderer.domElement.remove();
	}
}

