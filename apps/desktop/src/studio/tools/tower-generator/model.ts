/**
 * «Калибровка принтера»: our own G-code for the usual calibration prints,
 * generated from the form — no pre-sliced files. A test is a hollow square
 * tower (two perimeters, open bottom, skirt on the first layer) cut into
 * segments; each segment prints with its own value of the setting under
 * test. Temperature and retraction print two towers, so the travel between
 * them shows stringing. Pressure / Linear Advance is a pattern of lines, each
 * with its own K, slow–fast–slow.
 *
 * Extrusion: E = length × line width × layer height ÷ filament cross-section
 * (× flow), relative (M83) or absolute (M82, reset per layer).
 *
 * Safety: everything is clamped; values outside the material's range, a
 * test that does not fit the bed or the printer's height stop the
 * generation with a readable reason instead of producing a file.
 */

import { num } from '$lib/i18n/current';
import { unitLabel } from '$lib/components/tools/units';
import * as m from '$msg/tools/tower-generator';
import { clampTo as clamp } from '../shared/math';
import { ownKey } from '$lib/own';

export type Firmware = 'marlin' | 'klipper';
export type TowerTest =
	| 'temperature'
	| 'retraction'
	| 'flow'
	| 'speed'
	| 'acceleration'
	| 'corner'
	| 'shaper';
export type CalibrationKind = TowerTest | 'pa' | 'pid' | 'esteps';
export type MaterialId = 'pla' | 'petg' | 'abs' | 'asa' | 'tpu' | 'other';

export interface Material {
	label: string;
	nozzle: readonly [number, number];
	bed: readonly [number, number];
	temp: number;
	bedTemp: number;
	fan: number;
	/** g/cm³, for the weight of the test. */
	density: number;
}

export const MATERIALS: Record<MaterialId, Material> = {
	pla: {
		label: 'PLA',
		nozzle: [185, 235],
		bed: [0, 70],
		temp: 210,
		bedTemp: 55,
		fan: 100,
		density: 1.24
	},
	petg: {
		label: 'PETG',
		nozzle: [220, 260],
		bed: [50, 90],
		temp: 240,
		bedTemp: 75,
		fan: 40,
		density: 1.27
	},
	abs: {
		label: 'ABS',
		nozzle: [230, 270],
		bed: [80, 115],
		temp: 250,
		bedTemp: 100,
		fan: 0,
		density: 1.04
	},
	asa: {
		label: 'ASA',
		nozzle: [235, 275],
		bed: [80, 115],
		temp: 255,
		bedTemp: 100,
		fan: 20,
		density: 1.07
	},
	tpu: {
		label: 'TPU',
		nozzle: [200, 240],
		bed: [0, 70],
		temp: 225,
		bedTemp: 50,
		fan: 60,
		density: 1.21
	},
	other: {
		get label() {
			return m.t_tower_generator_material_other();
		},
		nozzle: [170, 300],
		bed: [0, 120],
		temp: 210,
		bedTemp: 60,
		fan: 100,
		density: 1.24
	}
};

export interface SegmentPlan {
	count: number;
	/** Height of one segment, mm. */
	height: number;
	start: number;
	step: number;
	/** Side of the tower, mm. */
	size: number;
}

export interface PrinterProfile {
	preset: string;
	bedX: number;
	bedY: number;
	maxZ: number;
	nozzle: number;
	filament: number;
	firmware: Firmware;
	relativeE: boolean;
	/** Our purge line along the front edge before the test. */
	primeLine: boolean;
	/** Bambu Lab: the part fan is P1. */
	bambuFan: boolean;
	startGcode: string;
	endGcode: string;
}

export interface TowerParams extends PrinterProfile {
	test: CalibrationKind;
	material: MaterialId;
	nozzleTemp: number;
	bedTemp: number;
	/** Part cooling, %. */
	fan: number;
	/** Fan from this layer on (1 = the first). */
	fanLayer: number;
	layerHeight: number;
	lineWidth: number;
	/** mm/s */
	printSpeed: number;
	firstLayerSpeed: number;
	travelSpeed: number;
	retractLength: number;
	retractSpeed: number;
	/** 0 = off */
	zHop: number;
	retractVary: 'length' | 'speed';
	plans: Record<TowerTest, SegmentPlan>;
	pa: { start: number; end: number; step: number };
	pid: { heater: 'nozzle' | 'bed'; temp: number; cycles: number };
	esteps: { current: number; requested: number; mark: number; left: number };
}

// ---------- printers ----------

/** Comment lines of G-code: «; text», a line each (a message may span lines). */
const comment = (text: string) =>
	text
		.split('\n')
		.map((line) => `; ${line}`)
		.join('\n');

// The start and end code is in the form, in the page's language: functions, not
// constants — a module is shared by every visitor.
const marlinStart = () => `M140 S{bed} ; ${m.t_tower_generator_gcode_heat_bed()}
M104 S{nozzle} ; ${m.t_tower_generator_gcode_heat_nozzle()}
G28 ; ${m.t_tower_generator_gcode_home_all()}
M190 S{bed} ; ${m.t_tower_generator_gcode_wait_bed()}
M109 S{nozzle} ; ${m.t_tower_generator_gcode_wait_nozzle()}`;

