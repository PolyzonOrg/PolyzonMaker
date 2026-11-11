/**
 * «Правка G-code»: commands inserted at chosen layers of a sliced file
 * (a colour change or a pause, the temperature, the fan, speed or flow from
 * that layer on), and a print that failed continued from a measured height.
 * Works on the text: layers are found by the slicers' layer comments
 * (PrusaSlicer/Orca ;LAYER_CHANGE, Cura ;LAYER:n, Bambu ; CHANGE_LAYER,
 * Simplify3D ; layer n, Z = …) or, without them, by the moves up in Z.
 * Nothing else in the file is touched. Pure; the page reads and saves files.
 */
import * as msg from '$msg/tools/gcode-edit';

export type Firmware = 'marlin' | 'prusa' | 'klipper' | 'bambu';
export type InsertKind = 'colour' | 'pause' | 'temp' | 'fan' | 'speed' | 'flow' | 'custom';

export interface Layer {
	/** Offset of the layer's first line in the text */
	at: number;
	/** Z of the layer, mm */
	z: number;
}

export interface LayerIndex {
	layers: Layer[];
	/** What the file looks like it was sliced for */
	firmware: Firmware;
	/** Name of the slicer, when it wrote one */
	slicer: string | null;
}

const MARKER = /^;\s*(LAYER_CHANGE|LAYER:-?\d|CHANGE_LAYER|layer \d+, z)/i;

/** Every layer's start and Z. */
export function indexLayers(text: string): LayerIndex {
	const layers: Layer[] = [];
	const marked = /^;\s*(LAYER_CHANGE|LAYER:-?\d|CHANGE_LAYER|layer \d+, z)/im.test(text);
	let z = 0;
	let pending: number | null = null;
	let lastZ = -1;
	let pos = 0;
	while (pos < text.length) {
		let end = text.indexOf('\n', pos);
		if (end < 0) end = text.length;
		const line = text.slice(pos, end).trim();
		if (marked) {
			if (MARKER.test(line)) {
				pending = pos;
			} else if (pending !== null) {
				// The layer's Z: Prusa/Orca write ;Z:, Bambu ; Z_HEIGHT:, S3D «Z = …», the others move there.
				const zc =
					/^;\s*Z(?:_HEIGHT)?:\s*([-\d.]+)/i.exec(line) ?? /^;.*\bZ\s*=\s*([-\d.]+)/i.exec(line);
				const move = /^G[01]\b[^;]*\bZ([-\d.]+)/i.exec(line);
				const found = zc?.[1] ?? move?.[1];
				if (found !== undefined) {
					layers.push({ at: pending, z: Number(found) });
					pending = null;
				} else if (/^G[0-3]\b/i.test(line)) {
					// Moving without a Z: the layer is at the current height.
					layers.push({ at: pending, z });
					pending = null;
				}
			}
			const move = /^G[01]\b[^;]*\bZ([-\d.]+)/i.exec(line);
			if (move) z = Number(move[1]);
		} else {
			// No layer comments: a move up starts a layer once something is extruded there.
			const move = /^G[01]\b[^;]*\bZ([-\d.]+)/i.exec(line);
			if (move) {
				const nz = Number(move[1]);
				if (nz > z + 1e-6) pending = pos;
				z = nz;
			}
			if (pending !== null && /^G[123]\b[^;]*\bE[\d.]/i.test(line)) {
				if (z > lastZ + 1e-6) {
					layers.push({ at: pending, z });
					lastZ = z;
				}
				pending = null;
			}
		}
		pos = end + 1;
	}
	return { layers, firmware: firmwareOf(text), slicer: slicerOf(text) };
}

export function slicerOf(text: string): string | null {
	const head = text.slice(0, 4000) + text.slice(-20000);
	const m =
		/(BambuStudio|OrcaSlicer|PrusaSlicer|SuperSlicer|Cura_SteamEngine|Simplify3D|IdeaMaker|Creality Print|ElegooSlicer|Anycubic Slicer)/i.exec(
			head
		);
	return m ? m[1].replace('Cura_SteamEngine', 'Cura') : null;
}

