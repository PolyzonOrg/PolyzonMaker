/**
 * The picture the assistant checks its own build by (render_openscad,
 * build_cad): four views in a 2×2 grid — by default iso, front, top, right.
 * The axis views are orthographic, so proportions on them are true, and each
 * carries a scale bar; the iso view carries the overall size. Parts of a CAD
 * build are coloured (the tools' part colours) and named in a legend under
 * the grid. `look` picks other sides, a section (the cut face shows white)
 * or one part alone. Axes are OpenSCAD's (Z up); the look is the studio
 * viewer's (viewer-look). Drawn off screen in a renderer of its own.
 */
import * as THREE from 'three';
import { addLights, disposeLines, edgeLines, surfaceMaterial } from './viewer-look';
import { partColor } from '$lib/tools/booleans/parts';
import { viewsOf, type Look, type ViewName } from '$lib/chat/scad-run';
import { num } from '$lib/i18n/current';
import * as m from '$msg/scad/shared';

let CELL = 384;
/** The studio's dark scene (token inverse-raised); the grey model reads on it. */
let SCENE = '#26262a';
const MODEL = 0xa3a3a8;
/** Inside of the part where a section cuts it. */
const CUT = 0xf2f2f2;
const INK = '#e5e5e5';
const MUTED = '#a3a3a8';
const LEGEND_ROW = 22;
const LEGEND_COLUMNS = 4;
const LEGEND_MAX = 24;

interface View {
	label: () => string;
	/** From the model's centre towards the camera. */
	dir: [number, number, number];
	up: [number, number, number];
	ortho: boolean;
}

/** The knowledge blocks describe these (server/chat/knowledge.ts). */
const VIEWS: Record<ViewName, View> = {
	iso: { label: m.scad_view_iso, dir: [1, -1, 0.8], up: [0, 0, 1], ortho: false },
	iso_back: { label: m.scad_view_iso_back, dir: [-1, 1, 0.8], up: [0, 0, 1], ortho: false },
	front: { label: m.scad_view_front, dir: [0, -1, 0], up: [0, 0, 1], ortho: true },
	back: { label: m.scad_view_back, dir: [0, 1, 0], up: [0, 0, 1], ortho: true },
	left: { label: m.scad_view_left, dir: [-1, 0, 0], up: [0, 0, 1], ortho: true },
	right: { label: m.scad_view_right, dir: [1, 0, 0], up: [0, 0, 1], ortho: true },
	top: { label: m.scad_view_top, dir: [0, 0, 1], up: [0, 1, 0], ortho: true },
	bottom: { label: m.scad_view_bottom, dir: [0, 0, -1], up: [0, 1, 0], ortho: true }
};

/** A part of the STL, in order: its triangles follow the previous part's. */
export interface ViewPart {
	name: string;
	triangles: number;
	color?: string;
}

const fmt = (v: number) => num(v, 1);

/** A round length for the scale bar: 1, 2 or 5 × 10ⁿ mm, 48–120 px long. */
function scaleBar(pxPerMm: number): number {
	for (let p = -1; p < 5; p++) {
		for (const m of [1, 2, 5]) {
			const mm = m * 10 ** p;
			if (mm * pxPerMm >= 48) return mm;
		}
	}
	return 10_000;
}