const marlinEnd = () => `M104 S0 ; ${m.t_tower_generator_gcode_nozzle_off()}
M140 S0 ; ${m.t_tower_generator_gcode_bed_off()}
M107 ; ${m.t_tower_generator_gcode_fan_off()}
G91 ; ${m.t_tower_generator_gcode_relative_moves()}
G1 E-2 F2400 ; ${m.t_tower_generator_gcode_retract()}
G1 Z10 F600 ; ${m.t_tower_generator_gcode_raise_nozzle()}
G90
G1 X0 Y{bed_y} F3000 ; ${m.t_tower_generator_gcode_park_head()}
M84 ; ${m.t_tower_generator_gcode_motors_off()}`;

const bambuStart = () => `${comment(m.t_tower_generator_gcode_bambu_start())}
M140 S{bed}
M104 S{nozzle}
G28
M190 S{bed}
M109 S{nozzle}`;

/** The custom printer (and the form's first state): plain Marlin. */
const CUSTOM_PRINTER = {
	bedX: 220,
	bedY: 220,
	maxZ: 250,
	firmware: 'marlin',
	primeLine: true,
	bambuFan: false
} as const;

export interface PrinterPreset {
	id: string;
	label: string;
	/** Shown under the presets: what to check for this printer. */
	note: string;
	profile: Omit<PrinterProfile, 'preset' | 'nozzle' | 'filament' | 'relativeE'>;
}

export const PRINTER_PRESETS: readonly PrinterPreset[] = [
	{
		id: 'custom',
		get label() {
			return m.t_tower_generator_preset_custom();
		},
		get note() {
			return m.t_tower_generator_note_custom();
		},
		profile: {
			...CUSTOM_PRINTER,
			get startGcode() {
				return marlinStart();
			},
			get endGcode() {
				return marlinEnd();
			}
		}
	},
	{
		id: 'ender3v2',
		label: 'Ender-3 V2',
		get note() {
			return m.t_tower_generator_note_ender3v2();
		},
		profile: {
			bedX: 220,
			bedY: 220,
			maxZ: 250,
			firmware: 'marlin',
			primeLine: true,
			bambuFan: false,
			get startGcode() {
				return `${marlinStart()}\n; G29 ; ${m.t_tower_generator_gcode_g29_hint()}`;
			},
			get endGcode() {
				return marlinEnd();
			}
		}
	},
	{
		id: 'ender3v3se',
		label: 'Ender-3 V3 SE',
		get note() {
			return m.t_tower_generator_note_ender3v3se();
		},
		profile: {
			bedX: 220,
			bedY: 220,
			maxZ: 250,
			firmware: 'marlin',
			primeLine: true,
			bambuFan: false,
			get startGcode() {
				return `M140 S{bed}
M104 S{nozzle}
G28
M420 S1 ; ${m.t_tower_generator_gcode_saved_mesh()}
M190 S{bed}
M109 S{nozzle}`;
			},
			get endGcode() {
				return marlinEnd();
			}
		}
	},
	{
		id: 'mk3s',
		label: 'Prusa MK3S',
		get note() {
			return m.t_tower_generator_note_mk3s();
		},
		profile: {
			bedX: 250,
			bedY: 210,
			maxZ: 210,
			firmware: 'marlin',
			primeLine: false,
			bambuFan: false,
			get startGcode() {
				return `G90
M83
M104 S{nozzle}
M140 S{bed}
M190 S{bed}
M109 S{nozzle}
G28 W ; ${m.t_tower_generator_gcode_home_no_mesh()}
G80 ; ${m.t_tower_generator_gcode_mesh_bed_leveling()}
G1 Z0.2 F720
G1 Y-3 F1000 ; ${m.t_tower_generator_gcode_off_print_area()}
G92 E0
G1 X60 E9 F1000 ; ${m.t_tower_generator_gcode_purge_line()}
G1 X100 E12.5 F1000
G92 E0`;
			},
			get endGcode() {
				return marlinEnd();
			}
		}
	},
	{
		id: 'mk4',
		label: 'Prusa MK4 / MK4S',
		get note() {
			return m.t_tower_generator_note_mk4();
		},
		profile: {
			bedX: 250,
			bedY: 210,
			maxZ: 220,
			firmware: 'marlin',
			primeLine: true,
			bambuFan: false,
			get startGcode() {
				return `M17
G90
M83
M140 S{bed}
M104 S170 ; ${m.t_tower_generator_gcode_probe_temp()}
M190 S{bed}
M109 S170
G28 ; ${m.t_tower_generator_gcode_home()}
G29 ; ${m.t_tower_generator_gcode_bed_mesh()}
M104 S{nozzle}
M109 S{nozzle}`;
			},
			get endGcode() {
				return marlinEnd();
			}
		}
	},
	{
		id: 'a1',
		label: 'Bambu Lab A1',
		get note() {
			return m.t_tower_generator_note_bambu();
		},
		profile: {
			bedX: 256,
			bedY: 256,
			maxZ: 256,
			firmware: 'marlin',
			primeLine: true,
			bambuFan: true,
			get startGcode() {
				return bambuStart();
			},
			get endGcode() {
				return marlinEnd();
			}
		}
	},
	{
		id: 'p1',
		label: 'Bambu Lab P1P / P1S',
		get note() {
			return m.t_tower_generator_note_bambu();
		},
		profile: {
			bedX: 256,
			bedY: 256,
			maxZ: 256,
			firmware: 'marlin',
			primeLine: true,
			bambuFan: true,
			get startGcode() {
				return bambuStart();
			},
			get endGcode() {
				return marlinEnd();
			}
		}
	},
	{
		id: 'klipper',
		label: 'Voron / Klipper',
		get note() {
			return m.t_tower_generator_note_klipper();
		},
		profile: {
			bedX: 300,
			bedY: 300,
			maxZ: 280,
			firmware: 'klipper',
			primeLine: true,
			bambuFan: false,
			startGcode: 'PRINT_START BED={bed} EXTRUDER={nozzle}',
			endGcode: 'PRINT_END'
		}
	}
];

