export interface Section {
	title: string;
	items: string[];
}

/** The notes of a release: `## Heading` starts a list, every other line is an item of it. */
export function whatsNew(notes: string | null): Section[] {
	const sections: Section[] = [{ title: '', items: [] }];
	for (const raw of (notes ?? '').split('\n')) {
		const line = raw.trim();
		if (line.startsWith('## ')) sections.push({ title: line.slice(3).trim(), items: [] });
		else if (line) sections[sections.length - 1].items.push(line.replace(/^[-*]\s+/, ''));
	}
	return sections.filter((s) => s.items.length);
}

export function releaseDate(date: string | null, lang: string): string {
	const when = new Date(date ?? '');
	if (Number.isNaN(when.getTime())) return '';
	return when.toLocaleDateString(lang, { dateStyle: 'long', timeZone: 'UTC' });
}
