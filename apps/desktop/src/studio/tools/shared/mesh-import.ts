/**
 * Model files → triangle soup, all in the browser: STL (binary or ASCII),
 * OBJ (polygons fanned into triangles) and 3MF (a zip with XML meshes,
 * build transforms and components applied). Pure apart from
 * DecompressionStream, which browsers, workers and Node 18+ all have.
 */
import { parseStl, type Triangles } from '../stl';
import { unzip } from './zip-read';
import { ToolError } from '../build.svelte';
import * as tc from '$msg/tools/common';

/** Throws an Error with a Russian message the page can show as it is. */
export async function importMesh(name: string, bytes: Uint8Array): Promise<Triangles> {
	const ext = name.toLowerCase().split('.').pop() ?? '';
	let tris: Triangles;
	if (ext === 'obj') tris = parseObj(new TextDecoder().decode(bytes));
	else if (ext === '3mf') tris = await parse3mf(bytes);
	else {
		try {
			tris = parseStl(bytes);
		} catch {
			throw new ToolError(tc.tc_not_a_model());
		}
	}
	if (tris.length === 0) throw new ToolError(tc.tc_file_no_triangles());
	for (let i = 0; i < tris.length; i++) {
		if (!Number.isFinite(tris[i])) throw new ToolError(tc.tc_file_bad_coordinates());
	}
	return tris;
}

/** Wavefront OBJ: `v` and `f` lines; n-gons become fans, negative indices count back. */
export function parseObj(text: string): Triangles {
	const verts: number[] = [];
	const out: number[] = [];
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (line.startsWith('v ')) {
			const [, x, y, z] = line.split(/\s+/);
			verts.push(+x, +y, +z);
		} else if (line.startsWith('f ')) {
			const ids = line
				.split(/\s+/)
				.slice(1)
				.map((part) => {
					const n = parseInt(part.split('/')[0], 10);
					return n < 0 ? verts.length / 3 + n : n - 1;
				});
			if (ids.some((i) => !Number.isInteger(i) || i < 0 || i * 3 >= verts.length)) {
				throw new ToolError(tc.tc_obj_bad_face());
			}
			for (let k = 1; k + 1 < ids.length; k++) {
				for (const i of [ids[0], ids[k], ids[k + 1]])
					out.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
			}
		}
	}
	if (out.length === 0) throw new ToolError(tc.tc_obj_no_faces());
	return new Float32Array(out);
}

/** 4×3 affine transform of 3MF, row-vector convention: p' = p·M. */
type Transform = number[];
const IDENTITY: Transform = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function parseTransform(attr: string | undefined): Transform {
	if (!attr) return IDENTITY;
	const m = attr.trim().split(/\s+/).map(Number);
	return m.length === 12 && m.every(Number.isFinite) ? m : IDENTITY;
}

/** a then b. */
function compose(a: Transform, b: Transform): Transform {
	const out = new Array<number>(12);
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 3; c++) {
			let v = r === 3 ? b[9 + c] : 0;
			for (let k = 0; k < 3; k++) v += a[r * 3 + k] * b[k * 3 + c];
			out[r * 3 + c] = v;
		}
	}
	return out;
}

const attrPatterns = new Map<string, RegExp>();
/** Attribute value in a tag's text, with or without a namespace prefix. */
function attr(tag: string, name: string): string | undefined {
	let re = attrPatterns.get(name);
	if (!re) {
		re = new RegExp(`\\s(?:[\\w-]+:)?${name}="([^"]*)"`);
		attrPatterns.set(name, re);
	}
	return re.exec(tag)?.[1];
}

interface ObjectDef {
	mesh?: { vertices: Float64Array; triangles: Uint32Array };
	components: { path: string; id: string; transform: Transform }[];
}

