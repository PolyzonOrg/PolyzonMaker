/**
 * A drawn map of the Moon for a ball lithophane — not a photograph: dark
 * seas, bright highlands and craters of every size (few big ones, many
 * small, as on the real Moon), some young ones with bright rays. A globe
 * map (2:1, longitude across, pole to pole down), seamless all the way
 * round because every pixel is computed on the sphere. Pure and seeded.
 */

import { smoothstep as smooth, seededRandom as random } from '../shared/math';

/** Smooth 3D value noise in [0, 1). */
function noise(seed: number) {
	const hash = (x: number, y: number, z: number) => {
		let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + seed;
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	};
	const fade = (t: number) => t * t * (3 - 2 * t);
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	const layer = (xi: number, yi: number, zz: number, u: number, v: number) =>
		lerp(
			lerp(hash(xi, yi, zz), hash(xi + 1, yi, zz), u),
			lerp(hash(xi, yi + 1, zz), hash(xi + 1, yi + 1, zz), u),
			v
		);
	return (x: number, y: number, z: number) => {
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const zi = Math.floor(z);
		const u = fade(x - xi);
		const v = fade(y - yi);
		return lerp(layer(xi, yi, zi, u, v), layer(xi, yi, zi + 1, u, v), fade(z - zi));
	};
}

