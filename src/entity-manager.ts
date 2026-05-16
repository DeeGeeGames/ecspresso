import type { Entity, FilteredEntity, RemoveEntityOptions, HierarchyEntry, HierarchyIteratorOptions } from "./types";
import HierarchyManager from "./hierarchy-manager";
import QueryCache from "./query-cache";

/** Returns true if any component index in `changedIdx` was modified after `threshold`. */
function hasChangedComponentFlat(
	arr: Uint32Array | undefined,
	changedIdx: ReadonlyArray<number> | undefined,
	threshold: number,
): boolean {
	if (!arr || !changedIdx) return false;
	for (let i = 0; i < changedIdx.length; i++) {
		const idx = changedIdx[i];
		if (idx === undefined || idx >= arr.length) continue;
		const v = arr[idx];
		if (v !== undefined && v > threshold) return true;
	}
	return false;
}

type ComponentCallback<ComponentTypes> = (ctx: { value: unknown; entity: Entity<ComponentTypes> }) => void;

/**
 * Manages zero-allocation callback iteration with safe mid-iteration unsubscribe.
 * During iteration, unsubscribes are deferred. Snapshot length guarantees all
 * callbacks registered at call time execute. Compaction runs when iteration ends.
 */
class CallbackList<ComponentTypes> {
	private readonly callbacks: ComponentCallback<ComponentTypes>[] = [];
	private _iterDepth = 0;
	private _pendingRemovals: ComponentCallback<ComponentTypes>[] = [];

	add(cb: ComponentCallback<ComponentTypes>): void {
		this.callbacks.push(cb);
	}

	remove(cb: ComponentCallback<ComponentTypes>): void {
		if (this._iterDepth > 0) {
			this._pendingRemovals.push(cb);
			return;
		}
		const idx = this.callbacks.indexOf(cb);
		if (idx !== -1) this.callbacks.splice(idx, 1);
	}

	invoke(ctx: { value: unknown; entity: Entity<ComponentTypes> }): void {
		this._iterDepth++;
		const len = this.callbacks.length;
		for (let i = 0; i < len; i++) {
			const cb = this.callbacks[i];
			if (cb) cb(ctx);
		}
		this._iterDepth--;
		if (this._iterDepth === 0 && this._pendingRemovals.length > 0) {
			for (const cb of this._pendingRemovals) {
				const idx = this.callbacks.indexOf(cb);
				if (idx !== -1) this.callbacks.splice(idx, 1);
			}
			this._pendingRemovals.length = 0;
		}
	}
}

export default
class EntityManager<ComponentTypes> {
	private nextId: number = 1;
	private entities: Map<number, Entity<ComponentTypes>> = new Map();
	private componentIndices: Map<keyof ComponentTypes, Set<number>> = new Map();
	/**
	 * Callbacks registered for component additions
	 */
	private addedCallbacks: Map<keyof ComponentTypes, CallbackList<ComponentTypes>> = new Map();
	/**
	 * Callbacks registered for component removals
	 */
	private removedCallbacks: Map<keyof ComponentTypes, CallbackList<ComponentTypes>> = new Map();
	/**
	 * Hierarchy manager for parent-child relationships
	 */
	private hierarchyManager: HierarchyManager = new HierarchyManager();
	/**
	 * Per-type component dispose callbacks.
	 * Called when a component is removed (explicit removal, entity destruction, or replacement).
	 */
	private disposeCallbacks: Map<keyof ComponentTypes, (ctx: { value: unknown; entityId: number }) => void> = new Map();
	/**
	 * Per-entity per-component change sequence tracking.
	 * Flat storage: changeSeqs[entityId][componentIdx] = seq number when last changed.
	 * Component names are mapped to dense indices via componentNameToIdx.
	 * Uint32Array zero-init means "never changed" (seq numbers start at 1).
	 */
	private changeSeqs: (Uint32Array | undefined)[] = [];
	private componentNameToIdx: Map<keyof ComponentTypes, number> = new Map();
	// 2-slot LRU for repeated same-name lookups, biggest win for plugin code
	// that calls markChanged with the same handful of literal strings in tight loops.
	private _idxCache0Name: keyof ComponentTypes | undefined;
	private _idxCache0Idx: number = -1;
	private _idxCache1Name: keyof ComponentTypes | undefined;
	private _idxCache1Idx: number = -1;
	/**
	 * Subscription bitmap for change tracking. `null` means track all (the
	 * default); a Uint8Array means explicit-only, with 1 at indices that opted
	 * in via `setTrackedChanges`. Indices outside the array's bounds are
	 * treated as 0 (not tracked).
	 */
	private _subscribedComponentIdx: Uint8Array | null = null;
	/**
	 * Monotonic sequence counter for change detection.
	 * Each markChanged call increments this and stamps the new value.
	 */
	private _changeSeq: number = 0;