// ---------- defaults ----------

export const TESTS: readonly { id: CalibrationKind; label: string }[] = [
	{
		id: 'temperature',
		get label() {
			return m.t_tower_generator_test_temperature();
		}
	},
	{
		id: 'retraction',
		get label() {
			return m.t_tower_generator_test_retraction();
		}
	},
	{
		id: 'flow',
		get label() {
			return m.t_tower_generator_test_flow();
		}
	},
	{
		id: 'speed',
		get label() {
			return m.t_tower_generator_test_speed();
		}
	},
	{
		id: 'acceleration',
		get label() {
			return m.t_tower_generator_test_acceleration();
		}
	},
	{
		id: 'corner',
		get label() {
			return m.t_tower_generator_test_corner();
		}
	},
	{
		id: 'shaper',
		get label() {
			return m.t_tower_generator_test_shaper();
		}
	},
	{ id: 'pa', label: 'Pressure Advance' },
	{
		id: 'pid',
		get label() {
			return m.t_tower_generator_test_pid();
		}
	},
	{
		id: 'esteps',
		get label() {
			return m.t_tower_generator_test_esteps();
		}
	}
];

export const TOWER_DEFAULTS: TowerParams = {
	preset: 'custom',
	...CUSTOM_PRINTER,
	get startGcode() {
		return marlinStart();
	},
	get endGcode() {
		return marlinEnd();
	},
	nozzle: 0.4,
	filament: 1.75,
	relativeE: true,
	test: 'temperature',
	material: 'pla',
	nozzleTemp: 210,
	bedTemp: 55,
	fan: 100,
	fanLayer: 3,
	layerHeight: 0.2,
	lineWidth: 0.45,
	printSpeed: 50,
	firstLayerSpeed: 20,
	travelSpeed: 150,
	retractLength: 1,
	retractSpeed: 35,
	zHop: 0,
	retractVary: 'length',
	plans: {
		temperature: { count: 6, height: 5, start: 225, step: -5, size: 15 },
		retraction: { count: 5, height: 5, start: 0.5, step: 0.5, size: 12 },
		flow: { count: 5, height: 5, start: 90, step: 5, size: 25 },
		speed: { count: 6, height: 5, start: 40, step: 20, size: 40 },
		acceleration: { count: 5, height: 5, start: 1000, step: 1000, size: 40 },
		// Square corner velocity / jerk, mm/s.
		corner: { count: 6, height: 5, start: 2, step: 2, size: 40 },
		// Input shaper frequency, Hz.
		shaper: { count: 8, height: 5, start: 20, step: 10, size: 40 }
	},
	pa: { start: 0, end: 0.1, step: 0.01 },
	pid: { heater: 'nozzle', temp: 210, cycles: 8 },
	esteps: { current: 100, requested: 100, mark: 150, left: 50 }
};

/** The retraction tower varies length or speed: each has its own sensible steps. */
export const RETRACTION_PLANS: Record<'length' | 'speed', { start: number; step: number }> = {
	length: { start: 0.5, step: 0.5 },
	speed: { start: 25, step: 10 }
};

export function applyPreset(p: TowerParams, id: string): TowerParams {
	const preset = PRINTER_PRESETS.find((x) => x.id === id);
	return preset ? { ...p, ...preset.profile, preset: id } : p;
}

// ---------- limits ----------

export const LIMITS = {
	bed: [50, 1000],
	maxZ: [20, 1000],
	nozzle: [0.2, 1.2],
	filament: [1.5, 3.2],
	fan: [0, 100],
	speed: [5, 600],
	firstLayerSpeed: [5, 100],
	travelSpeed: [20, 600],
	retractLength: [0, 15],
	retractSpeed: [5, 150],
	zHop: [0, 3],
	segments: [2, 12],
	segmentHeight: [1, 30],
	towerSize: [8, 80],
	flow: [50, 150],
	accel: [100, 50000],
	corner: [0.5, 60],
	shaper: [5, 200],
	paK: [0, 2],
	paLines: 60
} as const;

export class CalibrationError extends Error {}

/** One segment: its Z range on the printed tower and its value. */
export interface SegmentRow {
	index: number;
	zFrom: number;
	zTo: number;
	value: number;
	/** Speed test: the volumetric flow, mm³/s. */
	flow?: number;
	/** Pressure Advance: the line's Y on the bed, mm. */
	y?: number;
}

export interface TowerResult {
	gcode: string;
	rows: SegmentRow[];
	layers: number;
	/** Printed height, mm. */
	height: number;
	/** [minX, minY, maxX, maxY] of everything printed, mm. */
	footprint: [number, number, number, number];
	filename: string;
	warnings: string[];
}

/** Segment of a layer: by the layer's bottom, so boundaries fall between layers. */
export function segmentOfLayer(
	layer: number,
	layerHeight: number,
	segmentHeight: number,
	count: number
) {
	return Math.min(count - 1, Math.floor((layer * layerHeight + 1e-6) / segmentHeight));
}

/** Extruded filament per mm of path: line width × layer height ÷ filament area. */
export function extrusionPerMm(width: number, height: number, filament: number, flow = 1): number {
	return ((width * height) / (Math.PI * (filament / 2) ** 2)) * flow;
}

export function segmentValues(plan: SegmentPlan): number[] {
	return Array.from({ length: plan.count }, (_, i) => round(plan.start + plan.step * i, 4));
}