/** Grayscale RGBA, `width` × `height` (use 2:1). */
export function moonMap(width: number, height: number, seed = 7): Uint8ClampedArray<ArrayBuffer> {
	const W = Math.max(8, Math.round(width));
	const H = Math.max(4, Math.round(height));
	const n = noise(seed);
	const fbm = (x: number, y: number, z: number, octaves: number) => {
		let sum = 0;
		let amp = 0.5;
		let f = 1;
		for (let o = 0; o < octaves; o++) {
			sum += amp * n(x * f + o * 17.3, y * f, z * f);
			f *= 2;
			amp *= 0.5;
		}
		return sum / (1 - 0.5 ** octaves);
	};

	// Every pixel's point on the unit sphere.
	const P = new Float32Array(W * H * 3);
	for (let y = 0; y < H; y++) {
		const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
		for (let x = 0; x < W; x++) {
			const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
			const k = (y * W + x) * 3;
			P[k] = Math.cos(lat) * Math.cos(lon);
			P[k + 1] = Math.cos(lat) * Math.sin(lon);
			P[k + 2] = Math.sin(lat);
		}
	}

	// Seas and highlands, with a fine grain over everything.
	const albedo = new Float32Array(W * H);
	const sea = new Float32Array(W * H);
	for (let i = 0; i < W * H; i++) {
		const x = P[i * 3];
		const y = P[i * 3 + 1];
		const z = P[i * 3 + 2];
		// Most seas lie on the near side, the middle of the map.
		const s = smooth(0.56, 0.63, fbm(x * 1.5 + 3, y * 1.5, z * 1.5, 5) + 0.07 * x);
		sea[i] = s;
		const grain = fbm(x * 14, y * 14, z * 14, 3) - 0.5;
		const tone = fbm(x * 4 + 9, y * 4, z * 4, 3) - 0.5;
		albedo[i] = 0.76 - 0.34 * s + 0.1 * grain + 0.12 * tone * s;
	}

	// Craters: the number above a size falls with its square.
	const rnd = random(seed * 9973 + 1);
	const rMin = 0.005;
	const rMax = 0.16;
	const count = Math.round(2.6 * W);
	for (let c = 0; c < count; c++) {
		const z0 = rnd() * 2 - 1;
		const lon0 = rnd() * Math.PI * 2;
		const ring = Math.sqrt(1 - z0 * z0);
		const cx = ring * Math.cos(lon0);
		const cy = ring * Math.sin(lon0);
		const u = rnd();
		const r = rMin / Math.sqrt(1 - u * (1 - (rMin / rMax) ** 2));
		const young = rnd() < 0.035;
		const reach = young ? 4 : 1.8;
		// Seas are younger than the highlands: fewer, fainter craters there.
		const lat0 = Math.asin(z0);
		const yc = Math.min(H - 1, Math.max(0, Math.round(((Math.PI / 2 - lat0) / Math.PI) * H)));
		const xc = Math.min(W - 1, Math.max(0, Math.round((lon0 / (Math.PI * 2)) * W + W / 2) % W));
		const age = (0.35 + 0.65 * rnd()) * (1 - 0.6 * sea[yc * W + xc]);
		const span = r * reach;
		const y0 = Math.max(0, Math.floor(((Math.PI / 2 - (lat0 + span)) / Math.PI) * H));
		const y1 = Math.min(H - 1, Math.ceil(((Math.PI / 2 - (lat0 - span)) / Math.PI) * H));
		const cosSpan = Math.cos(span);
		const rays = young ? 10 + Math.floor(rnd() * 12) : 0;
		// East at the crater: the sun comes from the west, lighting the far inner wall.
		const ex = -Math.sin(lon0);
		const ey = Math.cos(lon0);
		const twist = rnd() * Math.PI * 2;
		// Two directions across the surface at the crater, to measure angles round it.
		const hx = Math.abs(z0) < 0.9 ? 0 : 1;
		const hz = 1 - hx;
		let e1x = -hz * cy;
		let e1y = hz * cx - hx * z0;
		let e1z = hx * cy;
		const e1n = Math.hypot(e1x, e1y, e1z) || 1;
		e1x /= e1n;
		e1y /= e1n;
		e1z /= e1n;
		const e2x = cy * e1z - z0 * e1y;
		const e2y = z0 * e1x - cx * e1z;
		const e2z = cx * e1y - cy * e1x;
		for (let y = y0; y <= y1; y++) {
			const lat = Math.PI / 2 - ((y + 0.5) / H) * Math.PI;
			const half = Math.cos(lat) > span ? Math.asin(Math.sin(span) / Math.cos(lat)) : Math.PI;
			const w = Math.min(W, Math.ceil((half / (Math.PI * 2)) * W) + 1);
			for (let dx = -w; dx <= w; dx++) {
				const x = (((xc + dx) % W) + W) % W;
				const i = y * W + x;
				const dot = P[i * 3] * cx + P[i * 3 + 1] * cy + P[i * 3 + 2] * z0;
				if (dot < cosSpan) continue;
				const s = Math.acos(Math.min(1, dot)) / r;
				let d = 0;
				const east = ((P[i * 3] - cx) * ex + (P[i * 3 + 1] - cy) * ey) / r;
				if (s < 0.9) d = -0.06 + 0.1 * east + (r > 0.05 && s < 0.14 ? 0.12 * (1 - s / 0.14) : 0);
				else if (s < 1.15) d = 0.14 * Math.sin(((s - 0.9) / 0.25) * Math.PI) + 0.05 * east;
				else if (s < 1.8) d = (0.04 - 0.04 * east) * (1 - (s - 1.15) / 0.65);
				if (rays && s > 1) {
					// Bright streaks thrown out of a young crater.
					const px = P[i * 3];
					const py = P[i * 3 + 1];
					const pz = P[i * 3 + 2];
					const a =
						Math.atan2(px * e2x + py * e2y + pz * e2z, px * e1x + py * e1y + pz * e1z) + twist;
					const streak = Math.max(0, Math.cos(a * rays)) ** 10;
					d += 0.1 * streak * (1 - (s - 1) / (reach - 1));
				}
				albedo[i] += d * age * (young ? 1.4 : 1);
			}
		}
	}

	const out = new Uint8ClampedArray(W * H * 4);
	for (let i = 0; i < W * H; i++) {
		const g = Math.round(255 * Math.min(1, Math.max(0, albedo[i])));
		out[i * 4] = g;
		out[i * 4 + 1] = g;
		out[i * 4 + 2] = g;
		out[i * 4 + 3] = 255;
	}
	return out;
}