	// ==================== Lifecycle Hook Arrays ====================
	private _afterComponentAddedHooks: Array<(entityId: number, componentName: keyof ComponentTypes) => void> = [];
	private _afterEntityMutatedHooks: Array<(entityId: number) => void> = [];
	private _afterComponentRemovedHooks: Array<(entityId: number, componentName: keyof ComponentTypes) => void> = [];
	private _beforeEntityRemovedHooks: Array<(entityId: number) => void> = [];
	private _afterParentChangedHooks: Array<(childId: number) => void> = [];

	/**
	 * Incrementally-maintained query result cache. Caches the static portion
	 * (with / without / parentHas) of each registered query shape and is
	 * updated via the lifecycle hook arrays above. Lazily created on the
	 * first cacheable query lookup.
	 */
	private readonly _queryCache: QueryCache<ComponentTypes> = new QueryCache<ComponentTypes>({
		getEntity: (id) => this.entities.get(id),
		getParent: (id) => this.hierarchyManager.getParent(id),
		getChildren: (id) => this.hierarchyManager.getChildren(id),
		allEntities: () => this.entities.values(),
		componentIndex: (c) => this.componentIndices.get(c),
	});

	// ==================== Batching Fields ====================
	private _batchingDepth: number = 0;
	private _batchedEntityIds: Set<number> = new Set();
	/** Component keys being added in the current addComponents batch, if any.
	 *  Used by required component resolution to skip auto-adding explicitly provided components. */
	_pendingBatchKeys: ReadonlySet<keyof ComponentTypes> | null = null;

	get entityCount(): number {
		return this.entities.size;
	}

	createEntity(): Entity<ComponentTypes> {
		const id = this.nextId++;
		const entity: Entity<ComponentTypes> = { id, components: {} };
		this.entities.set(id, entity);
		return entity;
	}

	/**
	 * Register a dispose callback for a component type.
	 * Called when a component is removed (explicit removal, entity destruction, or replacement).
	 * Later registrations replace earlier ones for the same component type.
	 * @param componentName The component type to register disposal for
	 * @param callback Function receiving the component value being disposed and the entity ID
	 */
	registerDispose<ComponentName extends keyof ComponentTypes>(
		componentName: ComponentName,
		callback: (ctx: { value: ComponentTypes[ComponentName]; entityId: number }) => void
	): void {
		this.disposeCallbacks.set(componentName, callback as (ctx: { value: unknown; entityId: number }) => void);
	}

	/**
	 * Get all registered dispose callbacks.
	 * @internal Used by ECSpresso for plugin installation
	 */
	getDisposeCallbacks(): Map<keyof ComponentTypes, (ctx: { value: unknown; entityId: number }) => void> {
		return this.disposeCallbacks;
	}

	/**
	 * Invoke the dispose callback for a component, if registered.
	 * Errors are caught and logged to prevent blocking removal.
	 */
	private invokeDispose<ComponentName extends keyof ComponentTypes>(
		componentName: ComponentName,
		value: ComponentTypes[ComponentName],
		entityId: number
	): void {
		const cb = this.disposeCallbacks.get(componentName);
		if (!cb) return;
		try {
			cb({ value, entityId });
		} catch (error) {
			console.warn(`Component dispose callback for '${String(componentName)}' threw:`, error);
		}
	}

