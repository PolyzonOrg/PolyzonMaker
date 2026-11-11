import { expect, test } from 'vitest';
import { fitted } from './picture';
import { errorCode } from './report';
import { failCall } from './core';

const thrown = (name: string, stack: string) => Object.assign(new Error('C:\\Users\\Иван\\кот.png not found'), { name, stack });

test('an error is told by its kind and place, and its message stays home', () => {
	const chromium = thrown('TypeError', 'TypeError: x\n    at open (http://tauri.localhost/assets/Result-Dk8sA.js:12:3456)');
	expect(errorCode(chromium)).toBe('TypeError_Result_12_3456');
	const webkit = thrown('RangeError', 'open@tauri://localhost/assets/Cad-x1.js:3:9\nasync*go@tauri://localhost/assets/index-z.js:1:1');
	expect(errorCode(webkit)).toBe('RangeError_Cad_3_9');
	expect(errorCode(thrown('Error', 'no place at all'))).toBe('Error');
	expect(errorCode(chromium)).not.toContain('Иван');
});

test('a failed call nobody caught is told by its command, never by what the computer answered', () => {
	const answer = 'C:\\Users\\Иван\\Models is not writable';
	failCall('job_retry', answer);
	expect(errorCode(answer)).toBe('call_job_retry');
	expect(errorCode('some text')).toBe('thrown_string');
	expect(errorCode(undefined)).toBe('thrown_undefined');
	expect(errorCode({ code: 1 })).toBe('thrown_object');
});

test('an error the window raised without an error object is told by its place, and a harmless one is not told', () => {
	const event = (message: string, filename: string) => Object.assign(new Event('error'), { message, filename, lineno: 7, colno: 21, error: null });
	expect(errorCode(event('Script error.', 'http://tauri.localhost/assets/Cad-x1.js'))).toBe('script_Cad_7_21');
	expect(errorCode(event('ResizeObserver loop completed with undelivered notifications.', ''))).toBe('');
});

test('a huge picture shrinks to what engines use, and a small one is told apart', () => {
	expect(fitted(8000, 6000)).toEqual({ scale: 0.256, small: false });
	expect(fitted(1024, 1024)).toEqual({ scale: 1, small: false });
	expect(fitted(640, 200).small).toBe(true);
});

test('models of Hugging Face that have a pack here are shown as ready to install', async () => {
	const { classify, knownPack } = await import('./catalog');
	const catalog = (await import('../../src-tauri/catalog.json')).default;
	for (const repo of ['tencent/Hunyuan3D-2.1', 'yyfz233/Pi3', 'facebook/VGGT-1B', 'TencentARC/Pixal3D']) {
		expect(classify({ id: repo, downloads: 0, likes: 0, task: 'image-to-3d', tags: [], gated: false, files: [] })).toBe('known');
		expect(catalog.models.some((m) => m.id === knownPack(repo))).toBe(true);
	}
});
