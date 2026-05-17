import ECSpresso from "./ecspresso";
import type { WorldConfig, EmptyConfig, WorldConfigFrom } from "./type-utils";

/**
 * Execution phase for systems. Systems are grouped by phase and executed
 * in this fixed order: preUpdate -> fixedUpdate -> update -> postUpdate -> render.
 * Within each phase, systems are sorted by priority (higher first).
 */
export type SystemPhase = 'preUpdate' | 'fixedUpdate' | 'update' | 'postUpdate' | 'render';

export
interface Entity<ComponentTypes> {
	id: number;
	components: Partial<ComponentTypes>;
}

/**
 * Options for removing an entity
 */
export
interface RemoveEntityOptions {
	/**
	 * Whether to also remove all descendants (default: true)
	 */
	cascade?: boolean;
}

/**
 * Options for hierarchy traversal methods
 */
export
interface HierarchyIteratorOptions {
	/** Specific root entities to start traversal from. If not provided, all root entities are used. */
	roots?: readonly number[];
}

/**
 * Entry yielded during hierarchy traversal
 */
export
interface HierarchyEntry {
	/** The entity being visited */
	entityId: number;
	/** The parent entity ID, or null for root entities */
	parentId: number | null;
	/** Depth in the hierarchy (0 for roots) */
	depth: number;
}

export
interface FilteredEntity<
	ComponentTypes,
	WithComponents extends keyof ComponentTypes = never,
	WithoutComponents extends keyof ComponentTypes = never,
	OptionalComponents extends keyof ComponentTypes = never,
	// Default = keyof ComponentTypes so callers that don't thread M get every
	// `with` component as writable (K extends keyof ComponentTypes is always
	// true). Narrowing kicks in only when M is explicitly a strict subset of
	// WithComponents.
	MutatesComponents extends keyof ComponentTypes = keyof ComponentTypes,
> {
	id: number;
	// Omit `with` keys from the Partial portion so the readonly narrowing in
	// the next term is not collapsed back to writable by the intersection.
	components: Omit<Partial<ComponentTypes>, WithComponents | WithoutComponents | OptionalComponents> & {
		[K in WithComponents]: K extends MutatesComponents ? ComponentTypes[K] : Readonly<ComponentTypes[K]>
	} & {
		[K in OptionalComponents]: ComponentTypes[K] | undefined
	};
}

export
interface QueryConfig<
	ComponentTypes,
	WithComponents extends keyof ComponentTypes,
	WithoutComponents extends keyof ComponentTypes,
	OptionalComponents extends keyof ComponentTypes = WithComponents,
	MutatesComponents extends keyof ComponentTypes = keyof ComponentTypes,
> {
	with: ReadonlyArray<WithComponents>;
	without?: ReadonlyArray<WithoutComponents>;
	changed?: ReadonlyArray<WithComponents>;
	optional?: ReadonlyArray<OptionalComponents>;
	parentHas?: ReadonlyArray<keyof ComponentTypes>;
	/**
	 * Components to auto-mark as changed on every iterated entity after
	 * `process()` returns. Eliminates repeated `ecs.markChanged(id, name)`
	 * boilerplate inside iteration loops. Components listed in `with` but
	 * absent from `mutates` are narrowed to `Readonly<T>` on the iteration
	 * entity, catching accidental writes at compile time.
	 */
	mutates?: ReadonlyArray<MutatesComponents>;
	/** @internal Pre-resolved component indices for `changed:`, populated at system registration. */
	_changedIdx?: ReadonlyArray<number>;
	/** @internal Pre-resolved component indices for `mutates:`, populated at system registration. */
	_mutatesIdx?: ReadonlyArray<number>;
}

/**
 * Utility type to derive the entity type that would result from a query definition.
 * This is useful for creating helper functions that operate on query results.
 *
 * @example
 * ```typescript
 * const queryDef = {
 *   with: ['position', 'sprite'],
 *   without: ['dead']
 * };
 *
 * type EntityType = QueryResultEntity<Components, typeof queryDef>;
 *
 * function updateSpritePosition(entity: EntityType) {
 *   entity.components.sprite.position.set(
 *     entity.components.position.x,
 *     entity.components.position.y
 *   );
 * }
 * ```
 */
export type QueryResultEntity<
	ComponentTypes extends Record<string, any>,
	QueryDef extends {
		with: ReadonlyArray<keyof ComponentTypes>;
		without?: ReadonlyArray<keyof ComponentTypes>;
		changed?: ReadonlyArray<keyof ComponentTypes>;
		optional?: ReadonlyArray<keyof ComponentTypes>;
		parentHas?: ReadonlyArray<keyof ComponentTypes>;
		mutates?: ReadonlyArray<keyof ComponentTypes>;
	}
