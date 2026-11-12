import { describe, expect, it } from 'vitest';
import catalog from '../../src-tauri/catalog.json';
import { EXAMPLES, examplesOf, groupsOf } from './examples';

const kinds = new Map(catalog.models.map((m) => [m.id, m.kind]));
const carried = new Set(Object.keys(import.meta.glob('../../public/examples/*.webp')).map((path) => path.split('/').pop()));
const files = (id: string) => examplesOf(id).map((e) => e.file);

describe('examples of work', () => {
	it('come from models of the catalog, each with a picture the app carries', () => {
		for (const e of EXAMPLES) {
			expect(kinds.has(e.model), e.file).toBe(true);
			if (e.from) expect(kinds.get(e.from), e.file).toBe('picture');
			expect(carried.has(e.file), e.file).toBe(true);
			expect(e.seconds).toBeGreaterThan(0);
			expect(e.alt.ru && e.alt.en, e.file).toBeTruthy();
		}
		expect(new Set(EXAMPLES.map((e) => e.file)).size).toBe(EXAMPLES.length);
	});

	it('say a picture was drawn by a picture model, and a 3D model by a 3D one', () => {
		for (const e of EXAMPLES) expect(kinds.get(e.model), e.file).toBe(e.kind === 'picture' ? 'picture' : '3d');
	});

	it('name the picture a 3D model was made from only when it is there, drawn by the model it says', () => {
		for (const e of EXAMPLES.filter((e) => e.picture)) {
			const picture = EXAMPLES.find((p) => p.file === e.picture);
			expect(picture?.kind, e.file).toBe('picture');
			expect(picture?.model, e.file).toBe(e.from);
		}
	});

	it('show a 3D model among the works of the model that made it, and of the one that drew its picture', () => {
		expect(files('trellis2')).toContain('dragon-klein.webp');
		expect(files('trellis2')).toContain('lamp-trellis2.webp');
		expect(files('zimage')).toEqual(['dragon-zimage.webp']);
	});

	it('show a picture model source by source: each of its pictures with everything made from it', () => {
		const klein = groupsOf('klein');
		expect(klein.map((g) => g.picture?.file)).toEqual(['picture-kitten-klein.webp', 'picture-dragon-klein.webp', 'picture-lamp-klein.webp', 'picture-tank-klein.webp', undefined]);
		expect(klein[0].made.map((e) => e.file)).toEqual(['kitten-hunyuan2.webp', 'kitten-mini.webp', 'kitten-pixal3d.webp', 'kitten-triposr.webp']);
		expect(klein.at(-1)!.made.map((e) => e.file)).toEqual(['dragon-klein.webp']);
		expect(new Set(files('klein')).size).toBe(files('klein').length);
	});

	it('show a 3D model each of its results next to the picture it was made from, then those without one', () => {
		const groups = groupsOf('triposr');
		expect(groups.map((g) => [g.picture?.file, g.made.map((e) => e.file)])).toEqual([
			['picture-kitten-klein.webp', ['kitten-triposr.webp']],
			['picture-dragon-klein.webp', ['dragon-triposr.webp']],
			['picture-lamp-klein.webp', ['lamp-triposr.webp']],
			['picture-tank-klein.webp', ['tank-triposr.webp']]
		]);
		const trellis = groupsOf('trellis2');
		expect(trellis.slice(0, -1).every((g) => g.picture && g.made.every((e) => e.model === 'trellis2'))).toBe(true);
		expect(trellis.at(-1)).toEqual({ made: expect.arrayContaining([expect.objectContaining({ file: 'goblin.webp' }), expect.objectContaining({ file: 'dragon-klein.webp' })]) });
		expect(trellis.flatMap((g) => g.made).some((e) => e.file === 'kitten-trellis2.webp')).toBe(false);
	});

	it('mark a run on the processor, since the times are those of a graphics card', () => {
		expect(groupsOf('triposr').flatMap((g) => g.made).every((e) => e.device === 'cpu')).toBe(true);
		expect(groupsOf('hunyuan-2').flatMap((g) => g.made).some((e) => e.device)).toBe(false);
	});

	it('are none for a model that has made nothing for us yet', () => {
		expect(examplesOf('hunyuan-2-1')).toEqual([]);
		expect(examplesOf('gemma-4-e4b')).toEqual([]);
	});
});
