import type ECSpresso from './ecspresso';
import type { RemoveEntityOptions } from './types';
import type { WorldConfig, EmptyConfig } from './type-utils';

/**
 * CommandBuffer queues structural changes to be executed later.
 * This prevents ordering issues when modifying entities during system execution.
 *
 * Commands are executed in FIFO order when playback() is called.
 *
 * @example
 * ```typescript
 * // In a system
 * ecs.commands.removeEntity(entityId);
 * ecs.commands.spawn({ position: { x: 0, y: 0 } });
 *
 * // Later (automatically at end of update())
 * ecs.commands.playback(ecs);
 * ```
 */
export default class CommandBuffer<
	Cfg extends WorldConfig = EmptyConfig,
> {
	private commands: Array<(ecs: ECSpresso<Cfg>) => void> = [];

	/**
	 * @param parent Owning ECS instance, used to read the active scope hint at
	 *   queue time so screen-gated spawns get auto-scoped on playback. Optional
	 *   so the buffer can be constructed standalone in tests.
	 */
	constructor(private readonly parent?: ECSpresso<Cfg>) {}

	/**
	 * Queue an entity removal command
	 * @param entityId The entity ID to remove
	 * @param options Optional removal options (cascade, etc.)
	 */
	removeEntity(entityId: number, options?: RemoveEntityOptions): void {
		this.commands.push((ecs) => {
			ecs.removeEntity(entityId, options);
		});
	}

	/**
	 * Queue a component addition command
	 * @param entityId The entity ID
	 * @param componentName The name of the component to add
	 * @param componentValue The component data
	 */
	addComponent<K extends keyof Cfg['components']>(
		entityId: number,
		componentName: K,
		componentValue: Cfg['components'][K]
	): void {
		this.commands.push((ecs) => {
			ecs.addComponent(entityId, componentName, componentValue);
		});
	}

	/**
	 * Queue a component removal command
	 * @param entityId The entity ID
	 * @param componentName The name of the component to remove
	 */
	removeComponent<K extends keyof Cfg['components']>(
		entityId: number,
		componentName: K
	): void {
		this.commands.push((ecs) => {
			ecs.removeComponent(entityId, componentName);
		});
	}

	/**
	 * Queue an entity spawn command
	 * @param components The initial components for the new entity
	 * @returns void (entity ID not available until playback)
	 */
	spawn<T extends { [K in keyof Cfg['components']]?: Cfg['components'][K] }>(
		components: T & Record<Exclude<keyof T, keyof Cfg['components']>, never>,
		options?: { scope?: (keyof Cfg['screens'] & string) | null }
	): void {
		const resolved = this._resolveScope(options);
		this.commands.push((ecs) => {
			ecs.spawn(components, resolved);
		});
	}

	/**
	 * Queue a child entity spawn command
	 * @param parentId The parent entity ID
	 * @param components The initial components for the new child entity
	 */
	spawnChild<T extends { [K in keyof Cfg['components']]?: Cfg['components'][K] }>(
		parentId: number,
		components: T & Record<Exclude<keyof T, keyof Cfg['components']>, never>,
		options?: { scope?: (keyof Cfg['screens'] & string) | null }
	): void {
		const resolved = this._resolveScope(options);
		this.commands.push((ecs) => {
			ecs.spawnChild(parentId, components, resolved);
		});
	}

	/**
	 * Snapshot the parent ECS's active scope hint at queue time when the
	 * caller didn't pass an explicit scope. Without this, playback (after the
	 * tick ends) would see a null hint and the gated system's screen intent
	 * would be lost.
	 */
	private _resolveScope(
		options: { scope?: (keyof Cfg['screens'] & string) | null } | undefined,
	): { scope?: (keyof Cfg['screens'] & string) | null } | undefined {
		if (options?.scope !== undefined) return options;
		const hint = this.parent?._getActiveScopeHint();
		if (!hint) return options;
		return { scope: hint };
	}

	/**
	 * Queue multiple component additions
	 * @param entityId The entity ID
	 * @param components Object with component names as keys and component data as values
	 */
	addComponents<T extends { [K in keyof Cfg['components']]?: Cfg['components'][K] }>(
		entityId: number,
		components: T & Record<Exclude<keyof T, keyof Cfg['components']>, never>
	): void {
		this.commands.push((ecs) => {
			ecs.addComponents(entityId, components);
		});
	}

	/**
	 * Queue a parent assignment command
	 * @param childId The child entity ID
	 * @param parentId The parent entity ID
	 */
	setParent(childId: number, parentId: number): void {
		this.commands.push((ecs) => {
			ecs.setParent(childId, parentId);
		});
	}

	/**
	 * Queue a component mutation command.
	 * The mutator runs during playback, receiving the component for in-place mutation.
	 * Automatically marks the component as changed.
	 * @param entityId The entity ID
	 * @param componentName The component to mutate
	 * @param mutator A function that receives the component value for in-place mutation
	 */
	mutateComponent<K extends keyof Cfg['components']>(
		entityId: number,
		componentName: K,
		mutator: (value: Cfg['components'][K]) => void
	): void {
		this.commands.push((ecs) => {
			ecs.mutateComponent(entityId, componentName, mutator);
		});
	}

	/**
	 * Queue a markChanged command
	 * @param entityId The entity ID
	 * @param componentName The component to mark as changed
	 */
	markChanged<K extends keyof Cfg['components']>(entityId: number, componentName: K): void {
		this.commands.push((ecs) => {
			ecs.markChanged(entityId, componentName);
		});
	}

	/**
	 * Queue a parent removal command
	 * @param childId The child entity ID
	 */
	removeParent(childId: number): void {
		this.commands.push((ecs) => {
			ecs.removeParent(childId);
		});
	}

	/**
	 * Execute all queued commands in FIFO order.
	 * Errors from individual commands are caught and logged, but do not stop playback.
	 * @param ecs The ECSpresso instance to execute commands on
	 */
	playback(
		ecs: ECSpresso<Cfg>
	): void {
		// Execute all commands, catching errors to prevent one bad command from stopping all playback
		for (const command of this.commands) {
			try {
				command(ecs);
			} catch (error) {
				// Log error but continue with remaining commands
				// This matches Unity DOTS behavior where invalid commands are silently skipped
				console.warn('CommandBuffer: Command failed during playback:', error);
			}
		}

		// Clear the queue
		this.commands.length = 0;
	}

	/**
	 * Clear all queued commands without executing them
	 */
	clear(): void {
		this.commands.length = 0;
	}

	/**
	 * Get the number of queued commands
	 * @returns The number of commands waiting to be executed
	 */
	get length(): number {
		return this.commands.length;
	}
}