const round = (v: number, d = 3) => {
	const k = 10 ** d;
	return Math.round(v * k) / k;
};
const fmt = (v: number, d = 3) => {
	const s = round(v, d).toFixed(d);
	return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
};

/** The test's part of the file name. */
function testFilename(test: CalibrationKind): string {
	switch (test) {
		case 'temperature':
			return m.t_tower_generator_temperature_filename();
		case 'retraction':
			return m.t_tower_generator_retraction_filename();
		case 'flow':
			return m.t_tower_generator_flow_filename();
		case 'speed':
			return m.t_tower_generator_speed_filename();
		case 'acceleration':
			return m.t_tower_generator_acceleration_filename();
		case 'corner':
			return m.t_tower_generator_corner_filename();
		case 'shaper':
			return m.t_tower_generator_shaper_filename();
		case 'pa':
			return 'pressure-advance';
		case 'pid':
			return 'pid';
		case 'esteps':
			return m.t_tower_generator_esteps_filename();
	}
}

/** A number for the person reading a message: the page's way, `d` decimals at most. */
const shown = (v: number, d = 3) => num(round(v, d), d);

/** Placeholders users may write in their start/end code. */
export function fillTemplate(code: string, values: Record<string, number>): string {
	return code.replace(/\{(nozzle|bed|bed_x|bed_y)\}/g, (_, key: string) => fmt(values[key], 1));
}

/** G-code lines with the head position, retraction and E bookkeeping. */
class Writer {
	lines: string[] = [];
	x = 0;
	y = 0;
	z = 0;
	private e = 0;
	private retracted = 0;

	constructor(
		private relativeE: boolean,
		private travelF: number
	) {}

	raw(line: string) {
		this.lines.push(line);
	}

	resetE() {
		if (!this.relativeE) {
			this.e = 0;
			this.raw('G92 E0');
		}
	}

	private eWord(de: number) {
		if (this.relativeE) return `E${fmt(de, 5)}`;
		this.e += de;
		return `E${fmt(this.e, 5)}`;
	}

	retract(length: number, speed: number) {
		if (this.retracted || length <= 0) return;
		this.raw(`G1 ${this.eWord(-length)} F${Math.round(speed * 60)}`);
		this.retracted = length;
	}

	unretract(speed: number) {
		if (!this.retracted) return;
		this.raw(`G1 ${this.eWord(this.retracted)} F${Math.round(speed * 60)}`);
		this.retracted = 0;
	}

	moveZ(z: number) {
		if (Math.abs(z - this.z) < 1e-6) return;
		this.raw(`G1 Z${fmt(z)} F600`);
		this.z = z;
	}

	/** Travel; long ones retract (and hop) — the stringing a retraction test shows. */
	travel(x: number, y: number, r: { length: number; speed: number; hop: number }) {
		const d = Math.hypot(x - this.x, y - this.y);
		if (d < 1e-6) return;
		const long = d > 2;
		const z = this.z;
		if (long) {
			this.retract(r.length, r.speed);
			if (r.hop > 0) this.moveZ(z + r.hop);
		}
		this.raw(`G0 X${fmt(x)} Y${fmt(y)} F${Math.round(this.travelF * 60)}`);
		this.x = x;
		this.y = y;
		if (long && r.hop > 0) this.moveZ(z);
	}

	extrude(x: number, y: number, perMm: number, speed: number, unretractSpeed: number) {
		this.unretract(unretractSpeed);
		const d = Math.hypot(x - this.x, y - this.y);
		if (d < 1e-6) return;
		this.raw(`G1 X${fmt(x)} Y${fmt(y)} ${this.eWord(d * perMm)} F${Math.round(speed * 60)}`);
		this.x = x;
		this.y = y;
	}
}

/** A clean copy of the form: every number in its range. */
export function sanitize(p: TowerParams): TowerParams {
	const nozzle = clamp(p.nozzle, LIMITS.nozzle);
	const plan = (q: SegmentPlan, value: readonly [number, number]): SegmentPlan => ({
		count: Math.round(clamp(q.count, LIMITS.segments)),
		height: clamp(q.height, LIMITS.segmentHeight),
		start: clamp(q.start, value),
		step: clamp(q.step, [-(value[1] - value[0]), value[1] - value[0]]),
		size: clamp(q.size, LIMITS.towerSize)
	});
	return {
		...p,
		bedX: clamp(p.bedX, LIMITS.bed),
		bedY: clamp(p.bedY, LIMITS.bed),
		maxZ: clamp(p.maxZ, LIMITS.maxZ),
		nozzle,
		filament: clamp(p.filament, LIMITS.filament),
		firmware: p.firmware === 'klipper' ? 'klipper' : 'marlin',
		material: ownKey(MATERIALS, p.material) ? p.material : 'pla',
		nozzleTemp: clamp(p.nozzleTemp, [150, 320]),
		bedTemp: clamp(p.bedTemp, [0, 130]),
		fan: clamp(p.fan, LIMITS.fan),
		fanLayer: Math.round(clamp(p.fanLayer, [1, 10])),
		layerHeight: clamp(p.layerHeight, [0.05, nozzle * 0.8]),
		lineWidth: clamp(p.lineWidth, [nozzle * 0.8, nozzle * 1.8]),
		printSpeed: clamp(p.printSpeed, LIMITS.speed),
		firstLayerSpeed: clamp(p.firstLayerSpeed, LIMITS.firstLayerSpeed),
		travelSpeed: clamp(p.travelSpeed, LIMITS.travelSpeed),
		retractLength: clamp(p.retractLength, LIMITS.retractLength),
		retractSpeed: clamp(p.retractSpeed, LIMITS.retractSpeed),
		zHop: clamp(p.zHop, LIMITS.zHop),
		retractVary: p.retractVary === 'speed' ? 'speed' : 'length',
		startGcode: String(p.startGcode ?? '').slice(0, 20_000),
		endGcode: String(p.endGcode ?? '').slice(0, 20_000),
		plans: {
			temperature: plan(p.plans.temperature, [150, 320]),
			retraction: plan(
				p.plans.retraction,
				p.retractVary === 'speed' ? LIMITS.retractSpeed : LIMITS.retractLength
			),
			flow: plan(p.plans.flow, LIMITS.flow),
			speed: plan(p.plans.speed, LIMITS.speed),
			acceleration: plan(p.plans.acceleration, LIMITS.accel),
			corner: plan(p.plans.corner ?? TOWER_DEFAULTS.plans.corner, LIMITS.corner),
			shaper: plan(p.plans.shaper ?? TOWER_DEFAULTS.plans.shaper, LIMITS.shaper)
		},
		pa: {
			start: clamp(p.pa.start, LIMITS.paK),
			end: clamp(p.pa.end, LIMITS.paK),
			step: clamp(p.pa.step, [0.001, 1])
		}
	};
}

