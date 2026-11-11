/**
 * Toolpath viewer on the dark scene: one line set per extrusion type, layers
 * shown by draw ranges over the same GPU buffers (scrubbing the layer slider
 * uploads nothing). Layers below the current one are dimmed while scrubbing,
 * so the current layer reads at a glance. Drawn on demand, like ScadViewer.
 *
 * Loaded lazily (three.js), never during SSR.
 */
import * as THREE from 'three';
import { fitToContainer } from '$lib/three-fit';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FEATURES, FEATURE_INFO, speedHue, speedRange, type Feature, type Toolpath } from './parse';

type ControlsCtor = new (object: THREE.Camera, domElement?: HTMLElement) => OrbitControls;

interface FeatureLines {
	below: THREE.LineSegments;
	top: THREE.LineSegments;
	color: THREE.Color;
	/** Per-vertex colours by speed, made on first use. */
	speed?: THREE.BufferAttribute;
}

export type ColorMode = 'type' | 'speed';

export class GcodeViewer {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(40, 1, 0.5, 20000);
	private controls: OrbitControls;
	private group = new THREE.Group();
	private grid: THREE.GridHelper | null = null;
	private lines = new Map<Feature, FeatureLines>();
	private tp: Toolpath | null = null;
	private visible: Record<Feature, boolean> = Object.fromEntries(
		FEATURES.map((f) => [f, f !== 'travel'])
	) as Record<Feature, boolean>;
	private from = 0;
	private to = Number.POSITIVE_INFINITY;
	private mode: ColorMode = 'type';
	private range: [number, number] = [0, 0];
	private frameId = 0;
	private resizeObs: ResizeObserver;

	static async create(container: HTMLElement): Promise<GcodeViewer> {
		const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
		return new GcodeViewer(container, OrbitControls);
	}

	private constructor(
		private container: HTMLElement,
		Controls: ControlsCtor
	) {
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.domElement.style.display = 'block';
		container.appendChild(this.renderer.domElement);
		// G-code is Z-up, three.js is Y-up: (x, y, z) → (x, z, −y).
		this.group.rotation.x = -Math.PI / 2;
		this.scene.add(this.group);
		this.camera.position.set(120, 120, 160);
		this.controls = new Controls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.12;
		this.controls.addEventListener('change', this.request);
		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(container);
		this.resize();
	}

	private request = () => {
		if (!this.frameId) this.frameId = requestAnimationFrame(this.frame);
	};

	private frame = () => {
		this.frameId = 0;
		const moving = this.controls.update();
		this.renderer.render(this.scene, this.camera);
		if (moving) this.request();
	};

	private resize() {
		fitToContainer(this.renderer, this.camera, this.container);
		this.request();
	}

	setToolpath(tp: Toolpath | null, fit = true): void {
		this.clear();
		this.tp = tp;
		if (!tp) return this.request();
		for (const f of FEATURES) {
			const path = tp.features[f];
			if (!path.positions.length) continue;
			const attr = new THREE.BufferAttribute(path.positions, 3);
			const color = new THREE.Color(FEATURE_INFO[f].color);
			const make = () => {
				const g = new THREE.BufferGeometry();
				g.setAttribute('position', attr);
				const line = new THREE.LineSegments(
					g,
					new THREE.LineBasicMaterial({ color: color.clone(), transparent: f === 'travel' })
				);
				line.frustumCulled = false;
				this.group.add(line);
				return line;
			};
			this.lines.set(f, { below: make(), top: make(), color });
		}
		const box = tp.bounds ?? this.travelBounds(tp);
		const cx = (box[0] + box[3]) / 2;
		const cy = (box[1] + box[4]) / 2;
		this.group.position.set(-cx, 0, cy);
		const span = Math.max(
			50,
			Math.ceil((Math.max(box[3] - box[0], box[4] - box[1]) * 1.6) / 10) * 10
		);
		this.grid = new THREE.GridHelper(span, Math.round(span / 10), 0x4a4a52, 0x2a2a30);
		const gm = this.grid.material as THREE.Material;
		gm.transparent = true;
		gm.opacity = 0.6;
		this.scene.add(this.grid);
		this.from = 0;
		this.to = tp.layerZ.length - 1;
		this.range = speedRange(tp);
		this.paint();
		this.apply();
		if (fit) this.fit(box);
	}

	/** Lines in their type's colour, or by speed from slow (blue) to fast (red). */
	setColorMode(mode: ColorMode): void {
		this.mode = mode;
		this.paint();
		this.apply();
	}

