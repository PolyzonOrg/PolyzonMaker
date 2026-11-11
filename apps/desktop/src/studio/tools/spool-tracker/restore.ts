/**
 * «Восстановить из файла»: a backup replaces the book everywhere. What the
 * file lacks is marked removed, so the merge with the account's copy
 * (mergeBooks) drops it too; what the file has is un-removed, and its spools
 * count as edited now, so an older removal does not hide them.
 */
import type { SpoolBook } from './model';

/** Ids of `current` that `file` does not have. */
function missing(current: { id: string }[], file: { id: string }[]): string[] {
	const kept = new Set(file.map((x) => x.id));
	return current.filter((x) => !kept.has(x.id)).map((x) => x.id);
}

export function restoreBook(book: SpoolBook, file: SpoolBook, now: number): SpoolBook {
	const removed = { ...book.removed, ...file.removed };
	const gone = [
		...missing(book.spools, file.spools),
		...missing(book.reservations, file.reservations),
		// The history too: what the file does not have goes, so the balance is the file's.
		...missing(book.movements, file.movements)
	];
	for (const id of gone) removed[id] = now;
	for (const x of [...file.spools, ...file.movements]) delete removed[x.id];
	return {
		...file,
		spools: file.spools.map((s) => ({ ...s, updatedAt: now })),
		removed
	};
}