export async function parse3mf(bytes: Uint8Array): Promise<Triangles> {
	const files = await unzip(bytes, (n) => n.toLowerCase().endsWith('.model'));
	if (files.size === 0) throw new ToolError(tc.tc_3mf_no_model());
	const objects = new Map<string, ObjectDef>();
	const decoder = new TextDecoder();
	let rootPath = '';
	let buildXml = '';
	/** mm per unit of the root model (3MF's `unit`, millimetres when it says nothing). */
	let unit = 1;
	for (const [name, data] of files) {
		const path = '/' + name.replace(/^\/+/, '');
		const xml = decoder.decode(data);
		const build = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml);
		if (build && (!rootPath || /3dmodel\.model$/i.test(path))) {
			rootPath = path;
			buildXml = build[1];
			const named = /<model\b[^>]*\sunit="([a-z]+)"/i.exec(xml)?.[1]?.toLowerCase() ?? '';
			unit = UNIT_MM[named] ?? 1;
		}
		for (const obj of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
			const id = attr(obj[1], 'id');
			if (!id) continue;
			const body = obj[2];
			const def: ObjectDef = { components: [] };
			const vxml = /<vertices>([\s\S]*?)<\/vertices>/.exec(body)?.[1];
			const txml = /<triangles>([\s\S]*?)<\/triangles>/.exec(body)?.[1];
			if (vxml && txml) {
				const v: number[] = [];
				for (const m of vxml.matchAll(/<vertex\b([^>]*)\/?>/g)) {
					v.push(Number(attr(m[1], 'x')), Number(attr(m[1], 'y')), Number(attr(m[1], 'z')));
				}
				const t: number[] = [];
				for (const m of txml.matchAll(/<triangle\b([^>]*)\/?>/g)) {
					t.push(Number(attr(m[1], 'v1')), Number(attr(m[1], 'v2')), Number(attr(m[1], 'v3')));
				}
				def.mesh = { vertices: new Float64Array(v), triangles: new Uint32Array(t) };
			}
			for (const c of body.matchAll(/<component\b([^>]*)\/?>/g)) {
				const cid = attr(c[1], 'objectid');
				if (!cid) continue;
				def.components.push({
					path: attr(c[1], 'path') ?? path,
					id: cid,
					transform: parseTransform(attr(c[1], 'transform'))
				});
			}
			objects.set(`${path}#${id}`, def);
		}
	}

	const out: number[] = [];
	const emit = (key: string, transform: Transform, depth: number) => {
		const def = objects.get(key);
		if (!def || depth > 16) return;
		if (def.mesh) {
			const { vertices: v, triangles: t } = def.mesh;
			const m = transform;
			for (let i = 0; i < t.length; i++) {
				const k = t[i] * 3;
				if (k + 2 >= v.length) throw new ToolError(tc.tc_3mf_bad_face());
				const x = v[k];
				const y = v[k + 1];
				const z = v[k + 2];
				out.push(
					x * m[0] + y * m[3] + z * m[6] + m[9],
					x * m[1] + y * m[4] + z * m[7] + m[10],
					x * m[2] + y * m[5] + z * m[8] + m[11]
				);
			}
		}
		for (const c of def.components) {
			emit(`/${c.path.replace(/^\/+/, '')}#${c.id}`, compose(c.transform, transform), depth + 1);
		}
	};
	const items = [...buildXml.matchAll(/<item\b([^>]*)\/?>/g)];
	if (items.length) {
		for (const item of items) {
			const id = attr(item[1], 'objectid');
			if (!id) continue;
			const path = attr(item[1], 'path') ?? rootPath;
			emit(`/${path.replace(/^\/+/, '')}#${id}`, parseTransform(attr(item[1], 'transform')), 0);
		}
	} else {
		for (const key of objects.keys()) emit(key, IDENTITY, 0);
	}
	if (out.length === 0) throw new ToolError(tc.tc_3mf_no_triangles());
	const tris = new Float32Array(out);
	if (unit !== 1) for (let i = 0; i < tris.length; i++) tris[i] *= unit;
	return tris;
}

/** The units 3MF allows, in millimetres. */
const UNIT_MM: Record<string, number> = {
	micron: 0.001,
	millimeter: 1,
	centimeter: 10,
	inch: 25.4,
	foot: 304.8,
	meter: 1000
};
