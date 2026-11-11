/**
 * The catalog's search over the registry (DESIGN_CODE §9 «Поиск в каталоге»):
 * the tools page and the assistant's way out of its free limit ask the same
 * index, so a tool is found by the same words in both.
 */
import { TOOL_CATEGORIES, TOOLS, toolBySlug, type ToolInfo } from './registry';
import { createToolSearch, toolInText, type SearchResult, type ToolSearch } from './search';
import { SEARCH_KEYWORDS } from './search-keywords';
import { currentLocale } from '$lib/i18n/current';
import type { Locale } from '$lib/i18n/locale';

// One index per language: per page load in the browser, per process on the
// server (the registry only, nobody's data); built on the first query.
const engines: Partial<Record<Locale, ToolSearch>> = {};

function engine(): ToolSearch {
	const locale = currentLocale();
	return (engines[locale] ??= index(locale));
}

export function findTools(query: string): SearchResult {
	return engine()(query);
}

/**
 * The free generator that makes what a chat message asks for (toolInText), or
 * null. Generators only: «модель» names half the tools for a model.
 */
export function toolForTask(text: string): ToolInfo | null {
	const slug = toolInText(engine(), text, (s) => {
		const tool = toolBySlug(s);
		return tool?.category === 'make' ? tool.title : undefined;
	});
	return slug ? (toolBySlug(slug) ?? null) : null;
}

function index(locale: Locale): ToolSearch {
	const section = Object.fromEntries(TOOL_CATEGORIES.map((c) => [c.id, c.title]));
	return createToolSearch(
		TOOLS.map((t) => ({
			slug: t.slug,
			title: t.title,
			description: t.description,
			section: section[t.category],
			keywords: SEARCH_KEYWORDS[t.slug] ?? ''
		})),
		locale
	);
}
