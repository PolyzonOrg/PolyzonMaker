/**
 * The spool book of this browser kept in step with the account's copy
 * (/api/tools/books/spools, shared/account-book.ts): a label scanned on the
 * phone shows what the computer wrote, and the other way round. The merge
 * (mergeBooks) loses nothing: the log only grows.
 */
import { accountBook } from '../shared/account-book';
import { emptyBook, loadBook, mergeBooks, parseBook, saveBook } from './model';

const spools = accountBook({
	endpoint: '/api/tools/books/spools',
	load: loadBook,
	save: saveBook,
	parse: parseBook,
	merge: mergeBooks,
	empty: emptyBook
});

/** Pull, merge, push. Calls wait for each other, so two quick changes never race. */
export const syncBook = spools.sync;
/** Save here at once, then bring the account's copy up to date. */
export const saveAndSync = spools.saveAndSync;
/** The last sync found the book too large for the account: it is kept in this browser only. */
export const bookTooBig = spools.tooBig;
