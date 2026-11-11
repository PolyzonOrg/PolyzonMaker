/**
 * The favourite tools on the page: the catalog and the tool headers read and
 * toggle the same marks. Browser only — the server renders from the copy it
 * read for this request (the catalog's load), never from this module, so no
 * request sees another's marks.
 */
import { accountBook } from './shared/account-book';
import {
	FAVORITES_KEY,
	emptyFavorites,
	favoriteSlugs,
	loadFavorites,
	mergeFavorites,
	parseFavorites,
	saveFavorites,
	setFavorite,
	type FavoriteBook
} from './favorites';

const account = accountBook({
	endpoint: '/api/tools/books/favorites',
	load: loadFavorites,
	save: saveFavorites,
	parse: parseFavorites,
	merge: mergeFavorites,
	empty: emptyFavorites
});

class Favorites {
	#book = $state<FavoriteBook>(emptyFavorites());
	/** Read from this browser (and the account) yet */
	ready = $state(false);
	slugs = $derived(favoriteSlugs(this.#book));

	has(slug: string): boolean {
		return this.#book.marks[slug]?.on === true;
	}

	/**
	 * Once per page load, in the browser: this browser's copy (with `known`,
	 * the account's copy the page came with), then a sync with the account.
	 */
	start(known?: FavoriteBook): void {
		if (typeof window === 'undefined') return;
		if (known) {
			const merged = mergeFavorites(loadFavorites(), known);
			saveFavorites(merged);
			this.#book = merged;
		}
		if (this.ready) return;
		if (!known) this.#book = loadFavorites();
		this.ready = true;
		void account.sync().then((book) => this.#apply(book));
		// Another tab starred something.
		window.addEventListener('storage', (e) => {
			if (e.key === FAVORITES_KEY) this.#book = loadFavorites();
		});
	}

	/** A synced copy, merged with what is here now: a click made meanwhile stays. */
	#apply(book: FavoriteBook): void {
		this.#book = mergeFavorites(book, this.#book);
	}

	toggle(slug: string): void {
		this.start();
		const next = setFavorite(this.#book, slug, !this.has(slug));
		this.#book = next;
		void account.saveAndSync(next).then((book) => this.#apply(book));
	}
}

export const favorites = new Favorites();