	// TODO: Component object pooling if(/when) garbage collection is an issue...?
	addComponent<ComponentName extends keyof ComponentTypes>(
		entityId: number,
		componentName: ComponentName,
		data: ComponentTypes[ComponentName]
	) {
		const entity = this.entities.get(entityId);

		if (!entity) {
			throw new Error(`Cannot add component '${String(componentName)}': Entity with ID ${entityId} does not exist`);
		}

		// Dispose old value if replacing an existing component
		const existing = entity.components[componentName];
		if (existing !== undefined) {
			this.invokeDispose(componentName, existing as ComponentTypes[ComponentName], entity.id);
		}

		entity.components[componentName] = data;

		// Update component index
		if (!this.componentIndices.has(componentName)) {
			this.componentIndices.set(componentName, new Set());
		}
		this.componentIndices.get(componentName)?.add(entity.id);
		// Trigger added callbacks (index-based iteration; unsubscribe nulls slots, compacted after)
		const callbacks = this.addedCallbacks.get(componentName);
		if (callbacks) {
			callbacks.invoke({ value: data, entity });
		}

		// Update query cache before user hooks so any hook-driven query sees fresh state
		this._queryCache.onComponentChanged(entity.id, componentName);

		// Fire afterComponentAdded hooks (may trigger recursive addComponent)
		this._batchingDepth++;
		for (const hook of this._afterComponentAddedHooks) {
			hook(entity.id, componentName);
		}
		this._batchedEntityIds.add(entity.id);
		this._batchingDepth--;

		// Flush afterEntityMutated when outermost batch completes
		if (this._batchingDepth === 0) {
			for (const entityId of this._batchedEntityIds) {
				for (const hook of this._afterEntityMutatedHooks) {
					hook(entityId);
				}
			}
			this._batchedEntityIds.clear();
		}

		return this;
	}

	/**
	 * Add multiple components to an entity at once
	 * @param entityId Entity ID to add components to
	 * @param components Object with component names as keys and component data as values
	 */
	addComponents<
		T extends { [K in keyof ComponentTypes]?: ComponentTypes[K] }
	>(
		entityId: number,
		components: T & Record<Exclude<keyof T, keyof ComponentTypes>, never>
	) {
		const entity = this.entities.get(entityId);

		if (!entity) {
			throw new Error(`Cannot add components: Entity with ID ${entityId} does not exist`);
		}

		const outerPending = this._pendingBatchKeys;
		this._pendingBatchKeys = new Set(Object.keys(components) as (keyof ComponentTypes)[]);
		this._batchingDepth++;
		for (const componentName in components) {
			this.addComponent(
				entity.id,
				componentName as keyof ComponentTypes,
				components[componentName as keyof T] as ComponentTypes[keyof ComponentTypes]
			);
		}
		this._batchingDepth--;
		this._pendingBatchKeys = outerPending;

		if (this._batchingDepth === 0) {
			for (const entityId of this._batchedEntityIds) {
				for (const hook of this._afterEntityMutatedHooks) {
					hook(entityId);
				}
			}
			this._batchedEntityIds.clear();
		}

		return this;
	}

	removeComponent<ComponentName extends keyof ComponentTypes>(
		entityId: number,
		componentName: ComponentName
	) {
		const entity = this.entities.get(entityId);

		if (!entity) {
			throw new Error(`Cannot remove component '${String(componentName)}': Entity with ID ${entityId} does not exist`);
		}
		// Get old value for callbacks
		const oldValue = entity.components[componentName] as ComponentTypes[ComponentName] | undefined;

		// Invoke dispose before deletion and removal callbacks
		if (oldValue !== undefined) {
			this.invokeDispose(componentName, oldValue, entity.id);
		}

		delete entity.components[componentName];

		// Trigger removed callbacks (index-based iteration; unsubscribe nulls slots, compacted after)
		const removeCbs = this.removedCallbacks.get(componentName);
		if (removeCbs && oldValue !== undefined) {
			removeCbs.invoke({ value: oldValue, entity });
		}

		// Update component index
		this.componentIndices.get(componentName)?.delete(entity.id);

		// Fire afterComponentRemoved hooks (only if component was present)
		if (oldValue !== undefined) {
			this._queryCache.onComponentChanged(entity.id, componentName);
			for (const hook of this._afterComponentRemovedHooks) {
				hook(entity.id, componentName);
			}
		}

		return this;
	}

