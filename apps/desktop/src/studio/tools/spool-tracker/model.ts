/**
 * «Учёт катушек»: a catalog of spools kept in this browser. The remaining
 * filament is never stored — it is the starting amount plus the movement log
 * (write-offs, refills, corrections after weighing), so the log is the truth.
 * Reservations hold grams for a running print: they lower what is available,
 * not what is on the spool; a finished print turns the reservation into a
 * write-off, a failed one drops it without a trace.
 *
 * Pure functions return a new book; load/save talk to localStorage. The
 * calculator and the G-code viewer read the same book, and sync.ts keeps it in
 * step with the account's copy. For that the book remembers removals: a
 * deleted spool or a finished reservation leaves its id and the time in
 * `removed`, so a merge with an older copy does not bring it back — unless the
 * spool was edited later than that (restored from a backup).
 */
import { newId, readStored, writeStored } from '../print-kit/format';
import * as msg from '$msg/tools/spool-tracker';

/** The plastics offered for a spool; the last one, «other», in the page's language. */
export function spoolMaterials(): string[] {
	return ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', msg.t_spool_tracker_material_other()];
}

export interface Spool {
	id: string;
	material: string;
	colorName: string;
	/** #rrggbb */
	color: string;
	brand: string;
	/** Net filament on a full spool, g (usually 1000). */
	netWeight: number;
	/** What the spool cost, ₽. */
	price: number;
	/** Filament on the spool when it was added, g. */
	initial: number;
	location: string;
	notes: string;
	createdAt: number;
	/** The last edit: of two copies of an edited spool the later one wins. */
	updatedAt?: number;
}

export type MovementKind = 'use' | 'refill' | 'adjust';
export type MovementSource = 'manual' | 'gcode' | 'reservation';

export interface Movement {
	id: string;
	spoolId: string;
	kind: MovementKind;
	/** Change of the remaining filament, g (negative for a write-off). */
	grams: number;
	/** Material cost of a write-off, ₽ (0 for other kinds). */
	cost: number;
	note: string;
	source: MovementSource;
	at: number;
}

export interface Reservation {
	id: string;
	spoolId: string;
	grams: number;
	note: string;
	at: number;
}

export interface SpoolBook {
	version: 1;
	spools: Spool[];
	movements: Movement[];
	reservations: Reservation[];
	/** Deleted spools and finished or cancelled reservations: id → when, ms. */
	removed: Record<string, number>;
}

/** Swatch of a new spool until the user picks one (filament data, not a UI colour). */
export const NEW_SPOOL_COLOR = '#ffffff';

export const SPOOL_STORAGE_KEY = 'polyzon:tools:spools:v1';

export function emptyBook(): SpoolBook {
	return { version: 1, spools: [], movements: [], reservations: [], removed: {} };
}

export interface SpoolInput {
	material: string;
	colorName: string;
	color: string;
	brand: string;
	netWeight: number;
	price: number;
	/** Only for a new spool: what is on it now (defaults to netWeight). */
	initial?: number;
	location: string;
	notes: string;
}

const COLOR = /^#[0-9a-f]{6}$/i;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const amount = (v: unknown, max = 1_000_000) => {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
};

function cleanSpool(input: SpoolInput): Omit<Spool, 'id' | 'createdAt' | 'initial'> {
	const netWeight = amount(input.netWeight, 100_000);
	if (netWeight <= 0) throw new Error(msg.t_spool_tracker_error_net_weight());
	return {
		material: text(input.material, 24) || 'PLA',
		colorName: text(input.colorName, 40),
		color: COLOR.test(input.color) ? input.color.toLowerCase() : '#9a9aa2',
		brand: text(input.brand, 60),
		netWeight,
		price: amount(input.price),
		location: text(input.location, 60),
		notes: text(input.notes, 500)
	};
}

export function spoolName(s: Pick<Spool, 'material' | 'colorName'>): string {
	return s.colorName ? `${s.material} ${s.colorName}` : s.material;
}

/** ₽ per gram: the spool price over its net weight. */
export function pricePerGram(s: Spool): number {
	return s.netWeight > 0 ? s.price / s.netWeight : 0;
}

