/**
 * Resource factory with declared dependencies and optional disposal callback
 */
export interface ResourceFactoryWithDeps<T, Context = unknown, D extends string = string> {
	dependsOn?: readonly D[];
	factory: (context: Context) => T | Promise<T>;
	onDispose?: (resource: T, context: Context) => void | Promise<void>;
}

/** @internal */
export const RESOURCE_DIRECT: unique symbol = Symbol('resource-direct');

/**
 * Branded wrapper for storing a value as-is, bypassing factory detection.
 * The value is carried on the symbol key to avoid structural conflicts
 * with user resource types that have a `value` property.
 * Create via the `directValue()` helper.
 */
export interface ResourceDirectValue<T> {
	[RESOURCE_DIRECT]: T;
}

/**
 * Wrap a value to store it as-is, bypassing factory detection.
 * Use when the resource itself is a function or class that should not be invoked.
 *
 * @example
 * ```ts
 * import { directValue } from 'ecspresso';
 * world.addResource('handler', directValue(myFunction));
 * world.addResource('MyClass', directValue(MyClass));
 * ```
 */
export function directValue<T>(value: T): ResourceDirectValue<T> {
	return { [RESOURCE_DIRECT]: value };
}

/**
 * Create a shallow snapshot of a value for change detection.
 * For objects, copies own enumerable properties one level deep.
 * For primitives, wraps in { $value } so reference changes are caught.
 */
function shallowSnapshot(value: unknown): Record<string, unknown> {
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		return { ...value as Record<string, unknown> };
	}
	return { $value: value };
}

/**
 * Compare a live value against a snapshot taken by shallowSnapshot.
 * Returns true if any shallow property differs.
 */
function shallowChanged(current: unknown, snapshot: Record<string, unknown>): boolean {
	if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
		const obj = current as Record<string, unknown>;
		for (const k in snapshot) {
			if (!Object.is(obj[k], snapshot[k])) return true;
		}
		return false;
	}
	return !Object.is(current, snapshot['$value']);
}

/**
 * Type guard for detecting { factory } pattern (with optional dependsOn and onDispose)
 */
function isFactoryWithDeps<T>(resource: unknown): resource is ResourceFactoryWithDeps<T> {
	return (
		typeof resource === 'object' &&
		resource !== null &&
		'factory' in resource &&
		typeof (resource as ResourceFactoryWithDeps<T>).factory === 'function'
	);
}

/**
 * Type guard for detecting { value } wrapper pattern (branded with symbol)
 */
function isDirectValue<T>(resource: unknown): resource is ResourceDirectValue<T> {
	return (
		typeof resource === 'object' &&
		resource !== null &&
		RESOURCE_DIRECT in resource
	);
}

/**
 * Topological sort with cycle detection
 */
function topologicalSort<K extends string>(
	keys: readonly K[],
	getDeps: (key: K) => readonly string[]
): K[] {
	const sorted: K[] = [];
	const visited = new Set<K>();
	const visiting = new Set<K>();

	function visit(key: K, path: K[] = []): void {
		if (visited.has(key)) return;
		if (visiting.has(key)) {
			throw new Error(`Circular resource dependency: ${[...path, key].join(' -> ')}`);
		}

		visiting.add(key);
		for (const dep of getDeps(key)) {
			const found = keys.find(k => k === dep);
			if (found) {
				visit(found, [...path, key]);
			}
		}
		visiting.delete(key);
		visited.add(key);
		sorted.push(key);
	}

	for (const key of keys) {
		visit(key);
	}
	return sorted;
}

/**
 * When Context is unknown (default), context args are optional.
 * When Context is a specific type (e.g. ECSpresso<...>), context is required.
 */
type ContextArgs<Context> = unknown extends Context ? [context?: Context] : [context: Context];

function asError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

function aggregateErrors(errors: readonly unknown[], message: string): Error {
	if (errors.length === 1) {
		const error = errors[0];
		return asError(error);
	}
	return new AggregateError(errors, message);
}

export default
class ResourceManager<
	ResourceTypes extends Record<string, any> = Record<string, any>,
	Context = unknown,