	getComponent<ComponentName extends keyof ComponentTypes>(entityId: number, componentName: ComponentName): ComponentTypes[ComponentName] | undefined {
		return this.entities.get(entityId)?.components[componentName];
	}

	getEntitiesWithQuery<
		WithComponents extends keyof ComponentTypes = never,
		WithoutComponents extends keyof ComponentTypes = never
	>(
		required: ReadonlyArray<WithComponents> = [],
		excluded: ReadonlyArray<WithoutComponents> = [],
		changed?: ReadonlyArray<keyof ComponentTypes>,
		changeThreshold?: number,
		parentHas?: ReadonlyArray<keyof ComponentTypes>,
	): Array<FilteredEntity<ComponentTypes, WithComponents extends never ? never : WithComponents, WithoutComponents extends never ? never : WithoutComponents>> {
		return this.getEntitiesWithQueryInto([], required, excluded, changed, changeThreshold, parentHas);
	}

	/**
	 * Fill an existing array with entities matching the query, clearing it first.
	 * Returns the same array reference for convenience.
	 */
	getEntitiesWithQueryInto<
		WithComponents extends keyof ComponentTypes = never,
		WithoutComponents extends keyof ComponentTypes = never
	>(
		output: Array<FilteredEntity<ComponentTypes, WithComponents extends never ? never : WithComponents, WithoutComponents extends never ? never : WithoutComponents>>,
		required: ReadonlyArray<WithComponents> = [],
		excluded: ReadonlyArray<WithoutComponents> = [],
		changed?: ReadonlyArray<keyof ComponentTypes>,
		changeThreshold?: number,
		parentHas?: ReadonlyArray<keyof ComponentTypes>,
	): Array<FilteredEntity<ComponentTypes, WithComponents extends never ? never : WithComponents, WithoutComponents extends never ? never : WithoutComponents>> {
		output.length = 0;

		const hasChangedFilter = changed !== undefined && changed.length > 0 && changeThreshold !== undefined;
		let changedIdx: number[] | undefined;
		if (hasChangedFilter) {
			changedIdx = [];
			for (const name of changed) {
				const idx = this.componentNameToIdx.get(name);
				if (idx !== undefined) changedIdx.push(idx);
			}
		}

		// Runtime query filtering guarantees WithComponents/WithoutComponents constraints,
		// but TypeScript can't narrow Entity<CT> to FilteredEntity from imperative logic.
		type ResultEntry = FilteredEntity<ComponentTypes, WithComponents extends never ? never : WithComponents, WithoutComponents extends never ? never : WithoutComponents>;

		// Empty static shape: walk all entities. Cheaper than maintaining a
		// cache that mirrors the entity set.
		const hasParentHasFilter = parentHas !== undefined && parentHas.length > 0;
		if (required.length === 0 && excluded.length === 0 && !hasParentHasFilter) {
			if (!hasChangedFilter) {
				for (const entity of this.entities.values()) {
					output.push(entity as unknown as ResultEntry);
				}
				return output;
			}
			for (const entity of this.entities.values()) {
				if (!hasChangedComponentFlat(this.changeSeqs[entity.id], changedIdx, changeThreshold ?? 0)) continue;
				output.push(entity as unknown as ResultEntry);
			}
			return output;
		}

		const members = this._queryCache.getOrCreate(
			required as ReadonlyArray<keyof ComponentTypes>,
			excluded as ReadonlyArray<keyof ComponentTypes>,
			(parentHas ?? []) as ReadonlyArray<keyof ComponentTypes>,
		);

		if (members.size === 0) return output;

		if (hasChangedFilter) {
			for (const entity of members.values()) {
				if (!hasChangedComponentFlat(this.changeSeqs[entity.id], changedIdx, changeThreshold ?? 0)) continue;
				output.push(entity as unknown as ResultEntry);
			}
			return output;
		}

		for (const entity of members.values()) {
			output.push(entity as unknown as ResultEntry);
		}

		return output;
	}

