/**
 * A jar with a screw-on lid. The thread has 45° flanks, so the neck and the
 * lid both print upright without supports; two starts close in half a turn.
 * The jar stands on its bottom, the lid lies on its top — as they print.
 */
import {
	circle,
	cylinder,
	difference,
	extrude,
	part,
	rotate,
	toScad,
	translate,
	union,
	type Node
} from '../csg/csg';
import { num } from '$lib/i18n/current';
import * as m from '$msg/tools/jar-generator';
import { threadDepth, threadedRod, type Thread } from '../shared/thread';
import { clamp as c } from '../shared/math';

export type JarKind = 'both' | 'jar' | 'lid';

export interface JarParams {
	kind: JarKind;
	/** Inside diameter of the jar, mm */
	inner: number;
	/** Height of the jar without the lid, mm */
	height: number;
	wall: number;
	bottom: number;
	/** Thread pitch, mm */
	pitch: number;
	starts: 1 | 2;
	/** Turns of thread on the neck */
	turns: number;
	/** Radial play between the jar's and the lid's thread, mm */
	clearance: number;
	lidTop: number;
	lidWall: number;
	/** Ribs round the lid for grip. */
	ribs: boolean;
}

export const JAR_DEFAULTS: JarParams = {
	kind: 'both',
	inner: 60,
	height: 70,
	wall: 2,
	bottom: 2,
	pitch: 4,
	starts: 2,
	turns: 1.5,
	clearance: 0.4,
	lidTop: 2.4,
	lidWall: 2,
	ribs: true
};

export interface JarPreset {
	id: string;
	label: string;
	params: Partial<JarParams>;
}

export const JAR_PRESETS: readonly JarPreset[] = [
	{
		id: 'spice',
		get label() {
			return m.t_jar_generator_preset_spice();
		},
		params: { inner: 40, height: 60, pitch: 3, turns: 1.5 }
	},
	{
		id: 'screws',
		get label() {
			return m.t_jar_generator_preset_screws();
		},
		params: { inner: 60, height: 50 }
	},
	{
		id: 'big',
		get label() {
			return m.t_jar_generator_preset_big();
		},
		params: { inner: 90, height: 110, wall: 2.4, pitch: 5 }
	},
	{
		id: 'pills',
		get label() {
			return m.t_jar_generator_preset_pills();
		},
		params: { inner: 30, height: 40, wall: 1.6, pitch: 2.5, turns: 2 }
	}
];

export function clampJar(p: JarParams): JarParams {
	const pitch = c(p.pitch, 1.5, 10);
	const starts = p.starts === 1 ? 1 : 2;
	const turns = c(p.turns, 1, 5);
	const bottom = c(p.bottom, 0.8, 8);
	const lidWall = c(p.lidWall, 1.2, 6);
	const clearance = c(p.clearance, 0, 1.5);
	// The neck is narrower than the body by the lid's wall, the play and the thread.
	const step = lidWall + clearance + 0.4 * pitch;
	const inner = c(p.inner, 2 * step + 10, 250);
	const neck = turns * pitch * starts;
	return {
		kind: p.kind === 'jar' || p.kind === 'lid' ? p.kind : 'both',
		inner,
		// Room for the floor, the 45° shoulder inside and the neck.
		height: c(p.height, neck + bottom + step + 4, 400),
		wall: c(p.wall, 1.2, 6),
		bottom,
		pitch,
		starts,
		turns,
		clearance,
		lidTop: c(p.lidTop, 1.2, 8),
		lidWall,
		ribs: !!p.ribs
	};
}

export interface JarLayout {
	thread: Thread;
	/** Height of the threaded neck, mm */
	neck: number;
	/** The opening of the neck and the 45° shoulder inside down to the body, mm */
	opening: number;
	shoulder: number;
	/** Outside diameter of the jar and of the lid: flush when closed, mm */
	jarOuter: number;
	lidOuter: number;
	lidHeight: number;
	/** Capacity up to the neck, ml */
	volume: number;
}

export function jarLayout(input: JarParams): JarLayout {
	const p = clampJar(input);
	const probe: Thread = { major: 0, pitch: p.pitch, starts: p.starts, profile: 'jar' };
	const depth = threadDepth(probe);
	// Closed, the lid is flush with the body: the thread sits inside the lid's wall.
	const jarOuter = p.inner + 2 * p.wall;
	const major = jarOuter - 2 * (p.lidWall + p.clearance);
	const thread: Thread = { ...probe, major };
	const opening = major - 2 * depth - 2 * p.wall;
	const shoulder = (p.inner - opening) / 2;
	const neck = p.turns * p.pitch * p.starts;
	const body = p.height - neck;
	const R = p.inner / 2;
	const r = opening / 2;
	const mm3 =
		Math.PI * R * R * (body - shoulder - p.bottom) +
		((Math.PI * shoulder) / 3) * (R * R + R * r + r * r) +
		Math.PI * r * r * neck;
	return {
		thread,
		neck,
		opening,
		shoulder,
		jarOuter,
		lidOuter: jarOuter,
		lidHeight: p.lidTop + neck - 0.3,
		volume: mm3 / 1000
	};
}

