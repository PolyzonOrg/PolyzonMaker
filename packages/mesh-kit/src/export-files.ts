/**
 * Files for the slicer, each read back before it is called ready: the
 * number of objects, the triangles, the size and the open and non-manifold
 * edges must come back as they went in. A file that fails is returned
 * without its bytes, with what went wrong. STL and 3MF are in millimetres
 * (3MF in the plain profile: geometry and units, no colours or materials);
 * GLB in metres unless asked otherwise.
 */
import { analyze } from './analyze.js';
import { markCoordinates, stlHeader, threeMfMetadata, xmpPacket, type Provenance } from './provenance.js';
import { glbMesh, writeGlb } from './glb.js';
import { parse3mfObjects } from './mesh-import.js';
import { bounds, merge, parseStl, writeStl, type Triangles, type Vec3 } from './stl.js';
import { write3mf } from './threemf.js';
import { unweld, weld } from './weld.js';

export type ExportFormat = 'stl' | '3mf' | 'glb';

export interface ExportPart {
	name: string;
	/** mm, Z up */
	tris: Triangles;
}

export interface FileFacts {
	objects: number;
	triangles: number;
	/** mm */
	size: Vec3;
	openEdges: number;
	nonManifoldEdges: number;
}

export interface ExportedFile {
	format: ExportFormat;
	ready: boolean;
	/** Only when `ready`. */
	bytes: Uint8Array | null;
	/** What was written, and what reading the file back found. */
	expected: FileFacts;
	readBack: FileFacts | null;
	problems: string[];
}

export interface ExportOptions {
	formats?: readonly ExportFormat[];
	/** The 3MF's title, and the part's name when one mesh is given. */
	name?: string;
	/** What the GLB's numbers are: glTF's metres (default) or millimetres. */
	glbUnit?: 'm' | 'mm';
	/** Made by an AI: every file says so and carries the invisible mark (provenance.ts) */
	provenance?: Provenance;
}

export async function exportModel(
	input: Triangles | readonly ExportPart[],
	{ formats = ['stl', '3mf'], name = 'model', glbUnit = 'm', provenance }: ExportOptions = {}
): Promise<ExportedFile[]> {
	const given = (input instanceof Float32Array ? [{ name, tris: input }] : input).filter((p) => p.tris.length >= 9);
	// STL and 3MF hold millimetres as they are, so the mark goes in here; a GLB marks its own numbers in metres
	const parts = provenance ? given.map((p) => ({ ...p, tris: markCoordinates(p.tris) })) : given;
	const all = merge(parts.map((p) => p.tris));
	const whole = facts([all], 0);
	// 3MF and GLB store shared corners: a triangle whose corners are one point is not written.
	const kept = parts.reduce((n, p) => n + weld(p.tris, 1e-9).indices.length / 3, 0);
	const out: ExportedFile[] = [];
	for (const format of formats) {
		const expected =
			format === 'stl' ? { ...whole, objects: 1 } : { ...whole, objects: parts.length, triangles: kept };
		const bytes =
			format === 'stl'
				? provenance
					? writeStl(all, stlHeader(provenance))
					: writeStl(all)
				: format === '3mf'
					? write3mf(parts, name, provenance ? { plain: true, application: provenance.tool, metadata: threeMfMetadata(provenance) } : { plain: true })
					: writeGlb(
							given.map((p) => p.tris),
							glbUnit,
							[],
							provenance && { generator: `${provenance.tool} (${provenance.system})`, xmp: xmpPacket(provenance) }
						);
		let readBack: FileFacts | null = null;
		const problems: string[] = [];
		try {
			readBack = await readBackFacts(format, bytes, glbUnit);
		} catch (e) {
			problems.push(`cannot be read back: ${(e as Error).message}`);
		}
		if (readBack) {
			const tolerance = 1e-3 + Math.hypot(...expected.size) * 1e-6;
			if (readBack.objects !== expected.objects)
				problems.push(`${readBack.objects} objects instead of ${expected.objects}`);
			if (readBack.triangles !== expected.triangles)
				problems.push(`${readBack.triangles} triangles instead of ${expected.triangles}`);
			if (readBack.size.some((v, k) => Math.abs(v - expected.size[k]) > tolerance))
				problems.push(`size ${readBack.size.join(' × ')} mm instead of ${expected.size.join(' × ')} mm`);
			if (readBack.openEdges !== expected.openEdges)
				problems.push(`${readBack.openEdges} open edges instead of ${expected.openEdges}`);
			if (readBack.nonManifoldEdges !== expected.nonManifoldEdges)
				problems.push(`${readBack.nonManifoldEdges} non-manifold edges instead of ${expected.nonManifoldEdges}`);
		}
		const ready = problems.length === 0;
		out.push({ format, ready, bytes: ready ? bytes : null, expected, readBack, problems });
	}
	return out;
}

async function readBackFacts(format: ExportFormat, bytes: Uint8Array, glbUnit: 'm' | 'mm'): Promise<FileFacts> {
	if (format === 'stl') return facts([parseStl(bytes)], 1);
	if (format === '3mf') {
		const objects = await parse3mfObjects(bytes);
		return facts(objects, objects.length);
	}
	const mesh = glbMesh(bytes);
	const tris = unweld(mesh);
	if (glbUnit === 'm') for (let i = 0; i < tris.length; i++) tris[i] *= 1000;
	return facts([tris], mesh.parts);
}

function facts(objects: Triangles[], count: number): FileFacts {
	const all = objects.length === 1 ? objects[0] : merge(objects);
	const a = analyze(all);
	return {
		objects: count,
		triangles: all.length / 9,
		size: bounds(all).size,
		openEdges: a.openEdges,
		nonManifoldEdges: a.nonManifoldEdges
	};
}

/**
 * The ArrayBuffers inside a result, for postMessage's transfer list: the
 * meshes and files move to the other thread instead of being copied. Every
 * array mesh-kit returns owns its whole buffer, so nothing else goes along.
 */
export function transferList(value: unknown): ArrayBuffer[] {
	const found = new Set<ArrayBuffer>();
	const walk = (v: unknown) => {
		if (ArrayBuffer.isView(v)) {
			if (v.buffer instanceof ArrayBuffer) found.add(v.buffer);
		} else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
	};
	walk(value);
	return [...found];
}
