/**
 * Favourite tools of the catalog: a mark per tool with the time it was set
 * or cleared, so two devices merge without losing either — the later mark
 * of each tool wins, an unstarred tool stays unstarred everywhere. Kept in
 * this browser and with the account (server/tool-books.ts, kind
 * `favorites`).
 */

export interface FavoriteMark {
	on: boolean;
	/** ms since the epoch */
	at: number;
}

export interface FavoriteBook {
	v: 1;
	marks: Record<string, FavoriteMark>;
}

export const FAVORITES_KEY = 'pz-tool-favorites';
/** Context key: the account's favourites (`{ book }`) as this page's load read them. */
export const KNOWN_FAVORITES = 'pz-known-favorites';
/** More than the catalog will ever have; a guard against a bloated document. */
const MAX_MARKS = 400;
const SLUG = /^[a-z0-9-]{1,64}$/;

export const emptyFavorites = (): FavoriteBook => ({ v: 1, marks: {} });

/** A book from JSON, keeping only well-formed marks. Throws on anything that is not one. */
export function parseFavorites(raw: string): FavoriteBook {
	const data: unknown = JSON.parse(raw);
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a book');
	const marks = (data as { marks?: unknown }).marks;
	const out = emptyFavorites();
	if (!marks || typeof marks !== 'object') return out;
	for (const [slug, mark] of Object.entries(marks as Record<string, unknown>).slice(0, MAX_MARKS)) {
		if (!SLUG.test(slug) || !mark || typeof mark !== 'object') continue;
		const { on, at } = mark as { on?: unknown; at?: unknown };
		if (typeof on === 'boolean' && typeof at === 'number' && Number.isFinite(at) && at >= 0)
			out.marks[slug] = { on, at };
	}
	return out;
}

/** Both copies together: for each tool the later mark (a set mark on a tie). */
export function mergeFavorites(a: FavoriteBook, b: FavoriteBook): FavoriteBook {
	const out = emptyFavorites();
	for (const slug of new Set([...Object.keys(a.marks), ...Object.keys(b.marks)])) {
		const x = a.marks[slug];
		const y = b.marks[slug];
		out.marks[slug] = !x || (y && (y.at > x.at || (y.at === x.at && y.on))) ? { ...y } : { ...x };
	}
	return out;
}

export function setFavorite(
	book: FavoriteBook,
	slug: string,
	on: boolean,
	now = Date.now()
): FavoriteBook {
	// Never earlier than the mark it replaces: a clock behind still changes it.
	const at = Math.max(now, (book.marks[slug]?.at ?? 0) + 1);
	return { v: 1, marks: { ...book.marks, [slug]: { on, at } } };
}

/** Starred tools in the order they were starred. */
export function favoriteSlugs(book: FavoriteBook): string[] {
	return Object.entries(book.marks)
		.filter(([, m]) => m.on)
		.sort((x, y) => x[1].at - y[1].at)
		.map(([slug]) => slug);
}

export function loadFavorites(): FavoriteBook {
	try {
		const raw = localStorage.getItem(FAVORITES_KEY);
		return raw ? parseFavorites(raw) : emptyFavorites();
	} catch {
		return emptyFavorites();
	}
}

export function saveFavorites(book: FavoriteBook): void {
	try {
		localStorage.setItem(FAVORITES_KEY, JSON.stringify(book));
	} catch {
		// Private mode or a full storage: the account's copy still has it.
	}
}