export function remaining(book: SpoolBook, spoolId: string): number {
	const spool = book.spools.find((s) => s.id === spoolId);
	if (!spool) return 0;
	let g = spool.initial;
	for (const m of book.movements) if (m.spoolId === spoolId) g += m.grams;
	return round(g);
}

export function reserved(book: SpoolBook, spoolId: string): number {
	let g = 0;
	for (const r of book.reservations) if (r.spoolId === spoolId) g += r.grams;
	return round(g);
}

/** What can still be planned: on the spool minus held for running prints. */
export function available(book: SpoolBook, spoolId: string): number {
	return round(remaining(book, spoolId) - reserved(book, spoolId));
}

const round = (g: number) => Math.round(g * 100) / 100;

function positive(grams: number): number {
	const g = Number(grams);
	if (!Number.isFinite(g) || g <= 0) throw new Error(msg.t_spool_tracker_error_grams());
	if (g > 100_000) throw new Error(msg.t_spool_tracker_error_too_heavy());
	return round(g);
}

function spoolOf(book: SpoolBook, spoolId: string): Spool {
	const spool = book.spools.find((s) => s.id === spoolId);
	if (!spool) throw new Error(msg.t_spool_tracker_error_not_found());
	return spool;
}

export function addSpool(book: SpoolBook, input: SpoolInput, now = Date.now()): SpoolBook {
	const clean = cleanSpool(input);
	const initial = input.initial === undefined ? clean.netWeight : amount(input.initial, 100_000);
	const spool: Spool = { ...clean, id: newId(), initial, createdAt: now, updatedAt: now };
	return { ...book, spools: [spool, ...book.spools] };
}

export function updateSpool(
	book: SpoolBook,
	spoolId: string,
	input: SpoolInput,
	now = Date.now()
): SpoolBook {
	spoolOf(book, spoolId);
	const clean = cleanSpool(input);
	return {
		...book,
		spools: book.spools.map((s) => (s.id === spoolId ? { ...s, ...clean, updatedAt: now } : s))
	};
}

/** Removals remembered: enough for years of a workshop. */
const REMOVED_KEEP = 5000;

function forget(book: SpoolBook, ids: string[], now: number): Record<string, number> {
	const out = { ...book.removed };
	for (const id of ids) out[id] = now;
	return keepRemoved(out);
}

/** Sorted by id, so equal books serialise alike; the newest removals kept. */
function keepRemoved(map: Record<string, number>): Record<string, number> {
	let entries = Object.entries(map);
	if (entries.length > REMOVED_KEEP) {
		entries = entries.sort((p, q) => q[1] - p[1]).slice(0, REMOVED_KEEP);
	}
	return Object.fromEntries(entries.sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)));
}

/** The spool, its log and its reservations go together. */
export function deleteSpool(book: SpoolBook, spoolId: string, now = Date.now()): SpoolBook {
	return {
		...book,
		spools: book.spools.filter((s) => s.id !== spoolId),
		movements: book.movements.filter((m) => m.spoolId !== spoolId),
		reservations: book.reservations.filter((r) => r.spoolId !== spoolId),
		removed: forget(
			book,
			[spoolId, ...book.reservations.filter((r) => r.spoolId === spoolId).map((r) => r.id)],
			now
		)
	};
}

function log(
	book: SpoolBook,
	spoolId: string,
	kind: MovementKind,
	grams: number,
	note: string,
	source: MovementSource,
	now: number
): SpoolBook {
	const spool = spoolOf(book, spoolId);
	const movement: Movement = {
		id: newId(),
		spoolId,
		kind,
		grams: round(grams),
		cost: kind === 'use' ? round(-grams * pricePerGram(spool)) : 0,
		note: text(note, 200),
		source,
		at: now
	};
	return { ...book, movements: [movement, ...book.movements] };
}

/** Filament used by a print. May take the spool below zero — the UI warns first. */
export function writeOff(
	book: SpoolBook,
	spoolId: string,
	grams: number,
	note = '',
	source: MovementSource = 'manual',
	now = Date.now()
): SpoolBook {
	return log(book, spoolId, 'use', -positive(grams), note, source, now);
}

/** Filament added to the spool (rewound leftovers, a refill). */
export function refill(
	book: SpoolBook,
	spoolId: string,
	grams: number,
	note = '',
	now = Date.now()
): SpoolBook {
	return log(book, spoolId, 'refill', positive(grams), note, 'manual', now);
}

