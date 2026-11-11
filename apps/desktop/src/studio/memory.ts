/**
 * A tool comes back as it was left. Each field's value is kept under the name an agent knows it by
 * (./fields), in this window's own storage: a small convenience, so losing it only brings the tool's own
 * values back. Values go into the fields while the tool opens, and right after a reset or its undo, with
 * the fields that a choice brings up as it goes. A field that comes up later keeps what the tool gives it,
 * a preset's value among them.
 */
import { checked, type Field } from './fields';

export type Values = Record<string, unknown>;
export type Form = readonly (readonly [string, Field])[];
export type Shelf = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'maker-tool:';

/** What a field can take back: a file is not a setting, and a number is NaN for a moment while it is typed. */
const worth = (f: Field) => f.kind !== 'file' && f.value !== undefined && !(typeof f.value === 'number' && !Number.isFinite(f.value));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const valuesOf = (form: Form): Values => Object.fromEntries(form.filter(([, f]) => worth(f)).map(([name, f]) => [name, f.value]));

export class Memory {
	readonly #key: string;
	readonly #shelf: () => Shelf;
	#saved: Values;
	/** What the tool gave each field when it first came up */
	readonly #defaults = new Map<string, unknown>();
	/** The last field of each name: one out of sight still sets the tool's value */
	readonly #last = new Map<string, Field>();
	readonly #seen = new WeakSet<Field>();
	#pending: Values = {};
	#closing: ReturnType<typeof setTimeout> | undefined;
	#closed = false;

	constructor(slug: string, shelf: () => Shelf = () => localStorage) {
		this.#key = KEY + slug;
		this.#shelf = shelf;
		this.#saved = this.#load();
		this.#expect(this.#saved);
	}

	/** Fields new to the form: what the tool gave each is its own value, and while values go in, they take theirs. */
	join(form: Form): void {
		for (const [name, f] of form) {
			if (this.#seen.has(f) || !worth(f)) continue;
			this.#seen.add(f);
			this.#last.set(name, f);
			if (!this.#defaults.has(name)) this.#defaults.set(name, f.value);
			this.#fill(name, f);
		}
	}

	/** Keeps what the fields hold now, with what the fields out of sight held. A tool left as it came takes no room. */
	keep(form: Form): void {
		if (!Object.keys(this.#saved).length && !this.changed(form)) return;
		Object.assign(this.#saved, valuesOf(form));
		this.#write();
	}

	changed(form: Form): boolean {
		return form.some(([name, f]) => worth(f) && this.#defaults.has(name) && !same(f.value, this.#defaults.get(name)));
	}

	/** The tool's own values back, in sight and out of it; answers with what it had, for an undo. */
	reset(form: Form): Values {
		const had = { ...this.#saved, ...valuesOf(form) };
		this.#saved = {};
		this.#write();
		this.put(form, Object.fromEntries(this.#defaults));
		return had;
	}

	/** Values into the fields, and into those that their choices bring up in the next updates. */
	put(form: Form, values: Values): void {
		if (this.#closed) return;
		this.#expect(values);
		const here = new Map(form);
		for (const [name, f] of this.#last) if (!here.has(name)) this.#fill(name, f);
		for (const [name, f] of form) this.#fill(name, f);
	}

	/** The tool has closed: an undo that comes later has nothing to go into. */
	close(): void {
		this.#closed = true;
		clearTimeout(this.#closing);
	}

	#expect(values: Values) {
		this.#pending = { ...values };
		clearTimeout(this.#closing);
		// a choice brings up its fields within the updates it starts, all before the next task
		this.#closing = setTimeout(() => (this.#pending = {}));
	}

	#fill(name: string, f: Field) {
		if (!Object.hasOwn(this.#pending, name)) return;
		try {
			f.value = checked(name, f, this.#pending[name]);
		} catch {
			// a value this version of the tool no longer takes
		}
	}

	#load(): Values {
		try {
			const values: unknown = JSON.parse(this.#shelf().getItem(this.#key) ?? 'null');
			return values && typeof values === 'object' && !Array.isArray(values) ? (values as Values) : {};
		} catch {
			return {};
		}
	}

	#write() {
		try {
			if (Object.keys(this.#saved).length) this.#shelf().setItem(this.#key, JSON.stringify(this.#saved));
			else this.#shelf().removeItem(this.#key);
		} catch {
			// the tool opens with its own values next time
		}
	}
}
