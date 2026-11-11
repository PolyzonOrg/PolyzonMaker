// The open tool's form, as its fields tell it. Every field registers itself, so the agent and the tool's
// memory see the same form a person sees, without a line for each tool, and a field that appears only for
// some choice appears there only then.
import { onDestroy } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';

export interface Field {
	kind: 'number' | 'choice' | 'toggle' | 'text' | 'file';
	label: string;
	hint?: string;
	value?: unknown;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	options?: readonly { value: unknown; label: string }[];
	maxlength?: number;
	accept?: string;
	open?: (file: File) => void;
}

const fields = new SvelteSet<Field>();

/** Called once by each field component. Its getters keep it live. */
export function field(one: Field): void {
	fields.add(one);
	onDestroy(() => fields.delete(one));
}

/** The form by name. Read in an effect, it follows the fields as they come and go. */
export const form = () => named([...fields]);

/** A label can repeat in a form, in two groups: each field still needs a name of its own. */
export function named(list: readonly Field[]): [string, Field][] {
	const seen = new Map<string, number>();
	return list.map((f) => {
		const n = (seen.get(f.label) ?? 0) + 1;
		seen.set(f.label, n);
		return [n === 1 ? f.label : `${f.label} (${n})`, f];
	});
}

/** Each kind's check: the value it takes, or why not. */
const CHECKS: Record<Field['kind'], (f: Field, value: unknown) => unknown> = {
	number(f, value) {
		const n = Number(value);
		if (!Number.isFinite(n)) throw new Error('needs a number');
		if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) throw new Error(`goes from ${f.min} to ${f.max}`);
		return n;
	},
	choice(f, value) {
		const option = f.options?.find((o) => o.value === value || o.label === value);
		if (!option) throw new Error(`is one of ${f.options?.map((o) => String(o.value)).join(', ')}`);
		return option.value;
	},
	toggle(_, value) {
		if (typeof value !== 'boolean') throw new Error('needs true or false');
		return value;
	},
	text(f, value) {
		if (typeof value !== 'string') throw new Error('needs text');
		if (f.maxlength && value.length > f.maxlength) throw new Error(`holds ${f.maxlength} characters`);
		return value;
	},
	file() {
		throw new Error('takes a finished job: {"job": "<id>"}');
	}
};

/** The value a field takes, or why not, in words an agent can act on. */
export function checked(name: string, f: Field, value: unknown): unknown {
	try {
		return CHECKS[f.kind](f, value);
	} catch (e) {
		throw new Error(`«${name}»: ${(e as Error).message}`);
	}
}