/** The spool was weighed: the log gets the difference, the remaining becomes `measured`. */
export function adjust(
	book: SpoolBook,
	spoolId: string,
	measured: number,
	note = '',
	now = Date.now()
): SpoolBook {
	const g = Number(measured);
	if (!Number.isFinite(g) || g < 0) throw new Error(msg.t_spool_tracker_error_remaining());
	const delta = round(g - remaining(book, spoolId));
	if (delta === 0) return book;
	return log(book, spoolId, 'adjust', delta, note, 'manual', now);
}

export function reserve(
	book: SpoolBook,
	spoolId: string,
	grams: number,
	note = '',
	now = Date.now()
): SpoolBook {
	spoolOf(book, spoolId);
	const r: Reservation = {
		id: newId(),
		spoolId,
		grams: positive(grams),
		note: text(note, 200),
		at: now
	};
	return { ...book, reservations: [r, ...book.reservations] };
}

/** The print succeeded: the held grams become a write-off. */
export function commitReservation(book: SpoolBook, id: string, now = Date.now()): SpoolBook {
	const r = book.reservations.find((x) => x.id === id);
	if (!r) return book;
	const rest = {
		...book,
		reservations: book.reservations.filter((x) => x.id !== id),
		removed: forget(book, [id], now)
	};
	return writeOff(rest, r.spoolId, r.grams, r.note, 'reservation', now);
}

/** The print failed or was cancelled: nothing is written off. */
export function cancelReservation(book: SpoolBook, id: string, now = Date.now()): SpoolBook {
	return {
		...book,
		reservations: book.reservations.filter((x) => x.id !== id),
		removed: forget(book, [id], now)
	};
}

export interface BookSummary {
	spools: number;
	/** Filament on all spools, g. */
	grams: number;
	/** What that filament cost, ₽. */
	value: number;
	/** Written off this calendar month. */
	monthGrams: number;
	monthCost: number;
}

export function summary(book: SpoolBook, now = Date.now()): BookSummary {
	let grams = 0;
	let value = 0;
	for (const s of book.spools) {
		const g = Math.max(0, remaining(book, s.id));
		grams += g;
		value += g * pricePerGram(s);
	}
	const d = new Date(now);
	const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
	let monthGrams = 0;
	let monthCost = 0;
	for (const m of book.movements) {
		if (m.kind !== 'use' || m.at < monthStart) continue;
		monthGrams -= m.grams;
		monthCost += m.cost;
	}
	return {
		spools: book.spools.length,
		grams: round(grams),
		value: round(value),
		monthGrams: round(monthGrams),
		monthCost: round(monthCost)
	};
}

// ---------- backup ----------

export function exportBook(book: SpoolBook): string {
	return JSON.stringify({ app: 'polyzon-spools', ...book }, null, 2);
}

