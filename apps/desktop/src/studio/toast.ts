/**
 * Global toast queue for the workspace. Toasts confirm what just happened
 * (saved, copied, deleted) and may carry one follow-up link; they never hold
 * information that is unavailable elsewhere (DESIGN_CODE §7).
 */
import { writable, type Readable } from 'svelte/store';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastAction {
	label: string;
	href?: string;
	onClick?: () => void;
}

export interface ToastItem {
	id: number;
	text: string;
	kind: ToastKind;
	action?: ToastAction;
	duration: number;
}

let seq = 0;
const store = writable<ToastItem[]>([]);

export const toasts: Readable<ToastItem[]> = { subscribe: store.subscribe };

/** Clock of a toast: what is left of its time, and since when it runs. */
interface Clock {
	left: number;
	since: number;
	handle?: ReturnType<typeof setTimeout>;
}
const clocks = new Map<number, Clock>();
let held = false;

function run(id: number, clock: Clock): void {
	clock.since = Date.now();
	clock.handle = setTimeout(() => dismissToast(id), clock.left);
}

/**
 * Pointer or focus on the toasts stops their clocks, so an action can be
 * reached in time (WCAG 2.2.1); letting go gives each the time it had left.
 */
export function holdToasts(hold: boolean): void {
	if (hold === held) return;
	held = hold;
	for (const [id, clock] of clocks) {
		if (!hold) {
			run(id, clock);
			continue;
		}
		clearTimeout(clock.handle);
		clock.left -= Date.now() - clock.since;
	}
}

export function showToast(
	text: string,
	options: { kind?: ToastKind; action?: ToastAction; duration?: number } = {}
): number {
	const id = ++seq;
	const item: ToastItem = {
		id,
		text,
		kind: options.kind || 'info',
		action: options.action,
		// Toasts with a link stay a bit longer so the link can actually be used.
		duration: options.duration ?? (options.action ? 6000 : 3200)
	};
	store.update((items) => [...items, item].slice(-3));
	if (item.duration > 0) {
		const clock: Clock = { left: item.duration, since: Date.now() };
		clocks.set(id, clock);
		if (!held) run(id, clock);
	}
	return id;
}

export function dismissToast(id: number): void {
	clearTimeout(clocks.get(id)?.handle);
	clocks.delete(id);
	store.update((items) => items.filter((item) => item.id !== id));
}
