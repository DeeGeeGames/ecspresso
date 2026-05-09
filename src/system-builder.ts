import type ECSpresso from "./ecspresso";
import type { SystemDefaults } from "./plugin";
import type { FilteredEntity, QueryDefinition, System, SystemPhase } from "./types";
import type { WorldConfig, EmptyConfig } from "./type-utils";

export const PROCESS_EACH_QUERY = '__each' as const;
type ProcessEachKey = typeof PROCESS_EACH_QUERY;

/**
 * Builder class for creating type-safe ECS Systems with proper query inference.
 * Systems are automatically registered with their ECSpresso instance when
 * finalized (at the start of initialize() or update()).
 */
export class SystemBuilder<
	Cfg extends WorldConfig = EmptyConfig,
	Queries extends Record<string, QueryDefinition<Cfg['components']>> = {},
	Label extends string = string,
	SysGroups extends string = never,
	ResourceKeys extends keyof Cfg['resources'] = never,
	Singletons extends Record<string, QueryDefinition<Cfg['components']>> = {},
> {
	private queries: Queries = {} as Queries;
	private singletons: Singletons = {} as Singletons;
	private processFunction?: InternalProcessFunction<Cfg, Queries, Singletons>;
	private detachFunction?: LifecycleFunction<Cfg>;
	private initializeFunction?: LifecycleFunction<Cfg>;
	private eventHandlers?: {
		[EventName in keyof Cfg['events']]?: (ctx: {
			data: Cfg['events'][EventName];
			ecs: ECSpresso<Cfg>;
		}) => void;
	};
	private _priority = 0;
	private _phase: SystemPhase = 'update';
	private _groups: string[] = [];
	private _inScreens?: ReadonlyArray<keyof Cfg['screens'] & string>;
	private _excludeScreens?: ReadonlyArray<keyof Cfg['screens'] & string>;
	private _requiredAssets?: ReadonlyArray<keyof Cfg['assets'] & string>;
	private _runWhenEmpty = false;
	private _entityEnterHandlers: Record<string, (ctx: { entity: any; ecs: any }) => void> = {};
	private _resourceKeys?: string[];

	constructor(private _label: string, defaults?: SystemDefaults<Cfg>) {
		if (defaults) {
			if (defaults.phase !== undefined) this._phase = defaults.phase;
			if (defaults.priority !== undefined) this._priority = defaults.priority;
			if (defaults.inScreens !== undefined) this._inScreens = defaults.inScreens;
			if (defaults.excludeScreens !== undefined) this._excludeScreens = defaults.excludeScreens;
		}
	}

	get label() {
		return this._label;
	}

	/**
	 * Create a system object with all configured properties.
	 * @internal Used by ECSpresso to finalize and register the system
	 */
	_createSystemObject(): System<Cfg, any, any> {
		const system: System<Cfg, any, any> = {
			label: this._label,
			entityQueries: this.queries,
			priority: this._priority,
			phase: this._phase,
		};

		if (Object.keys(this.singletons).length > 0) {
			system.entitySingletons = this.singletons as Record<string, QueryDefinition<Cfg['components']>>;
		}

		if (this.processFunction) {
			system.process = this.processFunction;
		}

		if (this.detachFunction) {
			system.onDetach = this.detachFunction;
		}

		if (this.initializeFunction) {
			system.onInitialize = this.initializeFunction;
		}

		if (this.eventHandlers) {
			system.eventHandlers = this.eventHandlers;
		}

		if (this._groups.length > 0) {
			system.groups = [...this._groups];
		}

		if (this._inScreens) {
			system.inScreens = this._inScreens;
		}

		if (this._excludeScreens) {
			system.excludeScreens = this._excludeScreens;
		}

		if (this._requiredAssets) {
			system.requiredAssets = this._requiredAssets;
		}

		if (this._runWhenEmpty) {
			system.runWhenEmpty = true;
		}

		if (Object.keys(this._entityEnterHandlers).length > 0) {
			system.onEntityEnter = { ...this._entityEnterHandlers };
		}

		return system;
	}

	/**
	 * Set the priority of this system. Systems with higher priority values
	 * execute before those with lower values. Systems with the same priority
	 * execute in the order they were registered.
	 * @param priority The priority value (default: 0)
	 * @returns This SystemBuilder instance for method chaining
	 */
	setPriority(priority: number): this {
		this._priority = priority;
		return this;
	}

	/**
	 * Set the execution phase for this system.
	 * Systems are grouped by phase and executed in order:
	 * preUpdate -> fixedUpdate -> update -> postUpdate -> render
	 * @param phase The phase to assign this system to (default: 'update')
	 * @returns This SystemBuilder instance for method chaining
	 */
	inPhase(phase: SystemPhase): this {
		this._phase = phase;
		return this;
	}

	/**
	 * Add this system to a group. Systems can belong to multiple groups.
	 * When any group a system belongs to is disabled, the system will be skipped.
	 * @param groupName The name of the group to add the system to
	 * @returns This SystemBuilder instance for method chaining
	 */
	inGroup<G extends string>(groupName: G): SystemBuilder<Cfg, Queries, Label, SysGroups | G, ResourceKeys, Singletons> {
		if (!this._groups.includes(groupName)) {
			this._groups.push(groupName);
		}
		return this as any;
	}

	/**
	 * Restrict this system to only run in specified screens.
	 * System will be skipped during update() when the current screen
	 * is not in this list.
	 * @param screens Array of screen names where this system should run
	 * @returns This SystemBuilder instance for method chaining
	 */
	inScreens(screens: ReadonlyArray<keyof Cfg['screens'] & string>): this {
		this._inScreens = [...screens];
		return this;
	}

	/**
	 * Exclude this system from running in specified screens.
	 * System will be skipped during update() when the current screen
	 * is in this list.
	 * @param screens Array of screen names where this system should NOT run
	 * @returns This SystemBuilder instance for method chaining
	 */
	excludeScreens(screens: ReadonlyArray<keyof Cfg['screens'] & string>): this {
		this._excludeScreens = [...screens];
		return this;
	}

	/**
	 * Require specific assets to be loaded for this system to run.
	 * System will be skipped during update() if any required asset
	 * is not loaded.
	 * @param assets Array of asset keys that must be loaded
	 * @returns This SystemBuilder instance for method chaining
	 */
	requiresAssets(assets: ReadonlyArray<keyof Cfg['assets'] & string>): this {
		this._requiredAssets = [...assets];
		return this;
	}

	/**
	 * Allow this system to run even when all queries return zero entities.
	 * By default, systems with queries are skipped when no entities match.
	 */
	runWhenEmpty(): this {
		this._runWhenEmpty = true;
		return this;
	}

	/**
	 * Declare resource dependencies for this system. Resources are resolved
	 * once (on first process call) and the same object is reused every frame.
	 * The resolved resources are available as ctx.resources in setProcess.
	 * @param keys Array of resource keys to resolve
	 * @returns This SystemBuilder instance for method chaining
	 */
	withResources<RK extends keyof Cfg['resources'] & string>(
		keys: readonly RK[]
	): SystemBuilder<Cfg, Queries, Label, SysGroups, RK, Singletons> {
		(this as any)._resourceKeys = [...keys];
		return this as any;
	}

	/**
	 * Add a query definition to the system.
	 *
	 * When `mutates` is declared, every iterated entity is automatically
	 * `markChanged`'d for each listed component after the system's
	 * `process()` returns. Components in `with` but absent from `mutates`
	 * are narrowed to `Readonly<T>` in the iteration entity type.
	 */
	addQuery<
		QueryName extends string,
		WithComponents extends keyof Cfg['components'],
		WithoutComponents extends keyof Cfg['components'] = never,
		OptionalComponents extends keyof Cfg['components'] = never,
		MutatesComponents extends WithComponents = WithComponents,
		NewQueries extends Queries & Record<QueryName, QueryDefinition<Cfg['components'], WithComponents, WithoutComponents, OptionalComponents, MutatesComponents>> =
			Queries & Record<QueryName, QueryDefinition<Cfg['components'], WithComponents, WithoutComponents, OptionalComponents, MutatesComponents>>
	>(
		name: QueryName,
		definition: {
			with: ReadonlyArray<WithComponents>;
			without?: ReadonlyArray<WithoutComponents>;
			changed?: ReadonlyArray<WithComponents>;
			optional?: ReadonlyArray<OptionalComponents>;
			parentHas?: ReadonlyArray<keyof Cfg['components']>;
			mutates?: ReadonlyArray<MutatesComponents>;
		}
	): SystemBuilder<Cfg, NewQueries, Label, SysGroups, ResourceKeys, Singletons> {
		// Cast is needed because TypeScript can't preserve the type information
		// when modifying an object property
		const newBuilder = this as any;
		newBuilder.queries = {
			...this.queries,
			[name]: definition,
		};
		return newBuilder;
	}

	/**
	 * Add a singleton query — a named query that yields a single
	 * `FilteredEntity | undefined` instead of an array. Surfaces on the
	 * process context's `queries` object alongside regular queries.
	 *
	 * When multiple entities match, the first is returned (no error). Use
	 * the instance-level `getSingleton` / `tryGetSingleton` helpers on
	 * `ECSpresso` if you need strictness guarantees.
	 *
	 * When `mutates` is declared, the resolved entity is automatically
	 * `markChanged`'d for each listed component after the system's
	 * `process()` returns. Components in `with` but absent from `mutates`
	 * are narrowed to `Readonly<T>` in the iteration entity type.
	 */
	addSingleton<
		SingletonName extends string,
		WithComponents extends keyof Cfg['components'],
		WithoutComponents extends keyof Cfg['components'] = never,
		OptionalComponents extends keyof Cfg['components'] = never,
		MutatesComponents extends WithComponents = WithComponents,
		NewSingletons extends Singletons & Record<SingletonName, QueryDefinition<Cfg['components'], WithComponents, WithoutComponents, OptionalComponents, MutatesComponents>> =
			Singletons & Record<SingletonName, QueryDefinition<Cfg['components'], WithComponents, WithoutComponents, OptionalComponents, MutatesComponents>>
	>(
		name: SingletonName,
		definition: {
			with: ReadonlyArray<WithComponents>;
			without?: ReadonlyArray<WithoutComponents>;
			changed?: ReadonlyArray<WithComponents>;
			optional?: ReadonlyArray<OptionalComponents>;
			parentHas?: ReadonlyArray<keyof Cfg['components']>;
			mutates?: ReadonlyArray<MutatesComponents>;
		}
	): SystemBuilder<Cfg, Queries, Label, SysGroups, ResourceKeys, NewSingletons> {
		const newBuilder = this as any;
		newBuilder.singletons = {
			...this.singletons,
			[name]: definition,
		};
		return newBuilder;
	}

	/**
	 * Set the system's process function that runs each update.
	 * The callback receives a single context object { queries, dt, ecs, resources? }.
	 * The context is pre-allocated per system and reused every frame.
	 * @param process Function to process entities matching the system's queries each update
	 * @returns This SystemBuilder instance for method chaining
	 */
	setProcess(
		process: ProcessFunction<Cfg, Queries, ResourceKeys, Singletons>
	): this {
		this.processFunction = this._wrapWithResources(process as (ctx: unknown) => void);
		return this;
	}

	private _wrapWithResources(
		process: (ctx: unknown) => void,
	): InternalProcessFunction<Cfg, Queries, Singletons> {
		if (!this._resourceKeys?.length) {
			return process as unknown as InternalProcessFunction<Cfg, Queries, Singletons>;
		}
		const keys = this._resourceKeys;
		const resolved: Record<string, unknown> = {};
		let initialized = false;
		return ((ctx) => {
			for (const key of keys) {
				if (!initialized || ctx.ecs.isResourceObserved(key as keyof Cfg['resources'] & string)) {
					resolved[key] = ctx.ecs.getResource(key as keyof Cfg['resources'] & string);
				}
			}
			initialized = true;
			(ctx as Record<string, unknown>)['resources'] = resolved;
			process(ctx);
		}) as InternalProcessFunction<Cfg, Queries, Singletons>;
	}

	/**
	 * Inline-query terminator: define a single query and a per-entity callback
	 * in one call. Collapses the common `addQuery` + `setProcess` + for-loop
	 * pattern into a single chain step.
	 *
	 * Only valid on a builder with no prior queries or process function —
	 * TypeScript narrows `this` to `never` otherwise, and a runtime guard
	 * throws for untyped callers. For multi-query systems use
	 * `addQuery` + `setProcess`.
	 *
	 * When `mutates` is declared, the callback may `return false` to skip the
	 * auto-mark for that specific entity. Returning `true`, `undefined`, or
	 * any other value stamps all components listed in `mutates`. Components
	 * in `with` but absent from `mutates` are narrowed to `Readonly<T>` on
	 * the per-entity iteration type.
	 *
	 * @param definition Inline query definition (with / without / optional / changed / parentHas / mutates)
	 * @param process Callback invoked once per matching entity each frame
	 */
	setProcessEach<
		W extends keyof Cfg['components'],
		WO extends keyof Cfg['components'] = never,
		O extends keyof Cfg['components'] = never,
		M extends W = W,
	>(
		this: [keyof Queries] extends [never]
			? [keyof Singletons] extends [never]
				? SystemBuilder<Cfg, Queries, Label, SysGroups, ResourceKeys, Singletons>
				: never
			: never,
		definition: {
			with: ReadonlyArray<W>;
			without?: ReadonlyArray<WO>;
			optional?: ReadonlyArray<O>;
			changed?: ReadonlyArray<W>;
			parentHas?: ReadonlyArray<keyof Cfg['components']>;
			mutates?: ReadonlyArray<M>;
		},
		process: (ctx: {
			entity: FilteredEntity<Cfg['components'], W, WO, O, M>;
			dt: number;
			ecs: ECSpresso<Cfg>;
		} & ([ResourceKeys] extends [never]
			? {}
			: { resources: { readonly [K in ResourceKeys]: Cfg['resources'][K] } })
		) => boolean | void,
	): SystemBuilder<
		Cfg,
		Queries & Record<ProcessEachKey, QueryDefinition<Cfg['components'], W, WO, O, M>>,
		Label,
		SysGroups,
		ResourceKeys,
		Singletons
	> {
		// The conditional `this:` parameter cannot be introspected in the body — cast to access private fields.
		const self = this as unknown as {
			queries: Record<string, unknown>;
			singletons: Record<string, unknown>;
			processFunction?: unknown;
			_wrapWithResources(fn: (ctx: unknown) => void): InternalProcessFunction<Cfg, Queries, Singletons>;
		};

		if (Object.keys(self.queries).length > 0 || Object.keys(self.singletons).length > 0 || self.processFunction !== undefined) {
			throw new Error(
				'setProcessEach requires a SystemBuilder with no prior queries, singletons, or process function. ' +
				'Use addQuery + setProcess for multi-query systems.',
			);
		}

		self.queries[PROCESS_EACH_QUERY] = definition;

		const perEntityCtx = {
			entity: undefined as unknown,
			dt: 0,
			ecs: undefined as unknown,
			resources: undefined as unknown,
		};

		const mutates = definition.mutates && definition.mutates.length > 0
			? definition.mutates as ReadonlyArray<keyof Cfg['components']>
			: undefined;

		const iterate = (ctx: unknown) => {
			const frameCtx = ctx as {
				queries: Record<string, ReadonlyArray<{ id: number }>>;
				dt: number;
				ecs: { markChanged: (id: number, name: keyof Cfg['components']) => void };
				resources?: unknown;
			};
			const entities = frameCtx.queries[PROCESS_EACH_QUERY];
			if (!entities) return;
			perEntityCtx.dt = frameCtx.dt;
			perEntityCtx.ecs = frameCtx.ecs;
			perEntityCtx.resources = frameCtx.resources;
			for (let i = 0; i < entities.length; i++) {
				const entity = entities[i];
				if (!entity) continue;
				perEntityCtx.entity = entity;
				const result = (process as (c: unknown) => boolean | void)(perEntityCtx);
				if (mutates === undefined || result === false) continue;
				for (let j = 0; j < mutates.length; j++) {
					const name = mutates[j];
					if (name !== undefined) frameCtx.ecs.markChanged(entity.id, name);
				}
			}
		};

		self.processFunction = self._wrapWithResources(iterate);
		return this as unknown as SystemBuilder<
			Cfg,
			Queries & Record<ProcessEachKey, QueryDefinition<Cfg['components'], W, WO, O, M>>,
			Label,
			SysGroups,
			ResourceKeys,
			Singletons
		>;
	}

	/**
	 * Register a callback that fires once per entity the first time it appears
	 * in a query's results. Fires before process. Automatic cleanup when entity
	 * leaves the query so re-entry fires the callback again.
	 * @param queryName Name of a query previously added via addQuery
	 * @param callback Function called with the entity and ecs instance
	 * @returns This SystemBuilder instance for method chaining
	 */
	setOnEntityEnter<QN extends keyof Queries & string>(
		queryName: QN,
		callback: (ctx: {
			entity: FilteredEntity<
				Cfg['components'],
				Queries[QN] extends QueryDefinition<Cfg['components'], infer W> ? W : never,
				Queries[QN] extends QueryDefinition<Cfg['components'], any, infer WO> ? WO : never,
				Queries[QN] extends QueryDefinition<Cfg['components'], any, any, infer O> ? O : never
			>;
			ecs: ECSpresso<Cfg>;
		}) => void,
	): this {
		this._entityEnterHandlers[queryName] = callback;
		return this;
	}

	/**
	 * Set the onDetach lifecycle hook
	 * Called when the system is removed from the ECS
	 * @param onDetach Function to run when this system is detached from the ECS
	 * @returns This SystemBuilder instance for method chaining
	 */
	setOnDetach(
		onDetach: LifecycleFunction<Cfg>
	): this {
		this.detachFunction = onDetach;
		return this;
	}

	/**
	 * Set the onInitialize lifecycle hook.
	 *
	 * Fires exactly once per system. For systems added before `initialize()`,
	 * the hook is awaited inside `initialize()` itself. For systems added
	 * after `initialize()` has returned, the hook fires on registration (at
	 * the next `update()`'s finalize step) — async hooks run fire-and-forget,
	 * so don't rely on completion ordering against the first `process` call.
	 *
	 * @param onInitialize Function to run when this system is initialized
	 * @returns This SystemBuilder instance for method chaining
	 */
	setOnInitialize(
		onInitialize: LifecycleFunction<Cfg>
	): this {
		this.initializeFunction = onInitialize;
		return this;
	}

	/**
	 * Set event handlers for the system
	 * These handlers will be automatically subscribed when the system is attached
	 * @param handlers Object mapping event names to handler functions
	 * @returns This SystemBuilder instance for method chaining
	 */
	setEventHandlers(
		handlers: {
			[EventName in keyof Cfg['events']]?: (ctx: {
				data: Cfg['events'][EventName];
				ecs: ECSpresso<Cfg>;
			}) => void;
		}
	): this {
		this.eventHandlers = handlers;
		return this;
	}
}

