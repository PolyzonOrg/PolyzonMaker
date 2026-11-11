import { defineConfig } from 'vitest/config';

// The WASM booleans and level sets take seconds on a busy machine.
export default defineConfig({ test: { testTimeout: 60_000 } });
