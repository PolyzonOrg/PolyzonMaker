/**
 * G-code → toolpath for the viewer: every move as a line segment, grouped by
 * extrusion type (from the slicer's ;TYPE: / ; FEATURE: comments) and by
 * layer, plus the numbers people check before a print — layers, height,
 * filament, time. Pure and streaming: push() text chunks as they are read,
 * finish() at the end. Runs in a worker for big files; small generated files
 * (the calibration towers) are parsed in place with parseGcode().
 *
 * Understood: G0/G1, G2/G3 (I/J or R, approximated by short segments),
 * G28, G90/G91, G92, G20/G21, M82/M83, T<n>. Layers come from the slicer's
 * layer comments when there are any, otherwise from the Z of extrusions
 * (Z-hops do not count — nothing is extruded up there).
 */
import { ToolError } from '../build.svelte';
import * as m from '$msg/tools/gcode-viewer';
import { MetaReader, type SlicerMeta } from './slicer-meta';

export const FEATURES = [
	'outer',
	'inner',
	'solid',
	'infill',
	'bridge',
	'support',
	'skirt',
	'other',
	'travel'
] as const;
export type Feature = (typeof FEATURES)[number];

/** Line colours on the dark scene; travel is drawn dimmer. */
export const FEATURE_INFO: Record<Feature, { label: string; color: string }> = {
	outer: {
		get label() {
			return m.t_gcode_viewer_feature_outer();
		},
		color: '#ff7a33'
	},
	inner: {
		get label() {
			return m.t_gcode_viewer_feature_inner();
		},
		color: '#ffc93c'
	},
	solid: {
		get label() {
			return m.t_gcode_viewer_feature_solid();
		},
		color: '#e5484d'
	},
	infill: {
		get label() {
			return m.t_gcode_viewer_feature_infill();
		},
		color: '#b06ee8'
	},
	bridge: {
		get label() {
			return m.t_gcode_viewer_feature_bridge();
		},
		color: '#4d8fe0'
	},
	support: {
		get label() {
			return m.t_gcode_viewer_feature_support();
		},
		color: '#3fb96b'
	},
	skirt: {
		get label() {
			return m.t_gcode_viewer_feature_skirt();
		},
		color: '#2ec4b6'
	},
	other: {
		get label() {
			return m.t_gcode_viewer_feature_other();
		},
		color: '#b4b4bc'
	},
	travel: {
		get label() {
			return m.t_gcode_viewer_feature_travel();
		},
		color: '#59606b'
	}
};

/** Slicer names of extrusion types → our groups (all slicers, any case). */
export function classifyFeature(name: string): Feature {
	const n = name.trim().toLowerCase();
	if (!n || n === 'custom') return 'other';
	if (n.includes('support')) return 'support';
	if (n.includes('skirt') || n.includes('brim')) return 'skirt';
	if (n.includes('bridge') || n.includes('overhang')) return 'bridge';
	if (n.includes('gap') || n.includes('ironing') || n.includes('tower') || n.includes('wipe'))
		return 'other';
	if (n.includes('external') || n.includes('outer')) return 'outer';
	if (n.includes('perimeter') || n.includes('wall')) return 'inner';
	if (n.includes('solid') || n.includes('top') || n.includes('bottom') || n.includes('skin'))
		return 'solid';
	if (n.includes('infill') || n.includes('fill')) return 'infill';
	return 'other';
}

export interface FeaturePath {
	/** x0 y0 z0 x1 y1 z1 per segment, G-code axes (Z up), mm. */
	positions: Float32Array;
	/** Index of the first segment of each layer; layers + 1 entries. */
	layerStart: Uint32Array;
	/** Path length, mm. */
	length: number;
	/** Feedrate of each segment, mm/s. */
	speeds: Float32Array;
}

export interface Toolpath {
	features: Record<Feature, FeaturePath>;
	/** Z of each layer (its first extrusion), mm. */
	layerZ: Float32Array;
	/** Extrusions of the model (no skirt, no start-code purge): [minX, minY, minZ, maxX, maxY, maxZ]. */
	bounds: number[] | null;
	/** Net filament pushed through the nozzle (retractions cancel out), mm. */
	filamentMm: number;
	/** Sum of length ÷ feedrate — no acceleration, so usually optimistic. */
	estimatedSec: number;
	toolChanges: number;
	/** Whether the slicer marked extrusion types (otherwise everything is «Прочее»). */
	typed: boolean;
	meta: SlicerMeta;
}

