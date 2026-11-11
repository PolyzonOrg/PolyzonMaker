import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Dev only: Vite marks a dynamic import and then refuses it for public/, where OpenSCAD's loader lives
const publicImports: Plugin = {
	name: 'public-imports',
	configureServer(server) {
		server.middlewares.use((request, _, next) => {
			request.url = request.url?.replace(/^(\/openscad\/[^?]+)\?import$/, '$1');
			next();
		});
	}
};

// three's OrbitControls asks the canvas for its document when it lets go. Svelte takes a page out of the
// document first, so the canvas answers with itself, and the listener on the real document stays for good,
// holding the whole page. Every 3D view has one of these.
const orbitLetsGo: Plugin = {
	name: 'orbit-lets-go',
	transform(code, id) {
		if (!id.includes('controls/OrbitControls.js')) return;
		if (!code.includes('this.domElement.getRootNode()')) this.error('three changed: check whether orbit-lets-go is still needed');
		return { code: code.replaceAll('this.domElement.getRootNode()', 'this.domElement.ownerDocument'), map: null };
	}
};

// three shares a few textures of its own between all renderers, the empty stand-ins and a lighting table,
// and each renderer listens for their disposal, which never comes. So three keeps every renderer it ever had, about half a megabyte each.
const threeForgets: Plugin = {
	name: 'three-forgets',
	transform(code, id) {
		if (!id.includes('three/build/three.module')) return;
		const empty = /const (empty\w*Texture) = \/\*@__PURE__\*\/ new \w+\([^;]*\);/g;
		if (!empty.test(code)) this.error('three changed: check whether three-forgets is still needed');
		const quiet = code.replace(empty, (line, name) => `${line} ${name}.addEventListener = () => {};`);
		if (!quiet.includes(`lut.name = 'DFG_LUT';`)) this.error('three changed: check whether three-forgets is still needed');
		return { code: quiet.replace(`lut.name = 'DFG_LUT';`, `lut.name = 'DFG_LUT'; lut.addEventListener = () => {};`), map: null };
	}
};

// `tauri build` serves dist/. `npm run dev` also opens in a plain browser, on the stand-in core (src/lib/mock.ts).
export default defineConfig({
	plugins: [svelte(), publicImports, orbitLetsGo, threeForgets],
	// the tools from Polyzon Studio keep their own import paths: src/studio/README.md
	resolve: { alias: { $lib: here('src/studio'), $msg: here('src/studio/gen'), $app: here('src/studio/app') } },
	worker: { format: 'es' },
	build: { target: 'es2022', cssTarget: ['chrome105', 'safari15'], chunkSizeWarningLimit: 2000 },
	server: { port: 5199, strictPort: true },
	clearScreen: false,
	test: { include: ['src/**/*.test.ts'] }
});