export async function renderViews(
	stl: Uint8Array,
	opts: { parts?: ViewPart[]; look?: Look; cell?: number } = {}
): Promise<Blob> {
	CELL = opts.cell ?? 384;
	SCENE = opts.cell ? '#5a5b61' : '#26262a';
	const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
	const full = new STLLoader().parse(Uint8Array.from(stl).buffer);
	const look = opts.look;

	// Parts by triangle range, when the build says how many each has.
	const position = full.getAttribute('position');
	const triangles = position.count / 3;
	const ranges: Array<{ name: string; color: string; start: number; count: number }> = [];
	if (opts.parts && opts.parts.reduce((n, p) => n + p.triangles, 0) === triangles) {
		let start = 0;
		opts.parts.forEach((p, i) => {
			ranges.push({ name: p.name, color: p.color ?? partColor(i), start, count: p.triangles });
			start += p.triangles;
		});
	}
	const shown = look?.part ? ranges.filter((r) => r.name === look.part) : ranges;
	let geometry = full;
	if (look?.part && shown.length > 0) {
		// One part alone: its triangles only, framed on their own.
		const parts = shown.map((r) =>
			(position.array as Float32Array).slice(r.start * 9, (r.start + r.count) * 9)
		);
		const merged = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
		let at = 0;
		for (const a of parts) {
			merged.set(a, at);
			at += a.length;
		}
		geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3));
		geometry.computeBoundingBox();
	}
	const colored = shown.length > 1 || (shown.length === 1 && ranges.length > 1);
	if (colored) {
		const colors = new Float32Array(geometry.getAttribute('position').count * 3);
		const c = new THREE.Color();
		let tri = 0;
		for (const r of shown) {
			c.set(r.color);
			for (let t = 0; t < r.count; t++, tri++) {
				for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (tri * 3 + k) * 3);
			}
		}
		geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	}

	if (!geometry.boundingBox) geometry.computeBoundingBox();
	const box = geometry.boundingBox!;
	const size = box.getSize(new THREE.Vector3());
	const center = box.getCenter(new THREE.Vector3());
	const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);

	const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
	const scene = new THREE.Scene();
	const material = surfaceMaterial(colored ? 0xffffff : MODEL);
	material.vertexColors = colored;
	const mesh = new THREE.Mesh(geometry, material);
	const edges = opts.cell ? null : edgeLines(geometry, MODEL);
	if (edges) mesh.add(edges);
	scene.add(mesh);
	let inside: THREE.Mesh | null = null;
	if (look?.section) {
		const axis = { x: 0, y: 1, z: 2 }[look.section.axis];
		const normal = new THREE.Vector3().setComponent(axis, -1);
		const plane = new THREE.Plane(normal, look.section.at);
		renderer.localClippingEnabled = true;
		material.clippingPlanes = [plane];
		if (edges) (edges.material as THREE.Material).clippingPlanes = [plane];
		// The part's inside, seen through the cut, in one flat colour: the cut face.
		inside = new THREE.Mesh(
			geometry,
			new THREE.MeshBasicMaterial({ color: CUT, side: THREE.BackSide, clippingPlanes: [plane] })
		);
		scene.add(inside);
	}
	scene.add(new THREE.HemisphereLight(0xffffff, 0x404046, 1.1));
	const key = new THREE.DirectionalLight(0xffffff, 1.5);
	scene.add(key, key.target);
	key.target.position.copy(center);

	const legend = colored ? shown : [];
	const legendRows = Math.ceil(Math.min(legend.length, LEGEND_MAX + 1) / LEGEND_COLUMNS);
	const legendHeight = legendRows ? legendRows * LEGEND_ROW + 16 : 0;

	try {
		renderer.setPixelRatio(1);
		renderer.setSize(CELL, CELL, false);
		renderer.setClearColor(SCENE, 1);
		const canvas = document.createElement('canvas');
		const across = legendHeight ? 2 : Math.min(viewsOf(look).length, 2);
		const down = Math.ceil(viewsOf(look).length / 2);
		canvas.width = CELL * across;
		canvas.height = CELL * down + legendHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2D canvas is not available');
		ctx.fillStyle = SCENE;
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		const section = look?.section;
		viewsOf(look).forEach((name, i) => {
			const view = VIEWS[name];
			const dir = new THREE.Vector3(...view.dir).normalize();
			const distance = radius * 4;
			const camera = view.ortho
				? new THREE.OrthographicCamera(
						-radius * 1.1,
						radius * 1.1,
						radius * 1.1,
						-radius * 1.1,
						radius / 10,
						distance * 2
					)
				: new THREE.PerspectiveCamera(30, 1, radius / 10, distance * 4);
			const reach = view.ortho ? distance : (radius * 1.15) / Math.sin((15 * Math.PI) / 180);
			camera.position.copy(center).addScaledVector(dir, reach);
			camera.up.set(...view.up);
			camera.lookAt(center);
			// Light from over the viewer's left shoulder, as in the studio viewer.
			const side = new THREE.Vector3().crossVectors(camera.up, dir).normalize();
			key.position
				.copy(center)
				.addScaledVector(dir, reach)
				.addScaledVector(side, -radius)
				.addScaledVector(camera.up, radius * 1.5);
			renderer.render(scene, camera);
			const x = (i % 2) * CELL;
			const y = Math.floor(i / 2) * CELL;
			ctx.drawImage(renderer.domElement, x, y, CELL, CELL);
			ctx.font = '600 15px system-ui, sans-serif';
			ctx.fillStyle = INK;
			ctx.fillText(
				section
					? m.scad_view_section({
							view: view.label(),
							axis: section.axis.toUpperCase(),
							at: fmt(section.at)
						})
					: view.label(),
				x + 12,
				y + 24
			);
			ctx.font = '500 13px system-ui, sans-serif';
			if (view.ortho) {
				// The scale bar: true length on the flat views.
				const pxPerMm = CELL / (radius * 2.2);
				const mm = scaleBar(pxPerMm);
				const px = mm * pxPerMm;
				const bx = x + 12;
				const by = y + CELL - 16;
				ctx.fillStyle = INK;
				ctx.fillRect(bx, by, px, 2);
				ctx.fillRect(bx, by - 5, 2, 7);
				ctx.fillRect(bx + px - 2, by - 5, 2, 7);
				ctx.fillText(m.scad_view_scale({ size: fmt(mm) }), bx + px + 8, by + 4);
			} else {
				ctx.fillStyle = INK;
				ctx.fillText(
					m.scad_view_size({ x: fmt(size.x), y: fmt(size.y), z: fmt(size.z) }),
					x + 12,
					y + CELL - 12
				);
			}
		});
		// Hairlines between the cells.
		ctx.fillStyle = '#4a4a52';
		if (across > 1) ctx.fillRect(CELL - 1, 0, 2, CELL * down);
		if (down > 1) ctx.fillRect(0, CELL - 1, CELL * 2, 2);
		if (legendHeight) {
			ctx.fillRect(0, CELL * down - 1, CELL * 2, 2);
			ctx.font = '500 13px system-ui, sans-serif';
			const width = (CELL * 2) / LEGEND_COLUMNS;
			legend.slice(0, LEGEND_MAX).forEach((r, i) => {
				const lx = (i % LEGEND_COLUMNS) * width + 12;
				const ly = CELL * down + 12 + Math.floor(i / LEGEND_COLUMNS) * LEGEND_ROW;
				ctx.fillStyle = r.color;
				ctx.fillRect(lx, ly + 2, 12, 12);
				ctx.fillStyle = INK;
				ctx.fillText(fitText(ctx, r.name, width - 34), lx + 20, ly + 13);
			});
			if (legend.length > LEGEND_MAX) {
				const i = LEGEND_MAX;
				ctx.fillStyle = MUTED;
				ctx.fillText(
					m.scad_view_legend_more({ n: legend.length - LEGEND_MAX }),
					(i % LEGEND_COLUMNS) * width + 12,
					CELL * down + 25 + Math.floor(i / LEGEND_COLUMNS) * LEGEND_ROW
				);
			}
		}

		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
				'image/jpeg',
				0.85
			)
		);
	} finally {
		disposeLines(edges);
		if (inside) (inside.material as THREE.Material).dispose();
		if (geometry !== full) geometry.dispose();
		full.dispose();
		material.dispose();
		renderer.dispose();
		renderer.forceContextLoss();
	}
}

