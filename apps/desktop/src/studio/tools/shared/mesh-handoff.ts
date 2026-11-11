/**
 * A model handed to a tool without leaving the browser: «Починить» in the
 * viewer opens the repair tool with the same file, «В инструменты» on a
 * generation opens the mold, hollow, flexi, cut or check tool with it.
 * Lives in memory only: survives client-side navigation, not a reload.
 */
let pending: File | null = null;

export function handOffMesh(file: File): void {
	pending = file;
}

export function takeHandedOffMesh(): File | null {
	const file = pending;
	pending = null;
	return file;
}

/** A model is waiting for the page that opens next. */
export function hasHandedOffMesh(): boolean {
	return pending !== null;
}