// Helper type definitions

type QueryResults<
	ComponentTypes extends Record<string, any>,
	Queries extends Record<string, QueryDefinition<ComponentTypes>>,
	Singletons extends Record<string, QueryDefinition<ComponentTypes>> = {},
> = {
	[QueryName in keyof Queries]: QueryName extends string
		? FilteredEntity<
			ComponentTypes,
			Queries[QueryName] extends QueryDefinition<ComponentTypes, infer W> ? W : never,
			Queries[QueryName] extends QueryDefinition<ComponentTypes, any, infer WO> ? WO : never,
			Queries[QueryName] extends QueryDefinition<ComponentTypes, any, any, infer O> ? O : never,
			// Fallback: if M isn't inferable, use W so everything in `with`
			// stays writable (matches pre-mutates behavior).
			Queries[QueryName] extends QueryDefinition<ComponentTypes, infer W2, any, any, infer M>
				? (unknown extends M ? W2 : M)
				: never
		>[]
		: never;
} & {
	[SingletonName in keyof Singletons]: SingletonName extends string
		? FilteredEntity<
			ComponentTypes,
			Singletons[SingletonName] extends QueryDefinition<ComponentTypes, infer W> ? W : never,
			Singletons[SingletonName] extends QueryDefinition<ComponentTypes, any, infer WO> ? WO : never,
			Singletons[SingletonName] extends QueryDefinition<ComponentTypes, any, any, infer O> ? O : never,
			Singletons[SingletonName] extends QueryDefinition<ComponentTypes, infer W2, any, any, infer M>
				? (unknown extends M ? W2 : M)
				: never
		> | undefined
		: never;
};