	/** Test-only accessor for the internal query cache. @internal */
	get _queryCacheForTesting(): QueryCache<ComponentTypes> {
		return this._queryCache;
	}

	removeEntity(entityId: number, options?: RemoveEntityOptions): boolean {
		const entity = this.entities.get(entityId);

		if (!entity) return false;

		const cascade = options?.cascade ?? true;

		if (cascade) {
			// Get all descendants first (depth-first order)
			const descendants = this.hierarchyManager.getDescendants(entity.id);
			// Fire beforeEntityRemoved for descendants (reverse: children before parents)
			for (let i = descendants.length - 1; i >= 0; i--) {
				const descendantId = descendants[i];
				if (descendantId === undefined) continue;
				this._queryCache.onEntityRemoved(descendantId);
				for (const hook of this._beforeEntityRemovedHooks) {
					hook(descendantId);
				}
			}
			// Fire beforeEntityRemoved for the entity itself
			this._queryCache.onEntityRemoved(entity.id);
			for (const hook of this._beforeEntityRemovedHooks) {
				hook(entity.id);
			}
			// Now do actual removal (descendants in reverse order)
			for (let i = descendants.length - 1; i >= 0; i--) {
				const descendantId = descendants[i];
				if (descendantId === undefined) continue;
				this.removeEntityInternal(descendantId);
			}
		} else {
			// Fire beforeEntityRemoved for just this entity
			this._queryCache.onEntityRemoved(entity.id);
			for (const hook of this._beforeEntityRemovedHooks) {
				hook(entity.id);
			}
		}

		return this.removeEntityInternal(entity.id);
	}

	/**
	 * Internal method to remove a single entity without cascade logic
	 */
	private removeEntityInternal(entityId: number): boolean {
		const entity = this.entities.get(entityId);
		if (!entity) return false;

		// Clean up hierarchy
		this.hierarchyManager.removeEntity(entityId);

		// Trigger disposal and removal callbacks for each component before removing the entity
		for (const componentName of Object.keys(entity.components) as Array<keyof ComponentTypes>) {
			const oldValue = entity.components[componentName];

			if (oldValue !== undefined) {
				// Invoke dispose before removal callbacks
				this.invokeDispose(componentName, oldValue as ComponentTypes[keyof ComponentTypes], entity.id);

				// Trigger removed callbacks (index-based iteration; unsubscribe nulls slots, compacted after)
				const removeCbs = this.removedCallbacks.get(componentName);
				if (removeCbs) {
					removeCbs.invoke({ value: oldValue, entity });
				}
			}

			// Remove entity from component indices
			this.componentIndices.get(componentName)?.delete(entity.id);
		}

		// Clean up change sequences
		this.changeSeqs[entity.id] = undefined;

		// Remove the entity itself
		return this.entities.delete(entity.id);
	}

	getEntity(entityId: number): Entity<ComponentTypes> | undefined {
		return this.entities.get(entityId);
	}

	/**
	 * Register a callback when a specific component is added to any entity
	 * @param componentName The component key
	 * @param handler Function receiving the new component value and the entity
	 * @returns Unsubscribe function to remove the callback
	 */
	onComponentAdded<ComponentName extends keyof ComponentTypes>(
		componentName: ComponentName,
		handler: (ctx: { value: ComponentTypes[ComponentName]; entity: Entity<ComponentTypes> }) => void
	): () => void {
		const widened = handler as ComponentCallback<ComponentTypes>;
		let list = this.addedCallbacks.get(componentName);
		if (!list) {
			list = new CallbackList();
			this.addedCallbacks.set(componentName, list);
		}
		list.add(widened);
		return () => {
			this.addedCallbacks.get(componentName)?.remove(widened);
		};
	}