const FN = 96;

function jar(p: JarParams, L: JarLayout): Node {
	const body = p.height - L.neck;
	const r = L.jarOuter / 2;
	return difference(
		union(
			// Chamfer at the bed against the elephant's foot.
			cylinder(0.6, r - 0.6, r, FN),
			translate([0, 0, 0.59], cylinder(body - 0.59, r, r, FN)),
			translate([0, 0, body - 0.01], threadedRod(L.thread, L.neck + 0.01, { chamferTop: true }))
		),
		// Inside: the body, a 45° shoulder (no supports), the opening of the neck.
		translate(
			[0, 0, p.bottom],
			cylinder(body - L.shoulder - p.bottom + 0.01, p.inner / 2, p.inner / 2, FN)
		),
		translate([0, 0, body - L.shoulder], cylinder(L.shoulder, p.inner / 2, L.opening / 2, FN)),
		translate([0, 0, body - 0.01], cylinder(L.neck + 1, L.opening / 2, L.opening / 2, FN))
	);
}

/** The lid, top down on the bed: a cup with the thread inside. */
function lid(p: JarParams, L: JarLayout): Node {
	const R = L.lidOuter / 2;
	const ribs = Math.max(12, Math.round((Math.PI * L.lidOuter) / 4));
	// Rounded ribs every ~4 mm stand out of the rim: the wall over the thread stays whole.
	const outline = p.ribs
		? union(
				circle(R, FN),
				...Array.from({ length: ribs }, (_, i) => {
					const a = (2 * Math.PI * i) / ribs;
					return translate([R * Math.cos(a), R * Math.sin(a)], circle(0.9, 12));
				})
			)
		: circle(R, FN);
	const depth = L.lidHeight - p.lidTop;
	const mouth = threadDepth(L.thread) + p.clearance;
	return difference(
		extrude(L.lidHeight, outline),
		translate(
			[0, 0, p.lidTop],
			union(
				threadedRod(L.thread, depth + 0.01, { grow: p.clearance }),
				// The mouth opens at 45°, so the jar finds the thread. Turned half a
				// step: its edges on the thread's own met them in edges of four faces.
				translate(
					[0, 0, depth - mouth + 0.01],
					rotate(
						[0, 0, 180 / FN],
						cylinder(
							mouth,
							L.thread.major / 2 + p.clearance - mouth,
							L.thread.major / 2 + p.clearance + 0.01,
							FN
						)
					)
				)
			)
		)
	);
}

export function jarModel(input: JarParams): Node {
	const p = clampJar(input);
	const L = jarLayout(p);
	if (p.kind === 'jar') return part('jar', jar(p, L));
	if (p.kind === 'lid') return part('lid', lid(p, L));
	const gap = L.jarOuter / 2 + L.lidOuter / 2 + 8;
	return union(
		part('jar', translate([-gap / 2, 0, 0], jar(p, L))),
		part('lid', translate([gap / 2, 0, 0], lid(p, L)))
	);
}

const mm = (v: number) => num(v, 4);

export function jarHeader(input: JarParams): string[] {
	const p = clampJar(input);
	const L = jarLayout(p);
	return [
		m.t_jar_generator_header_title({
			inner: mm(p.inner),
			height: mm(p.height),
			volume: num(Math.round(L.volume), 0)
		}),
		m.t_jar_generator_header_thread({
			major: mm(L.thread.major),
			pitch: mm(p.pitch),
			starts: p.starts,
			turns: mm(p.turns),
			clearance: mm(p.clearance)
		}),
		m.t_jar_generator_header_print()
	];
}

export function jarScad(p: JarParams): string {
	return toScad(jarModel(p), jarHeader(p));
}

/** One line under the form. */
export function jarSummary(input: JarParams): string {
	const p = clampJar(input);
	const L = jarLayout(p);
	// «1,5 оборота», but «1 оборот», «5 оборотов»: fractions take the plural's «other».
	return m.t_jar_generator_summary({
		volume: num(Math.round(L.volume), 0),
		jar: mm(L.jarOuter),
		lid: mm(L.lidOuter),
		lidHeight: mm(L.lidHeight),
		turns: m.t_jar_generator_summary_turns({ count: p.turns, n: mm(p.turns) })
	});
}
