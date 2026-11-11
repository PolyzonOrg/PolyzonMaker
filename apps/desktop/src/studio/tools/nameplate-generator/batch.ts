/**
 * «Набор»: one tag for each name of a list. Which names are made, and the
 * file each one gets in the archive.
 */

/** One name a line, blank lines and the spaces around a name dropped, at most `max`. */
export function batchNames(text: string, max: number): string[] {
	return text
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, max);
}

/** File names for `slugs` in order: two equal names get -2, -3 so neither file is lost in the archive. */
export function uniqueNames(slugs: readonly string[]): string[] {
	const used = new Set<string>();
	return slugs.map((slug) => {
		// The first free of slug, slug-2, slug-3…: a list may itself hold «tag-a-2».
		let name = slug;
		for (let n = 2; used.has(name); n++) name = `${slug}-${n}`;
		used.add(name);
		return name;
	});
}