export function generateCalibration(input: TowerParams): TowerResult {
	const p = sanitize(input);
	if (p.test === 'pid' || p.test === 'esteps') {
		throw new CalibrationError(m.t_tower_generator_error_no_file());
	}
	const mat = MATERIALS[p.material];
	const warnings: string[] = [];
	if (p.bedTemp < mat.bed[0] || p.bedTemp > mat.bed[1]) {
		throw new CalibrationError(
			m.t_tower_generator_error_bed_temp({
				temp: shown(p.bedTemp, 0),
				material: mat.label,
				min: num(mat.bed[0]),
				max: num(mat.bed[1])
			})
		);
	}
	const isTower = p.test !== 'pa';
	const plan = isTower ? p.plans[p.test as TowerTest] : null;
	const values = plan ? segmentValues(plan) : [];

	// Values of the test, checked before anything is written.
	let startTemp = p.nozzleTemp;
	if (p.test === 'temperature') {
		const bad = values.find((t) => t < mat.nozzle[0] || t > mat.nozzle[1]);
		if (bad !== undefined) {
			throw new CalibrationError(
				m.t_tower_generator_error_step_temp({
					temp: shown(bad, 0),
					material: mat.label,
					min: num(mat.nozzle[0]),
					max: num(mat.nozzle[1])
				})
			);
		}
		startTemp = values[0];
	} else if (p.nozzleTemp < mat.nozzle[0] || p.nozzleTemp > mat.nozzle[1]) {
		throw new CalibrationError(
			m.t_tower_generator_error_nozzle_temp({
				temp: shown(p.nozzleTemp, 0),
				material: mat.label,
				min: num(mat.nozzle[0]),
				max: num(mat.nozzle[1])
			})
		);
	}
	/** `unit` is a unit code (units.ts). */
	const outside = (lim: readonly [number, number], what: () => string, unit: string) => {
		const bad = values.find((v) => v < lim[0] || v > lim[1]);
		if (bad !== undefined) {
			throw new CalibrationError(
				m.t_tower_generator_error_out_of_limits({
					what: what(),
					value: shown(bad, 3),
					unit: unitLabel(unit),
					min: shown(lim[0]),
					max: shown(lim[1])
				})
			);
		}
	};
	if (p.test === 'retraction') {
		if (p.retractVary === 'length')
			outside(LIMITS.retractLength, m.t_tower_generator_limit_retraction, 'mm');
		else outside(LIMITS.retractSpeed, m.t_tower_generator_limit_retraction_speed, 'mm/s');
	}
	if (p.test === 'flow') outside(LIMITS.flow, m.t_tower_generator_limit_flow, '%');
	if (p.test === 'speed') outside(LIMITS.speed, m.t_tower_generator_limit_speed, 'mm/s');
	if (p.test === 'acceleration')
		outside(LIMITS.accel, m.t_tower_generator_limit_acceleration, 'mm/s2');
	if (p.test === 'corner') outside(LIMITS.corner, m.t_tower_generator_limit_corner, 'mm/s');
	if (p.test === 'shaper') outside(LIMITS.shaper, m.t_tower_generator_limit_frequency, 'Hz');

	const lh = p.layerHeight;
	const w = p.lineWidth;
	const perMmBase = extrusionPerMm(w, lh, p.filament);
	const klipper = p.firmware === 'klipper';
	const out = new Writer(p.relativeE, p.travelSpeed);
	const fanOn = `M106 ${p.bambuFan ? 'P1 ' : ''}S${Math.round((p.fan / 100) * 255)}`;
	const fanOff = p.bambuFan ? 'M106 P1 S0' : 'M107';
	const testLabel = TESTS.find((t) => t.id === p.test)!.label;

	// ---- geometry ----
	const margin = 5;
	const frontY = p.primeLine ? 14 : margin;
	let footprint: [number, number, number, number];
	const towers: { x: number; y: number }[] = [];
	let size = 0;
	let layers = 1;
	let skirt = 0;
	const paLines: { k: number; y: number }[] = [];
	const PA_SLOW = 20;
	const PA_FAST = 40;
	const paLength = PA_SLOW * 2 + PA_FAST;
	const paSpacing = 5;
	if (isTower && plan) {
		size = plan.size;
		const count = p.test === 'temperature' || p.test === 'retraction' ? 2 : 1;
		const gap = p.test === 'retraction' ? 40 : 20;
		const width = count * size + (count - 1) * gap;
		const x0 = (p.bedX - width) / 2;
		const y0 = Math.max((p.bedY - size) / 2, frontY + 8);
		for (let i = 0; i < count; i++) towers.push({ x: x0 + i * (size + gap), y: y0 });
		skirt = 4 + w; // two skirt loops, 4 mm from the towers
		footprint = [x0 - skirt - w, y0 - skirt - w, x0 + width + skirt + w, y0 + size + skirt + w];
		layers = Math.max(1, Math.round((plan.count * plan.height) / lh));
	} else {
		const { start, end, step } = p.pa;
		if (end < start) throw new CalibrationError(m.t_tower_generator_error_k_order());
		const n = Math.floor((end - start) / step + 1e-6) + 1;
		if (n > LIMITS.paLines) {
			throw new CalibrationError(
				m.t_tower_generator_error_too_many_lines({
					count: n,
					n: num(n),
					max: num(LIMITS.paLines)
				})
			);
		}
		const height = (n - 1) * paSpacing;
		const x0 = (p.bedX - paLength) / 2;
		const y0 = Math.max((p.bedY - height) / 2, frontY + 6);
		for (let i = 0; i < n; i++)
			paLines.push({ k: round(start + step * i, 4), y: y0 + i * paSpacing });
		footprint = [x0 - w, y0 - w, x0 + paLength + w, y0 + height + w];
	}
	const [fx0, fy0, fx1, fy1] = footprint;
	if (fx0 < margin || fy0 < frontY || fx1 > p.bedX - margin || fy1 > p.bedY - margin) {
		throw new CalibrationError(
			m.t_tower_generator_error_bed_size({
				bedX: shown(p.bedX, 0),
				bedY: shown(p.bedY, 0),
				needX: shown(fx1 - fx0 + 2 * margin, 0),
				needY: shown(fy1 - fy0 + margin + frontY, 0)
			})
		);
	}
	const height = round(layers * lh, 3);
	if (height + p.zHop + 10 > p.maxZ) {
		throw new CalibrationError(
			m.t_tower_generator_error_too_tall({ height: shown(height, 1), maxZ: shown(p.maxZ, 0) })
		);
	}

	// ---- header and start ----
	// The comments keep G-code's decimal point, as its commands do.
	const valueOf = (layer: number) =>
		plan ? values[segmentOfLayer(layer, lh, plan.height, plan.count)] : 0;
	out.raw(comment(m.t_tower_generator_gcode_title({ test: testLabel })));
	out.raw(
		comment(
			m.t_tower_generator_gcode_setup({
				nozzle: fmt(p.nozzle),
				filament: fmt(p.filament, 2),
				layer: fmt(lh),
				line: fmt(w),
				material: mat.label
			})
		)
	);
	out.raw(
		comment(
			m.t_tower_generator_gcode_printer({
				x: fmt(p.bedX, 0),
				y: fmt(p.bedY, 0),
				firmware: klipper ? 'Klipper' : 'Marlin'
			})
		)
	);
	out.raw(comment(m.t_tower_generator_gcode_check_start()));
	out.raw('');
	const fill = { nozzle: startTemp, bed: p.bedTemp, bed_x: p.bedX, bed_y: p.bedY };
	out.raw(fillTemplate(p.startGcode, fill));
	out.raw('');
	out.raw(`G90 ; ${m.t_tower_generator_gcode_absolute_xyz()}`);
	out.raw(
		p.relativeE
			? `M83 ; ${m.t_tower_generator_gcode_relative_e()}`
			: `M82 ; ${m.t_tower_generator_gcode_absolute_e()}`
	);
	out.raw('G92 E0');
	out.raw(`M220 S100 ; ${m.t_tower_generator_gcode_speed_100()}`);
	out.raw(`M221 S100 ; ${m.t_tower_generator_gcode_flow_100()}`);
	out.raw(fanOff);
	if (p.test === 'temperature')
		out.raw(`M109 S${fmt(startTemp, 0)} ; ${m.t_tower_generator_gcode_heat_first_step()}`);
	if (isTower && p.test === 'acceleration') out.raw(accelCommand(klipper, values[0]));
	if (isTower && p.test === 'corner') out.raw(cornerCommand(klipper, values[0]));
	if (isTower && p.test === 'shaper') out.raw(shaperCommand(klipper, values[0]));
	// Whatever the start code left, cross the bed high above it.
	out.raw(`G1 Z5 F600 ; ${m.t_tower_generator_gcode_lift_nozzle()}`);
	out.z = 5;

	// ---- prime line ----
	const retractFor = (layer: number) => ({
		length:
			p.test === 'retraction' && p.retractVary === 'length' ? valueOf(layer) : p.retractLength,
		speed: p.test === 'retraction' && p.retractVary === 'speed' ? valueOf(layer) : p.retractSpeed,
		hop: p.zHop
	});
	const firstZ = lh;
	if (p.primeLine) {
		const x1 = Math.min(p.bedX - margin - 5, 10 + 100);
		out.raw(';TYPE:Custom');
		out.raw(comment(m.t_tower_generator_gcode_prime_line()));
		out.raw(`G0 X10 Y5 F${Math.round(p.travelSpeed * 60)}`);
		out.x = 10;
		out.y = 5;
		out.moveZ(firstZ);
		const perMmPrime = extrusionPerMm(w * 1.5, lh, p.filament);
		out.extrude(x1, 5, perMmPrime, p.firstLayerSpeed, p.retractSpeed);
		out.extrude(x1, 5.8, perMmPrime, p.firstLayerSpeed, p.retractSpeed);
		out.extrude(10, 5.8, perMmPrime, p.firstLayerSpeed, p.retractSpeed);
		out.retract(p.retractLength, p.retractSpeed);
	}

	const rows: SegmentRow[] = [];
	if (isTower && plan) {
		// ---- towers, layer by layer ----
		let segment = -1;
		for (let layer = 0; layer < layers; layer++) {
			const z = round((layer + 1) * lh, 4);
			out.raw(';LAYER_CHANGE');
			out.raw(`;Z:${fmt(z)}`);
			out.raw(`;HEIGHT:${fmt(lh)}`);
			out.resetE();
			const s = segmentOfLayer(layer, lh, plan.height, plan.count);
			if (s !== segment) {
				segment = s;
				const v = values[s];
				out.raw(comment(m.t_tower_generator_gcode_step({ n: s + 1, value: fmt(v, 3) })));
				if (p.test === 'temperature' && s > 0) out.raw(`M104 S${fmt(v, 0)}`);
				if (p.test === 'acceleration' && s > 0) out.raw(accelCommand(klipper, v));
				if (p.test === 'corner' && s > 0) out.raw(cornerCommand(klipper, v));
				if (p.test === 'shaper' && s > 0) out.raw(shaperCommand(klipper, v));
			}
			if (layer === p.fanLayer - 1 && p.fan > 0) out.raw(fanOn);

			const first = layer === 0;
			const flow = p.test === 'flow' ? valueOf(layer) / 100 : 1;
			const perMm = perMmBase * flow;
			const speed = first ? p.firstLayerSpeed : p.test === 'speed' ? valueOf(layer) : p.printSpeed;
			const r = retractFor(layer);

			if (!first) out.moveZ(z);
			else {
				// Two skirt loops around everything, 4 mm away. Coming down from the
				// safe height: over the skirt's corner first, then to the first layer.
				const sx0 = towers[0].x - 4 - w / 2;
				const sy0 = towers[0].y - 4 - w / 2;
				const sx1 = towers[towers.length - 1].x + size + 4 + w / 2;
				const sy1 = towers[0].y + size + 4 + w / 2;
				out.travel(sx0 - w, sy0 - w, r);
				out.moveZ(z);
				out.raw(';TYPE:Skirt');
				for (let loop = 1; loop >= 0; loop--) {
					const o = loop * w;
					rect(out, sx0 - o, sy0 - o, sx1 + o, sy1 + o, perMm, speed, r);
				}
			}
			for (const t of towers) {
				out.raw(';TYPE:Perimeter');
				rect(
					out,
					t.x + 1.5 * w,
					t.y + 1.5 * w,
					t.x + size - 1.5 * w,
					t.y + size - 1.5 * w,
					perMm,
					speed,
					r
				);
				out.raw(';TYPE:External perimeter');
				rect(
					out,
					t.x + w / 2,
					t.y + w / 2,
					t.x + size - w / 2,
					t.y + size - w / 2,
					perMm,
					speed,
					r
				);
			}
		}
		// Table: real Z of each segment (boundaries fall between layers).
		for (let s = 0; s < plan.count; s++) {
			let firstLayer = -1;
			let lastLayer = -1;
			for (let layer = 0; layer < layers; layer++) {
				if (segmentOfLayer(layer, lh, plan.height, plan.count) !== s) continue;
				if (firstLayer < 0) firstLayer = layer;
				lastLayer = layer;
			}
			if (firstLayer < 0) continue;
			const row: SegmentRow = {
				index: s + 1,
				zFrom: round(firstLayer * lh, 3),
				zTo: round((lastLayer + 1) * lh, 3),
				value: values[s]
			};
			if (p.test === 'speed') row.flow = round(values[s] * w * lh, 2);
			rows.push(row);
		}
		if (p.test === 'speed') {
			const top = rows.at(-1)?.flow ?? 0;
			if (top > 20) {
				warnings.push(m.t_tower_generator_warning_top_flow({ flow: shown(top, 1) }));
			}
		}
	} else {
		// ---- Pressure / Linear Advance pattern: one layer of lines ----
		out.raw(';LAYER_CHANGE');
		out.raw(`;Z:${fmt(firstZ)}`);
		out.raw(`;HEIGHT:${fmt(lh)}`);
		out.resetE();
		const x0 = (p.bedX - paLength) / 2;
		const slow = Math.max(10, p.printSpeed / 5);
		const r = { length: p.retractLength, speed: p.retractSpeed, hop: p.zHop };
		paLines.forEach((line, i) => {
			out.travel(x0, line.y, r);
			out.moveZ(firstZ);
			out.raw(
				klipper ? `SET_PRESSURE_ADVANCE ADVANCE=${fmt(line.k, 4)}` : `M900 K${fmt(line.k, 4)}`
			);
			out.raw(';TYPE:Perimeter');
			out.extrude(x0 + PA_SLOW, line.y, perMmBase, slow, p.retractSpeed);
			out.raw(';TYPE:External perimeter');
			out.extrude(x0 + PA_SLOW + PA_FAST, line.y, perMmBase, p.printSpeed, p.retractSpeed);
			out.raw(';TYPE:Perimeter');
			out.extrude(x0 + paLength, line.y, perMmBase, slow, p.retractSpeed);
			out.retract(r.length, r.speed);
			rows.push({ index: i + 1, zFrom: 0, zTo: round(lh, 3), value: line.k, y: round(line.y, 1) });
		});
		if (!klipper) warnings.push(m.t_tower_generator_warning_lin_advance());
		warnings.push(m.t_tower_generator_warning_k_stays());
	}

	// ---- end ----
	out.raw(';TYPE:Custom');
	out.raw(fanOff);
	out.raw(fillTemplate(p.endGcode, fill));
	out.raw(comment(m.t_tower_generator_gcode_end()));

	if (p.test === 'corner' && !klipper) {
		warnings.push(m.t_tower_generator_warning_junction_deviation());
	}
	if (p.test === 'shaper') {
		warnings.push(
			klipper
				? m.t_tower_generator_warning_shaper_klipper()
				: m.t_tower_generator_warning_shaper_marlin()
		);
	}
	if (p.bambuFan) warnings.push(m.t_tower_generator_warning_bambu());
	if (!p.startGcode.trim()) warnings.push(m.t_tower_generator_warning_start_empty());
	return {
		gcode: out.lines.join('\n') + '\n',
		rows,
		layers,
		height,
		footprint,
		filename: `${m.t_tower_generator_filename()}-${testFilename(p.test)}.gcode`,
		warnings
	};
}