/**
 * Context object passed to system process functions.
 * Pre-allocated per system and reused every frame (zero per-frame allocation).
 * When resources are declared via withResources(), the context includes a
 * `resources` field with the resolved values (cached once on first call).
 */
export type ProcessContext<
	Cfg extends WorldConfig,
	Queries extends Record<string, QueryDefinition<Cfg['components']>>,
	ResourceKeys extends keyof Cfg['resources'] = never,
	Singletons extends Record<string, QueryDefinition<Cfg['components']>> = {},
> = {
	queries: QueryResults<Cfg['components'], Queries, Singletons>;
	dt: number;
	ecs: ECSpresso<Cfg>;
} & ([ResourceKeys] extends [never]
	? {}
	: { resources: { readonly [K in ResourceKeys]: Cfg['resources'][K] } });

/**
 * Function signature for system process methods.
 * Receives a single context object with queries, dt, ecs, and optionally resources.
 */
type ProcessFunction<
	Cfg extends WorldConfig,
	Queries extends Record<string, QueryDefinition<Cfg['components']>>,
	ResourceKeys extends keyof Cfg['resources'] = never,
	Singletons extends Record<string, QueryDefinition<Cfg['components']>> = {},
> = (ctx: ProcessContext<Cfg, Queries, ResourceKeys, Singletons>) => void;

/**
 * Internal process function used for storage on System objects.
 * When resources are declared, the SystemBuilder wraps the user's function
 * to resolve and cache resources on the context object.
 */
type InternalProcessFunction<
	Cfg extends WorldConfig,
	Queries extends Record<string, QueryDefinition<Cfg['components']>>,
	Singletons extends Record<string, QueryDefinition<Cfg['components']>> = {},
> = (ctx: ProcessContext<Cfg, Queries, never, Singletons>) => void;

/**
 * Type for system lifecycle functions
 * These can be asynchronous
 */
type LifecycleFunction<Cfg extends WorldConfig> = (
	ecs: ECSpresso<Cfg>,
) => void | Promise<void>;
