/**
 * Lookups by a key that comes from outside — a URL, a form, the assistant's
 * arguments, an imported file. `key in table` and `table[key]` also find what
 * every object inherits (`constructor`, `toString`, …); these see only the
 * table's own keys.
 */

/** `key` is one of `table`'s own keys. */
export function ownKey<T extends object>(table: T, key: PropertyKey): key is keyof T {
	return Object.hasOwn(table, key);
}

/** `table`'s own entry under `key`, or undefined. */
export function own<T extends object>(table: T, key: PropertyKey): T[keyof T] | undefined {
	return ownKey(table, key) ? table[key] : undefined;
}
