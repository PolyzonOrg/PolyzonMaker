// T-06: does the WebView draw and turn a generated-size mesh, and does mesh-kit work in a worker
// without stalling the view? Each step is measured; the report goes to Rust, which writes report.json.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { call } from './geometry';
import { Viewer } from './viewer';
import type { Prepared, Read } from './worker';

export const PROBE = '2026-11-04';

export type Status = 'run' | 'ok' | 'fail' | 'skip';
export interface Step {
	id: string;
	label: string;
	status: Status;
	ms?: number;
	data?: Record<string, unknown>;
	error?: string;
}

class Skip extends Error {}

const errors: string[] = [];
addEventListener('error', (e) => errors.push(`${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => errors.push(`unhandled: ${e.reason?.message ?? e.reason}`));
addEventListener('securitypolicyviolation', (e) => errors.push(`CSP ${e.violatedDirective}: ${e.blockedURI}`));

export async function runProbe(canvas: HTMLCanvasElement, onStep: (steps: Step[]) => void) {
	const started = new Date().toISOString();
	const steps: Step[] = [];
	const step = async (id: string, label: string, fn: () => Promise<Record<string, unknown> | void>) => {
		const s: Step = { id, label, status: 'run' };
		steps.push(s);
		onStep(steps);
		const t = performance.now();
		try {
			s.data = (await fn()) ?? undefined;
			s.status = 'ok';
		} catch (e) {
			s.status = e instanceof Skip ? 'skip' : 'fail';
			s.error = e instanceof Error ? e.message : String(e);
		}
		s.ms = Math.round(performance.now() - t);
		onStep(steps);
		return s.status === 'ok';
	};

	let app: unknown = null;
	await step('app', 'Связь с Rust', async () => {
		if (!isTauri()) throw new Skip('открыто в обычном браузере, без Tauri');
		app = await invoke('info');
		return app as Record<string, unknown>;
	});

	let viewer: Viewer | null = null;
	await step('webgl', 'WebGL 2', async () => {
		viewer = new Viewer(canvas);
		return viewer.info();
	});
	const v = viewer as Viewer | null;
	if (v) {
		await step('idle', 'Частота кадров без нагрузки', async () => stats(await frames(() => {}, { count: 90 })));
		for (const triangles of [1_000_000, 250_000]) {
			const k = `${triangles / 1000}k`;
			await step(`load-${k}`, `Загрузка модели ${k} треугольников`, () => load(v, triangles));
			await step(`turn-${k}`, `Вращение ${k}`, async () => stats(await frames((i) => v.orbit(i), { count: 240 })));
		}
		let stl: Uint8Array | null = null;
		await step('worker', 'Подготовка к печати в потоке (250k), вращение не должно тормозить', async () => {
			let done = false;
			const work = call<Prepared>({ op: 'prepare', height: 80 }).finally(() => (done = true));
			work.catch(() => {}); // it is awaited below, after the frames
			const during = await frames((i) => v.orbit(i), { until: () => done, maxMs: 300_000 });
			const { stl: bytes, ...result } = await work;
			if (!result.closed) throw new Error(`после починки сетка не замкнута: ${JSON.stringify(result)}`);
			stl = bytes;
			return { ...result, stlBytes: bytes.length, framesDuring: stats(during) };
		});
		await step('save', 'Запись STL на диск через Rust (путь с пробелами и кириллицей)', async () => {
			if (!isTauri()) throw new Skip('нет Tauri');
			const bytes = stl as Uint8Array | null;
			if (!bytes) throw new Skip('нет STL из предыдущего шага');
			const t = performance.now();
			const r = await invoke<{ path: string; bytes: number }>('save', bytes);
			const ms = performance.now() - t;
			if (r.bytes !== bytes.length) throw new Error(`записано ${r.bytes} байт из ${bytes.length}`);
			return { ...r, mbPerS: +(bytes.length / 2 ** 20 / (ms / 1000)).toFixed(1) };
		});
		await step('context', 'Потеря и возврат контекста WebGL', async () => {
			const r = await v.loseAndRestore();
			if (!r) throw new Skip('нет WEBGL_lose_context');
			if (!r.drawn) throw new Error('после возврата модель не рисуется');
			return r;
		});
	}

	// the view again at the end: at the start the window may not have its final size yet
	const report = { probe: PROBE, started, app, page: page(), view: v?.info() ?? null, steps, errors };
	(globalThis as { __probe?: unknown }).__probe = report;
	const saved = isTauri() ? await invoke<string>('finish', { report: JSON.stringify(report, null, 2) }) : null;
	return { viewer: v, saved, failed: steps.filter((s) => s.status === 'fail').length };
}

/** The real path of a model file: bytes → worker (mesh-kit reader) → a copy to draw. */
async function load(v: Viewer, triangles: number) {
	const t = performance.now();
	const glb = await call<Uint8Array>({ op: 'sample', triangles });
	const glbMB = +(glb.byteLength / 2 ** 20).toFixed(1); // before the bytes move to the worker
	const t1 = performance.now();
	const r = await call<Read>({ op: 'read', name: 'sample.glb', bytes: glb }, [glb.buffer]);
	const t2 = performance.now();
	v.show(r.tris);
	const drawn = v.drawn();
	const t3 = performance.now();
	if (!drawn) throw new Error('модель не появилась на экране');
	return {
		triangles: r.tris.length / 9,
		glbMB,
		sampleMs: Math.round(t1 - t),
		readMs: r.ms,
		readRoundTripMs: Math.round(t2 - t1),
		showMs: Math.round(t3 - t2)
	};
}

/** A file the person picked or dropped: drawn, then prepared like the sample. */
export async function openModel(v: Viewer, file: File) {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const r = await call<Read>({ op: 'read', name: file.name, bytes }, [bytes.buffer]);
	v.show(r.tris);
	const { stl: _, ...result } = await call<Prepared>({ op: 'prepare', height: 80 });
	return { name: file.name, readMs: r.ms, ...result };
}

const nextFrame = () =>
	// a hidden window gets no frames at all: one second then counts as one (slow) frame
	new Promise<number>((resolve) => {
		const timer = setTimeout(() => resolve(performance.now()), 1000);
		requestAnimationFrame((t) => (clearTimeout(timer), resolve(t)));
	});

/** Intervals between frames, each frame drawn by `each`. */
async function frames(each: (i: number) => void, o: { count?: number; until?: () => boolean; maxMs?: number }) {
	const out: number[] = [];
	const start = await nextFrame();
	let last = start;
	for (let i = 0; !(o.until?.() || i >= (o.count ?? Infinity) || last - start > (o.maxMs ?? 20_000)); i++) {
		each(i);
		const now = await nextFrame();
		out.push(now - last);
		last = now;
	}
	return out;
}

function stats(ms: number[]) {
	const s = [...ms].sort((a, b) => a - b);
	const at = (p: number) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(1);
	const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
	return { frames: s.length, fps: +(1000 / mean).toFixed(1), p50: at(0.5), p95: at(0.95), max: at(1) };
}

function page() {
	return {
		userAgent: navigator.userAgent,
		cores: navigator.hardwareConcurrency,
		devicePixelRatio,
		screen: [screen.width, screen.height],
		window: [innerWidth, innerHeight],
		visible: document.visibilityState
	};
}
