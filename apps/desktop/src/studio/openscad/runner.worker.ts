// OpenSCAD WASM compile worker.
// Runs on a separate thread so the heavy CGAL boolean operations don't
// freeze the main UI thread (which would trigger "Page not responding"
// dialogs on Windows). Main thread → postMessage({kind:'compile', source}),
// worker → postMessage({kind:'success', stl}) | {kind:'error', message}.

import { needsFont } from './font-gate';

// Catch bootstrap errors (network 404, parse errors, OOM during init) and
// forward them as a clear message instead of silently dying. Without this,
// the main thread's "ready handshake" watchdog would just time out at 10s
// without explaining why.
self.onerror = (e) => {
	try {
		(self as unknown as Worker).postMessage({
			kind: 'error',
			message: typeof e === 'string' ? e : ((e as ErrorEvent).message ?? 'worker bootstrap error')
		});
	} catch {
		/* main thread may already be gone */
	}
	return true; // prevent default
};
self.addEventListener?.('unhandledrejection', (e: PromiseRejectionEvent) => {
	try {
		(self as unknown as Worker).postMessage({
			kind: 'error',
			message: `unhandled rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`
		});
	} catch {
		/* noop */
	}
});

interface FS {
	mkdir(path: string): void;
	stat(path: string): unknown;
	readFile(path: string, opts?: { encoding?: 'utf8' | 'binary' }): Uint8Array | string;
	writeFile(path: string, data: string | ArrayBufferView): void;
	unlink(path: string): void;
}

interface OpenSCAD {
	FS: FS;
	callMain(args: string[]): number;
	locateFile?: (path: string, prefix: string) => string;
	printErr?: (m: string) => void;
	print?: (m: string) => void;
}

type FactoryOpts = {
	noInitialRun?: boolean;
	print?: (m: string) => void;
	printErr?: (m: string) => void;
};
type Factory = (opts?: FactoryOpts) => Promise<OpenSCAD>;
type FontsModule = { addFonts: (oscad: OpenSCAD) => void };

async function loadAll(withFont: boolean) {
	const base = '/openscad/';
	// No cache-busting: each worker is a fresh JS context, so Emscripten state
	// doesn't carry over between compiles (the original reason for `?t=...`).
	// Cache-busting in dev mode causes Vite to re-transform the module on every
	// request, which intermittently hangs under refresh-storms.
	const [coreMod, fontsMod, notoBytes] = await Promise.all([
		import(/* @vite-ignore */ base + 'openscad.js') as Promise<{ default?: Factory } & Factory>,
		import(/* @vite-ignore */ base + 'openscad.fonts-lite.js') as Promise<FontsModule>,
		withFont
			? fetch(base + 'NotoSans-Regular.ttf').then(async (r) => {
					if (!r.ok) throw new Error(`NotoSans fetch ${r.status}`);
					return new Uint8Array(await r.arrayBuffer());
				})
			: Promise.resolve(null)
	]);
	return {
		factory: coreMod.default ?? coreMod,
		fonts: fontsMod,
		notoBytes
	};
}

/** One OpenSCAD instance with fonts, ready for a single callMain. */
async function prepare(withFont: boolean) {
	const { factory, fonts, notoBytes } = await loadAll(withFont);
	// The Emscripten glue reads Module.printErr once, while it loads
	// (`var err = Module["printErr"] || console.warn`), so stderr can only be
	// captured through the factory options — assigning it afterwards leaves the
	// compiler log in the console and the page with a bare «exit 1».
	const errors: string[] = [];
	const oscad = await factory({
		noInitialRun: true,
		printErr: (m: string) => errors.push(m),
		// echo() and warnings go to stderr; stdout carries nothing worth keeping.
		print: () => {}
	});

	fonts.addFonts(oscad);
	try {
		oscad.FS.stat('/fonts');
	} catch {
		oscad.FS.mkdir('/fonts');
	}
	if (notoBytes) oscad.FS.writeFile('/fonts/NotoSans-Regular.ttf', notoBytes);
	return { oscad, errors };
}

/** Prepared ahead by a `warm` message (a spare worker), with the font. */
let warmed: ReturnType<typeof prepare> | null = null;