export function firmwareOf(text: string): Firmware {
	const head = text.slice(0, 200_000);
	if (/BambuStudio|; BambuStudio/i.test(head)) return 'bambu';
	if (/\bPRINT_START\b|\bSTART_PRINT\b|\bEXCLUDE_OBJECT_DEFINE\b|\bBED_MESH_CALIBRATE\b/.test(head))
		return 'klipper';
	// A Prusa printer's profile checks the model (M862); PrusaSlicer also slices for stock Marlin.
	if (/\bM862\.[13]\b/.test(head)) return 'prusa';
	return 'marlin';
}

export interface Insert {
	kind: InsertKind;
	/** 1-based layer number */
	layer: number;
	/** Temperature °C, fan %, speed %, flow % */
	value: number;
	/** Custom commands, one per line */
	code: string;
}

/** The commands of an insert for a firmware. */
export function commandsOf(ins: Insert, fw: Firmware): string[] {
	const v = Math.round(ins.value);
	// An emptied field is no value: no command (M104 S0 would cool the nozzle mid-print).
	const raw = ins.value as number | null | undefined;
	if (['temp', 'fan', 'speed', 'flow'].includes(ins.kind) && (raw == null || !Number.isFinite(raw)))
		return [];
	if (ins.kind === 'temp' && v < 150) return [];
	switch (ins.kind) {
		case 'colour':
			return fw === 'bambu'
				? [`M400 U1 ; ${msg.t_gcode_edit_gcode_colour_pause()}`]
				: [`M600 ; ${msg.t_gcode_edit_gcode_colour()}`];
		case 'pause':
			if (fw === 'klipper') return ['PAUSE'];
			if (fw === 'prusa') return ['M601'];
			if (fw === 'bambu') return ['M400 U1'];
			return [`M0 ${msg.t_gcode_edit_gcode_press_to_continue()}`];
		case 'temp':
			return [`M104 S${Math.max(0, Math.min(320, v))}`];
		case 'fan':
			return [`M106 S${Math.round((Math.max(0, Math.min(100, v)) / 100) * 255)}`];
		case 'speed':
			return [`M220 S${Math.max(10, Math.min(500, v))}`];
		case 'flow':
			return [`M221 S${Math.max(50, Math.min(150, v))}`];
		default:
			return safeLines(ins.code);
	}
}

/** Custom lines: printable text only, at most 20 lines of 120 characters. */
export function safeLines(code: string): string[] {
	return String(code ?? '')
		.split(/\r?\n/)
		.map((l) =>
			l
				.replace(/[^\x20-\x7E\u0400-\u04FF°]/g, '')
				.slice(0, 120)
				.trim()
		)
		.filter(Boolean)
		.slice(0, 20);
}

export interface Edited {
	text: string;
	/** What went where, for the summary */
	placed: { layer: number; z: number; lines: string[] }[];
}

/** The text with every insert just before the first line of its layer. */
export function applyInserts(
	text: string,
	index: LayerIndex,
	inserts: readonly Insert[],
	fw: Firmware
): Edited {
	const valid = inserts
		.map((i) => ({ ...i, layer: Math.round(i.layer) }))
		.filter((i) => i.layer >= 1 && i.layer <= index.layers.length)
		.map((i) => ({ ...i, lines: commandsOf(i, fw) }))
		.filter((i) => i.lines.length)
		.sort((a, b) => a.layer - b.layer);
	const placed: Edited['placed'] = [];
	const parts: string[] = [];
	let from = 0;
	for (const ins of valid) {
		const layer = index.layers[ins.layer - 1];
		parts.push(text.slice(from, layer.at));
		const block =
			[
				`; ${msg.t_gcode_edit_gcode_insert({ layer: String(ins.layer), z: String(layer.z) })}`,
				...ins.lines
			].join('\n') + '\n';
		parts.push(block);
		placed.push({ layer: ins.layer, z: layer.z, lines: ins.lines });
		from = layer.at;
	}
	parts.push(text.slice(from));
	return { text: parts.join(''), placed };
}