function cornerCommand(klipper: boolean, v: number): string {
	return klipper
		? `SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=${fmt(v, 1)}`
		: `M205 X${fmt(v, 1)} Y${fmt(v, 1)}`;
}

function shaperCommand(klipper: boolean, hz: number): string {
	const f = fmt(hz, 1);
	return klipper ? `SET_INPUT_SHAPER SHAPER_FREQ_X=${f} SHAPER_FREQ_Y=${f}` : `M593 F${f}`;
}

function accelCommand(klipper: boolean, accel: number): string {
	const a = Math.round(accel);
	return klipper ? `SET_VELOCITY_LIMIT ACCEL=${a}` : `M204 S${a}`;
}

/** A closed rectangle, starting and ending at its first corner. */
function rect(
	out: Writer,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	perMm: number,
	speed: number,
	r: { length: number; speed: number; hop: number }
) {
	out.travel(x0, y0, r);
	out.extrude(x1, y0, perMm, speed, r.speed);
	out.extrude(x1, y1, perMm, speed, r.speed);
	out.extrude(x0, y1, perMm, speed, r.speed);
	out.extrude(x0, y0, perMm, speed, r.speed);
}

// ---------- calculators without a file ----------

/** PID autotune: the commands to send from the printer's console. */
export function pidCommands(
	firmware: Firmware,
	heater: 'nozzle' | 'bed',
	temp: number,
	cycles: number
): string[] {
	const t = Math.round(clamp(temp, heater === 'nozzle' ? [150, 300] : [40, 120]));
	const c = Math.round(clamp(cycles, [3, 15]));
	if (firmware === 'klipper') {
		return [
			`PID_CALIBRATE HEATER=${heater === 'nozzle' ? 'extruder' : 'heater_bed'} TARGET=${t}`,
			'SAVE_CONFIG'
		];
	}
	return heater === 'nozzle'
		? ['M106 S255', `M303 E0 S${t} C${c} U1`, 'M107', 'M500']
		: [`M303 E-1 S${t} C${c} U1`, 'M500'];
}

