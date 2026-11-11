import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// `tauri build` serves dist/; `npm run dev` is for a plain browser, where the Tauri steps are skipped.
export default defineConfig({
	plugins: [svelte()],
	worker: { format: 'es' },
	build: { target: 'es2022' },
	clearScreen: false
});
