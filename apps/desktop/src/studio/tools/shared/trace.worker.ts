/**
 * Image → contours off the main thread: decode the uploaded picture, bring
 * it to 400–800 px on the long side, take the luminance (transparent pixels
 * count as background) and trace it. Main thread → { file, opts }, worker →
 * { rings, width, height } | { error }.
 */
import { traceGray, type TraceOptions } from './trace';

const MIN_SIDE = 400;
const MAX_SIDE = 800;

self.onmessage = async (e: MessageEvent<{ file: Blob; opts: TraceOptions }>) => {
	const { file, opts } = e.data;
	try {
		const bitmap = await createImageBitmap(file);
		const long = Math.max(bitmap.width, bitmap.height);
		const k = Math.min(MAX_SIDE, Math.max(MIN_SIDE, long)) / long;
		const width = Math.max(1, Math.round(bitmap.width * k));
		const height = Math.max(1, Math.round(bitmap.height * k));
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('no 2d context');
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		const { data } = ctx.getImageData(0, 0, width, height);
		const background = opts.invert ? 0 : 255;
		const gray = new Uint8Array(width * height);
		for (let i = 0; i < gray.length; i++) {
			const a = data[i * 4 + 3] / 255;
			const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
			gray[i] = Math.round(lum * a + background * (1 - a));
		}
		const rings = traceGray(gray, width, height, opts);
		self.postMessage({ rings, width, height });
	} catch (err) {
		self.postMessage({ error: err instanceof Error ? err.message : String(err) });
	}
};
