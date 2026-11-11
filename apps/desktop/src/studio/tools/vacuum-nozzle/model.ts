/**
 * «Насадки для пылесоса»: a crevice tool, a wide or a round nozzle on a
 * socket that slides over the vacuum's tube — 32 mm (most of them) or 35 mm,
 * or your own. The socket is slightly conical, as the tubes are, so it holds
 * by friction. Printed standing on the socket: the walls narrow or widen at
 * no more than 45°, the tip open at the top, cut square or slanted.
 */
import {
	circle,
	cube,
	difference,
	loft,
	part,
	rotate,
	rrect,
	toScad,
	translate,
	type Node
} from '../csg/csg';
import { num as fmt } from '$lib/i18n/current';
import * as m from '$msg/tools/vacuum-nozzle';
import { clamp } from '../shared/math';

export type NozzleKind = 'crevice' | 'wide' | 'round';

export interface NozzleParams {
	kind: NozzleKind;
	/** Outside of the vacuum's tube, mm */
	tube: number;
	/** Opening at the tip, mm (round: its diameter is the width) */
	tipWidth: number;
	tipHeight: number;
	/** From the socket to the tip, and the straight tip, mm */
	length: number;
	tipLength: number;
	wall: number;
	/** Slant of the tip's cut, degrees (0: square) */
	slant: number;
}

export const NOZZLE_DEFAULTS: NozzleParams = {
	kind: 'crevice',
	tube: 32,
	tipWidth: 28,
	tipHeight: 8,
	length: 110,
	tipLength: 40,
	wall: 2,
	slant: 30
};

export const NOZZLE_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<NozzleParams>;
}[] = [
	{
		id: 'crevice',
		get label() {
			return m.t_vacuum_nozzle_kind_crevice();
		},
		params: { kind: 'crevice' }
	},
	{
		id: 'long',
		get label() {
			return m.t_vacuum_nozzle_preset_long();
		},
		params: { kind: 'crevice', tipWidth: 20, tipHeight: 6, length: 160, tipLength: 80 }
	},
	{
		id: 'wide',
		get label() {
			return m.t_vacuum_nozzle_kind_wide();
		},
		params: { kind: 'wide', tipWidth: 110, tipHeight: 12, length: 70, tipLength: 15, slant: 0 }
	},
	{
		id: 'round',
		get label() {
			return m.t_vacuum_nozzle_preset_round();
		},
		params: { kind: 'round', tipWidth: 14, length: 70, tipLength: 50, slant: 0 }
	},
	{
		id: 'tube35',
		get label() {
			return m.t_vacuum_nozzle_preset_tube35();
		},
		params: { kind: 'crevice', tube: 35 }
	}
];

/** Socket: as deep as this, wider at the mouth by this, narrower at the bottom by this, mm. */
const SOCKET = { depth: 40, mouth: 0.4, taper: 0.6 };

export function clampNozzle(p: NozzleParams): NozzleParams {
	const kind = (['crevice', 'wide', 'round'] as const).includes(p.kind) ? p.kind : 'crevice';
	const tube = clamp(p.tube, 15, 60);
	const tipWidth = clamp(p.tipWidth, 6, 200);
	const tipHeight = kind === 'round' ? tipWidth : clamp(p.tipHeight, 3, 60);
	// The walls may widen or narrow at 45° at most.
	const spread = Math.max(tipWidth, tipHeight, tube) / 2 - Math.min(tipWidth, tipHeight, tube) / 2;
	return {
		kind,
		tube,
		tipWidth,
		tipHeight,
		length: clamp(p.length, Math.max(20, spread + 5), 300),
		tipLength: clamp(p.tipLength, 0, 200),
		wall: clamp(p.wall, 1.2, 4),
		slant: kind === 'wide' ? 0 : clamp(p.slant, 0, 60)
	};
}

function mouth(p: NozzleParams, grow: number): Node {
	if (p.kind === 'round') return circle(p.tipWidth / 2 + grow, 64);
	const r = Math.min(p.tipHeight / 2, 3) + grow;
	return rrect(p.tipWidth + 2 * grow, p.tipHeight + 2 * grow, r, 48);
}

export function nozzleModel(input: NozzleParams): Node {
	const p = clampNozzle(input);
	const w = p.wall;
	const rIn = p.tube / 2 + SOCKET.mouth / 2;
	const rDeep = p.tube / 2 - SOCKET.taper / 2;
	const rOut = rIn + w;
	const zT = SOCKET.depth + p.length;
	const top = zT + p.tipLength;
	const outer = loft([
		{ z: 0, shape: circle(rOut, 96) },
		{ z: SOCKET.depth, shape: circle(rOut, 96) },
		{ z: zT, shape: mouth(p, w) },
		{ z: top, shape: mouth(p, w) }
	]);
	const inner = loft([
		{ z: -1, shape: circle(rIn, 96) },
		{ z: 0, shape: circle(rIn, 96) },
		{ z: SOCKET.depth, shape: circle(rDeep, 96) },
		{ z: zT, shape: mouth(p, 0) },
		{ z: top + 1, shape: mouth(p, 0) }
	]);
	const cuts: Node[] = [inner];
	if (p.slant > 0) {
		// Across the thin side: the tip reaches into corners.
		const big = Math.max(p.tipWidth, p.tipHeight) * 4 + 50;
		const t = Math.tan((p.slant * Math.PI) / 180);
		const drop = Math.min(p.tipLength * 0.9, (p.tipHeight + 2 * w) * t);
		cuts.push(
			translate(
				[0, -(p.tipHeight / 2 + w), top - drop],
				rotate([p.slant, 0, 0], translate([-big / 2, 0, 0], cube([big, big, big])))
			)
		);
	}
	return part('nozzle', difference(outer, ...cuts));
}

const mm = (v: number) => fmt(Math.round(v * 10) / 10, 1);

export function nozzleSummary(input: NozzleParams): string {
	const p = clampNozzle(input);
	const tube = mm(p.tube);
	const length = mm(SOCKET.depth + p.length + p.tipLength);
	return p.kind === 'round'
		? m.t_vacuum_nozzle_summary_round({ tube, tip: mm(p.tipWidth), length })
		: m.t_vacuum_nozzle_summary_flat({ tube, w: mm(p.tipWidth), h: mm(p.tipHeight), length });
}

export function nozzleHeader(input: NozzleParams): string[] {
	return [m.t_vacuum_nozzle_scad_title(), nozzleSummary(input), m.t_vacuum_nozzle_scad_print()];
}

export function nozzleScad(p: NozzleParams): string {
	return toScad(nozzleModel(p), nozzleHeader(p));
}
