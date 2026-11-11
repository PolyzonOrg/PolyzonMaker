/**
 * Building closed meshes directly in JS (vases, lithophanes, stands): an
 * indexed vertex list where every surface reuses the vertices of its
 * neighbours, so the result is watertight by construction, not by welding.
 * Faces are counter-clockwise seen from outside. Pure, no three.js.
 */
import type { Triangles } from '../stl';
import { earClip } from './mesh-triangulate';
import { ToolError } from '../build.svelte';
import * as tc from '$msg/tools/common';

export class MeshBuilder {
	private pos = new Float64Array(3 * 1024);
	private idx = new Uint32Array(3 * 2048);
	private vCount = 0;
	private iCount = 0;

	get vertexCount(): number {
		return this.vCount;
	}

	get triangleCount(): number {
		return this.iCount / 3;
	}

	vertex(x: number, y: number, z: number): number {
		if (this.vCount * 3 + 3 > this.pos.length) {
			const grown = new Float64Array(this.pos.length * 2);
			grown.set(this.pos);
			this.pos = grown;
		}
		const at = this.vCount * 3;
		this.pos[at] = x;
		this.pos[at + 1] = y;
		this.pos[at + 2] = z;
		return this.vCount++;
	}

	tri(a: number, b: number, c: number): void {
		if (this.iCount + 3 > this.idx.length) {
			const grown = new Uint32Array(this.idx.length * 2);
			grown.set(this.idx);
			this.idx = grown;
		}
		this.idx[this.iCount++] = a;
		this.idx[this.iCount++] = b;
		this.idx[this.iCount++] = c;
	}

	/** Quad a→b→c→d (counter-clockwise from outside) as two triangles. */
	quad(a: number, b: number, c: number, d: number): void {
		this.tri(a, b, c);
		this.tri(a, c, d);
	}

	/**
	 * Band between two rings of the same length. The face normal is
	 * (a[i]→a[i+1]) × (a→b): rings running CCW seen from above, `a` below
	 * `b`, make an outer wall facing out.
	 */
	band(a: readonly number[], b: readonly number[], closed = true): void {
		const n = a.length;
		const last = closed ? n : n - 1;
		for (let i = 0; i < last; i++) {
			const j = (i + 1) % n;
			this.quad(a[i], a[j], b[j], b[i]);
		}
	}

	/** Fan from `center` over a closed ring: CCW seen from where the ring runs CCW. */
	fan(center: number, ring: readonly number[], flip = false): void {
		const n = ring.length;
		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			if (flip) this.tri(center, ring[j], ring[i]);
			else this.tri(center, ring[i], ring[j]);
		}
	}

	/**
	 * Band between two closed rings of different lengths that start at the
	 * same angle and run the same way (`outer` and `inner` of an annulus).
	 * CCW seen from where both rings run CCW; `flip` for the other side.
	 */
	zip(outer: readonly number[], inner: readonly number[], flip = false): void {
		const no = outer.length;
		const ni = inner.length;
		let i = 0;
		let j = 0;
		while (i < no || j < ni) {
			// Advance whichever ring's next vertex comes first around the circle.
			const advanceOuter = j >= ni || (i < no && (i + 1) / no <= (j + 1) / ni);
			const o0 = outer[i % no];
			const i0 = inner[j % ni];
			if (advanceOuter) {
				const o1 = outer[(i + 1) % no];
				if (flip) this.tri(o0, i0, o1);
				else this.tri(o0, o1, i0);
				i++;
			} else {
				const i1 = inner[(j + 1) % ni];
				if (flip) this.tri(o0, i0, i1);
				else this.tri(o0, i1, i0);
				j++;
			}
		}
	}

	toTriangles(): Triangles {
		const out = new Float32Array(this.iCount * 3);
		for (let i = 0; i < this.iCount; i++) {
			const v = this.idx[i] * 3;
			out[i * 3] = this.pos[v];
			out[i * 3 + 1] = this.pos[v + 1];
			out[i * 3 + 2] = this.pos[v + 2];
		}
		return out;
	}
}

/**
 * A simple polygon (x, y pairs, counter-clockwise) extruded along Z from 0 to
 * `height` — a closed prism. Throws if the outline cannot be triangulated.
 */
export function extrudePolygon(outline: readonly [number, number][], height: number): Triangles {
	const flat = outline.flat();
	const caps = earClip(flat);
	if (!caps) throw new ToolError(tc.tc_outline_not_triangulated());
	const m = new MeshBuilder();
	const bottom = outline.map(([x, y]) => m.vertex(x, y, 0));
	const top = outline.map(([x, y]) => m.vertex(x, y, height));
	for (let t = 0; t < caps.length; t += 3) {
		m.tri(top[caps[t]], top[caps[t + 1]], top[caps[t + 2]]);
		m.tri(bottom[caps[t]], bottom[caps[t + 2]], bottom[caps[t + 1]]);
	}
	m.band(bottom, top);
	return m.toTriangles();
}

/** A copy with axes renamed (x, y, z) → (z, x, y): a rotation, winding kept. */
export function rotateAxes(tris: Triangles): Triangles {
	const out = new Float32Array(tris.length);
	for (let i = 0; i < tris.length; i += 3) {
		out[i] = tris[i + 2];
		out[i + 1] = tris[i];
		out[i + 2] = tris[i + 1];
	}
	return out;
}
