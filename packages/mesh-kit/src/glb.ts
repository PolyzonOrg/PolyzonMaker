/**
 * GLB (binary glTF) ↔ meshes, geometry only. Reading takes every triangle
 * of the scene with node transforms applied, turned from glTF's Y-up to
 * Z-up for slicers; writing turns it back. Units are never guessed: the
 * caller says metres or millimetres. No three.js, so it runs in Node and in
 * a worker alike. Compressed geometry (Draco, meshopt) is refused rather
 * than misread.
 */
import { markCoordinates } from './provenance.js';
import { MeshKitError } from './errors.js';
import type { Triangles } from './stl.js';
import { weld, type IndexedMesh } from './weld.js';

interface Accessor {
	bufferView?: number;
	byteOffset?: number;
	componentType: number;
	count: number;
	type: string;
	sparse?: unknown;
}
interface GltfNode {
	children?: number[];
	mesh?: number;
	matrix?: number[];
	translation?: number[];
	rotation?: number[];
	scale?: number[];
}
interface Gltf {
	scene?: number;
	scenes?: Array<{ nodes?: number[] }>;
	nodes?: GltfNode[];
	meshes?: Array<{
		primitives: Array<{ attributes: { POSITION?: number }; indices?: number; mode?: number; material?: number }>;
	}>;
	materials?: Array<{ pbrMetallicRoughness?: { baseColorFactor?: number[] } }>;
	accessors?: Accessor[];
	bufferViews?: Array<{
		buffer?: number;
		byteOffset?: number;
		byteLength: number;
		byteStride?: number;
	}>;
	buffers?: Array<{ uri?: string; byteLength: number }>;
	extensionsUsed?: string[];
}

type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const INDEX_SIZE: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4 };

/** Column-major, as glTF stores it. */
function multiply(a: Mat4, b: Mat4): Mat4 {
	const out = new Array<number>(16);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
			out[c * 4 + r] = sum;
		}
	return out;
}

function localMatrix(node: GltfNode): Mat4 {
	if (node.matrix?.length === 16) return node.matrix;
	const [tx, ty, tz] = node.translation ?? [0, 0, 0];
	const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale ?? [1, 1, 1];
	return [
		(1 - 2 * (y * y + z * z)) * sx,
		2 * (x * y + z * w) * sx,
		2 * (x * z - y * w) * sx,
		0,
		2 * (x * y - z * w) * sy,
		(1 - 2 * (x * x + z * z)) * sy,
		2 * (y * z + x * w) * sy,
		0,
		2 * (x * z + y * w) * sz,
		2 * (y * z - x * w) * sz,
		(1 - 2 * (x * x + y * y)) * sz,
		0,
		tx,
		ty,
		tz,
		1
	];
}

const unreadable = (why: string) => new MeshKitError('glb-unreadable', why);

/** The colour of a run of triangles, in the file's order; linear RGB, null when it has none. */
export interface GlbPaint {
	triangles: number;
	color: number[] | null;
}

/**
 * Every triangle of the GLB's scene, node transforms applied, as one indexed
 * mesh in the file's own units (glTF: metres); `parts` counts the triangle
 * primitives it came from. Geometry only from the file's own BIN chunk: a
 * buffer by URI is refused, never fetched or opened.
 */
