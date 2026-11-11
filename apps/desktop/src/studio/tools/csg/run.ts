/**
 * Build a CSG tree in the browser: texts → glyph outlines through the
 * OpenSCAD worker (one extrusion per build, cached per text), then the
 * booleans in a manifold worker. Each build takes the warm spare worker and
 * starts the next spare, so a rebuild never waits for the WASM to load and a
 * cancelled build just terminates its worker.
 *
 *   const build = createBuild((root, signal) => buildCsg(root, signal), 400);
 *   onDestroy(disposeCsg);
 */
import { ToolError } from '../build.svelte';
import { buildOutline } from '../scad';
import { fontFiles } from '../shared/fonts';
import { collectTexts, union, type Node } from './csg';
import { textFrame, type Glyphs, type TextBox } from './evaluate';
import { glyphScad, glyphsFromRings } from './glyphs';
import { workerName } from '$lib/i18n/worker';
import * as tc from '$msg/tools/common';

const glyphCache = new Map<string, Glyphs[string]>();
let spare: Worker | null = null;

const spawn = () =>
	new Worker(new URL('./csg.worker.ts', import.meta.url), {
		type: 'module',
		name: workerName('csg')
	});

/** Start the worker early (on mount), before the first build is asked for. */
export function preloadCsg(): void {
	spare ??= spawn();
}

/** Drop the spare worker when the tool page goes away. */
export function disposeCsg(): void {
	spare?.terminate();
	spare = null;
}

/** Outlines of every text in the tree (cached), for evaluate() here or in a tool's own worker. */
export async function glyphsFor(root: Node, signal: AbortSignal): Promise<Glyphs> {
	const requests = collectTexts(root);
	const missing = requests.filter((r) => !glyphCache.has(r.key));
	if (missing.length) {
		let rings: Awaited<ReturnType<typeof buildOutline>>;
		let fonts: Record<string, Uint8Array> = {};
		try {
			for (const family of new Set(missing.map((r) => r.font).filter((f): f is string => !!f)))
				fonts = { ...fonts, ...(await fontFiles(family)) };
		} catch {
			throw new ToolError(tc.tc_font_not_loaded());
		}
		try {
			rings = await buildOutline(glyphScad(missing), signal, undefined, fonts);
		} catch (e) {
			if (signal.aborted) throw e;
			throw new ToolError(tc.tc_text_failed());
		}
		const found = glyphsFromRings(rings, missing);
		for (const [key, glyph] of Object.entries(found)) glyphCache.set(key, glyph);
		// Recent texts are enough to go back and forth.
		while (glyphCache.size > 64) glyphCache.delete(glyphCache.keys().next().value as string);
	}
	const glyphs: Glyphs = {};
	for (const r of requests) glyphs[r.key] = glyphCache.get(r.key) ?? [];
	return glyphs;
}

/**
 * Where texts will land, mm — for a layout that depends on them (stakes under
 * a word, a tray round a name) — measured before the model is built. The
 * glyphs stay cached for the build that follows.
 */
export async function measureTexts(
	nodes: readonly Node[],
	signal: AbortSignal
): Promise<(TextBox | null)[]> {
	const glyphs = await glyphsFor(union(...nodes), signal);
	return nodes.map((n) => (n.k === 'text' ? (textFrame(n, glyphs)?.box ?? null) : null));
}

/** A colour part of a model: its name in the slicer and its tree. */
export interface ColourNode {
	name: string;
	node: Node;
}

/**
 * The model as one 3MF, a part per colour (for printers with several
 * filaments: AMS, MMU, tool changers). Built in a worker of its own.
 */
export async function buildCsg3mf(
	parts: readonly ColourNode[],
	title: string
): Promise<Uint8Array> {
	const signal = new AbortController().signal;
	const glyphs = await glyphsFor(union(...parts.map((p) => p.node)), signal);
	const worker = spawn();
	return new Promise<Uint8Array>((resolve, reject) => {
		worker.onmessage = (e: MessageEvent<{ file?: ArrayBuffer; error?: string }>) => {
			worker.terminate();
			if (e.data.file) resolve(new Uint8Array(e.data.file));
			else reject(new ToolError(tc.tc_3mf_failed()));
		};
		worker.onerror = () => {
			worker.terminate();
			reject(new ToolError(tc.tc_3mf_failed_reload()));
		};
		worker.postMessage({
			parts: parts.map((p) => ({ name: p.name, root: p.node })),
			title,
			glyphs
		});
	});
}

export async function buildCsg(root: Node, signal: AbortSignal): Promise<Uint8Array> {
	const glyphs = await glyphsFor(root, signal);
	if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
	const worker = spare ?? spawn();
	spare = spawn();
	return new Promise<Uint8Array>((resolve, reject) => {
		const done = () => {
			worker.terminate();
			signal.removeEventListener('abort', onAbort);
		};
		const onAbort = () => {
			done();
			reject(new DOMException('cancelled', 'AbortError'));
		};
		signal.addEventListener('abort', onAbort);
		worker.onmessage = (e: MessageEvent<{ stl?: ArrayBuffer; error?: string }>) => {
			done();
			if (e.data.stl) resolve(new Uint8Array(e.data.stl));
			else reject(new ToolError(tc.tc_build_failed_change()));
		};
		worker.onerror = () => {
			done();
			reject(new ToolError(tc.tc_build_failed_reload()));
		};
		worker.postMessage({ root, glyphs });
	});
}
