/**
 * Several parts on one scene (halves of a cut, mold halves, flexi segments):
 * what the page keeps per part and how it is shown, sized and saved.
 */
import { bounds, downloadBytes, layoutInRow, placeOnBed, writeStl } from '../stl';
import { zipStore, type ZipEntry } from '../shared/zip';
import type { Vec3 } from './plane';
import { currentLocale, num } from '$lib/i18n/current';
import { decimalMark } from '$lib/i18n/locale';
import * as m from '$msg/tools/booleans';

export interface Part {
	id: number;
	name: string;
	/** Latin file name without extension. */
	file: string;
	/** Geometry as it sits on the scene (assembled). */
	tris: Float32Array;
	/** What goes into the file when it differs (dowels standing in a row). */
	printTris?: Float32Array;
	/** mm³ */
	volume: number;
	color: string;
	visible: boolean;
	/** Where «Раздвинуть на сцене» moves the part (scaled by the model size). */
	dir: Vec3;
	/** A short note next to the name («крышка»). */
	tag?: string;
	/**
	 * Shown for context, not printed with the set — the mold's master model.
	 * It still has its own download in the parts list.
	 */
	reference?: boolean;
}

/**
 * Part colours on the dark scene: muted, told apart by hue and lightness,
 * the first one is the plain model grey of the single-part viewer.
 */
export const PART_COLORS = [
	'#c9c9cc',
	'#d8b48a',
	'#8fb0d6',
	'#a9c79a',
	'#d79a8e',
	'#b5a2d6',
	'#d6cc8a',
	'#8ccfc2'
] as const;

export const partColor = (i: number) => PART_COLORS[i % PART_COLORS.length];

export function formatCm3(mm3: number): string {
	// Always one decimal («12,0»), in the language's marks.
	const [whole, frac] = (mm3 / 1000).toFixed(1).split('.');
	return m.t_booleans_volume_cm3({
		value: num(Number(whole), 0) + decimalMark(currentLocale()) + frac
	});
}

export function formatMl(mm3: number): string {
	return m.t_booleans_volume_ml({ value: num(Math.max(0, mm3) / 1000, 0) });
}

/** Overall size of the visible parts, for ToolShell's «X × Y × Z мм» caption. */
export function partsSize(parts: readonly Part[]): Vec3 | null {
	const shown = parts.filter((p) => p.visible);
	if (!shown.length) return null;
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const p of shown) {
		const b = bounds(p.tris);
		for (let k = 0; k < 3; k++) {
			min[k] = Math.min(min[k], b.min[k]);
			max[k] = Math.max(max[k], b.max[k]);
		}
	}
	return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

export function downloadPart(part: Part): void {
	const bytes = writeStl(placeOnBed(part.printTris ?? part.tris));
	downloadBytes(bytes, `${part.file}.stl`, 'model/stl');
}

/** The parts that go to the printer: everything but the reference model. */
export const printable = (parts: readonly Part[]) => parts.filter((p) => !p.reference);

/** All printable parts in one STL, side by side on the bed. */
export function downloadAll(parts: readonly Part[], file: string): void {
	const set = printable(parts);
	if (!set.length) return;
	const tris = layoutInRow(set.map((p) => p.printTris ?? p.tris));
	downloadBytes(writeStl(tris), `${file}.stl`, 'model/stl');
}

/** Each printable part as its own STL in one .zip — a slicer plate per part. */
export function downloadZip(parts: readonly Part[], file: string, extra: ZipEntry[] = []): void {
	const set = printable(parts);
	if (!set.length) return;
	const entries = set.map((p) => ({
		name: `${p.file}.stl`,
		data: writeStl(placeOnBed(p.printTris ?? p.tris))
	}));
	downloadBytes(zipStore([...entries, ...extra]), `${file}.zip`, 'application/zip');
}
