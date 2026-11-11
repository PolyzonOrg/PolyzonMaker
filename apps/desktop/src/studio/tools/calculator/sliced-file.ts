/**
 * Print time and filament from a sliced file, read in the browser:
 *
 * - .gcode (.g, .gc, .gco): the slicer's comments — read from the head and
 *   the tail only, where slicers put them, so a 100 MB file is not loaded;
 * - .3mf: a ZIP (shared/zip-read). Bambu Studio and OrcaSlicer write
 *   Metadata/slice_info.config (time and grams per plate and filament) and
 *   Metadata/plate_N.gcode;
 * - .bgcode (PrusaSlicer binary G-code): the metadata blocks before the
 *   G-code (stored or deflated; heatshrink-packed blocks are skipped).
 */
import {
	MetaReader,
	readSlicerMeta,
	type FilamentUse,
	type SlicerMeta
} from '../gcode-viewer/slicer-meta';
import { filamentGrams, parseGcode } from '../gcode-viewer/parse';
import {
	collect,
	decompressed,
	u16,
	u32,
	zipEntries,
	zipRead,
	type ByteSource
} from '../shared/zip-read';
import * as m from '$msg/tools/calculator';

export { blobSource, bytesSource, zipEntries, zipRead, type ByteSource } from '../shared/zip-read';

// ---------- results ----------

export interface PlateSummary {
	index: number;
	timeSec: number | null;
	grams: number | null;
	filaments: FilamentUse[];
}

export interface SlicedSummary extends SlicerMeta {
	kind: 'gcode' | '3mf' | 'bgcode';
	/** Grams computed from the length (the slicer wrote no weight). */
	gramsEstimated: boolean;
	/** Time and length worked out from the moves themselves (the file has no slicer notes). */
	fromMoves: boolean;
	/** Bambu/Orca projects: one entry per sliced plate. */
	plates: PlateSummary[];
}

const attrs = (tag: string) => {
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]] = m[2];
	return out;
};
const numOrNull = (v: string | undefined) => {
	const n = v === undefined ? NaN : Number(v);
	return Number.isFinite(n) ? n : null;
};

/** Bambu Studio / OrcaSlicer Metadata/slice_info.config → plates. */
export function parseSliceInfo(xml: string): PlateSummary[] {
	const plates: PlateSummary[] = [];
	for (const m of xml.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
		const body = m[1];
		const meta: Record<string, string> = {};
		for (const t of body.matchAll(/<metadata\s[^>]*>/g)) {
			const a = attrs(t[0]);
			if (a.key) meta[a.key] = a.value ?? '';
		}
		const filaments: FilamentUse[] = [];
		for (const t of body.matchAll(/<filament\s[^>]*>/g)) {
			const a = attrs(t[0]);
			const grams = numOrNull(a.used_g);
			const meters = numOrNull(a.used_m);
			if (!grams && !meters) continue;
			filaments.push({
				grams,
				mm: meters === null ? null : meters * 1000,
				type: a.type || null,
				color: /^#[0-9a-f]{6}/i.test(a.color ?? '') ? a.color.slice(0, 7) : null
			});
		}
		plates.push({
			index: numOrNull(meta.index) ?? plates.length + 1,
			timeSec: numOrNull(meta.prediction),
			grams: numOrNull(meta.weight) ?? (filaments.reduce((s, f) => s + (f.grams ?? 0), 0) || null),
			filaments
		});
	}
	return plates;
}

/** Filaments of all plates: the same colour and material summed. */
export function mergeFilaments(list: readonly FilamentUse[]): FilamentUse[] {
	const out: FilamentUse[] = [];
	const add = (a: number | null, b: number | null) =>
		a === null && b === null ? null : (a ?? 0) + (b ?? 0);
	for (const f of list) {
		const same = out.find((x) => x.color === f.color && x.type === f.type);
		if (same) {
			same.grams = add(same.grams, f.grams);
			same.mm = add(same.mm, f.mm);
		} else out.push({ ...f });
	}
	return out;
}

const HEAD = 1 << 20;
const TAIL = 2 << 20;

/** Only where slicers write their summary: the first 1 MB and the last 2 MB. */
async function gcodeText(src: ByteSource): Promise<string> {
	const decoder = new TextDecoder();
	if (src.size <= HEAD + TAIL) return decoder.decode(await src.read(0, src.size));
	const head = decoder.decode(await src.read(0, HEAD));
	const tail = decoder.decode(await src.read(src.size - TAIL, TAIL));
	return `${head}\n${tail}`;
}

function edges(text: string): string {
	return text.length <= HEAD + TAIL ? text : `${text.slice(0, HEAD)}\n${text.slice(-TAIL)}`;
}

