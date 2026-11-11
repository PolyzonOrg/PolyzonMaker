/**
 * Filament swatches: a card you print from each spool and keep on a ring —
 * the material, the maker and colour, the temperatures engraved on it, and
 * a row of steps from thin to thick along the bottom, to see how the colour
 * looks (and how much light it lets through) at every wall thickness.
 */
import {
	circle,
	difference,
	extrude,
	label,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/filament-swatch';
import { clamp as c } from '../shared/math';

export interface FilamentSwatchParams {
	material: string;
	maker: string;
	colour: string;
	/** Nozzle and bed, as the person writes them */
	temps: string;
	width: number;
	height: number;
	thickness: number;
	steps: number;
	/** Each step this much thicker, mm */
	step: number;
	font: string;
	count: number;
}

export const FILAMENT_SWATCH_DEFAULTS: FilamentSwatchParams = {
	material: 'PLA',
	maker: 'Bestfilament',
	get colour() {
		return m.t_filament_swatch_colour_default();
	},
	temps: '210 °C / 60 °C',
	width: 75,
	height: 40,
	thickness: 2.4,
	steps: 6,
	step: 0.4,
	font: 'Russo One',
	count: 1
};

export interface FilamentSwatchPreset {
	id: string;
	label: string;
	params: Partial<FilamentSwatchParams>;
}

export const FILAMENT_SWATCH_PRESETS: readonly FilamentSwatchPreset[] = [
	{ id: 'pla', label: 'PLA', params: { material: 'PLA', temps: '210 °C / 60 °C' } },
	{
		id: 'petg',
		label: 'PETG',
		params: {
			material: 'PETG',
			temps: '235 °C / 75 °C',
			get colour() {
				return m.t_filament_swatch_preset_petg_colour();
			}
		}
	},
	{
		id: 'thin',
		get label() {
			return m.t_filament_swatch_preset_thin();
		},
		params: { steps: 8, step: 0.2, thickness: 1.6 }
	},
	{
		id: 'small',
		get label() {
			return m.t_filament_swatch_preset_small();
		},
		params: { width: 50, height: 30, steps: 5 }
	}
];

export function clampFilamentSwatch(p: FilamentSwatchParams): FilamentSwatchParams {
	const thickness = c(p.thickness, 1.2, 4);
	const steps = Math.round(c(p.steps, 2, 10));
	return {
		material: String(p.material ?? '').slice(0, 16),
		maker: String(p.maker ?? '').slice(0, 24),
		colour: String(p.colour ?? '').slice(0, 24),
		temps: String(p.temps ?? '').slice(0, 24),
		width: c(p.width, 40, 100),
		height: c(p.height, 25, 60),
		thickness,
		steps,
		// The thickest step is the card itself.
		step: c(p.step, 0.1, thickness / steps),
		font: p.font,
		count: Math.round(c(p.count, 1, 12))
	};
}

/** Engraving depth, mm. */
const ENGRAVE = 0.6;
const MARGIN = 3.5;

/** The step band at the bottom, mm high. */
export const bandOf = (p: FilamentSwatchParams) => Math.min(10, p.height * 0.25);

/** Thickness of every step, thinnest first. */
export function stepThicknesses(p: FilamentSwatchParams): number[] {
	return Array.from({ length: p.steps }, (_, i) => Math.round((i + 1) * p.step * 100) / 100);
}

function swatch(p: FilamentSwatchParams): Node {
	const W = p.width;
	const H = p.height;
	const band = bandOf(p);
	const card = extrude(p.thickness, rrect(W, H, 3));
	// Cut each step down from the top to its thickness.
	const sw = (W - 2 * MARGIN) / p.steps;
	const cuts = stepThicknesses(p)
		.map((t, i) =>
			t >= p.thickness
				? null
				: translate(
						[-W / 2 + MARGIN + sw * (i + 0.5), -H / 2 + MARGIN + band / 2, t],
						extrude(p.thickness, square(sw - 0.01, band))
					)
		)
		.filter((n): n is Node => !!n);
	const hole = translate([W / 2 - 6, H / 2 - 6, -1], extrude(p.thickness + 2, circle(2.6, 40)));
	// Three lines in the top part, left-aligned on their baselines, engraved.
	const textTop = H / 2 - MARGIN;
	const room = H - 2 * MARGIN - band - 2;
	const capBig = Math.min(7, room * 0.33);
	const capSmall = Math.min(4, room * 0.18);
	const fit = W - 2 * MARGIN - 12;
	const o = { font: p.font, halign: 'left' as const };
	const left = -W / 2 + MARGIN + 1;
	const b1 = textTop - capBig;
	const b2 = b1 - capSmall - 2.4;
	const b3 = b2 - capSmall - 2.4;
	const lines = union(
		translate([left, b1], label(p.material.trim(), capBig, { ...o, fit })),
		translate(
			[left, b2],
			label([p.maker.trim(), p.colour.trim()].filter(Boolean).join(' · '), capSmall, {
				...o,
				fit: fit + 10
			})
		),
		translate([left, b3], label(p.temps.trim(), capSmall, { ...o, fit: fit + 10 }))
	);
	const engraving = translate([0, 0, p.thickness - ENGRAVE], extrude(ENGRAVE + 1, lines));
	return difference(card, ...cuts, hole, engraving);
}

export function filamentSwatchModel(input: FilamentSwatchParams): Node {
	const p = clampFilamentSwatch(input);
	const one = swatch(p);
	const cols = p.count > 4 ? 3 : Math.min(2, p.count);
	return union(
		...Array.from({ length: p.count }, (_, i) =>
			translate([(i % cols) * (p.width + 5), -Math.floor(i / cols) * (p.height + 5), 0], one)
		)
	);
}

const mm = (v: number) => num(v, 4);

export function filamentSwatchSummary(input: FilamentSwatchParams): string {
	const p = clampFilamentSwatch(input);
	const t = stepThicknesses(p);
	return m.t_filament_swatch_summary({
		count: p.steps,
		n: num(p.steps),
		width: mm(p.width),
		height: mm(p.height),
		from: mm(t[0]),
		to: mm(Math.min(t[t.length - 1], p.thickness))
	});
}

export function filamentSwatchHeader(input: FilamentSwatchParams): string[] {
	const p = clampFilamentSwatch(input);
	return [
		m.t_filament_swatch_scad_title(),
		`${p.material} ${p.maker} ${p.colour} ${p.temps}`,
		filamentSwatchSummary(p)
	];
}

export function filamentSwatchScad(p: FilamentSwatchParams): string {
	return toScad(filamentSwatchModel(p), filamentSwatchHeader(p));
}
