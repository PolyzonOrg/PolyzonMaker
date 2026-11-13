// loaded with the file, as drop.test.ts does: imported inside a test, the cold load of mesh-kit counted against
// its 5 s and timed out on a busy computer
import { analyze, readModel } from '@polyzon/mesh-kit';
import { describe, expect, it, vi } from 'vitest';
import type { Contributes, Plugin } from './core';
import { answer, contributed, fetches, modelFile, pluginTheme, themeKey, type Doors } from './plugins';

const job = { id: 'a', title: 'Кот', kind: 'model', state: 'succeeded', created: 5, output: 'model.glb', prompt: 'тайное', input: 'C:/Users/me/photo.png', error: '', detail: 'лог' };

function doors(): Doors {
	return {
		info: () => ({ version: '0.1.0', language: 'ru', theme: 'dark' }),
		jobs: () => [job] as never,
		read: vi.fn(async () => new ArrayBuffer(4)),
		pictures: vi.fn(async () => ({ id: 'p' }) as never),
		model: vi.fn(async () => ({ id: 'm' }) as never),
		add: vi.fn(async () => ({ id: 'n' }) as never),
		open: vi.fn(),
		context: () => ({ page: 'result', job: 'a' }),
		listen: vi.fn(() => [{ command: 'go' }])
	};
}

const plugin = (id: string, contributes: Partial<Contributes>): Plugin => ({
	id,
	name: id,
	version: '1',
	author: '',
	description: '',
	permissions: [],
	page: true,
	contributes: { panels: [], commands: [], themes: [], models: [], ...contributes }
});
const sand = { id: 'sand', title: 'Sand', base: 'light' as const, colors: { '--bg': '#f4efe6', '--ink': 'red', '--line': '#0000001a' } };

describe('what plugins bring', () => {
	it('comes only from plugins that are on, each beside its plugin', () => {
		const plugins = [plugin('a', { themes: [sand] }), plugin('b', { themes: [{ ...sand, id: 'dusk' }] }), plugin('c', { themes: [{ ...sand, id: 'gone' }] })];
		const grants = { a: { permissions: [], off: false, network: false }, b: { permissions: [], off: true, network: false } };
		expect(contributed(plugins, grants, 'themes').map(({ plugin, item }) => `${plugin.id}/${item.id}`)).toEqual(['a/sand']);
	});

	it('gives a theme only plain colours, and none once its plugin is off', () => {
		const plugins = [plugin('a', { themes: [sand] })];
		const theme = pluginTheme(themeKey('a', 'sand'), plugins, { a: { permissions: [], off: false, network: false } });
		expect(theme).toEqual({ base: 'light', colors: [['--bg', '#f4efe6'], ['--line', '#0000001a']] });
		expect(pluginTheme(themeKey('a', 'sand'), plugins, { a: { permissions: [], off: true, network: false } })).toBeNull();
		expect(pluginTheme('dark', plugins, {})).toBeNull();
	});

	it('says what its models download, from where and how much', () => {
		const weights = [{ url: 'https://huggingface.co/a/b/resolve/1/x.safetensors', size: 2 ** 30 }, { url: 'https://huggingface.co/a/b/resolve/1/y.json', size: 2 ** 29 }];
		const models = [
			{ id: 'm', name: 'M', runtime: { torch: '2.7.1', packages: ['numpy==2.2.6', 'pillow==12.3.0'], code: { url: 'https://codeload.github.com/a/b/zip/1', size: 1 }, weights } },
			{ id: 'n', name: 'N', runtime: { packages: ['numpy==2.2.6'] } }
		];
		expect(fetches(plugin('p', { models }))).toEqual({ code: ['codeload.github.com'], weights: { count: 2, bytes: 1.5 * 2 ** 30, hosts: ['huggingface.co'] }, packages: 2, torch: ['2.7.1'] });
	});
});

describe('a model a plugin hands over', () => {
	it('keeps the size it was made', async () => {
		const stl = new DataView(new ArrayBuffer(134));
		stl.setUint32(80, 1, true);
		[0, 0, 0, 90, 0, 0, 0, 90, 4].forEach((v, i) => stl.setFloat32(96 + i * 4, v, true));
		// read the way the result page reads every model
		const { size } = analyze(await readModel('model.glb', await modelFile(new Uint8Array(stl.buffer)), { glbUnit: 'm' }));
		[90, 90, 4].forEach((mm, axis) => expect(size[axis]).toBeCloseTo(mm, 3));
	});
});

describe('a model a plugin hands over as GLB', () => {
	it('is kept byte for byte', async () => {
		const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);
		expect(await modelFile(glb)).toBe(glb);
	});
});

