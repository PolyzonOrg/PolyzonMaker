import { go } from '../../lib/state.svelte';

/** The moves between tools that Studio makes by address. */
export async function goto(href: string, _options?: unknown): Promise<void> {
	const [, slug] = href.match(/^\/workspace\/tools\/?([\w-]*)/) ?? [];
	go(slug ? 'tool' : 'tools', slug ?? '');
}

/** Studio keeps a tool's state in its address, for sharing a link; this window has no address bar. */
export function replaceState(_href: string, _state: unknown): void {}