/** A file that would not fit in memory as lines (≈ 300 MB of vertices). */
const MAX_SEGMENTS = 12_000_000;

class Segments {
	buf = new Float32Array(6 * 4096);
	speed = new Float32Array(4096);
	len = 0;
	starts: number[] = [];
	length = 0;

	push(
		x0: number,
		y0: number,
		z0: number,
		x1: number,
		y1: number,
		z1: number,
		d: number,
		v: number
	) {
		if (this.len + 6 > this.buf.length) {
			const next = new Float32Array(this.buf.length * 2);
			next.set(this.buf);
			this.buf = next;
			const speed = new Float32Array(this.speed.length * 2);
			speed.set(this.speed);
			this.speed = speed;
		}
		this.speed[this.len / 6] = v;
		const b = this.buf;
		const i = this.len;
		b[i] = x0;
		b[i + 1] = y0;
		b[i + 2] = z0;
		b[i + 3] = x1;
		b[i + 4] = y1;
		b[i + 5] = z1;
		this.len = i + 6;
		this.length += d;
	}
}

// Word flags of one line.
const WX = 1,
	WY = 2,
	WZ = 4,
	WE = 8,
	WF = 16,
	WI = 32,
	WJ = 64,
	WR = 128;

export class GcodeParser {
	private x = 0;
	private y = 0;
	private z = 0;
	private e = 0;
	/** mm/min */
	private f = 1500;
	private units = 1;
	private relXYZ = false;
	private relE = false;
	private feature: Feature = 'other';
	/** Before the first ;TYPE: (start code, purge line) and in ;TYPE:Custom. */
	private custom = true;
	private typed = false;
	private layer = -1;
	private layerZ: number[] = [];
	private layerHasExtrusion = false;
	/** The layer has an extrusion of the model, not only start-code purge. */
	private layerReal = false;
	private commentLayers = false;
	private segs = Object.fromEntries(FEATURES.map((f) => [f, new Segments()])) as Record<
		Feature,
		Segments
	>;
	private total = 0;
	private moves = 0;
	private model = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
	private all = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
	private filament = 0;
	private time = 0;
	private tool = -1;
	private toolChanges = 0;
	private rest = '';
	private meta = new MetaReader();
	// Words of the current line.
	private wx = 0;
	private wy = 0;
	private wz = 0;
	private we = 0;
	private wf = 0;
	private wi = 0;
	private wj = 0;
	private wr = 0;

	push(chunk: string): void {
		const text = this.rest ? this.rest + chunk : chunk;
		let start = 0;
		for (;;) {
			const nl = text.indexOf('\n', start);
			if (nl < 0) break;
			this.line(text, start, nl);
			start = nl + 1;
		}
		this.rest = start < text.length ? text.slice(start) : '';
	}

	finish(): Toolpath {
		if (this.rest) {
			this.line(this.rest, 0, this.rest.length);
			this.rest = '';
		}
		if (!this.moves) throw new ToolError(m.t_gcode_viewer_no_moves());
		const features = {} as Record<Feature, FeaturePath>;
		for (const name of FEATURES) {
			const s = this.segs[name];
			const starts = new Uint32Array(this.layerZ.length + 1);
			starts.set(s.starts);
			starts[this.layerZ.length] = s.len / 6;
			features[name] = {
				positions: s.buf.slice(0, s.len),
				layerStart: starts,
				length: s.length,
				speeds: s.speed.slice(0, s.len / 6)
			};
		}
		const box = Number.isFinite(this.model[0]) ? this.model : this.all;
		// A layer without extrusion (travel only) takes the height of the one below.
		const layerZ = new Float32Array(this.layerZ.length);
		for (let i = 0; i < layerZ.length; i++) {
			const z = this.layerZ[i];
			layerZ[i] = Number.isFinite(z) ? z : i ? layerZ[i - 1] : 0;
		}
		return {
			features,
			layerZ,
			bounds: Number.isFinite(box[0]) ? box.slice() : null,
			filamentMm: this.filament,
			estimatedSec: Math.round(this.time),
			toolChanges: this.toolChanges,
			typed: this.typed,
			meta: this.meta.result()
		};
	}