	private paint() {
		const tp = this.tp;
		if (!tp) return;
		const [lo, hi] = this.range;
		const span = Math.max(1, hi - lo);
		const c = new THREE.Color();
		for (const [f, l] of this.lines) {
			const bySpeed = this.mode === 'speed' && f !== 'travel';
			if (bySpeed && !l.speed) {
				const speeds = tp.features[f].speeds;
				const colors = new Float32Array(speeds.length * 6);
				for (let i = 0; i < speeds.length; i++) {
					c.setHSL(speedHue((speeds[i] - lo) / span) / 360, 0.9, 0.55);
					colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
				}
				l.speed = new THREE.BufferAttribute(colors, 3);
			}
			for (const line of [l.below, l.top]) {
				const material = line.material as THREE.LineBasicMaterial;
				if (bySpeed) line.geometry.setAttribute('color', l.speed!);
				else line.geometry.deleteAttribute('color');
				if (material.vertexColors !== bySpeed) {
					material.vertexColors = bySpeed;
					material.needsUpdate = true;
				}
			}
			// Vertex colours are multiplied by the material's: white keeps them, dims them below.
			l.color.set(bySpeed ? 0xffffff : FEATURE_INFO[f].color);
		}
	}

	setVisible(visible: Record<Feature, boolean>): void {
		this.visible = { ...visible };
		this.apply();
	}

	/** Show layers from…to (0-based, inclusive). */
	setLayers(from: number, to: number): void {
		this.from = from;
		this.to = to;
		this.apply();
	}

	resetCamera(): void {
		if (this.tp) this.fit(this.tp.bounds ?? this.travelBounds(this.tp));
	}

	private apply() {
		const tp = this.tp;
		if (!tp) return;
		const last = tp.layerZ.length - 1;
		const to = Math.max(0, Math.min(last, this.to));
		const from = Math.max(0, Math.min(to, this.from));
		// Everything at full colour when all layers are on; dimmed below while scrubbing.
		const dim = to < last || from > 0 ? 0.42 : 1;
		for (const [f, l] of this.lines) {
			const starts = tp.features[f].layerStart;
			const on = this.visible[f];
			const a = starts[from] * 2;
			const b = starts[to] * 2;
			const c = starts[to + 1] * 2;
			l.below.visible = on && b > a;
			l.below.geometry.setDrawRange(a, b - a);
			l.top.visible = on && c > b;
			l.top.geometry.setDrawRange(b, c - b);
			const below = l.below.material as THREE.LineBasicMaterial;
			const top = l.top.material as THREE.LineBasicMaterial;
			below.color.copy(l.color).multiplyScalar(dim);
			top.color.copy(l.color);
			if (f === 'travel') {
				below.opacity = 0.5;
				top.opacity = 0.8;
			}
		}
		this.request();
	}

	private fit(box: number[]) {
		const dx = box[3] - box[0];
		const dy = box[4] - box[1];
		const dz = box[5];
		const size = Math.max(dx, dy, dz, 10);
		// Far enough that a flat, wide pattern stays inside the frame from the oblique view.
		const dist = size * 1.9 + 20;
		this.controls.target.set(0, dz / 2, 0);
		this.camera.position.set(dist * 0.55, dz / 2 + dist * 0.7, dist * 0.95);
		this.camera.near = Math.max(0.1, dist / 500);
		this.camera.far = dist * 20;
		this.camera.updateProjectionMatrix();
		this.controls.update();
		this.request();
	}

	private travelBounds(tp: Toolpath): number[] {
		const b = [Infinity, Infinity, 0, -Infinity, -Infinity, 0];
		const p = tp.features.travel.positions;
		for (let i = 0; i < p.length; i += 3) {
			b[0] = Math.min(b[0], p[i]);
			b[1] = Math.min(b[1], p[i + 1]);
			b[3] = Math.max(b[3], p[i]);
			b[4] = Math.max(b[4], p[i + 1]);
			b[5] = Math.max(b[5], p[i + 2]);
		}
		return Number.isFinite(b[0]) ? b : [0, 0, 0, 100, 100, 10];
	}

	private clear() {
		for (const l of this.lines.values()) {
			for (const line of [l.below, l.top]) {
				this.group.remove(line);
				line.geometry.dispose();
				(line.material as THREE.Material).dispose();
			}
		}
		this.lines.clear();
		if (this.grid) {
			this.scene.remove(this.grid);
			this.grid.geometry.dispose();
			(this.grid.material as THREE.Material).dispose();
			this.grid = null;
		}
	}

	dispose(): void {
		cancelAnimationFrame(this.frameId);
		this.resizeObs.disconnect();
		this.controls.removeEventListener('change', this.request);
		this.controls.dispose();
		this.clear();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		this.renderer.domElement.remove();
	}
}
