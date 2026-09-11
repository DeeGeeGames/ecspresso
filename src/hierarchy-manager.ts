import type { HierarchyEntry, HierarchyIteratorOptions } from "./types";

/**
 * Manages parent-child relationships between entities.
 * Handles hierarchy storage, validation, and traversal operations.
 */
export default class HierarchyManager {
	/** childId -> parentId */
	private parentMap: Map<number, number> = new Map();
	/** parentId -> ordered childIds */
	private childrenMap: Map<number, number[]> = new Map();
	/** Pre-allocated flat BFS queue for forEachInHierarchy [entityId, parentId (-1=null), depth, ...] */
	private _bfsQueue: number[] = [];

	/**
	 * Set the parent of an entity.
	 * @param childId The entity to set as a child
	 * @param parentId The entity to set as the parent
	 * @throws Error if this would create a circular reference or self-parenting
	 */
	setParent(childId: number, parentId: number): this {
		if (childId === parentId) {
			throw new Error(`Cannot set entity ${childId} as its own parent`);
		}

		// Check for circular reference by walking up from the prospective parent
		if (this.wouldCreateCycle(childId, parentId)) {
			throw new Error('Cannot set parent: would create circular reference');
		}

		// Remove from old parent's children list if exists
		const oldParent = this.parentMap.get(childId);
		if (oldParent !== undefined) {
			const oldChildren = this.childrenMap.get(oldParent);
			if (oldChildren) {
				const idx = oldChildren.indexOf(childId);
				if (idx !== -1) {
					oldChildren.splice(idx, 1);
				}
			}
		}

		// Set new parent
		this.parentMap.set(childId, parentId);

		// Add to new parent's children list
		const children = this.childrenMap.get(parentId);
		if (children) {
			children.push(childId);
		} else {
			this.childrenMap.set(parentId, [childId]);
		}

		return this;
	}

	/**
	 * Remove the parent relationship for an entity (orphan it).
	 * @param childId The entity to orphan
	 * @returns true if a parent was removed, false if entity had no parent
	 */
	removeParent(childId: number): boolean {
		const parentId = this.parentMap.get(childId);
		if (parentId === undefined) {
			return false;
		}

		// Remove from parent's children list
		const children = this.childrenMap.get(parentId);
		if (children) {
			const idx = children.indexOf(childId);
			if (idx !== -1) {
				children.splice(idx, 1);
			}
		}

		this.parentMap.delete(childId);
		return true;
	}

	/**
	 * Get the parent of an entity.
	 * @param entityId The entity to get the parent of
	 * @returns The parent entity ID, or null if no parent
	 */
	getParent(entityId: number): number | null {
		return this.parentMap.get(entityId) ?? null;
	}

	/**
	 * Get all children of an entity in insertion order.
	 * @param parentId The parent entity
	 * @returns Readonly array of child entity IDs
	 */
	getChildren(parentId: number): readonly number[] {
		const children = this.childrenMap.get(parentId);
		return children ? [...children] : [];
	}

	/**
	 * Get a child at a specific index.
	 * @param parentId The parent entity
	 * @param index The index of the child
	 * @returns The child entity ID, or null if index is out of bounds
	 */
	getChildAt(parentId: number, index: number): number | null {
		if (index < 0) return null;
		const children = this.childrenMap.get(parentId);
		if (!children || index >= children.length) return null;
		return children[index] ?? null;
	}

	/**
	 * Get the index of a child within its parent's children list.
	 * @param parentId The parent entity
	 * @param childId The child entity to find
	 * @returns The index of the child, or -1 if not found
	 */
	getChildIndex(parentId: number, childId: number): number {
		const children = this.childrenMap.get(parentId);
		if (!children) return -1;
		return children.indexOf(childId);
	}

	/**
	 * Remove an entity from the hierarchy (called when entity is destroyed).
	 * Orphans any children and removes from parent's children list.
	 * @param entityId The entity being removed
	 * @returns Information about the removal (oldParent and orphanedChildren)
	 */
	removeEntity(entityId: number): { oldParent: number | null; orphanedChildren: number[] } {
		const oldParent = this.parentMap.get(entityId) ?? null;

		// Remove from parent's children list
		if (oldParent !== null) {
			const parentChildren = this.childrenMap.get(oldParent);
			if (parentChildren) {
				const idx = parentChildren.indexOf(entityId);
				if (idx !== -1) {
					parentChildren.splice(idx, 1);
				}
			}
		}

		this.parentMap.delete(entityId);

		// Orphan all children
		const children = this.childrenMap.get(entityId) ?? [];
		const orphanedChildren = [...children];
		for (const childId of children) {
			this.parentMap.delete(childId);
		}
		this.childrenMap.delete(entityId);

		return { oldParent, orphanedChildren };
	}

	/**
	 * Get all ancestors of an entity in order [parent, grandparent, ...].
	 * @param entityId The entity to get ancestors of
	 * @returns Readonly array of ancestor entity IDs
	 */
	getAncestors(entityId: number): readonly number[] {
		const ancestors: number[] = [];
		let current = this.parentMap.get(entityId);
		while (current !== undefined) {
			ancestors.push(current);
			current = this.parentMap.get(current);
		}
		return ancestors;
	}

