/**
 * Parses a G-code file off the main thread: the file is streamed as text, so
 * a 100 MB print never exists as one string. Main → { file }; worker →
 * { kind: 'progress', value } … then { kind: 'done', toolpath } (buffers
 * transferred) or { kind: 'error', message } — a ToolError's text for the user, or '' (the
 * page shows its own line).
 */
import { ToolError } from '../build.svelte';
import { GcodeParser, toolpathBuffers } from './parse';

const post = (message: unknown, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
	const { file } = event.data;
	try {
		const parser = new GcodeParser();
		const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
		let read = 0;
		let reported = 0;
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			parser.push(value);
			read += value.length;
			if (read - reported > 2_000_000) {
				reported = read;
				post({ kind: 'progress', value: Math.min(0.99, read / Math.max(1, file.size)) });
			}
		}
		const toolpath = parser.finish();
		post({ kind: 'done', toolpath }, toolpathBuffers(toolpath));
	} catch (e) {
		post({ kind: 'error', message: e instanceof ToolError ? e.message : '' });
	}
};