	private line(text: string, start: number, end: number): void {
		// Within this line only: indexOf would run on to the next comment of the chunk.
		let semi = -1;
		for (let k = start; k < end; k++) {
			if (text.charCodeAt(k) === 59) {
				semi = k;
				break;
			}
		}
		const codeEnd = semi >= 0 ? semi : end;
		if (semi >= 0) this.comment(text.slice(semi + 1, end));

		let i = start;
		while (i < codeEnd && text.charCodeAt(i) <= 32) i++;
		if (i >= codeEnd) return;
		let c = text.charCodeAt(i) | 32;
		if (c === 110 /* n: line number */) {
			i++;
			while (i < codeEnd && text.charCodeAt(i) > 32) i++;
			while (i < codeEnd && text.charCodeAt(i) <= 32) i++;
			if (i >= codeEnd) return;
			c = text.charCodeAt(i) | 32;
		}
		if (c !== 103 && c !== 109 && c !== 116) return; // G, M, T only (skips Klipper macros)
		i++;
		let code = 0;
		let digits = 0;
		while (i < codeEnd) {
			const d = text.charCodeAt(i);
			if (d < 48 || d > 57) break;
			code = code * 10 + (d - 48);
			digits++;
			i++;
		}
		if (!digits) return;
		// «G1.1» style subcodes are not ours.
		if (text.charCodeAt(i) === 46) return;

		if (c === 116) {
			if (this.tool >= 0 && code !== this.tool) this.toolChanges++;
			this.tool = code;
			return;
		}
		if (c === 109) {
			if (code === 82) this.relE = false;
			else if (code === 83) this.relE = true;
			return;
		}
		switch (code) {
			case 0:
			case 1:
				this.move(this.words(text, i, codeEnd));
				return;
			case 2:
			case 3:
				this.arc(this.words(text, i, codeEnd), code === 2);
				return;
			case 20:
				this.units = 25.4;
				return;
			case 21:
				this.units = 1;
				return;
			case 28: {
				const mask = this.words(text, i, codeEnd);
				const allAxes = !(mask & (WX | WY | WZ));
				if (allAxes || mask & WX) this.x = 0;
				if (allAxes || mask & WY) this.y = 0;
				if (allAxes || mask & WZ) this.z = 0;
				return;
			}
			case 90:
				this.relXYZ = false;
				return;
			case 91:
				this.relXYZ = true;
				return;
			case 92: {
				const mask = this.words(text, i, codeEnd);
				const u = this.units;
				if (mask & WX) this.x = this.wx * u;
				if (mask & WY) this.y = this.wy * u;
				if (mask & WZ) this.z = this.wz * u;
				if (mask & WE) this.e = this.we * u;
				if (!(mask & (WX | WY | WZ | WE))) this.e = 0;
				return;
			}
		}
	}

	/** Reads «X12.5 Y-3 E.02 F1800» into wx…; returns which words were there. */
	private words(text: string, i: number, end: number): number {
		let mask = 0;
		while (i < end) {
			const ch = text.charCodeAt(i) | 32;
			i++;
			if (ch < 97 || ch > 122) continue;
			let j = i;
			let sign = 1;
			let c = text.charCodeAt(j);
			if (c === 45) {
				sign = -1;
				j++;
			} else if (c === 43) j++;
			let val = 0;
			let scale = 0;
			let digits = 0;
			while (j < end) {
				c = text.charCodeAt(j);
				if (c >= 48 && c <= 57) {
					val = val * 10 + (c - 48);
					if (scale) scale *= 10;
					digits++;
					j++;
				} else if (c === 46 && !scale) {
					scale = 1;
					j++;
				} else break;
			}
			i = j;
			if (!digits) continue;
			const v = sign * (scale ? val / scale : val);
			switch (ch) {
				case 120:
					this.wx = v;
					mask |= WX;
					break;
				case 121:
					this.wy = v;
					mask |= WY;
					break;
				case 122:
					this.wz = v;
					mask |= WZ;
					break;
				case 101:
					this.we = v;
					mask |= WE;
					break;
				case 102:
					this.wf = v;
					mask |= WF;
					break;
				case 105:
					this.wi = v;
					mask |= WI;
					break;
				case 106:
					this.wj = v;
					mask |= WJ;
					break;
				case 114:
					this.wr = v;
					mask |= WR;
					break;
			}
		}
		return mask;
	}