describe('what a plugin can ask for', () => {
	it('gets nothing it was not granted', async () => {
		const d = doors();
		await expect(answer('jobs.list', {}, [], d)).rejects.toThrow('NOT_ALLOWED');
		await expect(answer('jobs.file', { id: 'a', name: 'model.glb' }, ['jobs.create'], d)).rejects.toThrow('NOT_ALLOWED');
		await expect(answer('jobs.picture', { prompt: 'кот' }, ['jobs.read'], d)).rejects.toThrow('NOT_ALLOWED');
		await expect(answer('library.add', { title: 'x', file: new Uint8Array(1) }, ['jobs.read'], d)).rejects.toThrow('NOT_ALLOWED');
		expect(d.pictures).not.toHaveBeenCalled();
		expect(d.add).not.toHaveBeenCalled();
	});

	it('cannot call what does not exist', async () => {
		await expect(answer('settings.read', {}, ['jobs.read'], doors())).rejects.toThrow('NO_SUCH_METHOD');
		await expect(answer('__proto__', {}, ['jobs.read'], doors())).rejects.toThrow('NO_SUCH_METHOD');
		await expect(answer('constructor', {}, ['jobs.read'], doors())).rejects.toThrow('NO_SUCH_METHOD');
	});

	it('sees a job without its prompt, its input or its logs', async () => {
		const list = (await answer('jobs.list', undefined, ['jobs.read'], doors())) as object[];
		expect(list).toEqual([{ id: 'a', title: 'Кот', kind: 'model', state: 'succeeded', created: 5 }]);
	});

	it('reads only the finished files of a job that exists', async () => {
		const d = doors();
		expect(await answer('jobs.file', { id: 'a', name: 'model.glb' }, ['jobs.read'], d)).toBeInstanceOf(ArrayBuffer);
		await expect(answer('jobs.file', { id: 'a', name: 'job.json' }, ['jobs.read'], d)).rejects.toThrow('NO_SUCH_FILE');
		await expect(answer('jobs.file', { id: 'a', name: '../../settings.json' }, ['jobs.read'], d)).rejects.toThrow('NO_SUCH_FILE');
		await expect(answer('jobs.file', { id: '../other', name: 'model.glb' }, ['jobs.read'], d)).rejects.toThrow('NO_SUCH_FILE');
		expect(d.read).toHaveBeenCalledTimes(1);
	});

	it('starts work with sane input only', async () => {
		const d = doors();
		await answer('jobs.picture', { prompt: 'кот', variants: 2 }, ['jobs.create'], d);
		expect(d.pictures).toHaveBeenCalledWith('кот', 2);
		await expect(answer('jobs.picture', { prompt: '' }, ['jobs.create'], d)).rejects.toThrow('BAD_INPUT');
		await expect(answer('jobs.picture', { prompt: 'кот', variants: 99 }, ['jobs.create'], d)).rejects.toThrow('BAD_INPUT');
		for (const fine of [1, 4]) await answer('jobs.picture', { prompt: 'кот', variants: fine }, ['jobs.create'], d);
		for (const wrong of [0, 5, 1.5]) await expect(answer('jobs.picture', { prompt: 'кот', variants: wrong }, ['jobs.create'], d)).rejects.toThrow('BAD_INPUT');
		await answer('jobs.picture', { prompt: 'кот' }, ['jobs.create'], d);
		expect(d.pictures).toHaveBeenLastCalledWith('кот', 1);
		await expect(answer('jobs.model', { image: 'not bytes' }, ['jobs.create'], d)).rejects.toThrow('BAD_INPUT');
		await answer('jobs.model', { image: new Uint8Array(64 << 20) }, ['jobs.create'], d);
		await expect(answer('jobs.model', { image: new Uint8Array((64 << 20) + 1) }, ['jobs.create'], d)).rejects.toThrow('BAD_INPUT');
	});

	it('adds a model file with a title', async () => {
		const d = doors();
		const file = new Uint8Array(84);
		expect(await answer('library.add', { title: ' Подставка ', file }, ['library.add'], d)).toEqual({ id: 'n' });
		expect(d.add).toHaveBeenCalledWith('Подставка', file);
		await expect(answer('library.add', { title: '', file }, ['library.add'], d)).rejects.toThrow('BAD_INPUT');
		await expect(answer('library.add', { title: 'x', file: 'text' }, ['library.add'], d)).rejects.toThrow('BAD_INPUT');
		await expect(answer('library.add', { title: 'x'.repeat(201), file }, ['library.add'], d)).rejects.toThrow('BAD_INPUT');
		expect(await answer('library.add', { title: 'x'.repeat(200), file }, ['library.add'], d)).toEqual({ id: 'n' });
		await expect(answer('library.add', { title: 'x', file: new Uint8Array(0) }, ['library.add'], d)).rejects.toThrow('BAD_INPUT');
	});

	it('knows where it is and what came before it listened, without any permission', async () => {
		const d = doors();
		expect(await answer('context', {}, [], d)).toEqual({ page: 'result', job: 'a' });
		expect(await answer('listen', { name: 'command' }, [], d)).toEqual([{ command: 'go' }]);
		expect(d.listen).toHaveBeenCalledWith('command');
		await expect(answer('listen', { name: '' }, [], d)).rejects.toThrow('BAD_INPUT');
	});

	it('opens only a job that exists', async () => {
		const d = doors();
		await answer('open', { id: 'a' }, [], d);
		expect(d.open).toHaveBeenCalledWith('a');
		await expect(answer('open', { id: 'gone' }, [], d)).rejects.toThrow('NO_SUCH_JOB');
	});
});