	/**
	 * Register a callback when a specific component is removed from any entity
	 * @param componentName The component key
	 * @param handler Function receiving the old component value and the entity
	 * @returns Unsubscribe function to remove the callback
	 */
	onComponentRemoved<ComponentName extends keyof ComponentTypes>(
		componentName: ComponentName,
		handler: (ctx: { value: ComponentTypes[ComponentName]; entity: Entity<ComponentTypes> }) => void
	): () => void {
		const widened = handler as ComponentCallback<ComponentTypes>;
		let list = this.removedCallbacks.get(componentName);
		if (!list) {
			list = new CallbackList();
			this.removedCallbacks.set(componentName, list);
		}
		list.add(widened);
		return () => {
			this.removedCallbacks.get(componentName)?.remove(widened);
		};
	}

	// ==================== Lifecycle Hook Registration ====================

	onAfterComponentAdded(hook: (entityId: number, componentName: keyof ComponentTypes) => void): () => void {
		this._afterComponentAddedHooks.push(hook);
		return () => {
			const idx = this._afterComponentAddedHooks.indexOf(hook);
			if (idx !== -1) this._afterComponentAddedHooks.splice(idx, 1);
		};
	}

	onAfterEntityMutated(hook: (entityId: number) => void): () => void {
		this._afterEntityMutatedHooks.push(hook);
		return () => {
			const idx = this._afterEntityMutatedHooks.indexOf(hook);
			if (idx !== -1) this._afterEntityMutatedHooks.splice(idx, 1);
		};
	}

	onAfterComponentRemoved(hook: (entityId: number, componentName: keyof ComponentTypes) => void): () => void {
		this._afterComponentRemovedHooks.push(hook);
		return () => {
			const idx = this._afterComponentRemovedHooks.indexOf(hook);
			if (idx !== -1) this._afterComponentRemovedHooks.splice(idx, 1);
		};
	}

	onBeforeEntityRemoved(hook: (entityId: number) => void): () => void {
		this._beforeEntityRemovedHooks.push(hook);
		return () => {
			const idx = this._beforeEntityRemovedHooks.indexOf(hook);
			if (idx !== -1) this._beforeEntityRemovedHooks.splice(idx, 1);
		};
	}

	onAfterParentChanged(hook: (childId: number) => void): () => void {
		this._afterParentChangedHooks.push(hook);
		return () => {
			const idx = this._afterParentChangedHooks.indexOf(hook);
			if (idx !== -1) this._afterParentChangedHooks.splice(idx, 1);
		};
	}

	// ==================== Change Detection Methods ====================

	/**
	 * The current monotonic change sequence value.
	 * Each markChanged call increments this before stamping.
	 */
	get changeSeq(): number {
		return this._changeSeq;
	}

	/**
	 * Mark a component as changed on an entity, stamping the next sequence number.
	 * @param entityId The entity ID
	 * @param componentName The component that changed
	 */
	markChanged<K extends keyof ComponentTypes>(entityId: number, componentName: K): void {
		this.markChangedByIdx(entityId, this.getOrAssignComponentIdx(componentName));
	}

	/**
	 * Fast-path companion to markChanged that skips the component-name lookup.
	 * Use after resolving names to indices once via getOrAssignComponentIdx.
	 */
	markChangedByIdx(entityId: number, componentIdx: number): void {
		const bitmap = this._subscribedComponentIdx;
		if (bitmap !== null && (componentIdx >= bitmap.length || bitmap[componentIdx] === 0)) return;
		const seq = ++this._changeSeq;
		let arr = this.changeSeqs[entityId];
		if (arr === undefined) {
			arr = new Uint32Array(Math.max(componentIdx + 1, 8));
			this.changeSeqs[entityId] = arr;
		} else if (componentIdx >= arr.length) {
			const grown = new Uint32Array(Math.max(componentIdx + 1, arr.length * 2));
			grown.set(arr);
			arr = grown;
			this.changeSeqs[entityId] = arr;
		}
		arr[componentIdx] = seq;
	}