> = FilteredEntity<
	ComponentTypes,
	QueryDef['with'][number],
	QueryDef['without'] extends ReadonlyArray<any> ? QueryDef['without'][number] : never,
	QueryDef['optional'] extends ReadonlyArray<any> ? QueryDef['optional'][number] : never,
	// When mutates is absent, fall back to WithComponents so every listed
	// component stays writable (K extends WithComponents is true for all).
	// Narrowing applies only when mutates is explicitly a strict subset.
	QueryDef['mutates'] extends ReadonlyArray<any> ? QueryDef['mutates'][number] : QueryDef['with'][number]
>;

/**
 * Simplified query definition type for creating reusable queries
 */
export type QueryDefinition<
	ComponentTypes extends Record<string, any>,
	WithComponents extends keyof ComponentTypes = keyof ComponentTypes,
	WithoutComponents extends keyof ComponentTypes = keyof ComponentTypes,
	OptionalComponents extends keyof ComponentTypes = keyof ComponentTypes,
	MutatesComponents extends keyof ComponentTypes = keyof ComponentTypes,
> = {
	with: ReadonlyArray<WithComponents>;
	without?: ReadonlyArray<WithoutComponents>;
	changed?: ReadonlyArray<WithComponents>;
	optional?: ReadonlyArray<OptionalComponents>;
	parentHas?: ReadonlyArray<keyof ComponentTypes>;
	/**
	 * Components to auto-mark as changed on every iterated entity after
	 * `process()` returns. Components in `with` but absent from `mutates`
	 * are narrowed to `Readonly<T>` on the iteration entity type.
	 */
	mutates?: ReadonlyArray<MutatesComponents>;
	/** @internal Pre-resolved component indices for `changed:`, populated at system registration. */
	_changedIdx?: ReadonlyArray<number>;
	/** @internal Pre-resolved component indices for `mutates:`, populated at system registration. */
	_mutatesIdx?: ReadonlyArray<number>;
};

/**
 * Helper function to create a query definition with proper type inference.
 * This enables better TypeScript inference when creating reusable queries.
 *
 * @example
 * ```typescript
 * const movingEntitiesQuery = createQueryDefinition({
 *   with: ['position', 'velocity'],
 *   without: ['dead']
 * });
 *
 * type MovingEntity = QueryResultEntity<Components, typeof movingEntitiesQuery>;
 *
 * function updatePosition(entity: MovingEntity) {
 *   entity.components.position.x += entity.components.velocity.x;
 *   entity.components.position.y += entity.components.velocity.y;
 * }
 *
 * world.addSystem('movement')
 *   .addQuery('entities', movingEntitiesQuery)
 *   .setProcess(({ queries }) => {
 *     for (const entity of queries.entities) {
 *       updatePosition(entity);
 *     }
 *   });
 * ```
 */
export function createQueryDefinition<
	ComponentTypes extends Record<string, any>,
	const QueryDef extends {
		with: ReadonlyArray<keyof ComponentTypes>;
		without?: ReadonlyArray<keyof ComponentTypes>;
		changed?: ReadonlyArray<keyof ComponentTypes>;
		optional?: ReadonlyArray<keyof ComponentTypes>;
		parentHas?: ReadonlyArray<keyof ComponentTypes>;
		mutates?: ReadonlyArray<keyof ComponentTypes>;
	}
>(queryDef: QueryDef): QueryDef {
	return queryDef;
}

export
interface System<
	Cfg extends WorldConfig = EmptyConfig,
	WithComponents extends keyof Cfg['components'] = never,
	WithoutComponents extends keyof Cfg['components'] = never,