	private target(mask: number): [number, number, number, number] {
		const u = this.units;
		const rel = this.relXYZ;
		const nx = mask & WX ? (rel ? this.x + this.wx * u : this.wx * u) : this.x;
		const ny = mask & WY ? (rel ? this.y + this.wy * u : this.wy * u) : this.y;
		const nz = mask & WZ ? (rel ? this.z + this.wz * u : this.wz * u) : this.z;
		let de = 0;
		if (mask & WE) {
			const ev = this.we * u;
			if (this.relE || rel) {
				de = ev;
				this.e += ev;
			} else {
				de = ev - this.e;
				this.e = ev;
			}
		}
		if (mask & WF && this.wf > 0) this.f = this.wf * u;
		return [nx, ny, nz, de];
	}

	private move(mask: number): void {
		const [nx, ny, nz, de] = this.target(mask);
		this.lineTo(nx, ny, nz, de);
	}

	private arc(mask: number, cw: boolean): void {
		const x0 = this.x;
		const y0 = this.y;
		const [nx, ny, nz, de] = this.target(mask);
		const u = this.units;
		let cx: number;
		let cy: number;
		if (mask & (WI | WJ)) {
			cx = x0 + (mask & WI ? this.wi * u : 0);
			cy = y0 + (mask & WJ ? this.wj * u : 0);
		} else if (mask & WR) {
			const dx = nx - x0;
			const dy = ny - y0;
			const d = Math.hypot(dx, dy);
			const r = Math.abs(this.wr * u);
			if (d === 0 || r === 0) return this.lineTo(nx, ny, nz, de);
			const h = Math.sqrt(Math.max(r * r - (d * d) / 4, 0));
			// Minor arc: the centre is left of the chord for G3, right for G2; R<0 flips it.
			let side = cw ? -1 : 1;
			if (this.wr < 0) side = -side;
			cx = (x0 + nx) / 2 + (side * h * -dy) / d;
			cy = (y0 + ny) / 2 + (side * h * dx) / d;
		} else {
			return this.lineTo(nx, ny, nz, de);
		}
		const r = Math.hypot(x0 - cx, y0 - cy);
		const a0 = Math.atan2(y0 - cy, x0 - cx);
		const a1 = Math.atan2(ny - cy, nx - cx);
		let sweep = a1 - a0;
		if (cw && sweep >= -1e-9) sweep -= 2 * Math.PI;
		if (!cw && sweep <= 1e-9) sweep += 2 * Math.PI;
		const n = Math.max(1, Math.min(720, Math.ceil((Math.abs(sweep) * r) / 0.5)));
		const z0 = this.z;
		for (let k = 1; k <= n; k++) {
			const t = k / n;
			const a = a0 + sweep * t;
			const px = k === n ? nx : cx + r * Math.cos(a);
			const py = k === n ? ny : cy + r * Math.sin(a);
			this.lineTo(px, py, z0 + (nz - z0) * t, de / n);
		}
	}

	private lineTo(nx: number, ny: number, nz: number, de: number): void {
		const dx = nx - this.x;
		const dy = ny - this.y;
		const dz = nz - this.z;
		const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
		this.moves++;
		this.filament += de;
		this.time += (dist > 0 ? dist : Math.abs(de)) / (this.f / 60);
		if (dist > 0) {
			const extruding = de > 1e-7;
			if (extruding) {
				if (this.layer < 0) this.startLayer();
				else if (
					!this.commentLayers &&
					this.layerHasExtrusion &&
					Math.abs(nz - this.layerZ[this.layer]) > 1e-4
				)
					this.startLayer();
				// The layer's height: its first model extrusion (a purge line may come first).
				if (!this.layerHasExtrusion || (!this.layerReal && !this.custom)) {
					this.layerZ[this.layer] = nz;
					this.layerHasExtrusion = true;
					this.layerReal = !this.custom;
				}
				const kind = this.feature;
				this.segs[kind].push(this.x, this.y, this.z, nx, ny, nz, dist, this.f / 60);
				this.grow(this.all, nx, ny, nz);
				if (!this.custom && kind !== 'skirt') {
					this.grow(this.model, this.x, this.y, this.z);
					this.grow(this.model, nx, ny, nz);
				}
			} else {
				if (this.layer < 0) this.startLayer();
				this.segs.travel.push(this.x, this.y, this.z, nx, ny, nz, dist, this.f / 60);
			}
			if (++this.total > MAX_SEGMENTS) throw new ToolError(m.t_gcode_viewer_too_big());
		}
		this.x = nx;
		this.y = ny;
		this.z = nz;
	}

