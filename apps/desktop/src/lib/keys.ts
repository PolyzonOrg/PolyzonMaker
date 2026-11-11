/**
 * Keyboard shortcuts: one table of actions, each with its default keys and the place it works in. A person
 * can give any action other keys; pages only say what an action does while they are open.
 * Pure, except for the handlers pages register, so that matching can be tested.
 */

export type Scope = 'app' | 'cad' | 'result';

export interface Action {
	id: string;
	scope: Scope;
	keys: string;
}

export const ACTIONS: Action[] = [
	{ id: 'new', scope: 'app', keys: 'Mod+N' },
	{ id: 'page.library', scope: 'app', keys: 'Mod+1' },
	{ id: 'page.tools', scope: 'app', keys: 'Mod+2' },
	{ id: 'page.cad', scope: 'app', keys: 'Mod+3' },
	{ id: 'page.openscad', scope: 'app', keys: 'Mod+4' },
	{ id: 'page.models', scope: 'app', keys: 'Mod+5' },
	{ id: 'page.plugins', scope: 'app', keys: 'Mod+6' },
	{ id: 'page.settings', scope: 'app', keys: 'Mod+,' },
	{ id: 'menu', scope: 'app', keys: 'Mod+B' },
	{ id: 'assistant', scope: 'app', keys: 'Mod+J' },
	{ id: 'help', scope: 'app', keys: 'Mod+/' },
	{ id: 'cad.handleMove', scope: 'cad', keys: 'G' },
	{ id: 'cad.handleTurn', scope: 'cad', keys: 'R' },
	{ id: 'cad.fit', scope: 'cad', keys: 'Home' },
	{ id: 'cad.front', scope: 'cad', keys: '1' },
	{ id: 'cad.side', scope: 'cad', keys: '3' },
	{ id: 'cad.top', scope: 'cad', keys: '7' },
	{ id: 'cad.hide', scope: 'cad', keys: 'H' },
	{ id: 'cad.showAll', scope: 'cad', keys: 'Alt+H' },
	{ id: 'cad.delete', scope: 'cad', keys: 'Delete' },
	{ id: 'cad.deselect', scope: 'cad', keys: 'Escape' },
	{ id: 'cad.build', scope: 'cad', keys: 'Mod+Enter' },
	{ id: 'cad.toLibrary', scope: 'cad', keys: 'Mod+L' },
	{ id: 'result.prepare', scope: 'result', keys: 'Mod+P' },
	{ id: 'result.saveStl', scope: 'result', keys: 'Mod+E' }
];

type Press = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> & { code?: string };

const PUNCTUATION: Record<string, string> = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']' };

/** In another alphabet a key says the letter it writes: the table knows the Latin one in the same place. */
function latin(e: Press) {
	const code = e.code ?? '';
	return /^Key[A-Z]$/.test(code) ? code.slice(3) : (PUNCTUATION[code] ?? e.key);
}

/** The name of a key press, in the same form as the table. */
export function comboOf(e: Press): string {
	const typed = e.key.length === 1 && e.key > '\u007f' ? latin(e) : e.key;
	const key = typed.length === 1 ? typed.toUpperCase() : typed;
	if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return '';
	return [e.ctrlKey || e.metaKey ? 'Mod' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+');
}

/** How a combination reads on this system. */
export function shown(combo: string, mac: boolean): string {
	return combo.replace('Mod', mac ? '⌘' : 'Ctrl').replace('Delete', mac ? '⌫' : 'Del').replace('Escape', 'Esc');
}

/** Keys that mean something while writing: without Ctrl they stay with the field. */
const plain = (combo: string) => !combo.includes('Mod') && !combo.includes('Alt');

/** Which action this press is, given where the focus is, what page is open and what the person changed. */
export function actionFor(e: Press, typing: boolean, scope: Scope | null, mine: Record<string, string>): Action | null {
	const combo = comboOf(e);
	if (!combo) return null;
	const action = ACTIONS.find((a) => (mine[a.id] ?? a.keys) === combo && (a.scope === 'app' || a.scope === scope));
	if (!action) return null;
	return typing && plain(combo) ? null : action;
}

/** An action that already answers to these keys in the same place, to warn before they are taken. */
export function clash(id: string, combo: string, mine: Record<string, string>): Action | null {
	const action = ACTIONS.find((a) => a.id === id);
	return ACTIONS.find((a) => a.id !== id && (mine[a.id] ?? a.keys) === combo && (a.scope === 'app' || action?.scope === 'app' || a.scope === action?.scope)) ?? null;
}

const handlers = new Map<string, () => void>();

/** A page says what actions do while it is open; the answer takes them back. */
export function handle(table: Record<string, () => void>): () => void {
	for (const [id, run] of Object.entries(table)) handlers.set(id, run);
	return () => {
		for (const id of Object.keys(table)) handlers.delete(id);
	};
}

export function run(id: string): boolean {
	const handler = handlers.get(id);
	handler?.();
	return !!handler;
}