> {
	label: string;
	/**
	 * System priority - higher values execute first (default: 0)
	 * When systems have the same priority, they execute in registration order
	 */
	priority?: number;
	/**
	 * Execution phase for this system (default: 'update')
	 * Systems are grouped by phase and executed in order:
	 * preUpdate -> fixedUpdate -> update -> postUpdate -> render
	 */
	phase?: SystemPhase;
	/**
	 * Groups this system belongs to. If any group is disabled, the system will be skipped.
	 */
	groups?: string[];
	/**
	 * Screens where this system should run. If specified, system only runs
	 * when current screen is in this list.
	 */
	inScreens?: ReadonlyArray<keyof Cfg['screens'] & string>;
	/**
	 * Screens where this system should NOT run. If specified, system skips
	 * when current screen is in this list.
	 */
	excludeScreens?: ReadonlyArray<keyof Cfg['screens'] & string>;
	/**
	 * Assets that must be loaded for this system to run.
	 * System will be skipped if any required asset is not loaded.
	 */
	requiredAssets?: ReadonlyArray<keyof Cfg['assets'] & string>;
	/**
	 * When true, the system's process function runs even when all queries
	 * return zero entities. Default is false (system is skipped when all
	 * queries are empty).
	 */
	runWhenEmpty?: boolean;
	entityQueries?: {
		[queryName: string]: QueryConfig<Cfg['components'], WithComponents, WithoutComponents>;
	};
	/**
	 * Singleton queries that yield a single entity (or undefined) rather than
	 * an array. Resolved into the process context's `queries` object under
	 * the registered name.
	 */
	entitySingletons?: {
		[singletonName: string]: QueryConfig<Cfg['components'], WithComponents, WithoutComponents>;
	};
	/**
	 * Process method that runs during each update cycle.
	 * Receives a single context object with queries, dt, and ecs.
	 */
	process?(ctx: {
		queries: {
			[queryName: string]: Array<FilteredEntity<Cfg['components'], WithComponents, WithoutComponents>>;
		};
		dt: number;
		ecs: ECSpresso<Cfg>;
	}): void;

	/**
	 * Lifecycle hook called when the system is initialized
	 * This is called when ECSpresso.initialize() is invoked, after resources are initialized
	 * Use this for one-time initialization that depends on resources
	 * @param ecs The ECSpresso instance providing access to all ECS functionality
	 */
	onInitialize?(
		ecs: ECSpresso<Cfg>
	): void | Promise<void>;

	/**
	 * Lifecycle hook called when the system is detached from the ECS
	 * @param ecs The ECSpresso instance providing access to all ECS functionality
	 */
	onDetach?(
		ecs: import("./ecspresso").default<Cfg>
	): void;

	/**
	 * Per-query callbacks that fire once per entity the first time it appears
	 * in a query's results. Fires before process. Automatic cleanup when
	 * entity leaves query (component removed, entity destroyed) so re-entry
	 * fires the callback again.
	 */
	onEntityEnter?: Record<string, (ctx: { entity: FilteredEntity<Cfg['components'], WithComponents, WithoutComponents>; ecs: ECSpresso<Cfg> }) => void>;

	/**
	 * Event handlers for specific event types
	 */
	eventHandlers?: {
		[EventName in keyof Cfg['events']]?: (ctx: {
			data: Cfg['events'][EventName];
			ecs: ECSpresso<Cfg>;
		}) => void;
	};

	/**
	 * @internal Precomputed pairs of (queryName, mutates, kind) derived at
	 * system registration from queries/singletons declaring `mutates`. Null
	 * when no query on the system declares `mutates`, so the post-process
	 * auto-mark walk is a single pointer check away from zero cost for
	 * non-users.
	 */
	_autoMarkPairs?: ReadonlyArray<{
		queryName: string;
		mutatesIdx: ReadonlyArray<number>;
		kind: 'list' | 'singleton';
	}> | null;
}

// ==================== Base World ====================

/**
 * Typed world interface for plugin helpers and structural typing.
 *
 * Generic over component types `C`:
 * - `BaseWorld` (no param): defaults to `{}`, meaning component-accessing methods
 *   cannot be called (keys resolve to `never`). Use for functions that only need
 *   `removeEntity`, `getResource`, etc.
 * - `BaseWorld<MyComponents>`: narrows `getComponent`, `hasComponent`, `markChanged`,
 *   `spawn`, and command buffer methods to the declared component map.
 *
 * Structural typing ensures any `ECSpresso<Cfg>` where `Cfg['components']` is a
 * superset of `C` satisfies `BaseWorld<C>`.
 */
type _BaseWorldCfg<C extends Record<string, any>> = WorldConfigFrom<C, Record<string, any>, Record<string, any>, Record<string, unknown>, Record<string, any>>;
type _EventBus = import("./event-bus").default<Record<string, any>>;
export type BaseWorld<C extends Record<string, any> = {}> = Pick<ECSpresso<_BaseWorldCfg<C>>,
	| 'getComponent'
	| 'hasComponent'
	| 'removeEntity'
	| 'spawn'
	| 'markChanged'
	| 'getResource'
	| 'hasResource'
> & {
	eventBus: Pick<_EventBus, 'publish'>;
	commands: Pick<import("./command-buffer").default<_BaseWorldCfg<C>>, 'spawn' | 'removeEntity' | 'addComponent' | 'removeComponent'>;
};

// Re-export utility types from type-utils
export type { Merge, MergeAll, TypesAreCompatible, ComponentsOf, EventsOf, ResourcesOf, LabelsOf, GroupsOf, AssetGroupNamesOf, ReactiveQueryNamesOf, AssetTypesOf, ScreenStatesOf, ComponentsOfWorld, EventsOfWorld, AssetsOfWorld, ScreenStatesOfWorld, AnyECSpresso, AnyPlugin, EventNameMatching, ChannelOfWorld, WorldConfig, EmptyConfig, WorldConfigFrom, MergeConfigs, ConfigsAreCompatible, ConfigOf, WithComponents, WithEvents, WithResources, WithAssets, WithScreens } from './type-utils';