/** A small picture of a model for the file field (DESIGN_CODE §7.8): the iso view, transparent around it. */
export async function renderThumbnail(triangles: Float32Array, px = 128): Promise<Blob> {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(triangles, 3));
	geometry.computeBoundingSphere();
	const center = geometry.boundingSphere!.center;
	const radius = Math.max(geometry.boundingSphere!.radius, 1);
	const material = surfaceMaterial(MODEL);
	const scene = new THREE.Scene();
	scene.add(new THREE.Mesh(geometry, material));
	const camera = new THREE.PerspectiveCamera(30, 1, radius * 0.1, radius * 20);
	camera.position
		.copy(center)
		.addScaledVector(
			new THREE.Vector3(...VIEWS.iso.dir).normalize(),
			radius / Math.sin((15 * Math.PI) / 180)
		);
	camera.up.set(...VIEWS.iso.up);
	camera.lookAt(center);
	addLights(scene, camera);
	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		alpha: true,
		preserveDrawingBuffer: true
	});
	try {
		renderer.setPixelRatio(1);
		renderer.setSize(px, px, false);
		renderer.setClearColor(0x000000, 0);
		renderer.render(scene, camera);
		return await new Promise<Blob>((resolve, reject) =>
			renderer.domElement.toBlob(
				(b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
				'image/png'
			)
		);
	} finally {
		geometry.dispose();
		material.dispose();
		renderer.dispose();
		renderer.forceContextLoss();
	}
}

/** A name cut with «…» to the width it has. */
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
	if (ctx.measureText(text).width <= width) return text;
	let s = text;
	while (s.length > 1 && ctx.measureText(`${s}…`).width > width) s = s.slice(0, -1);
	return `${s}…`;
}