export interface ResumeState {
	nozzle: number;
	bed: number;
	fan: number;
	/** Extruder position before the layer, when the file uses absolute E */
	e: number | null;
	relativeE: boolean;
}

/** Temperatures, fan and extruder state the print had just before `at`. */
export function stateBefore(text: string, at: number): ResumeState {
	const head = text.slice(0, at);
	const last = (re: RegExp) => {
		let m: RegExpExecArray | null;
		let v: string | null = null;
		re.lastIndex = 0;
		while ((m = re.exec(head))) v = m[1];
		return v;
	};
	// S0 hands the heating to a start macro (Klipper PRINT_START): it is not the temperature.
	const nozzle = Number(last(/^M10[49]\b[^;\n]*\bS([1-9]\d*(?:\.\d+)?)/gim) ?? 200);
	const bed = Number(last(/^M1(?:40|90)\b[^;\n]*\bS([1-9]\d*(?:\.\d+)?)/gim) ?? 60);
	const fanRaw = last(/^M10[67]\b([^;\n]*)/gim);
	const fan =
		fanRaw === null ? 0 : /^\s*$/.test(fanRaw) ? 0 : Number(/S(\d+)/.exec(fanRaw)?.[1] ?? 255);
	const mode = last(/^(M8[23])\b/gim);
	const relativeE = mode === 'M83';
	const e = relativeE ? null : Number(last(/^G[0-3]\b[^;\n]*\bE(-?\d+(?:\.\d+)?)/gim) ?? 0);
	return { nozzle, bed, fan, e, relativeE };
}

export interface Resumed {
	text: string;
	layer: number;
	z: number;
}

/**
 * The print continued from the first layer above `height` (mm, measured on
 * the part). The nozzle is lowered onto the part's top by hand first; the
 * file heats up, tells the printer that this is Z = the part's top, lifts
 * 2 mm and only then homes X and Y (the nozzle never drags across the part);
 * fan and extruder as they were, then the rest of the file.
 * `temps`: the person's own, else the file's last ones before the layer.
 */
export function resumeFrom(
	text: string,
	index: LayerIndex,
	height: number,
	fw: Firmware,
	temps?: { nozzle: number; bed: number }
): Resumed | null {
	const i = index.layers.findIndex((l) => l.z > height + 0.02);
	if (i < 0) return null;
	const layer = index.layers[i];
	// The printer is told Z = the top of what is printed: the layer below the one we continue.
	const zNow = i > 0 ? index.layers[i - 1].z : 0;
	const s = { ...stateBefore(text, layer.at), ...temps };
	const set = fw === 'klipper' ? `SET_KINEMATIC_POSITION Z=${zNow}` : `G92 Z${zNow}`;
	const lines = [
		`; ${msg.t_gcode_edit_gcode_resume_title()}`,
		`; ${msg.t_gcode_edit_gcode_resume_from({ layer: String(i + 1), z: String(layer.z) })}`,
		`M140 S${s.bed}`,
		`M104 S${s.nozzle}`,
		`M190 S${s.bed}`,
		`M109 S${s.nozzle}`,
		`${set} ; ${msg.t_gcode_edit_gcode_nozzle_on_top()}`,
		'G91',
		`G1 Z2 F600 ; ${msg.t_gcode_edit_gcode_lift()}`,
		'G90',
		fw === 'klipper' ? 'G28 X Y' : `G28 X Y ; ${msg.t_gcode_edit_gcode_home_xy()}`,
		s.relativeE ? 'M83' : 'M82',
		s.relativeE ? 'G92 E0' : `G92 E${s.e ?? 0}`,
		s.fan > 0 ? `M106 S${s.fan}` : 'M107',
		''
	];
	return { text: lines.join('\n') + text.slice(layer.at), layer: i + 1, z: layer.z };
}
