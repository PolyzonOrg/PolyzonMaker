/**
 * An uploaded picture → grayscale height map (light = high). Decoded by the
 * browser, scaled down to 1024 px on the long side, never uploaded.
 */
import { ToolError } from '../build.svelte';
import type { HeightImage } from './patterns';
import * as m from '$msg/tools/stl-texturizer';

const MAX_SIDE = 1024;

export async function readHeightImage(file: File): Promise<HeightImage> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new ToolError(m.t_stl_texturizer_image_open_failed());
	}
	const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new ToolError(m.t_stl_texturizer_image_read_failed());
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();
	const rgba = ctx.getImageData(0, 0, width, height).data;
	const data = new Float32Array(width * height);
	for (let i = 0; i < data.length; i++) {
		const o = i * 4;
		// Luminance; transparent pixels count as low.
		const y = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
		data[i] = (y / 255) * (rgba[o + 3] / 255);
	}
	return { width, height, data };
}
