/**
 * A roller stand for a filament spool: two cradles, each with two bearings
 * the spool's rim rolls on — it turns freely and does not slide off.
 * Bearings are the common 608 (22 × 8 × 7, from skateboards) or the smaller
 * 625 (16 × 5 × 5); each turns on a bolt through two cheeks. The spacing of
 * the bearings follows the spool's diameter. The cradles print as they
 * stand, no supports.
 */
import { currentLocale, num } from '$lib/i18n/current';
import { sentenceGap } from '$lib/i18n/locale';
import * as m from '$msg/tools/spool-holder';
import {
	cylinder,
	difference,
	extrude,
	part,
	rotate,
	rrect,
	square,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { clamp as c } from '../shared/math';

export type BearingId = '608' | '625';

export const BEARINGS: Readonly<Record<BearingId, { outer: number; bore: number; width: number }>> =
	{
		'608': { outer: 22, bore: 8, width: 7 },
		'625': { outer: 16, bore: 5, width: 5 }
	};

export interface SpoolHolderParams {
	/** Outside diameter of the spool, mm */
	spool: number;
	bearing: BearingId;
	/** How many cradles to print (two: one under each rim) */
	count: 1 | 2;
	/** Plate under the cradle, mm */
	base: number;
	/** Play beside the bearing and round the bolt, mm */
	clearance: number;
}

export const SPOOL_HOLDER_DEFAULTS: SpoolHolderParams = {
	spool: 200,
	bearing: '608',
	count: 2,
	base: 4,
	clearance: 0.4
};

export interface SpoolHolderPreset {
	id: string;
	label: string;
	params: Partial<SpoolHolderParams>;
}

export const SPOOL_HOLDER_PRESETS: readonly SpoolHolderPreset[] = [
	{
		id: 'kg',
		get label() {
			return m.t_spool_holder_preset_kg();
		},
		params: { spool: 200 }
	},
	{
		id: 'half',
		get label() {
			return m.t_spool_holder_preset_half();
		},
		params: { spool: 160 }
	},
	{
		id: 'big',
		get label() {
			return m.t_spool_holder_preset_big();
		},
		params: { spool: 300 }
	},
	{
		id: 'small',
		get label() {
			return m.t_spool_holder_preset_small();
		},
		params: { spool: 200, bearing: '625' }
	}
];

export function clampSpoolHolder(p: SpoolHolderParams): SpoolHolderParams {
	return {
		spool: c(p.spool, 100, 400),
		bearing: p.bearing === '625' ? '625' : '608',
		count: p.count === 1 ? 1 : 2,
		base: c(p.base, 2.5, 10),
		clearance: c(p.clearance, 0.1, 1)
	};
}

export interface SpoolHolderLayout {
	/** Between the bearing axles, mm */
	spacing: number;
	/** Axle height above the bed, mm */
	axle: number;
	/** Where the rim rests on a bearing, ° from its lowest point */
	angle: number;
	/** The spool's rim above the bed, at its lowest, mm */
	rim: number;
	length: number;
	width: number;
}

const CHEEK = 4;

export function spoolHolderLayout(input: SpoolHolderParams): SpoolHolderLayout {
	const p = clampSpoolHolder(input);
	const b = BEARINGS[p.bearing];
	// The rim rests on the two bearings up to 35° either side of its lowest point —
	// less for a big spool, whose rim would otherwise sag onto the plate between them.
	const R = p.spool / 2;
	const r = b.outer / 2;
	const axle = p.base + r + 3;
	const k = Math.min(
		(35 * Math.PI) / 180,
		Math.acos(Math.min(1, (R + p.base + 2 - axle) / (R + r)))
	);
	const spacing = 2 * (R + r) * Math.sin(k);
	return {
		spacing,
		axle,
		angle: (k * 180) / Math.PI,
		rim: axle + (R + r) * Math.cos(k) - R,
		length: spacing + 2 * (r + CHEEK + 2),
		width: b.width + 2 * (p.clearance + CHEEK)
	};
}

/** Half the width of a cheek round the bolt: below the point where the rim touches the bearing. */
const cheekHalf = (bore: number) => bore / 2 + 3;

/** One cradle: a plate, two pairs of cheeks, a bolt hole through each pair. */
function cradle(p: SpoolHolderParams, L: SpoolHolderLayout): Node {
	const b = BEARINGS[p.bearing];
	const r = b.outer / 2;
	const gap = b.width + 2 * p.clearance;
	// The plate wider than the cheeks: a long narrow strip would rock under the spool.
	const pieces: Node[] = [extrude(p.base, rrect(L.length, Math.max(L.width, 30), 3, 24))];
	const holes: Node[] = [];
	const w = 2 * cheekHalf(b.bore);
	for (const s of [-1, 1]) {
		const x = (s * L.spacing) / 2;
		// A cheek rises from the plate and rounds over the bolt.
		const profile = union(
			translate([x, L.axle / 2], square(w, L.axle)),
			translate([x, L.axle], rrect(w, w, w / 2 - 0.01, 32))
		);
		// A washer on each cheek's inner face, as wide as the inner race: the cheeks
		// touch only the ring that turns with the bolt, never the seal or the outer one.
		const washer = b.bore / 2 + 0.27 * ((b.outer - b.bore) / 2);
		const stand = Math.max(0, p.clearance - 0.15);
		for (const side of [-1, 1]) {
			const y = side * (gap / 2 + CHEEK / 2);
			pieces.push(translate([0, y + CHEEK / 2, 0], rotate([90, 0, 0], extrude(CHEEK, profile))));
			if (stand > 0)
				pieces.push(
					translate(
						[x, side * (gap / 2 - stand / 2), L.axle],
						rotate([90, 0, 0], cylinder(stand + 0.02, washer, washer, 32, true))
					)
				);
		}
		// The bolt through both cheeks and the bearing between them.
		const bolt = b.bore / 2 + p.clearance / 2;
		holes.push(
			translate(
				[x, -L.width / 2 - 1, L.axle],
				rotate([-90, 0, 0], cylinder(L.width + 2, bolt, bolt, 32))
			)
		);
		// Room for the bearing to turn: the plate gives way under its race.
		holes.push(
			translate(
				[x, 0, L.axle],
				rotate([90, 0, 0], cylinder(gap - 2 * stand, r + 1.5, r + 1.5, 48, true))
			)
		);
	}
	return difference(union(...pieces), ...holes);
}

export function spoolHolderModel(input: SpoolHolderParams): Node {
	const p = clampSpoolHolder(input);
	const L = spoolHolderLayout(p);
	const one = cradle(p, L);
	if (p.count === 1) return part('cradle', one);
	const dy = Math.max(L.width, 30) + 10;
	return union(
		part('cradle', translate([0, -dy / 2, 0], one)),
		part('cradle2', translate([0, dy / 2, 0], one))
	);
}

const mm = (v: number) => num(Math.round(v * 10) / 10, 1);

export function spoolHolderSummary(input: SpoolHolderParams): string {
	const p = clampSpoolHolder(input);
	const L = spoolHolderLayout(p);
	const b = BEARINGS[p.bearing];
	const bearings = p.count * 2;
	const what = m.t_spool_holder_summary({
		count: bearings,
		n: num(bearings),
		spool: mm(p.spool),
		bearing: p.bearing,
		outer: b.outer,
		bore: b.bore,
		width: b.width,
		spacing: mm(L.spacing)
	});
	const cradles =
		p.count === 1 ? m.t_spool_holder_summary_one_cradle() : m.t_spool_holder_summary_two_cradles();
	return `${what}${sentenceGap(currentLocale())}${cradles}`;
}

export function spoolHolderHeader(input: SpoolHolderParams): string[] {
	const p = clampSpoolHolder(input);
	return [m.t_spool_holder_header_title(), spoolHolderSummary(p), m.t_spool_holder_header_print()];
}

export function spoolHolderScad(p: SpoolHolderParams): string {
	return toScad(spoolHolderModel(p), spoolHolderHeader(p));
}