> {
	private resources: Map<keyof ResourceTypes, any> = new Map();
	private resourceFactories: Map<keyof ResourceTypes, (context: Context) => any | Promise<any>> = new Map();
	private resourceDependencies: Map<keyof ResourceTypes, readonly (keyof ResourceTypes & string)[]> = new Map();
	private resourceDisposers: Map<keyof ResourceTypes, (resource: any, context: Context) => void | Promise<void>> = new Map();
	private initializedResourceKeys: Set<keyof ResourceTypes> = new Set();
	/** In-flight factory calls, preventing duplicate initialization and late races. */
	private pendingInitializations: Map<keyof ResourceTypes, Promise<void>> = new Map();
	/** Resources currently inside an onDispose callback. */
	private disposingResourceKeys: Set<keyof ResourceTypes> = new Set();
	/** Shared promise for concurrent disposeResources() calls. */
	private disposePromise: Promise<void> | undefined;
	/** Prevent new factories from starting or storing values after world teardown begins. */
	private closed = false;
	/** Prevent a late factory result from repopulating a manager that was cleared. */
	private cleared = false;
	/** Non-zero while an onDispose callback is running. */
	private disposalCallbackDepth = 0;
	private _changeSubscribers: Map<keyof ResourceTypes, Set<(newValue: any, oldValue: any) => void>> = new Map();
	/** Shallow snapshots of observed resources, keyed by resource key */
	private _observedSnapshots: Map<keyof ResourceTypes, Record<string, unknown>> = new Map();

	/**
	 * Add a resource to the manager.
	 *
	 * Resolution order:
	 * 1. `{ factory, dependsOn?, onDispose? }` → factory with optional deps/disposal
	 * 2. `{ value }` → direct value wrapper (use to store functions/classes as-is)
	 * 3. `typeof === 'function'` → bare factory (no deps)
	 * 4. Anything else → direct value
	 *
	 * @param label The resource key
	 * @param resource The resource value, a factory function, or a factory with dependencies
	 * @returns The resource manager instance for chaining
	 */
	add<K extends keyof ResourceTypes>(
		label: K,
		resource:
			| ResourceTypes[K]
			| ((context: Context) => ResourceTypes[K] | Promise<ResourceTypes[K]>)
			| ResourceFactoryWithDeps<ResourceTypes[K], Context, keyof ResourceTypes & string>
			| ResourceDirectValue<ResourceTypes[K]>,
	) {
		if (this.closed) {
			throw new Error('ResourceManager is closed');
		}
		const storeValue = (value: unknown) => {
			this.resources.set(label, value);
			this.initializedResourceKeys.add(label);
			this.resourceDependencies.set(label, []);
		};

		if (isFactoryWithDeps<ResourceTypes[K]>(resource)) {
			// Factory with optional dependencies and/or onDispose
			this.resourceFactories.set(label, resource.factory as (context: Context) => any | Promise<any>);
			// Type guard narrows to default D=string; the call-site constraint ensures correctness
			this.resourceDependencies.set(label, (resource.dependsOn ?? []) as readonly (keyof ResourceTypes & string)[]);
			if (resource.onDispose) {
				this.resourceDisposers.set(label, resource.onDispose as (resource: any, context: Context) => void | Promise<void>);
			}
		} else if (isDirectValue<ResourceTypes[K]>(resource)) {
			storeValue(resource[RESOURCE_DIRECT]);
		} else if (typeof resource === 'function') {
			// Bare function → treat as factory (no dependencies)
			this.resourceFactories.set(label, resource as (context: Context) => any | Promise<any>);
			this.resourceDependencies.set(label, []);
		} else {
			storeValue(resource);
		}
		return this;
	}

	/**
	 * Try to get a resource from the manager.
	 * Returns the resource value if it exists, or undefined if not found.
	 * Like `get`, initializes factory resources on first access.
	 * @param label The resource key
	 * @param context Context to pass to factory functions (usually the ECSpresso instance)
	 * @returns The resource value, or undefined if not found
	 * @see get — the throwing alternative
	 */
	tryGet<K extends keyof ResourceTypes>(
		label: K,
		...args: ContextArgs<Context>
	): ResourceTypes[K] | undefined {
		if (!this.has(label)) return undefined;
		return this.get(label, ...args);
	}

	/**
	 * Get a resource from the manager
	 * @param label The resource key
	 * @param context Context to pass to factory functions (usually the ECSpresso instance)
	 * @returns The resource value
	 * @throws Error if resource not found
	 * @see tryGet — the non-throwing alternative
	 */
	get<K extends keyof ResourceTypes>(
		label: K,
		...args: ContextArgs<Context>
	): ResourceTypes[K] {
		// Check if we already have the initialized resource
		if (this.resources.has(label)) return this.resources.get(label) as ResourceTypes[K];
		if (this.closed) throw new Error('ResourceManager is closed');

		// Check if we have a factory for this resource
		const factory = this.resourceFactories.get(label);
		if (factory === undefined) {
			throw new Error(`Resource ${String(label)} not found`);
		}

		// Initialize the resource, passing the context
		const context = args[0] as Context;
		const initializedResource = factory(context);

		// If it's not a Promise, store it immediately
		if (!(initializedResource instanceof Promise)) {
			this.resources.set(label, initializedResource);
			this.initializedResourceKeys.add(label);
		} else {
			const initialization = initializedResource.then(value => {
				if (this.cleared) return;
				this.resources.set(label, value);
				this.initializedResourceKeys.add(label);
			});
			this.pendingInitializations.set(label, initialization);
			initialization.then(
				() => {
					if (this.pendingInitializations.get(label) === initialization) {
						this.pendingInitializations.delete(label);
					}
				},
				() => {
					if (this.pendingInitializations.get(label) === initialization) {
						this.pendingInitializations.delete(label);
					}
				},
			);
		}

		return initializedResource;
	}

	/**
	 * Check if a resource exists
	 * @param label The resource key
	 * @returns True if the resource exists
	 */
	has<K extends keyof ResourceTypes>(label: K): boolean {
		return this.resources.has(label) || this.resourceFactories.has(label);
	}

	/**
	 * Remove a resource (without calling onDispose)
	 * @param label The resource key
	 * @returns True if the resource was removed
	 */
	remove<K extends keyof ResourceTypes>(label: K): boolean {
		const resourceRemoved = this.resources.delete(label);
		const factoryRemoved = this.resourceFactories.delete(label);
		this.resourceDependencies.delete(label);
		this.resourceDisposers.delete(label);
		this.initializedResourceKeys.delete(label);
		return resourceRemoved || factoryRemoved;
	}

	/**
	 * Get all resource keys
	 * @returns Array of resource keys
	 */
	getKeys(): Array<keyof ResourceTypes> {
		const keys = new Set([
			...this.resources.keys(),
			...this.resourceFactories.keys()
		]);
		return Array.from(keys);
	}

	/**
	 * Check if a resource needs to be initialized
	 * @param label The resource key
	 * @returns True if the resource needs initialization
	 */
	needsInitialization<K extends keyof ResourceTypes>(label: K): boolean {
		return this.resourceFactories.has(label) && !this.initializedResourceKeys.has(label);
	}

	/**
	 * Get all resource keys that need to be initialized
	 * @returns Array of resource keys that need initialization
	 */
	getPendingInitializationKeys(): Array<keyof ResourceTypes> {
		return Array
			.from(this.resourceFactories.keys())
			.filter(key => !this.initializedResourceKeys.has(key));
	}

	/**
	 * Initialize a specific resource if it's a factory function
	 * @param label The resource key
	 * @param context Context to pass to factory functions
	 * @returns Promise that resolves when the resource is initialized
	 */
	async initializeResource<K extends keyof ResourceTypes>(
		label: K,
		...args: ContextArgs<Context>
	): Promise<void> {
		if (this.closed) return;
		if (!this.resourceFactories.has(label) || this.initializedResourceKeys.has(label)) {
			return;
		}
		const pending = this.pendingInitializations.get(label);
		if (pending) {
			await pending;
			return;
		}

		const factory = this.resourceFactories.get(label);
		if (!factory) return;
		const context = args[0] as Context;
		const initialization = this.initializeResourceValue(label, factory, context);
		this.pendingInitializations.set(label, initialization);
		try {
			await initialization;
		} finally {
			if (this.pendingInitializations.get(label) === initialization) {
				this.pendingInitializations.delete(label);
			}
		}
	}

	private async initializeResourceValue<K extends keyof ResourceTypes>(
		label: K,
		factory: (context: Context) => ResourceTypes[K] | Promise<ResourceTypes[K]>,
		context: Context,
	): Promise<void> {
		const initializedResource = await factory(context);
		if (this.cleared) return;
		this.resources.set(label, initializedResource);
		this.initializedResourceKeys.add(label);
		this.resourceFactories.delete(label);
	}

	/**
	 * Initialize specific resources or all resources that haven't been initialized yet.
	 * Resources are initialized in topological order based on their dependencies.
	 * @param context Context to pass to factory functions (usually the ECSpresso instance)
	 * @param keys Optional array of resource keys to initialize
	 * @returns Promise that resolves when the specified resources are initialized
	 */
	async initializeResources<K extends keyof ResourceTypes>(
		...args: [...ContextArgs<Context>, ...K[]]
	): Promise<void> {
		// First arg is context (when Context is typed), remaining are keys
		const keys = args.slice(1) as K[];

		// Determine which keys to initialize
		const keysToInit = keys.length === 0
			? this.getPendingInitializationKeys()
			: keys;

		// If no keys to initialize, we're done
		if (keysToInit.length === 0) return;

		// Sort keys topologically based on dependencies
		const sortedKeys = topologicalSort(
			keysToInit as readonly (keyof ResourceTypes & string)[],
			(key) => [...(this.resourceDependencies.get(key) ?? [])]
		);

		// Initialize in order (sequentially to respect dependencies)
		for (const key of sortedKeys) {
			await this.initializeResource(key, ...args.slice(0, 1) as ContextArgs<Context>);
		}
	}

	/**
	 * Get the dependencies of a resource
	 * @param label The resource key
	 * @returns Array of resource keys that this resource depends on
	 */
	getDependencies<K extends keyof ResourceTypes>(label: K): readonly (keyof ResourceTypes & string)[] {
		return this.resourceDependencies.get(label) ?? [];
	}

	/**
	 * Dispose a single resource, calling its onDispose callback if it exists
	 * @param label The resource key to dispose
	 * @param context Context to pass to the onDispose callback
	 * @returns True if the resource existed and was disposed, false if it didn't exist
	 */
	async disposeResource<K extends keyof ResourceTypes>(
		label: K,
		...args: ContextArgs<Context>
	): Promise<boolean> {
		const pending = this.pendingInitializations.get(label);
		if (pending) {
			await pending;
		}
		if (!this.resources.has(label) && !this.resourceFactories.has(label)) {
			return false;
		}
		if (this.disposingResourceKeys.has(label)) return false;

		this.disposingResourceKeys.add(label);
		try {
			// Only call onDispose if the resource was initialized. Keep the resource
			// maps intact until the callback completes so it can read dependencies.
			if (this.initializedResourceKeys.has(label)) {
				const disposer = this.resourceDisposers.get(label);
				const resource = this.resources.get(label);
				if (disposer && this.resources.has(label)) {
					const context = args[0] as Context;
					this.disposalCallbackDepth++;
					try {
						await disposer(resource, context);
					} finally {
						this.disposalCallbackDepth--;
					}
				}
			}

			return true;
		} finally {
			// Clean up all tracking after the callback, including when it throws, so
			// a failed disposal cannot be repeated on a later call.
			this.resources.delete(label);
			this.resourceFactories.delete(label);
			this.resourceDependencies.delete(label);
			this.resourceDisposers.delete(label);
			this.initializedResourceKeys.delete(label);
			this._changeSubscribers.delete(label);
			this._observedSnapshots.delete(label);
			this.disposingResourceKeys.delete(label);
		}
	}

	/**
	 * Subscribe to changes for a specific resource key.
	 *
	 * Subscribing marks the resource as "observed." Observed resources are
	 * shallow-diffed at the end of each frame via `flushObserved()`, so in-place
	 * mutations are detected and subscribers notified.
	 *
	 * When the last subscriber unsubscribes, per-frame diffing stops.
	 *
	 * @param key The resource key to watch
	 * @param callback Function called with (newValue, oldValue) when the resource changes
	 * @returns Unsubscribe function
	 */
	onResourceChange<K extends keyof ResourceTypes>(
		key: K,
		callback: (newValue: ResourceTypes[K], oldValue: ResourceTypes[K]) => void
	): () => void {
		const existing = this._changeSubscribers.get(key);
		const subscribers = existing ?? new Set<(newValue: any, oldValue: any) => void>();
		if (!existing) {
			this._changeSubscribers.set(key, subscribers);
			// First subscriber — take a shallow snapshot for per-frame diffing
			const current = this.resources.get(key);
			this._observedSnapshots.set(key, shallowSnapshot(current));
		}
		const wrapped = callback as (newValue: any, oldValue: any) => void;
		subscribers.add(wrapped);

		return () => {
			subscribers.delete(wrapped);
			if (subscribers.size === 0) {
				this._changeSubscribers.delete(key);
				this._observedSnapshots.delete(key);
			}
		};
	}

	/**
	 * Notify subscribers of a resource value change.
	 * Skips notification if the value is unchanged (via Object.is).
	 * @param key The resource key that changed
	 * @param newValue The new resource value
	 * @param oldValue The previous resource value
	 */
	notifyChange<K extends keyof ResourceTypes>(
		key: K,
		newValue: ResourceTypes[K],
		oldValue: ResourceTypes[K]
	): void {
		if (Object.is(newValue, oldValue)) return;
		const subscribers = this._changeSubscribers.get(key);
		if (!subscribers || subscribers.size === 0) return;
		// Update snapshot so flushObserved doesn't double-fire for this change
		if (this._observedSnapshots.has(key)) {
			this._observedSnapshots.set(key, shallowSnapshot(newValue));
		}
		const subscriberSnapshot = [...subscribers];
		for (const cb of subscriberSnapshot) {
			cb(newValue, oldValue);
		}
	}

	/**
	 * Whether a resource has active change subscribers.
	 */
	isObserved<K extends keyof ResourceTypes>(key: K): boolean {
		return this._observedSnapshots.has(key);
	}

	/**
	 * Diff all observed resources against their snapshots.
	 * Fires subscribers for any resource whose shallow properties changed
	 * since the last snapshot, then updates the snapshot.
	 * Call once per frame after all systems have run.
	 */
	flushObserved(): void {
		if (this._observedSnapshots.size === 0) return;
		for (const [key, snapshot] of this._observedSnapshots) {
			const current = this.resources.get(key);
			if (!shallowChanged(current, snapshot)) continue;

			// Reconstruct the old value from the snapshot encoding
			const oldValue = '$value' in snapshot ? snapshot['$value'] : snapshot;
			const newSnapshot = shallowSnapshot(current);
			const subscribers = this._changeSubscribers.get(key)!;
			for (const cb of subscribers) {
				cb(current, oldValue);
			}
			this._observedSnapshots.set(key, newSnapshot);
		}
	}

	/**
	 * Dispose all initialized resources in reverse dependency order.
	 * Resources that depend on others are disposed first.
	 * @param context Context to pass to onDispose callbacks
	 */
	async disposeResources(
		...args: ContextArgs<Context>
	): Promise<void> {
		if (this.disposalCallbackDepth > 0) return;
		if (this.disposePromise) {
			await this.disposePromise;
			return;
		}

		const disposal = this.disposeResourcesInternal(...args);
		this.disposePromise = disposal;
		disposal.then(
			() => {
				if (this.disposePromise === disposal) this.disposePromise = undefined;
			},
			() => {
				if (this.disposePromise === disposal) this.disposePromise = undefined;
			},
		);
		try {
			await disposal;
		} finally {
			if (this.disposePromise === disposal) {
				this.disposePromise = undefined;
			}
		}
	}

	private async disposeResourcesInternal(
		...args: ContextArgs<Context>
	): Promise<void> {
		const pending = Array.from(this.pendingInitializations.values());
		const initializationResults = await Promise.allSettled(pending);
		const errors = initializationResults
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.map(result => result.reason);

		// Get only initialized resource keys after pending factories have settled.
		const initializedKeys = Array.from(this.initializedResourceKeys);
		const sortedKeys = topologicalSort(
			initializedKeys as readonly (keyof ResourceTypes & string)[],
			(key) => [...(this.resourceDependencies.get(key) ?? [])]
		).reverse();

		// Dispose in reverse dependency order and continue after individual failures.
		for (const key of sortedKeys) {
			try {
				await this.disposeResource(key, ...args);
			} catch (error) {
				errors.push(error);
			}
		}

		if (errors.length > 0) {
			throw aggregateErrors(errors, 'One or more resources failed to initialize or dispose');
		}
	}

	/** @internal Prevent new factory work while the owning world is tearing down. */
	close(): void {
		this.closed = true;
	}

	/** @internal Release uninitialized factories and any remaining manager state. */
	clear(): void {
		this.closed = true;
		this.cleared = true;
		this.resources.clear();
		this.resourceFactories.clear();
		this.resourceDependencies.clear();
		this.resourceDisposers.clear();
		this.initializedResourceKeys.clear();
		this.pendingInitializations.clear();
		this.disposingResourceKeys.clear();
		this._changeSubscribers.clear();
		this._observedSnapshots.clear();
	}
}