	getOrAssignComponentIdx<K extends keyof ComponentTypes>(componentName: K): number {
		if (componentName === this._idxCache0Name) return this._idxCache0Idx;
		if (componentName === this._idxCache1Name) {
			const idx = this._idxCache1Idx;
			this._idxCache1Name = this._idxCache0Name;
			this._idxCache1Idx = this._idxCache0Idx;
			this._idxCache0Name = componentName;
			this._idxCache0Idx = idx;
			return idx;
		}
		let idx = this.componentNameToIdx.get(componentName);
		if (idx === undefined) {
			idx = this.componentNameToIdx.size;
			this.componentNameToIdx.set(componentName, idx);
		}
		this._idxCache1Name = this._idxCache0Name;
		this._idxCache1Idx = this._idxCache0Idx;
		this._idxCache0Name = componentName;
		this._idxCache0Idx = idx;
		return idx;
	}

	/**
	 * @internal Switch to explicit-only change tracking. After this call,
	 * markChangedByIdx is a no-op for any component idx not in `names`.
	 */
	setTrackedChanges(names: ReadonlyArray<keyof ComponentTypes>): void {
		let bitmap = new Uint8Array(Math.max(names.length + 4, 8));
		for (let i = 0; i < names.length; i++) {
			const name = names[i];
			if (name === undefined) continue;
			const idx = this.getOrAssignComponentIdx(name);
			if (idx >= bitmap.length) {
				const grown = new Uint8Array(Math.max(idx + 1, bitmap.length * 2));
				grown.set(bitmap);
				bitmap = grown;
			}
			bitmap[idx] = 1;
		}
		this._subscribedComponentIdx = bitmap;
	}

	/**
	 * Get the sequence number at which a component was last changed on an entity
	 * @param entityId The entity ID
	 * @param componentName The component to check
	 * @returns The sequence number when last changed, or -1 if never changed
	 */
	getChangeSeq<K extends keyof ComponentTypes>(entityId: number, componentName: K): number {
		const idx = this.componentNameToIdx.get(componentName);
		if (idx === undefined) return -1;
		const arr = this.changeSeqs[entityId];
		if (!arr || idx >= arr.length) return -1;
		const v = arr[idx];
		if (v === undefined || v === 0) return -1;
		return v;
	}

	// ==================== Hierarchy Methods ====================

	/**
	 * Create an entity as a child of another entity with initial components
	 * @param parentId The parent entity ID
	 * @param components Initial components to add
	 * @returns The created child entity
	 */
	spawnChild<T extends { [K in keyof ComponentTypes]?: ComponentTypes[K] }>(
		parentId: number,
		components: T & Record<Exclude<keyof T, keyof ComponentTypes>, never>
	): FilteredEntity<ComponentTypes, keyof T & keyof ComponentTypes> {
		const entity = this.createEntity();
		this.addComponents(entity.id, components);
		this.setParent(entity.id, parentId);
		return entity as FilteredEntity<ComponentTypes, keyof T & keyof ComponentTypes>;
	}

	/**
	 * Set the parent of an entity
	 * @param childId The entity ID to set as a child
	 * @param parentId The entity ID to set as the parent
	 */
	setParent(childId: number, parentId: number): this {
		this.hierarchyManager.setParent(childId, parentId);
		this._queryCache.onParentChanged(childId);
		for (const hook of this._afterParentChangedHooks) {
			hook(childId);
		}
		return this;
	}

	/**
	 * Remove the parent relationship for an entity (orphan it)
	 * @param childId The entity ID to orphan
	 * @returns true if a parent was removed, false if entity had no parent
	 */
	removeParent(childId: number): boolean {
		const result = this.hierarchyManager.removeParent(childId);
		if (result) {
			this._queryCache.onParentChanged(childId);
			for (const hook of this._afterParentChangedHooks) {
				hook(childId);
			}
		}
		return result;
	}

	/**
	 * Get the parent of an entity
	 * @param entityId The entity ID to get the parent of
	 * @returns The parent entity ID, or null if no parent
	 */
	getParent(entityId: number): number | null {
		return this.hierarchyManager.getParent(entityId);
	}

