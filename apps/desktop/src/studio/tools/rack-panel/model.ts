/**
 * «Панель для 10″ стойки»: a front panel for a 10-inch (254 mm) rack, 1 to
 * 4 units high (EIA-310: 1U = 44,45 mm, the panel 0,79 mm shorter), blank,
 * vented, or with keystone ports for network, USB or HDMI modules. Ears with
 * slotted holes on the rack's pitch; ribs behind keep a long panel straight.
 * Printed face down, ribs up, no supports.
 */
import {
	cube,
	difference,
	extrude,
	part,
	rrect,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/rack-panel';
import { clamp } from '../shared/math';

export type RackFill = 'blank' | 'vent' | 'keystone';

export interface RackPanelParams {
	units: number;
	fill: RackFill;
	/** Keystone ports in a row */
	ports: number;
	/** Rows of ports (2U and more) */
	portRows: number;
	thickness: number;
	ribs: boolean;
}

export const RACK_PANEL_DEFAULTS: RackPanelParams = {
	units: 1,
	fill: 'keystone',
	ports: 8,
	portRows: 1,
	thickness: 3,
	ribs: true
};

export const RACK_PANEL_PRESETS: readonly {
	id: string;
	label: string;
	params: Partial<RackPanelParams>;
}[] = [
	{
		id: 'patch',
		get label() {
			return m.t_rack_panel_preset_patch();
		},
		params: { units: 1, fill: 'keystone', ports: 10 }
	},
	{
		id: 'blank',
		get label() {
			return m.t_rack_panel_preset_blank();
		},
		params: { units: 1, fill: 'blank' }
	},
	{
		id: 'vent',
		get label() {
			return m.t_rack_panel_preset_vent();
		},
		params: { units: 2, fill: 'vent' }
	},
	{
		id: 'patch2',
		get label() {
			return m.t_rack_panel_preset_patch2();
		},
		params: { units: 2, fill: 'keystone', ports: 10, portRows: 2 }
	}
];

/** EIA-310 for 10-inch racks, mm. */
export const RACK = {
	unit: 44.45,
	/** Panel narrower than its units by this much. */
	gap: 0.79,
	width: 254,
	/** Between the hole centres left and right. */
	holeSpan: 236.5,
	/** Hole centres in each unit, from its bottom. */
	holes: [6.35, 22.225, 38.1],
	/** Slot for an M6 cage nut or a 10-32 screw. */
	slot: [10, 6.5],
	/** The rails behind the ears: nothing of the panel's back may reach into them. */
	rail: 17
} as const;

/** Keystone module window and the thickness its latch grips, mm. */
export const KEYSTONE = {
	window: [14.9, 19.4],
	/** Plate around the window, as the jacks expect (1,2–1,95 mm). */
	plate: 1.6,
	/** Pocket behind for the jack's body. */
	pocket: [18.5, 25]
} as const;

export function clampRackPanel(p: RackPanelParams): RackPanelParams {
	const units = Math.round(clamp(p.units, 1, 4));
	return {
		units,
		fill: (['blank', 'vent', 'keystone'] as const).includes(p.fill) ? p.fill : 'blank',
		ports: Math.round(clamp(p.ports, 1, 12)),
		portRows: Math.round(clamp(p.portRows, 1, Math.max(1, units))),
		thickness: clamp(p.thickness, 2.4, 6),
		ribs: !!p.ribs
	};
}

export interface RackLayout {
	height: number;
	/** Mounting slots (centres): x, y from the panel's bottom */
	slots: [number, number][];
	/** Keystone port centres */
	ports: [number, number][];
	/** Free width between the rails, mm */
	inner: number;
}

export function rackLayout(input: RackPanelParams): RackLayout {
	const p = clampRackPanel(input);
	const height = p.units * RACK.unit - RACK.gap;
	// In every unit the outer two holes; the middle one is left for the next panel's cage nut.
	const slots: [number, number][] = [];
	for (let u = 0; u < p.units; u++)
		for (const h of [RACK.holes[0], RACK.holes[2]])
			for (const x of [-RACK.holeSpan / 2, RACK.holeSpan / 2])
				slots.push([x, u * RACK.unit + h - RACK.gap / 2]);
	const inner = RACK.width - 2 * RACK.rail;
	const ports: [number, number][] = [];
	if (p.fill === 'keystone') {
		const pitch = Math.max(KEYSTONE.pocket[0] + 1.6, 20);
		const n = Math.min(p.ports, Math.floor((inner - 4) / pitch));
		const rows = p.portRows;
		const rowPitch = Math.min(height / rows, KEYSTONE.pocket[1] + 6);
		for (let r = 0; r < rows; r++)
			for (let i = 0; i < n; i++)
				ports.push([(i - (n - 1) / 2) * pitch, height / 2 + (r - (rows - 1) / 2) * rowPitch]);
	}
	return { height, slots, ports, inner };
}

const FN = 32;

export function rackPanelModel(input: RackPanelParams): Node {
	const p = clampRackPanel(input);
	const L = rackLayout(p);
	const T = p.thickness;
	const H = L.height;
	// Face down: the front on z = 0, the panel centred across, its bottom at y = 0.
	const body: Node[] = [translate([-RACK.width / 2, 0, 0], cube([RACK.width, H, T]))];
	const ribW = 2;
	const ribD = 10;
	const ribLen = L.inner - 4;
	if (p.ribs) {
		for (const y of [ribW / 2 + 1, H - ribW / 2 - 1])
			body.push(
				translate([-ribLen / 2, y - ribW / 2, T - 0.01], cube([ribLen, ribW, ribD + 0.01]))
			);
	}
	const cuts: Node[] = L.slots.map(([x, y]) =>
		translate([x, y, -1], extrude(T + 2, rrect(RACK.slot[0], RACK.slot[1], RACK.slot[1] / 2, FN)))
	);
	if (p.fill === 'vent') {
		// Upright slots across the face between the rails, 3 mm wide.
		const w = 3;
		const pitch = 7;
		const n = Math.floor((L.inner - 8) / pitch);
		const h = H - 14;
		for (let i = 0; i < n; i++)
			cuts.push(
				translate([(i - (n - 1) / 2) * pitch, H / 2, -1], extrude(T + 2, rrect(w, h, w / 2, FN)))
			);
	}
	for (const [x, y] of L.ports) {
		cuts.push(
			translate(
				[x - KEYSTONE.window[0] / 2, y - KEYSTONE.window[1] / 2, -1],
				cube([KEYSTONE.window[0], KEYSTONE.window[1], T + 2])
			)
		);
		if (T > KEYSTONE.plate)
			cuts.push(
				translate(
					[x - KEYSTONE.pocket[0] / 2, y - KEYSTONE.pocket[1] / 2, KEYSTONE.plate],
					cube([KEYSTONE.pocket[0], KEYSTONE.pocket[1], T])
				)
			);
	}
	return part('panel', difference(union(...body), ...cuts));
}

const mm = (v: number) => num(Math.round(v * 100) / 100, 2);

export function rackPanelSummary(input: RackPanelParams): string {
	const p = clampRackPanel(input);
	const L = rackLayout(p);
	const what =
		p.fill === 'keystone'
			? m.t_rack_panel_summary_ports({ count: L.ports.length, n: num(L.ports.length) })
			: p.fill === 'vent'
				? m.t_rack_panel_summary_vent()
				: m.t_rack_panel_summary_blank();
	return m.t_rack_panel_summary({
		units: p.units,
		width: mm(RACK.width),
		height: mm(L.height),
		what,
		slots: m.t_rack_panel_summary_slots({ count: L.slots.length, n: num(L.slots.length) })
	});
}

export function rackPanelHeader(input: RackPanelParams): string[] {
	const p = clampRackPanel(input);
	return [
		m.t_rack_panel_scad_title(),
		rackPanelSummary(p),
		p.ribs
			? m.t_rack_panel_scad_thickness_ribs({ thickness: mm(p.thickness) })
			: m.t_rack_panel_scad_thickness({ thickness: mm(p.thickness) })
	];
}

export function rackPanelScad(p: RackPanelParams): string {
	return toScad(rackPanelModel(p), rackPanelHeader(p));
}
