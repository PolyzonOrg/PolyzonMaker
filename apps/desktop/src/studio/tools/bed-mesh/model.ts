/**
 * «Карта стола»: the bed mesh a printer measured (Klipper BED_MESH_OUTPUT,
 * the points of a saved [bed_mesh] profile, Marlin G29 T / M420 V), read
 * from pasted console text: how uneven the bed is, and how far to turn each
 * corner screw to level it. Pure; the page draws the grid.
 */
import { speedHue } from '../gcode-viewer/parse';
import * as m from '$msg/tools/bed-mesh';

export type FirstRow = 'front' | 'back';
export type MeshSource = 'klipper' | 'marlin' | 'unknown';

/** Klipper's probed points, when the text has them: the measurement itself. */
const PROBED = /Probed Z positions:?/i;

/**
 * Rows of numbers in the text: the largest block of rows of the same length
 * (in Klipper's output, the probed points when they are there).
 */
export function parseMesh(text: string, firstRow: FirstRow): number[][] | null {
	let body = String(text ?? '');
	const probed = body.search(PROBED);
	if (probed >= 0) {
		body = body.slice(probed).replace(PROBED, '');
		const next = body.search(/Mesh X,Y|Measured points/i);
		if (next >= 0) body = body.slice(0, next);
	}
	const rows: number[][] = [];
	for (const raw of body.split(/\r?\n/)) {
		const line = raw.replace(/^\s*(\/\/|echo:|Recv:|ok\b)\s*/i, '');
		// Decimals only: Marlin's row and column indexes are whole numbers.
		const values = [...line.matchAll(/[-+]?\d*\.\d+/g)].map((m) => Number(m[0]));
		rows.push(values.length >= 3 ? values : []);
	}
	// The longest run of consecutive rows with the same number of values.
	let best: number[][] = [];
	let run: number[][] = [];
	for (const r of rows) {
		if (r.length && run.length && r.length === run[0].length) run.push(r);
		else run = r.length ? [r] : [];
		if (run.length > best.length) best = run.slice();
	}
	if (best.length < 2 || best.length > 30 || best[0].length > 30) return null;
	return firstRow === 'front' ? best : best.slice().reverse();
}

/** Which firmware the text looks like. */
export function sourceOf(text: string): MeshSource {
	if (/Bilinear Leveling Grid|Bed Topography|G29|M420|Mesh Bed Leveling/i.test(text))
		return 'marlin';
	if (/\/\/|probed|mesh_max|points\s*=|bed_mesh/i.test(text)) return 'klipper';
	return 'unknown';
}

/**
 * Which row the text lists first, by the block's own heading (as the
 * firmware sources print them); null when the text does not say:
 * - Klipper «Probed Z positions» and a saved profile's `points =`: front (lowest Y) first;
 * - Klipper «Measured points» (BED_MESH_OUTPUT's mesh): back first;
 * - Marlin bilinear and mesh bed levelling (G29 T, M420 V): front (y = 0) first;
 * - Marlin UBL «Bed Topography Report»: back first.
 */
export function rowOrderOf(text: string): FirstRow | null {
	if (PROBED.test(text) || /points\s*=/i.test(text)) return 'front';
	if (/Measured points/i.test(text)) return 'back';
	if (/Bed Topography Report/i.test(text)) return 'back';
	if (/Bilinear Leveling Grid|Mesh Bed Leveling|G29|M420/i.test(text)) return 'front';
	return null;
}

export interface MeshStats {
	min: number;
	max: number;
	range: number;
	mean: number;
}

export function statsOf(grid: number[][]): MeshStats {
	const all = grid.flat();
	const min = Math.min(...all);
	const max = Math.max(...all);
	return { min, max, range: max - min, mean: all.reduce((a, b) => a + b, 0) / all.length };
}

/** A word for the spread, as printers' guides grade it. */
export function verdictOf(range: number): string {
	if (range < 0.1) return m.t_bed_mesh_verdict_excellent();
	if (range < 0.2) return m.t_bed_mesh_verdict_good();
	if (range < 0.4) return m.t_bed_mesh_verdict_fair();
	return m.t_bed_mesh_verdict_poor();
}

export interface ScrewTurn {
	corner: string;
	/** Corner above (+) or below (−) the average of the corners, mm */
	delta: number;
	turns: number;
	/** The same as minutes on a clock face: a quarter turn is 15 */
	minutes: number;
}

/** Screw pitches of the usual bed screws, mm per turn. */
export const PITCHES: readonly { label: string; pitch: number }[] = [
	{ label: 'M3', pitch: 0.5 },
	{ label: 'M4', pitch: 0.7 },
	{ label: 'M5', pitch: 0.8 }
];

/** Four corner screws brought to the average of the corners. */
export function screwTurns(grid: number[][], pitch: number): ScrewTurn[] {
	const last = grid.length - 1;
	const end = grid[0].length - 1;
	const corners: [string, number][] = [
		[m.t_bed_mesh_corner_back_left(), grid[last][0]],
		[m.t_bed_mesh_corner_back_right(), grid[last][end]],
		[m.t_bed_mesh_corner_front_left(), grid[0][0]],
		[m.t_bed_mesh_corner_front_right(), grid[0][end]]
	];
	const ref = corners.reduce((a, [, v]) => a + v, 0) / corners.length;
	return corners.map(([corner, v]) => {
		const delta = v - ref;
		const turns = Math.abs(delta) / pitch;
		return { corner, delta, turns, minutes: Math.round(turns * 60) };
	});
}

/** Blue (lowest) to red (highest), the hues of the G-code speed scale (scene data). */
export function hueOf(v: number, s: MeshStats): number {
	return speedHue(s.range > 0 ? (v - s.min) / s.range : 0.5);
}

export const SAMPLE = `// Mesh X,Y: 5,5
// Measured points:
//  0.112500  0.072500  0.040000  0.052500  0.090000
//  0.067500  0.032500 -0.002500  0.012500  0.047500
//  0.042500  0.005000 -0.027500 -0.012500  0.025000
//  0.050000  0.017500 -0.012500  0.000000  0.037500
//  0.097500  0.060000  0.030000  0.042500  0.080000`;