	/**
	 * Get all children of an entity in insertion order
	 * @param parentId The parent entity ID
	 * @returns Readonly array of child entity IDs
	 */
	getChildren(parentId: number): readonly number[] {
		return this.hierarchyManager.getChildren(parentId);
	}

	/**
	 * Get a child at a specific index
	 * @param parentId The parent entity ID
	 * @param index The index of the child
	 * @returns The child entity ID, or null if index is out of bounds
	 */
	getChildAt(parentId: number, index: number): number | null {
		return this.hierarchyManager.getChildAt(parentId, index);
	}

	/**
	 * Get the index of a child within its parent's children list
	 * @param parentId The parent entity ID
	 * @param childId The child entity ID to find
	 * @returns The index of the child, or -1 if not found
	 */
	getChildIndex(parentId: number, childId: number): number {
		return this.hierarchyManager.getChildIndex(parentId, childId);
	}

	/**
	 * Get all ancestors of an entity in order [parent, grandparent, ...]
	 * @param entityId The entity ID to get ancestors of
	 * @returns Readonly array of ancestor entity IDs
	 */
	getAncestors(entityId: number): readonly number[] {
		return this.hierarchyManager.getAncestors(entityId);
	}

	/**
	 * Get all descendants of an entity in depth-first order
	 * @param entityId The entity ID to get descendants of
	 * @returns Readonly array of descendant entity IDs
	 */
	getDescendants(entityId: number): readonly number[] {
		return this.hierarchyManager.getDescendants(entityId);
	}

	/**
	 * Get the root ancestor of an entity (topmost parent), or self if no parent
	 * @param entityId The entity ID to get the root of
	 * @returns The root entity ID
	 */
	getRoot(entityId: number): number {
		return this.hierarchyManager.getRoot(entityId);
	}

	/**
	 * Get siblings of an entity (other children of the same parent)
	 * @param entityId The entity ID to get siblings of
	 * @returns Readonly array of sibling entity IDs
	 */
	getSiblings(entityId: number): readonly number[] {
		return this.hierarchyManager.getSiblings(entityId);
	}

	/**
	 * Check if an entity is a descendant of another entity
	 * @param entityId The potential descendant ID
	 * @param ancestorId The potential ancestor ID
	 * @returns true if entityId is a descendant of ancestorId
	 */
	isDescendantOf(entityId: number, ancestorId: number): boolean {
		return this.hierarchyManager.isDescendantOf(entityId, ancestorId);
	}

	/**
	 * Check if an entity is an ancestor of another entity
	 * @param entityId The potential ancestor ID
	 * @param descendantId The potential descendant ID
	 * @returns true if entityId is an ancestor of descendantId
	 */
	isAncestorOf(entityId: number, descendantId: number): boolean {
		return this.hierarchyManager.isAncestorOf(entityId, descendantId);
	}

	/**
	 * Returns true when at least one parent-child relationship exists.
	 */
	get hasHierarchy(): boolean {
		return this.hierarchyManager.hasHierarchy;
	}

	/**
	 * Get all root entities (entities that have children but no parent)
	 * @returns Readonly array of root entity IDs
	 */
	getRootEntities(): readonly number[] {
		return this.hierarchyManager.getRootEntities();
	}

	/**
	 * Traverse the hierarchy in parent-first (breadth-first) order.
	 * Parents are guaranteed to be visited before their children.
	 * @param callback Function called for each entity with (entityId, parentId, depth)
	 * @param options Optional traversal options (roots to filter to specific subtrees)
	 */
	forEachInHierarchy(
		callback: (entityId: number, parentId: number | null, depth: number) => void,
		options?: HierarchyIteratorOptions
	): void {
		this.hierarchyManager.forEachInHierarchy(callback, options);
	}

	/**
	 * Generator-based hierarchy traversal in parent-first (breadth-first) order.
	 * Supports early termination via break.
	 * @param options Optional traversal options (roots to filter to specific subtrees)
	 * @yields HierarchyEntry for each entity in parent-first order
	 */
	hierarchyIterator(options?: HierarchyIteratorOptions): Generator<HierarchyEntry, void, unknown> {
		return this.hierarchyManager.hierarchyIterator(options);
	}
}