async function compile(
	source: string,
	files: Record<string, Uint8Array | string> = {},
	format: 'stl' | 'svg' = 'stl',
	fonts: Record<string, Uint8Array> = {}
): Promise<{ out: Uint8Array; log: string }> {
	const ahead = warmed;
	warmed = null;
	// A failed warm-up is retried here, the way a cold worker would load.
	const ready = ahead && (await ahead.catch(() => null));
	const { oscad, errors } = ready || (await prepare(needsFont(source)));

	const SRC = '/in.scad';
	const OUT = `/out.${format}`;
	// Inputs for import()/surface(), next to the source: only plain names.
	for (const [name, data] of Object.entries(files)) {
		if (!/^[\w.-]+$/.test(name) || name === 'in.scad' || name === OUT.slice(1)) continue;
		oscad.FS.writeFile('/' + name, data);
	}
	// The user's fonts beside Noto Sans: fontconfig scans /fonts when text() first runs.
	for (const [name, data] of Object.entries(fonts)) {
		if (/^[\w.-]+\.(?:ttf|otf)$/i.test(name)) oscad.FS.writeFile('/fonts/' + name, data);
	}
	oscad.FS.writeFile(SRC, source);

	let rc: number;
	try {
		// No experimental flags — they caused intermittent freezes in 2022.03.13 WASM.
		// `--enable=fast-csg` doesn't exist as a standalone option here (verified by
		// inspecting the binary), and even valid sub-features (`lazy-union`, etc.)
		// add behavioral variability. Stick to the stock CGAL backend for stability.
		rc = oscad.callMain(['-o', OUT, SRC]);
	} catch (e) {
		const msg =
			errors.filter((l) => /error|warning/i.test(l)).join('\n') ||
			(e instanceof Error ? e.message : String(e));
		throw new Error(msg.slice(0, 600));
	}
	if (rc !== 0) {
		const msg =
			errors.filter((l) => /error/i.test(l)).join('\n') || errors.join('\n') || `exit ${rc}`;
		throw new Error(msg.slice(0, 600));
	}
	return {
		out: oscad.FS.readFile(OUT, { encoding: 'binary' }) as Uint8Array,
		// What a successful build still has to say: echo() output and warnings.
		log: errors
			.filter((l) => /^(ECHO|WARNING|DEPRECATED|TRACE):/.test(l))
			.join('\n')
			.slice(0, 4000)
	};
}

type InMsg =
	| {
			kind: 'compile';
			source: string;
			files?: Record<string, Uint8Array | string>;
			format?: 'stl' | 'svg';
			fonts?: Record<string, Uint8Array>;
	  }
	| { kind: 'ping' }
	| { kind: 'warm' };
type OutMsg =
	| { kind: 'success'; stl: ArrayBuffer; log: string }
	| { kind: 'error'; message: string }
	| { kind: 'ready' };

self.onmessage = async (e: MessageEvent<InMsg>) => {
	const msg = e.data;
	if (msg?.kind === 'warm') {
		warmed = prepare(true);
		// Not an unhandled rejection: the compile that takes it retries.
		warmed.catch(() => {});
		return;
	}
	if (msg?.kind === 'ping') {
		(self as unknown as Worker).postMessage({ kind: 'ready' } satisfies OutMsg);
		return;
	}
	if (msg?.kind !== 'compile') return;
	try {
		// Acknowledge that compile is starting — main thread can then update the
		// UI label from "Запуск воркера…" to "Компиляция…".
		const { out: stl, log } = await compile(msg.source, msg.files, msg.format, msg.fonts);
		// Transfer the buffer to avoid copying tens of megabytes. Slice always
		// produces a plain ArrayBuffer (the Uint8Array's underlying buffer may
		// be ArrayBufferLike, but .slice always returns ArrayBuffer here).
		const buf = stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength) as ArrayBuffer;
		const reply: OutMsg = { kind: 'success', stl: buf, log };
		(self as unknown as Worker).postMessage(reply, [buf]);
	} catch (err) {
		const reply: OutMsg = {
			kind: 'error',
			message: err instanceof Error ? err.message : String(err)
		};
		(self as unknown as Worker).postMessage(reply);
	}
};

// No auto-emit of `ready` at module bottom — that was racy: if the worker
// finished loading before the main thread attached its onmessage handler,
// the ready message would be lost. Instead, main thread sends `ping` after
// attaching its handler, and we reply with `ready` (see onmessage above).
