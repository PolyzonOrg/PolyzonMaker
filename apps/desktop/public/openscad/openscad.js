/// <reference types="./openscad.d.ts" />
//
// Patched loader for the OpenSCAD Emscripten bundle.
//
// Each call needs a fresh Emscripten bootstrap instance. A unique same-origin
// module URL keeps browser module-map isolation without using `data:`/`blob:`
// scripts that production CSP intentionally blocks.

async function OpenSCAD(options) {
    const module = {
        noInitialRun: true,
        locateFile: (path) => new URL(`./${path}`, import.meta.url).href,
        ...options,
    };
    // Wire up the ready promise BEFORE the dynamic import: with hot bytecode
    // caches the runtime may fire onRuntimeInitialized synchronously.
    let _ready;
    const ready = new Promise((resolve) => { _ready = resolve; });
    module.onRuntimeInitialized = () => _ready(null);

    globalThis.OpenSCAD = module;
    try {
        // The instance number is per JS context, not per wall-clock: every
        // fresh worker asks for `?instance=1`, so the 120 KB bootstrap comes
        // from the HTTP cache, while a second call inside the same context
        // still gets its own module-map entry.
        const instance = (globalThis.__openscadInstances = (globalThis.__openscadInstances ?? 0) + 1);
        const bootstrapUrl = new URL(`./openscad.wasm.js?instance=${instance}`, import.meta.url).href;
        await import(bootstrapUrl);
    } finally {
        delete globalThis.OpenSCAD;
    }
    await ready;
    return module;
}

export { OpenSCAD as default };