	/**
	 * Get all descendants of an entity in depth-first order.
	 * @param entityId The entity to get descendants of
	 * @returns Readonly array of descendant entity IDs
	 */
	getDescendants(entityId: number): readonly number[] {
		const descendants: number[] = [];
		const initialChildren = this.childrenMap.get(entityId);
		if (!initialChildren) return descendants;

		// Use push/pop (O(1)) instead of shift/unshift (O(n)).
		// Seed stack in reverse so pop() yields children in original order.
		const stack = initialChildren.slice().reverse();

		while (stack.length > 0) {
			const current = stack.pop() as number;
			descendants.push(current);
			const children = this.childrenMap.get(current);
			if (children) {
				for (let i = children.length - 1; i >= 0; i--) {
					stack.push(children[i] as number);
				}
			}
		}

		return descendants;
	}

	/**
	 * Get the root ancestor of an entity (topmost parent), or self if no parent.
	 * @param entityId The entity to get the root of
	 * @returns The root entity ID
	 */
	getRoot(entityId: number): number {
		let current = entityId;
		let parent = this.parentMap.get(current);
		while (parent !== undefined) {
			current = parent;
			parent = this.parentMap.get(current);
		}
		return current;
	}

	/**
	 * Get siblings of an entity (other children of the same parent).
	 * @param entityId The entity to get siblings of
	 * @returns Readonly array of sibling entity IDs
	 */
	getSiblings(entityId: number): readonly number[] {
		const parentId = this.parentMap.get(entityId);
		if (parentId === undefined) return [];

		const children = this.childrenMap.get(parentId);
		if (!children) return [];

		return children.filter(id => id !== entityId);
	}

	/**
	 * Check if an entity is a descendant of another entity.
	 * @param entityId The potential descendant
	 * @param ancestorId The potential ancestor
	 * @returns true if entityId is a descendant of ancestorId
	 */
	isDescendantOf(entityId: number, ancestorId: number): boolean {
		if (entityId === ancestorId) return false;

		let current = this.parentMap.get(entityId);
		while (current !== undefined) {
			if (current === ancestorId) return true;
			current = this.parentMap.get(current);
		}
		return false;
	}

	/**
	 * Check if an entity is an ancestor of another entity.
	 * @param entityId The potential ancestor
	 * @param descendantId The potential descendant
	 * @returns true if entityId is an ancestor of descendantId
	 */
	isAncestorOf(entityId: number, descendantId: number): boolean {
		return this.isDescendantOf(descendantId, entityId);
	}

	/**
	 * Returns true when at least one parent-child relationship exists.
	 * O(1) — checks Map size, no iteration.
	 */
	get hasHierarchy(): boolean {
		return this.childrenMap.size > 0;
	}

	/**
	 * Get all root entities (entities that have children but no parent).
	 * @returns Readonly array of root entity IDs
	 */
	getRootEntities(): readonly number[] {
		const roots: number[] = [];
		for (const parentId of this.childrenMap.keys()) {
			if (!this.parentMap.has(parentId)) {
				roots.push(parentId);
			}
		}
		return roots;
	}

	/** @internal Release all hierarchy relationships and traversal scratch state. */
	clear(): void {
		this.parentMap.clear();
		this.childrenMap.clear();
		this._bfsQueue.length = 0;
	}

	/**
	 * Check if setting a parent would create a cycle.
	 * A cycle would occur if the prospective parent is a descendant of the child.
	 */
	private wouldCreateCycle(childId: number, parentId: number): boolean {
		let current: number | undefined = parentId;
		while (current !== undefined) {
			if (current === childId) {
				return true;
			}
			current = this.parentMap.get(current);
		}
		return false;
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
		const roots = options?.roots ?? this.getRootEntities();
		// Flat queue with stride 3: [entityId, parentId (-1 for null), depth, ...]
		const queue = this._bfsQueue;
		queue.length = 0;

		for (const id of roots) {
			queue.push(id, -1, 0);
		}

		for (let i = 0; i < queue.length; i += 3) {
			const entityId = queue[i]!;
			const rawParent = queue[i + 1]!;
			const depth = queue[i + 2]!;

			callback(entityId, rawParent === -1 ? null : rawParent, depth);

			const children = this.childrenMap.get(entityId);
			if (children) {
				const childDepth = depth + 1;
				for (const childId of children) {
					queue.push(childId, entityId, childDepth);
				}
			}
		}
	}

	/**
	 * Generator-based hierarchy traversal in parent-first (breadth-first) order.
	 * Supports early termination via break.
	 * @param options Optional traversal options (roots to filter to specific subtrees)
	 * @yields HierarchyEntry for each entity in parent-first order
	 */
	*hierarchyIterator(options?: HierarchyIteratorOptions): Generator<HierarchyEntry, void, unknown> {
		const roots = options?.roots ?? this.getRootEntities();
		const queue: HierarchyEntry[] = [];

		// Initialize queue with root entities
		for (const id of roots) {
			queue.push({ entityId: id, parentId: null, depth: 0 });
		}

		for (const current of queue) {
			yield current;

			const children = this.childrenMap.get(current.entityId);
			if (children) {
				for (const childId of children) {
					queue.push({
						entityId: childId,
						parentId: current.entityId,
						depth: current.depth + 1
					});
				}
			}
		}
	}
}
