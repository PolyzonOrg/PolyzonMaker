import { describe, expect, it } from 'vitest';
import catalog from '../../src-tauri/catalog.json';
import { EXAMPLES, examplesOf } from './examples';

const ids = new Set(catalog.models.map((m) => m.id));
const carried = new Set(Object.keys(import.meta.glob('../../public/examples/*.webp')).map((path) => path.split('/').pop()));

describe('examples of work', () => {
	it('come from models of the catalog, each with a picture the app carries', () => {
		for (const e of EXAMPLES) {
			expect(ids.has(e.model), e.file).toBe(true);
			if (e.from) expect(ids.has(e.from), e.file).toBe(true);
			expect(carried.has(e.file), e.file).toBe(true);
			expect(e.seconds).toBeGreaterThan(0);
			expect(e.alt.ru && e.alt.en, e.file).toBeTruthy();
		}
	});

	it('show a 3D model among the works of the model that made it, and of the one that drew its picture', () => {
		expect(examplesOf('trellis2').map((e) => e.file)).toContain('dragon-klein.webp');
		expect(examplesOf('klein').map((e) => e.file)).toEqual(['dragon-klein.webp']);
		expect(examplesOf('zimage').map((e) => e.file)).toEqual(['dragon-zimage.webp']);
	});

	it('are none for a model that has made nothing for us yet', () => {
		expect(examplesOf('pixal3d')).toEqual([]);
		expect(examplesOf('gemma-4-e4b')).toEqual([]);
	});
});
