import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The code editor comes from Studio and paints with Studio's tokens; studio.css maps them onto the app's.
// A token left out is invalid CSS, so the browser drops the rule: the selection was drawn clear
// («не могу ничего выделить», owner 2026-11-10) and the code was not in a monospace font.
// read from disk: vitest hands CSS imports over empty, ?raw too
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../studio/styles/studio.css');
const users = ['../studio/openscad/editor/theme.ts', '../studio/components/scad/ScadEditor.svelte'].map(read).join('\n');
const used = [...new Set([...users.matchAll(/var\((--pz-[a-z0-9-]+)\)/g)].map((m) => m[1]))];

describe('the Studio tokens the code editor uses', () => {
	it('are all given a value', () => {
		expect(used.filter((name) => !css.includes(`${name}:`))).toEqual([]);
	});

	it('hold colour channels as rgb(r g b / alpha) reads them: spaces, not commas', () => {
		const triplets = [...css.matchAll(/(--pz-rgb-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
		expect(triplets.length).toBeGreaterThan(0);
		expect(triplets.filter(([, value]) => !/^\d{1,3} \d{1,3} \d{1,3}$/.test(value))).toEqual([]);
	});
});