export function glbMesh(glb: Uint8Array): IndexedMesh & { parts: number; paints: GlbPaint[] } {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	if (glb.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw unreadable('not a GLB');
	const jsonLength = view.getUint32(12, true);
	if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > glb.byteLength)
		throw unreadable('GLB has no JSON chunk');
	const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as Gltf;
	for (const ext of gltf.extensionsUsed ?? [])
		if (ext === 'KHR_draco_mesh_compression' || ext === 'EXT_meshopt_compression')
			throw unreadable(`geometry is compressed (${ext})`);
	if (gltf.buffers?.some((b) => b.uri !== undefined)) throw unreadable('a buffer lives outside the file');
	const binAt = 20 + jsonLength;
	const bin =
		binAt + 8 <= glb.byteLength && view.getUint32(binAt + 4, true) === 0x004e4942
			? glb.subarray(binAt + 8, Math.min(glb.byteLength, binAt + 8 + view.getUint32(binAt, true)))
			: new Uint8Array(0);

	function data(accessorIndex: number, elementSize: number) {
		const a = gltf.accessors?.[accessorIndex];
		const v = a?.bufferView == null ? undefined : gltf.bufferViews?.[a.bufferView];
		if (!a || !v || a.sparse || (v.buffer ?? 0) !== 0) throw unreadable('accessor not readable');
		const stride = v.byteStride ?? elementSize;
		const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
		const length = a.count === 0 ? 0 : stride * (a.count - 1) + elementSize;
		if (start + length > bin.byteLength) throw unreadable('accessor out of bounds');
		return { a, stride, bytes: new DataView(bin.buffer, bin.byteOffset + start, length) };
	}

	const parts: (IndexedMesh & { paint?: number[] })[] = [];
	function addPrimitive(positionIndex: number, indexAccessor: number | undefined, m: Mat4, paint?: number[]) {
		const pos = data(positionIndex, 12);
		if (pos.a.type !== 'VEC3' || pos.a.componentType !== 5126)
			throw unreadable('positions not float32');
		const positions = new Float32Array(pos.a.count * 3);
		for (let i = 0; i < pos.a.count; i++) {
			const x = pos.bytes.getFloat32(i * pos.stride, true);
			const y = pos.bytes.getFloat32(i * pos.stride + 4, true);
			const z = pos.bytes.getFloat32(i * pos.stride + 8, true);
			// World position, then Y-up → Z-up.
			positions[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
			positions[i * 3 + 1] = -(m[2] * x + m[6] * y + m[10] * z + m[14]);
			positions[i * 3 + 2] = m[1] * x + m[5] * y + m[9] * z + m[13];
		}
		let indices: Uint32Array;
		if (indexAccessor == null) indices = Uint32Array.from({ length: pos.a.count }, (_, i) => i);
		else {
			const size = INDEX_SIZE[gltf.accessors?.[indexAccessor]?.componentType ?? 0];
			if (!size) throw unreadable('indices not unsigned integers');
			const idx = data(indexAccessor, size);
			indices = new Uint32Array(idx.a.count);
			for (let i = 0; i < idx.a.count; i++) {
				const at = i * idx.stride;
				indices[i] =
					size === 1
						? idx.bytes.getUint8(at)
						: size === 2
							? idx.bytes.getUint16(at, true)
							: idx.bytes.getUint32(at, true);
				if (indices[i] >= pos.a.count) throw unreadable('index out of range');
			}
		}
		indices = indices.subarray(0, indices.length - (indices.length % 3));
		// A mirroring transform turns the faces inside out; swap two corners back.
		const det =
			m[0] * (m[5] * m[10] - m[9] * m[6]) -
			m[4] * (m[1] * m[10] - m[9] * m[2]) +
			m[8] * (m[1] * m[6] - m[5] * m[2]);
		if (det < 0)
			for (let i = 0; i < indices.length; i += 3)
				[indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
		parts.push({ positions, indices, paint });
	}

	function visit(nodeIndex: number, parent: Mat4, depth: number) {
		const node = gltf.nodes?.[nodeIndex];
		if (!node || depth > 64) return;
		const world = multiply(parent, localMatrix(node));
		const mesh = node.mesh == null ? undefined : gltf.meshes?.[node.mesh];
		for (const p of mesh?.primitives ?? []) {
			// Only triangle lists (mode 4, the default); points and lines have nothing to print.
			if ((p.mode ?? 4) === 4 && p.attributes.POSITION != null)
				addPrimitive(p.attributes.POSITION, p.indices, world, gltf.materials?.[p.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor);
		}
		for (const child of node.children ?? []) visit(child, world, depth + 1);
	}
	const nodes = gltf.nodes ?? [];
	const children = new Set(nodes.flatMap((n) => n.children ?? []));
	const roots =
		gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => !children.has(i));
	for (const root of roots) visit(root, IDENTITY, 0);

	const vertexCount = parts.reduce((n, p) => n + p.positions.length / 3, 0);
	const out = {
		positions: new Float32Array(vertexCount * 3),
		indices: new Uint32Array(parts.reduce((n, p) => n + p.indices.length, 0)),
		parts: parts.length,
		paints: parts.map((p) => ({ triangles: p.indices.length / 3, color: p.paint?.slice(0, 3) ?? null }))
	};
	let vertexAt = 0;
	let indexAt = 0;
	for (const p of parts) {
		out.positions.set(p.positions, vertexAt * 3);
		for (let i = 0; i < p.indices.length; i++) out.indices[indexAt + i] = p.indices[i] + vertexAt;
		vertexAt += p.positions.length / 3;
		indexAt += p.indices.length;
	}
	if (out.indices.length === 0) throw new MeshKitError('no-triangles');
	return out;
}

/**
 * Parts in mm, Z up → a GLB: one mesh and node per part, Y up as glTF
 * wants. `unit` says what the GLB's numbers are: 'm' (glTF's own, the
 * default) divides by 1000, 'mm' keeps them for tools that read GLB in mm.
 * `colors` gives each part a colour, #rrggbb, by the same index.
 */
export function writeGlb(
	parts: readonly Triangles[],
	unit: 'm' | 'mm' = 'm',
	colors: readonly (string | undefined)[] = [],
	/** For an AI-made model: the program in `asset.generator`, an XMP packet and the invisible mark (provenance.ts) */
	made?: { generator: string; xmp: Record<string, unknown> }
): Uint8Array {
	const k = unit === 'm' ? 0.001 : 1;
	const kept = parts.flatMap((p, i) => (p.length >= 9 ? [{ triangles: p, color: colors[i] }] : []));
	const meshes = kept.map((p) => weld(p.triangles, 1e-9));
	const paints = [...new Set(kept.flatMap((p) => p.color ?? []))];
	const linear = (byte: number) => (byte / 255 <= 0.04045 ? byte / 255 / 12.92 : ((byte / 255 + 0.055) / 1.055) ** 2.4);
	const materials = paints.map((hex) => ({ pbrMetallicRoughness: { baseColorFactor: [1, 3, 5].map((at) => linear(parseInt(hex.slice(at, at + 2), 16))).concat(1), metallicFactor: 0, roughnessFactor: 0.6 } }));
	const bin: Uint8Array[] = [];
	const accessors: object[] = [];
	const bufferViews: object[] = [];
	let at = 0;
	const view = (bytes: Uint8Array, target: number) => {
		bufferViews.push({ buffer: 0, byteOffset: at, byteLength: bytes.length, target });
		bin.push(bytes);
		at += bytes.length;
		return bufferViews.length - 1;
	};
	for (const m of meshes) {
		// Z-up mm → glTF: (x, y, z) = (X, Z, −Y), in the chosen unit.
		let pos: Float32Array = new Float32Array(m.positions.length);
		for (let i = 0; i < pos.length; i += 3) {
			pos[i] = m.positions[i] * k;
			pos[i + 1] = m.positions[i + 2] * k;
			pos[i + 2] = -m.positions[i + 1] * k;
		}
		// marked in the numbers the file holds: scaling to metres afterwards would wipe it
		if (made) pos = markCoordinates(pos);
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < pos.length; i += 3) {
			for (let c = 0; c < 3; c++) {
				min[c] = Math.min(min[c], pos[i + c]);
				max[c] = Math.max(max[c], pos[i + c]);
			}
		}
		accessors.push(
			{ bufferView: view(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
			{ bufferView: view(new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength), 34963), componentType: 5125, count: m.indices.length, type: 'SCALAR' }
		);
	}
	const json = {
		asset: { version: '2.0', generator: made?.generator ?? 'Polyzon mesh-kit', ...(made ? { extensions: { KHR_xmp_json_ld: { packet: 0 } } } : {}) },
		...(made ? { extensionsUsed: ['KHR_xmp_json_ld'], extensions: { KHR_xmp_json_ld: { packets: [made.xmp] } } } : {}),
		scene: 0,
		scenes: [{ nodes: meshes.map((_, i) => i) }],
		nodes: meshes.map((_, i) => ({ mesh: i })),
		meshes: meshes.map((_, i) => {
			const material = paints.indexOf(kept[i].color ?? '');
			return { primitives: [{ attributes: { POSITION: 2 * i }, indices: 2 * i + 1, ...(material < 0 ? {} : { material }) }] };
		}),
		...(materials.length ? { materials } : {}),
		accessors,
		bufferViews,
		buffers: [{ byteLength: at }]
	};
	const text = new TextEncoder().encode(JSON.stringify(json));
	const jsonLength = Math.ceil(text.length / 4) * 4;
	const binLength = Math.ceil(at / 4) * 4;
	const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, 0x46546c67, true);
	dv.setUint32(4, 2, true);
	dv.setUint32(8, out.length, true);
	dv.setUint32(12, jsonLength, true);
	dv.setUint32(16, 0x4e4f534a, true);
	out.fill(0x20, 20, 20 + jsonLength);
	out.set(text, 20);
	dv.setUint32(20 + jsonLength, binLength, true);
	dv.setUint32(24 + jsonLength, 0x004e4942, true);
	let o = 28 + jsonLength;
	for (const b of bin) {
		out.set(b, o);
		o += b.length;
	}
	return out;
}
