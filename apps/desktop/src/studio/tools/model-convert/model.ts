/**
 * «Конвертер форматов»: a model opened from STL, OBJ, 3MF or GLB saved as
 * STL, OBJ or 3MF — in millimetres (files from 3D programs are often in
 * metres, centimetres or inches) and standing on the bed if asked. Pure.
 */
import { bounds, placeOnBed, type Triangles } from '../stl';
import { weld } from '../weld';

export type Unit = 'mm' | 'cm' | 'm' | 'in';

/** Millimetres in one unit. */
export const UNIT_MM: Record<Unit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

/** The model in millimetres, optionally moved so it stands on the bed at the origin. */
export function prepare(tris: Triangles, unit: Unit, onBed: boolean): Triangles {
	const k = UNIT_MM[unit] ?? 1;
	const out = k === 1 ? tris.slice() : tris.map((v) => v * k);
	return onBed ? placeOnBed(out) : out;
}

/** A Wavefront OBJ: shared vertices, faces numbered from 1. */
export function writeObj(tris: Triangles, name = 'model'): string {
	const mesh = weld(tris, 1e-5);
	const lines = [`# Polyzon Studio`, `o ${name.replace(/\s+/g, '_')}`];
	const n = (v: number) => {
		const s = v.toFixed(5);
		return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
	};
	for (let i = 0; i < mesh.positions.length; i += 3)
		lines.push(`v ${n(mesh.positions[i])} ${n(mesh.positions[i + 1])} ${n(mesh.positions[i + 2])}`);
	for (let i = 0; i < mesh.indices.length; i += 3)
		lines.push(`f ${mesh.indices[i] + 1} ${mesh.indices[i + 1] + 1} ${mesh.indices[i + 2] + 1}`);
	return lines.join('\n') + '\n';
}

/** Size of the model, mm. */
export const sizeOf = (tris: Triangles): [number, number, number] => bounds(tris).size;

/** A guess at the unit from the size: a part a metre across was probably drawn in metres. */
export function guessUnit(size: readonly number[]): Unit {
	const big = Math.max(...size);
	if (big > 0 && big < 2) return 'm';
	return 'mm';
}
