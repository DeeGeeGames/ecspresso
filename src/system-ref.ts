const systemRefBrand: unique symbol = Symbol('SystemRef');
const systemRefs = new WeakSet<object>();

/** Opaque identity for one processing system per world. Import the original token. */
export interface SystemRef {
	readonly [systemRefBrand]: true;
	/** Diagnostic name only; identical names do not share identity. */
	readonly name: string;
}

/** Create an immutable reference that can be bound independently in multiple worlds. */
export function defineSystemRef(name: string): SystemRef {
	const ref = Object.freeze({ [systemRefBrand]: true as const, name });
	systemRefs.add(ref);
	return ref;
}

/** Ordering options apply only to the plugin's documented primary processing system. */
export interface SystemOrderingOptions {
	readonly before?: readonly SystemRef[];
	readonly after?: readonly SystemRef[];
}

/** @internal Reject forged tokens at untyped boundaries. */
export function assertSystemRef(value: unknown): asserts value is SystemRef {
	if (typeof value === 'object' && value !== null && systemRefs.has(value)) return;
	throw new Error('Expected a system reference created by defineSystemRef().');
}