	private grow(b: number[], x: number, y: number, z: number) {
		if (x < b[0]) b[0] = x;
		if (y < b[1]) b[1] = y;
		if (z < b[2]) b[2] = z;
		if (x > b[3]) b[3] = x;
		if (y > b[4]) b[4] = y;
		if (z > b[5]) b[5] = z;
	}

	private startLayer() {
		this.layer++;
		this.layerZ.push(Number.NaN);
		this.layerHasExtrusion = false;
		this.layerReal = false;
		for (const name of FEATURES) this.segs[name].starts.push(this.segs[name].len / 6);
	}

	private comment(raw: string): void {
		const t = raw.trimStart();
		const c = t.charCodeAt(0);
		// T / F / f: extrusion type (PrusaSlicer, Orca, Cura ;TYPE:; Bambu ; FEATURE:; Simplify3D ; feature).
		if (c === 84 && t.startsWith('TYPE:')) return this.setFeature(t.slice(5));
		if (c === 70 && t.startsWith('FEATURE:')) return this.setFeature(t.slice(8));
		if (c === 102 && t.startsWith('feature ')) return this.setFeature(t.slice(8));
		// L / C / l: layer change (Prusa/Orca ;LAYER_CHANGE, Cura ;LAYER:n, Bambu ; CHANGE_LAYER, S3D ; layer n, Z = …).
		if (
			(c === 76 && (t.startsWith('LAYER_CHANGE') || /^LAYER:-?\d/.test(t))) ||
			(c === 67 && t.startsWith('CHANGE_LAYER')) ||
			(c === 108 && /^layer \d+, z/i.test(t))
		) {
			// The first layer comment only switches the mode: whatever the start code
			// purged before it belongs to the first layer, not to a layer of its own.
			if (this.commentLayers && this.layerHasExtrusion) this.startLayer();
			this.commentLayers = true;
			return;
		}
		this.meta.line(t);
	}

	private setFeature(name: string) {
		const n = name.trim();
		this.typed = true;
		this.custom = n.toLowerCase() === 'custom' || n === '';
		this.feature = classifyFeature(n);
	}
}

/** A whole G-code text at once (small files, tests). */
export function parseGcode(text: string): Toolpath {
	const parser = new GcodeParser();
	parser.push(text);
	return parser.finish();
}

/** Filament length → grams: π·(d/2)²·L in mm³, × density in g/cm³. */
export function filamentGrams(mm: number, diameter: number, density: number): number {
	return (Math.PI * (diameter / 2) ** 2 * mm * density) / 1000;
}

/** The buffers to transfer from the worker (no copy). */
export function toolpathBuffers(tp: Toolpath): ArrayBuffer[] {
	return FEATURES.flatMap((f) => [
		tp.features[f].positions.buffer as ArrayBuffer,
		tp.features[f].layerStart.buffer as ArrayBuffer,
		tp.features[f].speeds.buffer as ArrayBuffer
	]).concat(tp.layerZ.buffer as ArrayBuffer);
}

/**
 * The speeds the colour scale spans: of the extrusions (travel aside), the
 * 2nd to the 98th percentile, so one odd move does not wash the scale out.
 */
export function speedRange(tp: Toolpath): [number, number] {
	const bins = new Uint32Array(1001);
	let n = 0;
	for (const f of FEATURES) {
		if (f === 'travel') continue;
		for (const v of tp.features[f].speeds) {
			bins[Math.max(0, Math.min(1000, Math.round(v)))]++;
			n++;
		}
	}
	if (!n) return [0, 0];
	const at = (share: number) => {
		let seen = 0;
		for (let i = 0; i < bins.length; i++) {
			seen += bins[i];
			if (seen >= share * n) return i;
		}
		return 1000;
	};
	return [at(0.02), at(0.98)];
}

/** Slow to fast: blue through green to red, as the slicers draw it (scene data). */
export function speedHue(t: number): number {
	return (1 - Math.max(0, Math.min(1, t))) * 240;
}

/** The scale under «По скорости», the same hues as the lines. */
export const SPEED_GRADIENT = `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
	.map((t) => `hsl(${speedHue(t)} 90% 55%)`)
	.join(', ')})`;
