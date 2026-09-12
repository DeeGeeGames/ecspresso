/**
 * Minimal async context abstraction used to distinguish cleanup reentry from
 * unrelated concurrent calls. Node and Bun provide AsyncLocalStorage without
 * requiring it as a browser runtime dependency; browsers use the synchronous
 * fallback for cleanup callbacks that do not suspend.
 */

export interface CleanupScope {
	readonly owners: readonly object[];
}

interface AsyncContext<T> {
	run<R>(value: T, callback: () => R): R;
	getStore(): T | undefined;
}

interface AsyncLocalStorageLike<T> extends AsyncContext<T> {}

type AsyncLocalStorageConstructor = new <T>() => AsyncLocalStorageLike<T>;
type BuiltinModuleLoader = (specifier: string) => unknown;

function readProperty(value: unknown, key: string): unknown {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
	return (value as Record<string, unknown>)[key];
}

function isBuiltinModuleLoader(value: unknown): value is BuiltinModuleLoader {
	return typeof value === 'function';
}

function isAsyncLocalStorageConstructor(value: unknown): value is AsyncLocalStorageConstructor {
	return typeof value === 'function'
		&& typeof readProperty(readProperty(value, 'prototype'), 'run') === 'function'
		&& typeof readProperty(readProperty(value, 'prototype'), 'getStore') === 'function';
}

function createHostAsyncContext<T>(): AsyncContext<T> | undefined {
	const processValue = readProperty(globalThis, 'process');
	const loader = readProperty(processValue, 'getBuiltinModule');
	if (!isBuiltinModuleLoader(loader)) return undefined;

	let moduleValue: unknown;
	try {
		moduleValue = loader('node:async_hooks');
	} catch {
		return undefined;
	}

	const constructor = readProperty(moduleValue, 'AsyncLocalStorage');
	if (!isAsyncLocalStorageConstructor(constructor)) return undefined;

	const storage = new constructor<T>();
	return {
		run: (value, callback) => storage.run(value, callback),
		getStore: () => storage.getStore(),
	};
}

function createFallbackAsyncContext<T>(): AsyncContext<T> {
	let current: T | undefined;
	return {
		run(value, callback) {
			const previous = current;
			current = value;
			try {
				return callback();
			} finally {
				current = previous;
			}
		},
		getStore: () => current,
	};
}

const cleanupContext = createHostAsyncContext<CleanupScope>() ?? createFallbackAsyncContext<CleanupScope>();

export function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
	let reject: (reason?: unknown) => void = () => undefined;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

/** Run a callback with the supplied cleanup owners visible across awaits. */
export function withCleanupScope<T>(owners: readonly object[], callback: () => T): T {
	const parent = cleanupContext.getStore();
	const mergedOwners = parent ? [...parent.owners, ...owners] : [...owners];
	return cleanupContext.run({ owners: mergedOwners }, callback);
}

/** Whether the current async cleanup callback belongs to this owner. */
export function isCleanupReentry(owner: object): boolean {
	return cleanupContext.getStore()?.owners.includes(owner) ?? false;
}