/** A backup file → a clean book; anything unexpected is dropped, not trusted. */
export function parseBook(raw: string): SpoolBook {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		throw new Error(msg.t_spool_tracker_error_not_json());
	}
	const obj = data as Partial<SpoolBook> | null;
	if (!obj || typeof obj !== 'object' || !Array.isArray(obj.spools)) {
		throw new Error(msg.t_spool_tracker_error_no_spools());
	}
	const id = (v: unknown) => (typeof v === 'string' && v.length <= 64 && v ? v : newId());
	const at = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Date.now());
	const spools: Spool[] = [];
	for (const s of obj.spools.slice(0, 2000) as Partial<Spool>[]) {
		if (!s || typeof s !== 'object') continue;
		try {
			const clean = cleanSpool(s as SpoolInput);
			spools.push({
				...clean,
				id: id(s.id),
				initial: amount(s.initial ?? clean.netWeight, 100_000),
				createdAt: at(s.createdAt),
				...(typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt)
					? { updatedAt: s.updatedAt }
					: {})
			});
		} catch {
			/* a spool without a weight is skipped */
		}
	}
	const known = new Set(spools.map((s) => s.id));
	const kinds: MovementKind[] = ['use', 'refill', 'adjust'];
	const sources: MovementSource[] = ['manual', 'gcode', 'reservation'];
	const movements: Movement[] = [];
	for (const m of (Array.isArray(obj.movements) ? obj.movements : []).slice(
		0,
		50_000
	) as Partial<Movement>[]) {
		if (!m || !known.has(m.spoolId as string) || !kinds.includes(m.kind as MovementKind)) continue;
		const grams = Number(m.grams);
		if (!Number.isFinite(grams) || Math.abs(grams) > 100_000) continue;
		movements.push({
			id: id(m.id),
			spoolId: m.spoolId as string,
			kind: m.kind as MovementKind,
			grams: round(grams),
			cost: amount(m.cost),
			note: text(m.note, 200),
			source: sources.includes(m.source as MovementSource)
				? (m.source as MovementSource)
				: 'manual',
			at: at(m.at)
		});
	}
	const reservations: Reservation[] = [];
	for (const r of (Array.isArray(obj.reservations) ? obj.reservations : []).slice(
		0,
		1000
	) as Partial<Reservation>[]) {
		if (!r || !known.has(r.spoolId as string)) continue;
		const grams = amount(r.grams, 100_000);
		if (!grams) continue;
		reservations.push({
			id: id(r.id),
			spoolId: r.spoolId as string,
			grams,
			note: text(r.note, 200),
			at: at(r.at)
		});
	}
	const removed: Record<string, number> = {};
	if (obj.removed && typeof obj.removed === 'object' && !Array.isArray(obj.removed)) {
		for (const [key, when] of Object.entries(obj.removed)) {
			if (key && key.length <= 64 && typeof when === 'number' && Number.isFinite(when)) {
				removed[key] = when;
			}
		}
	}
	return { version: 1, spools, movements, reservations, removed: keepRemoved(removed) };
}

/**
 * Two copies of the book — this browser's and the account's — as one. The log
 * only grows, so the write-offs of both are kept; a spool edited in both keeps
 * the later edit; what either removed stays removed, unless the spool was
 * edited after that. The order does not depend on which copy came first:
 * newest first, as the lists show them.
 */
export function mergeBooks(a: SpoolBook, b: SpoolBook): SpoolBook {
	// A Map: ids come from imported files and other devices, and `id in {}`
	// is true for `constructor` and every other inherited name.
	const removed = new Map(Object.entries(a.removed));
	for (const [id, when] of Object.entries(b.removed)) {
		const seen = removed.get(id);
		removed.set(id, seen === undefined ? when : Math.max(seen, when));
	}
	const union = <T extends { id: string }>(x: T[], y: T[], later: (p: T, q: T) => T): T[] => {
		const out = new Map<string, T>();
		for (const item of [...x, ...y]) {
			const seen = out.get(item.id);
			out.set(item.id, seen ? later(seen, item) : item);
		}
		return [...out.values()];
	};
	const edited = (s: Spool) => s.updatedAt ?? s.createdAt;
	const spools = union(a.spools, b.spools, (p, q) => (edited(q) > edited(p) ? q : p))
		.filter((s) => {
			const removedAt = removed.get(s.id);
			return removedAt === undefined || edited(s) > removedAt;
		})
		.sort((p, q) => q.createdAt - p.createdAt || (p.id < q.id ? -1 : 1));
	const known = new Set(spools.map((s) => s.id));
	const newest = <T extends { id: string; at: number }>(p: T, q: T) =>
		q.at - p.at || (p.id < q.id ? -1 : 1);
	return {
		version: 1,
		spools,
		movements: union(a.movements, b.movements, (p) => p)
			.filter((m) => known.has(m.spoolId) && !removed.has(m.id))
			.sort(newest),
		reservations: union(a.reservations, b.reservations, (p) => p)
			.filter((r) => known.has(r.spoolId) && !removed.has(r.id))
			.sort(newest),
		removed: keepRemoved(Object.fromEntries(removed))
	};
}

// ---------- storage ----------

export function loadBook(): SpoolBook {
	const raw = readStored<unknown>(SPOOL_STORAGE_KEY);
	if (!raw) return emptyBook();
	try {
		return parseBook(JSON.stringify(raw));
	} catch {
		return emptyBook();
	}
}

export function saveBook(book: SpoolBook): void {
	writeStored(SPOOL_STORAGE_KEY, book);
}
