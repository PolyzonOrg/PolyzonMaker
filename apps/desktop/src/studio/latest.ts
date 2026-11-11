/**
 * Only the newest of overlapping async jobs may land. Open a large file, then
 * a small one: the large one finishes last, and without this its result would
 * replace the small one the user chose after it.
 *
 *   const opening = latestOnly();
 *   async function open(file: File) {
 *     const fresh = opening.next();
 *     const bytes = await file.arrayBuffer();
 *     if (!fresh()) return; // a newer file was chosen meanwhile
 *     …
 *   }
 */
export function latestOnly() {
	/** The newest job's own token; null once everything was cancelled. */
	let newest: object | null = null;
	return {
		/** Begin a job; the check says whether it is still the newest one. */
		next(): () => boolean {
			const mine = {};
			newest = mine;
			return () => mine === newest;
		},
		/** Nothing in flight may land any more (the input was cleared). */
		cancel(): void {
			newest = null;
		}
	};
}