async function read3mf(src: ByteSource): Promise<{ meta: SlicerMeta; plates: PlateSummary[] }> {
	const entries = await zipEntries(src);
	const find = (re: RegExp) => entries.find((e) => re.test(e.name));
	const reader = new MetaReader();
	const model = find(/^3D\/3dmodel\.model$/i);
	if (model) {
		// The application name is in the first lines of the model; the mesh is not needed.
		const head = new TextDecoder().decode(await zipRead(src, model, 16_384));
		const app = /<metadata name="Application">([^<]+)</i.exec(head);
		if (app) reader.setSlicer(app[1]);
	}
	const info = find(/^Metadata\/slice_info\.config$/i);
	const plates = info ? parseSliceInfo(new TextDecoder().decode(await zipRead(src, info))) : [];
	const gcodes = entries.filter((e) => /^Metadata\/plate_\d+\.gcode$/i.test(e.name));
	if (!plates.length && !gcodes.length) {
		throw new Error(m.t_calculator_file_no_slicing());
	}
	let meta = reader.result();
	if (!plates.length) {
		// Only the plate G-code: read its comments like a .gcode file.
		for (const g of gcodes) {
			const text = edges(new TextDecoder().decode(await zipRead(src, g)));
			readSlicerMeta(text, reader);
		}
		meta = reader.result();
	}
	return { meta, plates };
}

async function readBgcode(src: ByteSource): Promise<SlicerMeta> {
	const head = await src.read(0, 10);
	if (new TextDecoder().decode(head.subarray(0, 4)) !== 'GCDE') {
		throw new Error(m.t_calculator_file_bgcode_broken());
	}
	const checksum = u16(head, 8) === 1 ? 4 : 0;
	const reader = new MetaReader();
	reader.setSlicer('PrusaSlicer');
	let pos = 10;
	while (pos + 8 <= src.size) {
		const h = await src.read(pos, 12);
		const type = u16(h, 0);
		const compression = u16(h, 2);
		const size = u32(h, 4);
		const stored = compression ? u32(h, 8) : size;
		const dataStart = pos + (compression ? 12 : 8) + (type === 5 ? 6 : 2);
		// Metadata blocks come first; the G-code itself is not needed.
		if (type === 1) break;
		if (type <= 4 && (compression === 0 || compression === 1) && stored < 4 << 20) {
			const raw = await src.read(dataStart, stored);
			const data = compression ? await collect(decompressed(raw, 'deflate')) : raw;
			for (const line of new TextDecoder().decode(data).split('\n')) reader.line(line);
		}
		pos = dataStart + stored + checksum;
	}
	return reader.result();
}

export async function readSlicedFile(name: string, src: ByteSource): Promise<SlicedSummary> {
	const ext = name.toLowerCase().split('.').pop() ?? '';
	let kind: SlicedSummary['kind'];
	let meta: SlicerMeta;
	let plates: PlateSummary[] = [];
	let fromMoves = false;
	if (ext === '3mf') {
		kind = '3mf';
		({ meta, plates } = await read3mf(src));
	} else if (ext === 'bgcode') {
		kind = 'bgcode';
		meta = await readBgcode(src);
	} else {
		kind = 'gcode';
		const text = await gcodeText(src);
		meta = readSlicerMeta(text);
		// No notes from a slicer (a calibration file, a hand-made one): the moves tell it.
		if (meta.timeSec === null && meta.grams === null && !meta.mm && src.size <= 60_000_000) {
			const whole =
				src.size <= HEAD + TAIL ? text : new TextDecoder().decode(await src.read(0, src.size));
			const tp = parseGcode(whole);
			if (tp.filamentMm > 0) {
				meta = { ...meta, timeSec: tp.estimatedSec || null, mm: tp.filamentMm };
				fromMoves = true;
			}
		}
	}
	if (plates.length) {
		// The whole project: every sliced plate together.
		const sum = (pick: (p: PlateSummary) => number | null) =>
			plates.some((p) => pick(p) !== null) ? plates.reduce((s, p) => s + (pick(p) ?? 0), 0) : null;
		// Every plate's colours, not one plate's or none.
		const colours = mergeFilaments(plates.flatMap((p) => p.filaments));
		meta = {
			...meta,
			timeSec: sum((p) => p.timeSec),
			grams: sum((p) => p.grams),
			filaments: colours.length ? colours : meta.filaments
		};
	}
	let gramsEstimated = false;
	if (meta.grams === null && meta.mm) {
		meta = { ...meta, grams: filamentGrams(meta.mm, meta.diameter ?? 1.75, meta.density ?? 1.24) };
		gramsEstimated = true;
	}
	if (meta.timeSec === null && meta.grams === null) {
		throw new Error(m.t_calculator_file_no_data());
	}
	return { ...meta, kind, gramsEstimated, fromMoves, plates };
}
