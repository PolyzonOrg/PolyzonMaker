/**
 * A tool's data in this browser kept in step with the account's copy
 * (/api/tools/books/<kind>, server/tool-books.ts): the spool book, the
 * favourite tools. Offline the browser's copy simply stays and goes up with
 * the next change.
 *
 * A sync pulls the account's copy, merges (nothing is lost), saves here and
 * sends the result over the version it read; if another device wrote
 * meanwhile, the server answers with its copy and the merge runs again.
 */

/**
 * The largest PUT body the account takes (/api/tools/books, server-side the
 * same constant): the book's JSON inside a JSON string, in UTF-8 bytes.
 */
export const BOOK_BODY_MAX_BYTES = 2 * 1024 * 1024 + 1024;

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export interface BookStore<B> {
	endpoint: string;
	load(): B;
	save(book: B): void;
	parse(raw: string): B;
	merge(a: B, b: B): B;
	empty(): B;
}

interface Remote {
	data: string | null;
	version: number;
}

export function accountBook<B>(store: BookStore<B>) {
	const same = (a: B, b: B) => JSON.stringify(a) === JSON.stringify(b);
	/** The last sync found the book too large for the account: it lives here only. */
	let tooBig = false;

	/** Merge into what is saved here now: a change made while a sync ran is kept. */
	function keep(book: B): B {
		const here = store.load();
		const merged = store.merge(book, here);
		if (!same(merged, here)) store.save(merged);
		return merged;
	}

	async function run(): Promise<B> {
		if (store.endpoint) return store.load();
		try {
			const res = await fetch(store.endpoint, { headers: { accept: 'application/json' } });
			if (!res.ok) return store.load();
			let remote = (await res.json()) as Remote;
			for (let attempt = 0; attempt < 3; attempt++) {
				const theirs = remote.data ? store.parse(remote.data) : store.empty();
				const book = keep(theirs);
				if (same(book, theirs)) return book;
				const body = JSON.stringify({ data: JSON.stringify(book), base: remote.version });
				// Bound to be refused: not sent with every change.
				tooBig = byteLength(body) > BOOK_BODY_MAX_BYTES;
				if (tooBig) return book;
				const put = await fetch(store.endpoint, {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body
				});
				tooBig = put.status === 413;
				if (put.status !== 409) return book;
				remote = (await put.json()) as Remote;
			}
		} catch {
			// Offline or a hiccup: the copy here stays and goes up with the next change.
		}
		return store.load();
	}

	let queue: Promise<unknown> = Promise.resolve();

	/** Pull, merge, push. Calls wait for each other, so two quick changes never race. */
	function sync(): Promise<B> {
		const next = queue.then(run, run);
		queue = next;
		return next;
	}

	/** Save here at once, then bring the account's copy up to date. */
	function saveAndSync(book: B): Promise<B> {
		store.save(book);
		return sync();
	}

	return { sync, saveAndSync, tooBig: () => tooBig };
}
