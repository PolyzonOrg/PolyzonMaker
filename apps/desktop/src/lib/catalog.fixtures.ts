// Models and computers for tests: the reference PC's numbers unless a test says otherwise.
import type { Bench, Hardware, Model, Target } from './catalog';

export const target = (t: Partial<Target>): Target => ({
	os: 'windows',
	device: 'cpu',
	status: 'tested',
	ref_seconds: 30,
	min_vram_mb: 0,
	min_ram_mb: 8000,
	disk_gb: 5,
	...t
});

export const model = (id: string, quality: number, targets: Target[], more: Partial<Model> = {}): Model => ({
	id,
	name: id,
	runtime: { type: 'native' },
	kind: '3d',
	quality,
	summary: { en: '', ru: '' },
	publisher: '',
	license: 'MIT',
	license_url: '',
	source_url: '',
	regions_excluded: [],
	presets: [],
	targets,
	...more
});

export const pc = (more: Partial<Hardware> = {}): Hardware => ({
	os: 'windows',
	os_version: '',
	arch: 'x86_64',
	cpu: '',
	cores: 6,
	threads: 12,
	avx2: true,
	ram_mb: 24000,
	ram_free_mb: 16000,
	disk_free_gb: 100,
	gpus: [],
	webview: '',
	...more
});

export const nvidia = (vram_mb: number) => ({ vendor: 'nvidia', name: 'RTX', vram_mb, driver: '', cuda: 13 });
export const bench: Bench = { cpu_single: 1, cpu_multi: 63000, memory_mbs: 1, disk_write_mbs: 1, disk_read_mbs: 1, gpu_score: 2600, gpu_renderer: '' };