export interface EStepsResult {
	/** What really went in, mm. */
	actual: number;
	/** New steps per mm (Marlin) or rotation_distance (Klipper). */
	value: number;
	/** Off by this share: +3 % = under-extrudes by 3 %. */
	error: number;
}

/**
 * E-steps from a marked filament: mark `mark` mm above the extruder, extrude
 * `requested` mm, measure what is left to the mark. Marlin steps scale by
 * requested ÷ actual; Klipper's rotation_distance by actual ÷ requested.
 */
export function eSteps(
	firmware: Firmware,
	current: number,
	requested: number,
	mark: number,
	left: number
): EStepsResult | null {
	const actual = mark - left;
	if (!(current > 0) || !(requested > 0) || !(actual > 0) || left < 0) return null;
	const value =
		firmware === 'klipper' ? (current * actual) / requested : (current * requested) / actual;
	return {
		actual: round(actual, 2),
		value: round(value, 3),
		error: round((requested - actual) / requested, 4)
	};
}

/** Commands for the E-steps test and for saving the result. */
export function eStepsCommands(
	firmware: Firmware,
	temp: number,
	requested: number,
	value?: number
) {
	const t = Math.round(clamp(temp, [170, 300]));
	// Klipper refuses an extrude-only move over max_extrude_only_distance (50 mm by
	// default): the length goes in pieces of at most 50 mm.
	const length = clamp(requested, [10, 200]);
	const pieces = Math.ceil(length / 50);
	const before = [
		`M109 S${t}`,
		'M83',
		...Array.from({ length: pieces }, () => `G1 E${fmt(length / pieces, 2)} F60`)
	];
	if (value === undefined) return { before, after: [] as string[] };
	const after =
		firmware === 'klipper'
			? [`rotation_distance: ${fmt(value, 3)}`]
			: [`M92 E${fmt(value, 2)}`, 'M500'];
	return { before, after };
}

/** Flow from a measured wall: current × expected ÷ measured. */
export function flowCorrection(
	currentPercent: number,
	expected: number,
	measured: number
): number | null {
	if (!(currentPercent > 0) || !(expected > 0) || !(measured > 0)) return null;
	return round((currentPercent * expected) / measured, 1);
}
