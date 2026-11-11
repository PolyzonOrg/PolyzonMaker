import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BACKGROUND = 0xf4f4f1;
const MATERIAL = new THREE.MeshStandardMaterial({ color: 0xb9b6ab, roughness: 0.8 });

/** The model view: Z up, millimetres, a frame only when something moved (TZ §17.2). */
export class Viewer {
	readonly renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
	private controls: OrbitControls;
	private mesh: THREE.Mesh | null = null;
	private radius = 50;

	constructor(private canvas: HTMLCanvasElement) {
		// three.js throws here when the WebView has no WebGL 2
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		this.scene.background = new THREE.Color(BACKGROUND);
		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 2));
		const sun = new THREE.DirectionalLight(0xffffff, 1.5);
		sun.position.set(1, -1, 2);
		this.camera.add(sun);
		this.scene.add(this.camera);
		this.camera.up.set(0, 0, 1);
		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.addEventListener('change', () => this.render());
		new ResizeObserver(() => this.resize()).observe(canvas);
		this.resize();
	}

	info() {
		const gl = this.renderer.getContext();
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		return {
			version: gl.getParameter(gl.VERSION),
			renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
			vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
			maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
			pixelRatio: this.renderer.getPixelRatio(),
			drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
			cssSize: [this.canvas.clientWidth, this.canvas.clientHeight]
		};
	}

	render() {
		this.renderer.render(this.scene, this.camera);
	}

	show(tris: Float32Array) {
		// ResizeObserver reports only from rendering steps, which a window without frames never runs
		this.resize();
		if (this.mesh) {
			this.scene.remove(this.mesh);
			this.mesh.geometry.dispose();
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(tris, 3));
		geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
		this.mesh = new THREE.Mesh(geometry, MATERIAL);
		this.scene.add(this.mesh);
		const { center, radius } = geometry.boundingSphere!;
		this.radius = radius;
		this.controls.target.copy(center);
		this.camera.near = radius / 100;
		this.camera.far = radius * 100;
		this.camera.updateProjectionMatrix();
		this.orbit(0);
	}

	/** The camera at step `i` of 240 on a circle round the model. */
	orbit(i: number) {
		const a = (i / 240) * 2 * Math.PI;
		const d = this.radius * 3.2;
		const t = this.controls.target;
		this.camera.position.set(t.x + d * Math.cos(a), t.y + d * Math.sin(a), t.z + d * 0.45);
		this.camera.lookAt(t);
		this.render();
	}

	/** Did the last frame put the model in the middle of the picture (not a blank view)? */
	drawn(): boolean {
		this.render();
		const gl = this.renderer.getContext();
		const px = new Uint8Array(4);
		gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
		const bg = new THREE.Color(BACKGROUND);
		return Math.abs(px[0] - bg.r * 255) + Math.abs(px[1] - bg.g * 255) + Math.abs(px[2] - bg.b * 255) > 30;
	}

	/** Lose the GPU context on purpose and get it back, as after a driver reset (TZ §17.2). Null: not possible here. */
	async loseAndRestore(): Promise<{ restoreMs: number; drawn: boolean } | null> {
		const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
		if (!ext) return null;
		const lost = once(this.canvas, 'webglcontextlost');
		ext.loseContext();
		await lost;
		// restoring is allowed only once the lost event has been dispatched (three.js cancels it, which permits it)
		await new Promise((r) => setTimeout(r));
		const t = performance.now();
		const restored = once(this.canvas, 'webglcontextrestored');
		ext.restoreContext();
		await restored;
		return { restoreMs: Math.round(performance.now() - t), drawn: this.drawn() };
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

function once(target: EventTarget, type: string, ms = 5000): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`no ${type} in ${ms / 1000} s`)), ms);
		target.addEventListener(type, () => (clearTimeout(timer), resolve()), { once: true });
	});
}
