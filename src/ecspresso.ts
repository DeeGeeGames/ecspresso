import EntityManager from "./entity-manager";
import EventBus from "./event-bus";
import ResourceManager, { type ResourceFactoryWithDeps, type ResourceDirectValue } from "./resource-manager";
import AssetManager from "./asset-manager";
import ScreenManager from "./screen-manager";
import ReactiveQueryManager, { type ReactiveQueryDefinition } from "./reactive-query-manager";
import CommandBuffer from "./command-buffer";
import type { System, SystemPhase, FilteredEntity, Entity, RemoveEntityOptions, HierarchyEntry, HierarchyIteratorOptions } from "./types";
import { definePlugin, type Plugin, type SystemDefaults } from "./plugin";
import { SystemBuilder, PROCESS_EACH_QUERY } from "./system-builder";
import { checkRequiredCycle } from "./utils/check-required-cycle";
import { version } from "../package.json";
import type { AssetDefinition, AssetHandle, AssetEvents } from "./asset-types";
import type { ScreenDefinition, ScreenEvents } from "./screen-types";
import { ECSpressoBuilder } from "./ecspresso-builder";
import type { WorldConfig, EmptyConfig, ConflictingSlot, MissingRequirementSlot } from "./type-utils";

/**
	* Interface declaration for ECSpresso constructor to ensure type augmentation works properly.
	* This merges with the class declaration below.
*/
export default interface ECSpresso<
	Cfg extends WorldConfig = EmptyConfig,
	Labels extends string = string,
	Groups extends string = string,
	AssetGroupNames extends string = string,
	ReactiveQueryNames extends string = string,
> {
	/**
		* Default constructor
	*/
	new(): ECSpresso<Cfg, Labels, Groups, AssetGroupNames, ReactiveQueryNames>;
}

const PHASE_ORDER: readonly SystemPhase[] = [
	'preUpdate', 'fixedUpdate', 'update', 'postUpdate', 'render',
];

/**
 * Branded sentinel used as the expected-parameter type when `installPlugin`
 * detects an incompatible or unsatisfied plugin. The template-literal message
 * surfaces in the TypeScript error, pointing at the failing WorldConfig slot.
 * Uninhabitable at the value level (the symbol key is unreachable), so the
 * argument is still rejected.
 */
declare const __pluginError: unique symbol;
export type PluginError<M extends string> = { readonly [__pluginError]: M };

/**
 * Resolves to the expected parameter type for `installPlugin` given a world
 * config and a plugin's generic parameters:
 * - `Plugin<PCfg, PReq, ...>` when compatible and all requirements are met.
 * - `PluginError<"Plugin's X conflict with this world...">` when any slot conflicts.
 * - `PluginError<"Plugin requires X not provided by this world">` when a requirement is missing.
 *
 * Exported so tests can assert the exact parameter type `installPlugin`
 * produces without duplicating the conditional logic.
 */
export type InstallPluginParam<
	Cfg extends WorldConfig,
	PCfg extends WorldConfig,
	PReq extends WorldConfig,
	BL extends string,
	BG extends string,
	BAG extends string,
	BRQ extends string,
> =
	[ConflictingSlot<Cfg, PCfg>] extends [never]
		? [MissingRequirementSlot<Cfg, PReq>] extends [never]
			? Plugin<PCfg, PReq, BL, BG, BAG, BRQ>
			: PluginError<`Plugin requires ${MissingRequirementSlot<Cfg, PReq>} not provided by this world`>
		: PluginError<`Plugin's ${ConflictingSlot<Cfg, PCfg>} conflict with this world (same key, different type)`>;


/**
	* ECSpresso is the central ECS framework class that connects all features.
	* It handles creation and management of entities, components, and systems, and provides lifecycle hooks.
*/
export default class ECSpresso<
	Cfg extends WorldConfig = EmptyConfig,
	Labels extends string = string,
	Groups extends string = string,
	AssetGroupNames extends string = string,
	ReactiveQueryNames extends string = string,
> {
	// Phantom type property for structural type extraction (no runtime cost).
	declare readonly _cfg: Cfg;

	/** Library version*/
	public static readonly VERSION = version;

	/** Access/modify stored components and entities*/
	private _entityManager: EntityManager<Cfg['components']>;
	/** Publish/subscribe to events*/
	private _eventBus: EventBus<Cfg['events']>;
	/** Access/modify registered resources*/
	private _resourceManager: ResourceManager<Cfg['resources'], ECSpresso<Cfg>>;
	/** Command buffer for deferred structural changes */
	private _commandBuffer: CommandBuffer<Cfg>;

	/** Registered systems that will be updated in order*/
	private _systems: Array<System<Cfg, any, any>> = [];
	/** Systems grouped by execution phase, each sorted by priority */
	private _phaseSystems: Record<SystemPhase, Array<System<Cfg, any, any>>> = {
		preUpdate: [], fixedUpdate: [], update: [], postUpdate: [], render: [],
	};
	/** Track installed plugins to prevent duplicates*/
	private _installedPlugins: Set<string> = new Set();
	/** Per-plugin disposers registered via the install function's second arg */
	private _pluginCleanups: Map<string, Array<() => void>> = new Map();
	/** Defaults applied to systems created via addSystem during a plugin's install */
	private _currentSystemDefaults: SystemDefaults<Cfg> | undefined;
	/** Entity IDs scoped to a specific screen — removed on that screen's exit */
	private _screenScopedEntities: Map<string, Set<number>> = new Map();
	/** Reverse index: entity ID -> scope screen name, for O(1) cleanup on remove */
	private _entityScreenScope: Map<number, string> = new Map();
	/**
	 * Active screen scope hint set during a screen-gated system's process tick.
	 * spawn / spawnChild / commands.spawn fall back to this when the caller did
	 * not pass an explicit `scope`. `null` means no hint (not in a gated tick,
	 * or system has no `inScreens` matching the current screen).
	 */
	private _activeScopeHint: (keyof Cfg['screens'] & string) | null = null;
	/** Disabled system groups */
	private _disabledGroups: Set<string> = new Set();
	/** Asset manager for loading and accessing assets */
	private _assetManager: AssetManager<Cfg['assets']> | null = null;
	/** Screen manager for state/screen transitions */
	private _screenManager: ScreenManager<Cfg['screens']> | null = null;
	/** Reactive query manager for enter/exit callbacks */
	private _reactiveQueryManager: ReactiveQueryManager<Cfg['components']>;
	/** Post-update hooks to be called after all systems in update() */
	private _postUpdateHooks: Array<(ctx: { ecs: ECSpresso<Cfg>; dt: number }) => void> = [];
	/** Global tick counter, incremented at the end of each update() */
	private _currentTick: number = 0;
	/** Per-system last-seen change sequence for change detection */
	private _systemLastSeqs: Map<object, number> = new Map();
	/** Change threshold used for public getEntitiesWithQuery and between-system resolution */
	private _changeThreshold: number = 0;
	/** Fixed timestep interval in seconds (default: 1/60) */
	private _fixedDt: number = 1 / 60;
	/** Accumulated time for fixed update steps */
	private _fixedAccumulator: number = 0;
	/** Interpolation alpha between fixed steps (accumulator / fixedDt) */
	private _interpolationAlpha: number = 0;
	/** Maximum fixed update steps per frame (spiral-of-death protection) */
	private _maxFixedSteps: number = 8;
	/** Registry of required component relationships: trigger -> [{component, factory}] */
	private _requiredComponents: Map<keyof Cfg['components'], Array<{ component: keyof Cfg['components']; factory: (triggerValue: unknown) => unknown }>> = new Map();
	/** Pending plugin assets awaiting manager creation at build time */
	private _pendingPluginAssets: Array<[string, AssetDefinition<unknown>]> = [];
	/** Pending plugin screens awaiting manager creation at build time */
	private _pendingPluginScreens: Array<[string, ScreenDefinition<any, any>]> = [];
	/** Whether diagnostics timing collection is enabled */
	private _diagnosticsEnabled: boolean = false;
	/** Per-system timing in ms, populated when diagnostics enabled */
	private _systemTimings: Map<string, number> = new Map();
	/** Per-phase timing in ms, populated when diagnostics enabled */
	private _phaseTimings: Record<SystemPhase, number> = {
		preUpdate: 0, fixedUpdate: 0, update: 0, postUpdate: 0, render: 0,
	};
	/** Per-system per-query seen entity IDs for onEntityEnter tracking */
	private _entityEnterTracking: Map<object, Map<string, Set<number>>> = new Map();
	/** Shared reusable set for per-tick entity enter comparison (avoids allocation) */
	private _entityEnterFrameSet: Set<number> = new Set();
	/** Pre-allocated process context per system (avoids per-frame allocation) */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cascades from System<Cfg, any, any>; can't remove without existential types
	private _systemContexts: WeakMap<object, { queries: Record<string, any>; dt: number; ecs: ECSpresso<Cfg> }> = new WeakMap();
	/** Shared scratch array for singleton query resolution (cleared and reused each resolution) */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches EntityManager output-array shape
	private _singletonScratch: any[] = [];
	/** Pending system builder finalizers to run before next update/initialize */
	private _pendingFinalizers: Array<() => void> = [];
	private _batchingRegistrations = false;

	/**
		* Creates a new ECSpresso instance.
	*/
	constructor() {
		this._entityManager = new EntityManager<Cfg['components']>();
		this._eventBus = new EventBus<Cfg['events']>();
		this._resourceManager = new ResourceManager<Cfg['resources'], ECSpresso<Cfg>>();
		this._reactiveQueryManager = new ReactiveQueryManager<Cfg['components']>(this._entityManager);
		this._commandBuffer = new CommandBuffer<Cfg>(this);

		// Wire up lifecycle hooks for change detection, required components, and reactive queries
		this._subscribeLifecycleHooks();
	}

	/**
	 * Subscribes to EntityManager lifecycle hooks for change detection,
	 * required component auto-addition, and reactive query tracking.
	 * @private
	 */
	private _subscribeLifecycleHooks(): void {
		// afterComponentAdded → mark changed + auto-add required components
		this._entityManager.onAfterComponentAdded((entityId, componentName) => {
			this._entityManager.markChanged(entityId, componentName);

			// Auto-add required components (recursive via addComponent → this hook)
			const reqs = this._requiredComponents.get(componentName);
			if (reqs) {
				const entity = this._entityManager.getEntity(entityId);
				if (entity) {
					const triggerValue = entity.components[componentName];
					for (const { component, factory } of reqs) {
						if (this._entityManager._pendingBatchKeys?.has(component)) continue;
						if (!(component in entity.components)) {
							this._entityManager.addComponent(entityId, component, factory(triggerValue) as Cfg['components'][keyof Cfg['components']]);
						}
					}
				}
			}
		});

		// afterEntityMutated → recheck reactive queries (entity itself + children for parentHas)
		this._entityManager.onAfterEntityMutated((entityId) => {
			const entity = this._entityManager.getEntity(entityId);
			if (entity) {
				this._reactiveQueryManager.recheckEntityAndChildren(entity);
			}
		});

		// afterComponentRemoved → notify reactive query manager
		this._entityManager.onAfterComponentRemoved((entityId, componentName) => {
			const entity = this._entityManager.getEntity(entityId);
			if (entity) {
				this._reactiveQueryManager.onComponentRemoved(entity, componentName);
			}
		});

		// beforeEntityRemoved → notify reactive query manager + drain screen-scope tracking
		this._entityManager.onBeforeEntityRemoved((entityId) => {
			this._reactiveQueryManager.onEntityRemoved(entityId);
			const scope = this._entityScreenScope.get(entityId);
			if (scope !== undefined) {
				this._entityScreenScope.delete(entityId);
				this._screenScopedEntities.get(scope)?.delete(entityId);
			}
		});

		// afterParentChanged → recheck child entity for parentHas queries
		this._entityManager.onAfterParentChanged((childId) => {
			if (this._reactiveQueryManager.hasParentHasQueries) {
				const childEntity = this._entityManager.getEntity(childId);
				if (childEntity) {
					this._reactiveQueryManager.recheckEntity(childEntity);
				}
			}
		});
	}

	/**
		* Creates a new ECSpresso builder for type-safe plugin installation.
		* Types are inferred from the builder chain — use `.withPlugin()`,
		* `.withComponentTypes<T>()`, `.withEventTypes<T>()`, and `.withResource()`
		* to accumulate types without manual aggregate interfaces.
	 *
		* @returns A builder instance for fluent method chaining
	 *
		* @example
		* ```typescript
		* const ecs = ECSpresso.create()
	 *	 .withPlugin(createRenderer2DPlugin({ ... }))
	 *	 .withPlugin(createPhysics2DPlugin())
	 *	 .withComponentTypes<{ player: true; enemy: { type: string } }>()
	 *	 .withEventTypes<{ gameStart: true }>()
	 *	 .withResource('score', { value: 0 })
	 *	 .build();
	 *
	 * type ECS = typeof ecs;
		* ```
	*/
	static create<Cfg2 extends WorldConfig = EmptyConfig>(): ECSpressoBuilder<Cfg2, never, never, never, never> {
		return new ECSpressoBuilder<Cfg2, never, never, never, never>();
	}

	/**
		* Adds a system directly to this ECSpresso instance.
		* The system is registered when initialize() or update() is next called.
		* @param label Unique name to identify the system
		* @returns A SystemBuilder instance for method chaining
	*/
	addSystem(label: string): SystemBuilder<Cfg> {
		const builder = new SystemBuilder<Cfg>(label, this._currentSystemDefaults);
		this._pendingFinalizers.push(() => {
			this._registerSystem(builder._createSystemObject());
		});
		return builder;
	}

	/**
	 * Finalize and register all pending system builders.
	 * @private
	 */
	private _finalizePendingBuilders(): void {
		if (this._pendingFinalizers.length === 0) return;
		this._batchingRegistrations = true;
		while (this._pendingFinalizers.length > 0) {
			const finalizers = this._pendingFinalizers;
			this._pendingFinalizers = [];
			for (const finalize of finalizers) {
				finalize();
			}
		}
		this._batchingRegistrations = false;
		this._rebuildPhaseSystems();
	}

	/**
	 * Update all systems across execution phases.
	 * Phases run in order: preUpdate -> fixedUpdate -> update -> postUpdate -> render.
	 * The fixedUpdate phase uses a time accumulator for deterministic fixed-timestep simulation.
	 * @param deltaTime Time elapsed since the last update (in seconds)
	 */
	update(deltaTime: number) {
		this._finalizePendingBuilders();
		const currentScreen = (this._screenManager?.getCurrentScreen() ?? null) as (keyof Cfg['screens'] & string) | null;
		const timing = this._diagnosticsEnabled;

		// 1. preUpdate phase
		this._runPhase('preUpdate', deltaTime, currentScreen, timing);

		// 2. fixedUpdate phase — accumulate time and step N times
		const fixedT0 = timing ? performance.now() : 0;
		this._fixedAccumulator += deltaTime;
		let steps = 0;
		while (this._fixedAccumulator >= this._fixedDt && steps < this._maxFixedSteps) {
			this._executePhase(this._phaseSystems.fixedUpdate, this._fixedDt, currentScreen);
			this._commandBuffer.playback(this);
			this._fixedAccumulator -= this._fixedDt;
			steps++;
		}
		// Clamp accumulator if we hit the spiral-of-death cap
		if (this._fixedAccumulator >= this._fixedDt) {
			this._fixedAccumulator = 0;
		}
		if (timing) {
			this._phaseTimings.fixedUpdate = performance.now() - fixedT0;
		}
		// Compute interpolation alpha for render-phase smoothing
		this._interpolationAlpha = this._fixedAccumulator / this._fixedDt;

		// 3. update phase
		this._runPhase('update', deltaTime, currentScreen, timing);

		// 4. postUpdate phase
		this._runPhase('postUpdate', deltaTime, currentScreen, timing);

		// 5. Post-update hooks (between postUpdate and render, preserving existing behavior)
		for (const hook of this._postUpdateHooks) {
			hook({ ecs: this, dt: deltaTime });
		}

		// 6. render phase
		this._runPhase('render', deltaTime, currentScreen, timing);

		// 7. Flush observed resources — shallow-diff any resource with active
		// subscribers and fire callbacks for in-place mutations.
		this._resourceManager.flushObserved();

		// Set change threshold to current sequence so that public
		// getEntitiesWithQuery (called between updates) sees command
		// buffer marks but not stale ones.
		this._changeThreshold = this._entityManager.changeSeq;

		// Increment tick counter (frame counter only)
		this._currentTick++;
	}

	/**
	 * Execute all systems in a single phase.
	 * @private
	 */
	private _executePhase(
		systems: ReadonlyArray<System<Cfg, any, any>>,
		deltaTime: number,
		currentScreen: (keyof Cfg['screens'] & string) | null
	): void {
		for (const system of systems) {
			if (!system.process && !system.onEntityEnter) continue;

			// Group filtering - skip if any of the system's groups is disabled
			if (system.groups?.length) {
				let anyDisabled = false;
				for (const group of system.groups) {
					if (this._disabledGroups.has(group)) {
						anyDisabled = true;
						break;
					}
				}
				if (anyDisabled) continue;
			}

			// Screen filtering - skip if system is restricted to specific screens
			if (system.inScreens?.length) {
				if (currentScreen === null || !system.inScreens.includes(currentScreen)) {
					continue;
				}
			}

			// Screen exclusion - skip if system excludes current screen
			if (system.excludeScreens?.length) {
				if (currentScreen !== null && system.excludeScreens.includes(currentScreen)) {
					continue;
				}
			}

			// Asset requirements - skip if required assets not loaded
			if (system.requiredAssets?.length && this._assetManager) {
				let assetsReady = true;
				for (const assetKey of system.requiredAssets) {
					if (!this._assetManager.isLoaded(assetKey)) {
						assetsReady = false;
						break;
					}
				}
				if (!assetsReady) continue;
			}

			// Set per-system change threshold from its last-seen sequence
			const systemThreshold = this._systemLastSeqs.get(system) ?? 0;
			this._changeThreshold = systemThreshold;

			// Get or create pre-allocated context for this system
			let ctx = this._systemContexts.get(system);
			if (!ctx) {
				ctx = { queries: {}, dt: 0, ecs: this };
				this._systemContexts.set(system, ctx);
			}
			ctx.dt = deltaTime;

			// Prepare query results for each defined query in the system
			const queryResults = ctx.queries;
			let hasResults = false;
			let hasQueries = false;

			if (system.entityQueries) {
				for (const queryName in system.entityQueries) {
					hasQueries = true;

					const query = system.entityQueries[queryName];

					if (query) {
						const existing = queryResults[queryName];
						const output = existing ?? (queryResults[queryName] = []);

						this._entityManager.getEntitiesWithQueryInto(
							output,
							query.with,
							query.without || [],
							query.changed,
							query.changed ? this._changeThreshold : undefined,
							query.parentHas,
						);

						if (output.length) {
							hasResults = true;
						}
					}
				}
			}

			if (system.entitySingletons) {
				const scratch = this._singletonScratch;
				for (const singletonName in system.entitySingletons) {
					hasQueries = true;

					const query = system.entitySingletons[singletonName];

					if (query) {
						this._entityManager.getEntitiesWithQueryInto(
							scratch,
							query.with,
							query.without || [],
							query.changed,
							query.changed ? this._changeThreshold : undefined,
							query.parentHas,
						);

						queryResults[singletonName] = scratch[0];

						if (scratch.length) {
							hasResults = true;
						}
					}
				}
			}

			// Fire onEntityEnter callbacks before process
			const enterTracking = this._entityEnterTracking.get(system);
			if (enterTracking && system.onEntityEnter) {
				for (const queryName in system.onEntityEnter) {
					const results = queryResults[queryName];
					const seenEntities = enterTracking.get(queryName);
					if (!results || !seenEntities) continue;

					const callback = system.onEntityEnter[queryName];
					if (!callback) continue;

					// Build set of current entity IDs for pruning
					const frameSet = this._entityEnterFrameSet;
					frameSet.clear();

					for (const entity of results) {
						frameSet.add(entity.id);
						if (!seenEntities.has(entity.id)) {
							seenEntities.add(entity.id);
							callback({ entity, ecs: this });
						}
					}

					// Prune stale entries (entities no longer in query results)
					for (const id of seenEntities) {
						if (!frameSet.has(id)) {
							seenEntities.delete(id);
						}
					}
				}
			}

			// Call the system's process function only if there are results or there is no query.
			if (system.process) {
				// inScreens systems already passed the gate above, so currentScreen
				// is guaranteed non-null and in the array — no need to recheck.
				const previousHint = this._activeScopeHint;
				this._activeScopeHint = system.inScreens?.length && currentScreen !== null ? currentScreen : null;
				try {
					if (this._diagnosticsEnabled) {
						const t0 = performance.now();
						if (hasResults || system.runWhenEmpty) {
							system.process(ctx);
						} else if (!hasQueries) {
							system.process(ctx);
						}
						this._systemTimings.set(system.label, performance.now() - t0);
					} else if (hasResults || system.runWhenEmpty) {
						system.process(ctx);
					} else if (!hasQueries) {
						system.process(ctx);
					}
				} finally {
					this._activeScopeHint = previousHint;
				}
			}

			// Auto-mark iterated entities for queries that declared `mutates`.
			// Runs after process() and before the threshold advance so the
			// system's own threshold captures its auto-marks (no feedback loop).
			const autoMarkPairs = system._autoMarkPairs;
			if (autoMarkPairs) {
				const em = this._entityManager;
				for (let p = 0; p < autoMarkPairs.length; p++) {
					const pair = autoMarkPairs[p];
					if (!pair) continue;
					const mutates = pair.mutates;
					const mutatesLen = mutates.length;
					if (pair.kind === 'list') {
						const results = queryResults[pair.queryName] as Array<FilteredEntity<Cfg['components']>> | undefined;
						if (!results) continue;
						for (let i = 0; i < results.length; i++) {
							const entity = results[i];
							if (!entity) continue;
							for (let j = 0; j < mutatesLen; j++) {
								const name = mutates[j];
								if (name !== undefined) em.markChanged(entity.id, name);
							}
						}
					} else {
						const entity = queryResults[pair.queryName] as FilteredEntity<Cfg['components']> | undefined;
						if (!entity) continue;
						for (let j = 0; j < mutatesLen; j++) {
							const name = mutates[j];
							if (name !== undefined) em.markChanged(entity.id, name);
						}
					}
				}
			}

			// Record this system's last-seen sequence so it won't re-process these marks
			this._systemLastSeqs.set(system, this._entityManager.changeSeq);
		}
	}

	/**
	 * Execute a non-fixed phase with optional timing, then play back the command buffer.
	 * @private
	 */
	private _runPhase(
		phase: SystemPhase,
		deltaTime: number,
		currentScreen: (keyof Cfg['screens'] & string) | null,
		timing: boolean
	): void {
		if (timing) {
			const t0 = performance.now();
			this._executePhase(this._phaseSystems[phase], deltaTime, currentScreen);
			this._phaseTimings[phase] = performance.now() - t0;
		} else {
			this._executePhase(this._phaseSystems[phase], deltaTime, currentScreen);
		}
		this._commandBuffer.playback(this);
	}

	/**
	 * Initialize all resources and systems
	 * This method:
	 * 1. Initializes all resources that were added as factory functions
	 * 2. Sets up asset manager and loads eager assets
	 * 3. Sets up screen manager
	 * 4. Calls the onInitialize lifecycle hook on all systems
	 *
	 * This is useful for game startup to ensure all resources are ready
	 * and systems are properly initialized before the game loop begins.
	 *
	 * @returns Promise that resolves when everything is initialized
	 */
	async initialize(): Promise<void> {
		this._finalizePendingBuilders();
		await this.initializeResources();

		// Set up asset manager if present
		// Key/value casts are needed because the class generic doesn't constrain ResourceTypes
		// to contain $assets/$screen — the builder merges them into R at the type level.
		if (this._assetManager) {
			this._assetManager.setEventBus(this._eventBus as unknown as EventBus<AssetEvents<keyof Cfg['assets'] & string>>);
			await this._assetManager.loadEagerAssets();
			this._resourceManager.add('$assets' as keyof Cfg['resources'], this._assetManager.createResource() as unknown as Cfg['resources'][keyof Cfg['resources']]);
		}

		// Set up screen manager if present
		if (this._screenManager) {
			const screenBus = this._eventBus as unknown as EventBus<ScreenEvents<keyof Cfg['screens'] & string>>;
			this._screenManager.setDependencies(
				screenBus,
				this._assetManager,
				this
			);
			this._resourceManager.add('$screen' as keyof Cfg['resources'], this._screenManager.createResource() as unknown as Cfg['resources'][keyof Cfg['resources']]);
			// Drain screen-scoped entities on screen exit. Copy the set first
			// because `removeEntity` fires `beforeEntityRemoved` → mutates the set.
			screenBus.subscribe('screenExit', ({ screen }) => {
				const set = this._screenScopedEntities.get(screen);
				if (!set || set.size === 0) return;
				this._screenScopedEntities.delete(screen);
				for (const id of Array.from(set)) {
					this._entityScreenScope.delete(id);
					this.removeEntity(id);
				}
			});
		}

		for (const system of this._systems) {
			await system.onInitialize?.(this);
		}
	}

	/**
	 * Initialize specific resources or all resources that were added as factory functions but haven't been initialized yet.
	 * This is useful when you need to ensure resources are ready before proceeding.
	 * @param keys Optional array of resource keys to initialize. If not provided, all pending resources will be initialized.
	 * @returns Promise that resolves when the specified resources are initialized
	 */
	async initializeResources<K extends keyof Cfg['resources']>(...keys: K[]): Promise<void> {
		await this._resourceManager.initializeResources(this, ...keys);
	}

	/**
	 * Rebuild per-phase system arrays from the flat _systems list.
	 * Each phase array is sorted by priority (higher first), with
	 * registration order as tiebreaker.
	 * @private
	 */
	private _rebuildPhaseSystems(): void {
		for (const phase of PHASE_ORDER) {
			this._phaseSystems[phase] = [];
		}
		for (const system of this._systems) {
			const phase = system.phase ?? 'update';
			this._phaseSystems[phase].push(system);
		}
		for (const phase of PHASE_ORDER) {
			this._phaseSystems[phase].sort((a, b) => {
				const priorityA = a.priority ?? 0;
				const priorityB = b.priority ?? 0;
				return priorityB - priorityA; // Higher priority executes first
			});
		}
	}

	/**
		* Update the priority of a system
		* @param label The unique label of the system to update
		* @param priority The new priority value (higher values execute first)
		* @returns true if the system was found and updated, false otherwise
	*/
	updateSystemPriority(label: Labels, priority: number): boolean {
		this._finalizePendingBuilders();
		const system = this._systems.find(system => system.label === label);
		if (!system) return false;

		// Set the new priority
		system.priority = priority;

		// Re-sort the systems array
		this._rebuildPhaseSystems();

		return true;
	}

	/**
	 * Move a system to a different execution phase at runtime.
	 * @param label The unique label of the system to move
	 * @param phase The target phase
	 * @returns true if the system was found and updated, false otherwise
	 */
	updateSystemPhase(label: Labels, phase: SystemPhase): boolean {
		this._finalizePendingBuilders();
		const system = this._systems.find(system => system.label === label);
		if (!system) return false;

		system.phase = phase;
		this._rebuildPhaseSystems();

		return true;
	}

	/**
	 * The interpolation alpha between fixed update steps.
	 * Ranges from 0 to <1, representing how far into the next
	 * fixed step the current frame is. Use in the render phase
	 * for smooth visual interpolation.
	 */
	get interpolationAlpha(): number {
		return this._interpolationAlpha;
	}

	/**
	 * The configured fixed timestep interval in seconds.
	 */
	get fixedDt(): number {
		return this._fixedDt;
	}

	// ==================== System Group Control ====================

	/**
	 * Disable a system group. Systems in this group will be skipped during update().
	 * @param groupName The name of the group to disable
	 */
	disableSystemGroup(groupName: Groups): void {
		this._disabledGroups.add(groupName);
	}

	/**
	 * Enable a system group. Systems in this group will run during update().
	 * @param groupName The name of the group to enable
	 */
	enableSystemGroup(groupName: Groups): void {
		this._disabledGroups.delete(groupName);
	}

	/**
	 * Check if a system group is enabled.
	 * @param groupName The name of the group to check
	 * @returns true if the group is enabled (or doesn't exist), false if disabled
	 */
	isSystemGroupEnabled(groupName: Groups): boolean {
		return !this._disabledGroups.has(groupName);
	}

	/**
	 * Get all system labels that belong to a specific group.
	 * @param groupName The name of the group
	 * @returns Array of system labels in the group
	 */
	getSystemsInGroup(groupName: Groups): string[] {
		this._finalizePendingBuilders();
		return this._systems
			.filter(system => system.groups?.includes(groupName))
			.map(system => system.label);
	}

	/**
		* Remove a system by its label
		* Calls the system's onDetach method with this ECSpresso instance if defined
		* @param label The unique label of the system to remove
		* @returns true if the system was found and removed, false otherwise
	*/
	removeSystem(label: Labels): boolean {
		this._finalizePendingBuilders();
		const index = this._systems.findIndex(system => system.label === label);
		if (index === -1) return false;

		const system = this._systems[index];
		// This should never happen since we just found the system by index
		if (!system) return false;

		// Call the onDetach lifecycle hook if defined
		if (system.onDetach) {
			system.onDetach(this);
		}

		// Remove system and clean up per-system tracking
		this._systems.splice(index, 1);
		this._systemLastSeqs.delete(system);
		this._entityEnterTracking.delete(system);

		// Re-sort systems
		this._rebuildPhaseSystems();

		return true;
	}

	/**
		* Internal method to register a system with this ECSpresso instance
		* @internal Used by SystemBuilder - replaces direct private property access
	*/
	_registerSystem(system: System<Cfg, any, any>): void {
		this._systems.push(system);
		// Initialize the system's last-seen sequence to the current change threshold.
		// Before any update this is 0, so newly added systems see spawn marks.
		// After updates, the threshold is advanced past consumed marks, so
		// systems added later don't see stale marks.
		this._systemLastSeqs.set(system, this._changeThreshold);
		if (!this._batchingRegistrations) {
			this._rebuildPhaseSystems();
		}

		// Precompute auto-mark pairs for `mutates`-declaring queries so the
		// post-process walk in _executePhase is a single pointer check away
		// from zero cost for systems that don't use the feature.
		const autoMarkPairs: Array<{
			queryName: string;
			mutates: ReadonlyArray<keyof Cfg['components']>;
			kind: 'list' | 'singleton';
		}> = [];
		if (system.entityQueries) {
			for (const queryName in system.entityQueries) {
				// setProcessEach handles its own per-entity marking inline to
				// preserve return-value precision; skip its query here.
				if (queryName === PROCESS_EACH_QUERY) continue;
				const query = system.entityQueries[queryName];
				const mutates = (query as { mutates?: ReadonlyArray<keyof Cfg['components']> } | undefined)?.mutates;
				if (mutates && mutates.length > 0) {
					autoMarkPairs.push({ queryName, mutates, kind: 'list' });
				}
			}
		}
		if (system.entitySingletons) {
			for (const queryName in system.entitySingletons) {
				const query = system.entitySingletons[queryName];
				const mutates = (query as { mutates?: ReadonlyArray<keyof Cfg['components']> } | undefined)?.mutates;
				if (mutates && mutates.length > 0) {
					autoMarkPairs.push({ queryName, mutates, kind: 'singleton' });
				}
			}
		}
		system._autoMarkPairs = autoMarkPairs.length > 0 ? autoMarkPairs : null;

		// Set up entity enter tracking if the system has onEntityEnter handlers
		if (system.onEntityEnter) {
			const queryMap = new Map<string, Set<number>>();
			for (const queryName in system.onEntityEnter) {
				queryMap.set(queryName, new Set());
			}
			this._entityEnterTracking.set(system, queryMap);
		}

		// Set up event handlers if they exist
		if (!system.eventHandlers) return;

		for (const eventName in system.eventHandlers) {
			const handler = system.eventHandlers[eventName];
			if (handler) {
				this._eventBus.subscribe(eventName, (data) => {
					handler({ data, ecs: this });
				});
			}
		}
	}

	/**
		* Check if a resource exists
	*/
	hasResource<K extends keyof Cfg['resources']>(key: K): boolean {
		return this._resourceManager.has(key);
	}

	/**
	 * Get a resource by key. Throws if the resource is not found.
	 * @param key The resource key
	 * @returns The resource value
	 * @throws Error if resource not found
	 * @see tryGetResource — the non-throwing alternative that returns undefined
	 */
	getResource<K extends keyof Cfg['resources']>(key: K): Cfg['resources'][K] {
		if (!this._resourceManager.has(key)) {
			throw new Error(`Resource '${String(key)}' not found. Available resources: [${this.getResourceKeys().map(k => String(k)).join(', ')}]`);
		}

		return this._resourceManager.get(key, this);
	}

	/**
	 * Try to get a resource by key. Returns undefined if the resource is not found.
	 * Inspired by Bevy's `World::get_resource::<T>()` which returns `Option<&T>`.
	 *
	 * Two overloads:
	 * 1. Known key — full type safety from `ResourceTypes`
	 * 2. String key with explicit type param — for cross-plugin optional dependencies
	 *
	 * @example
	 * ```typescript
	 * // Known key (type inferred from ResourceTypes)
	 * const score = ecs.tryGetResource('score'); // ScoreResource | undefined
	 *
	 * // Cross-plugin optional dependency (caller specifies expected type)
	 * const si = ecs.tryGetResource<SpatialIndex>('spatialIndex') ?? null;
	 * ```
	 */
	tryGetResource<K extends keyof Cfg['resources']>(key: K): Cfg['resources'][K] | undefined;
	tryGetResource<T>(key: unknown extends T ? never : string): T | undefined;
	tryGetResource(key: string): unknown {
		const k = key as keyof Cfg['resources'];
		if (!this._resourceManager.has(k)) return undefined;
		return this._resourceManager.get(k, this);
	}

	/**
		* Add a resource to the ECS instance.
		*
		* - Plain value → stored directly
		* - Function → treated as a factory, called with this ECSpresso instance on first access
		* - `{ factory, dependsOn?, onDispose? }` → factory with dependencies/disposal
		* - `directValue(val)` → stores the value as-is (use to store functions/classes without invoking them)
	*/
	addResource<K extends keyof Cfg['resources']>(
		key: K,
		resource:
			| Cfg['resources'][K]
			| ((ecs: ECSpresso<Cfg>) => Cfg['resources'][K] | Promise<Cfg['resources'][K]>)
			| ResourceFactoryWithDeps<Cfg['resources'][K], ECSpresso<Cfg>, keyof Cfg['resources'] & string>
			| ResourceDirectValue<Cfg['resources'][K]>
	): this {
		this._resourceManager.add(key, resource);
		return this;
	}

	/**
		* Remove a resource from the ECS instance (without calling onDispose)
		* @param key The resource key to remove
		* @returns True if the resource was removed, false if it didn't exist
	*/
	removeResource<K extends keyof Cfg['resources']>(key: K): boolean {
		return this._resourceManager.remove(key);
	}

	/**
	 * Dispose a single resource, calling its onDispose callback if defined
	 * @param key The resource key to dispose
	 * @returns True if the resource existed and was disposed, false if it didn't exist
	 */
	async disposeResource<K extends keyof Cfg['resources']>(key: K): Promise<boolean> {
		return this._resourceManager.disposeResource(key, this);
	}

	/**
	 * Dispose all initialized resources in reverse dependency order.
	 * Resources that depend on others are disposed first.
	 * Calls each resource's onDispose callback if defined.
	 */
	async disposeResources(): Promise<void> {
		return this._resourceManager.disposeResources(this);
	}

	/**
		* Update an existing resource using an updater function
		* @param key The resource key to update
		* @param updater Function that receives the current resource value and returns the new value
		* @returns This ECSpresso instance for chaining
		* @throws Error if the resource doesn't exist
	*/
	updateResource<K extends keyof Cfg['resources']>(
		key: K,
		updater: (current: Cfg['resources'][K]) => Cfg['resources'][K]
	): this {
		const oldValue = this.getResource(key);
		const newValue = updater(oldValue);
		this._resourceManager.add(key, newValue);
		this._resourceManager.notifyChange(key, newValue, oldValue);
		return this;
	}

	/**
		* Set a resource to a plain value.
		* Unlike updateResource, does not require an updater function.
		* @param key The resource key to set
		* @param value The new resource value
		* @returns This ECSpresso instance for chaining
	*/
	setResource<K extends keyof Cfg['resources']>(
		key: K,
		value: Cfg['resources'][K]
	): this {
		const oldValue = this.tryGetResource(key);
		this._resourceManager.add(key, value);
		if (oldValue !== undefined) {
			this._resourceManager.notifyChange(key, value, oldValue);
		}
		return this;
	}

	/**
		* Subscribe to changes for a specific resource key.
		* @param key The resource key to watch
		* @param callback Function called with (newValue, oldValue) when the resource changes
		* @returns Unsubscribe function
	*/
	onResourceChange<K extends keyof Cfg['resources']>(
		key: K,
		callback: (newValue: Cfg['resources'][K], oldValue: Cfg['resources'][K]) => void
	): () => void {
		return this._resourceManager.onResourceChange(key, callback);
	}

	/**
		* Whether a resource has active change subscribers.
		* Used by the system builder to skip caching for observed resources.
	*/
	isResourceObserved<K extends keyof Cfg['resources']>(key: K): boolean {
		return this._resourceManager.isObserved(key);
	}

	/**
		* Get all resource keys that are currently registered
		* @returns Array of resource keys
	*/
	getResourceKeys(): Array<keyof Cfg['resources']> {
		return this._resourceManager.getKeys() as Array<keyof Cfg['resources']>;
	}

	/**
		* Check if a resource needs initialization (was added as a factory function)
		* @param key The resource key to check
		* @returns True if the resource needs initialization
	*/
	resourceNeedsInitialization<K extends keyof Cfg['resources']>(key: K): boolean {
		return this._resourceManager.needsInitialization(key);
	}

	/**
		* Get an entity by ID.
		* @param entityId The entity ID
		* @returns The entity, or undefined if it doesn't exist
	*/
	getEntity(entityId: number): Entity<Cfg['components']> | undefined {
		return this._entityManager.getEntity(entityId);
	}

	/**
		* Get a component value from an entity.
		* @param entityId The entity ID
		* @param componentName The component to retrieve
		* @returns The component value, or undefined if the entity doesn't have it
	*/
	getComponent<K extends keyof Cfg['components']>(
		entityId: number,
		componentName: K
	): Cfg['components'][K] | undefined {
		return this._entityManager.getComponent(entityId, componentName);
	}

	/**
		* Add or replace a component on an entity.
		* Triggers component-added callbacks and marks the component as changed.
		* @param entityId The entity ID
		* @param componentName The component to add
		* @param value The component value
	*/
	addComponent<K extends keyof Cfg['components']>(
		entityId: number,
		componentName: K,
		value: Cfg['components'][K]
	): void {
		this._entityManager.addComponent(entityId, componentName, value);
	}

	/**
		* Add multiple components to an entity at once.
		* @param entityId The entity ID
		* @param components Object with component names as keys and component data as values
	*/
	addComponents<T extends { [K in keyof Cfg['components']]?: Cfg['components'][K] }>(
		entityId: number,
		components: T & Record<Exclude<keyof T, keyof Cfg['components']>, never>
	): void {
		this._entityManager.addComponents(entityId, components);
	}

	/**
		* Remove a component from an entity.
		* Triggers component-removed and dispose callbacks.
		* @param entityId The entity ID
		* @param componentName The component to remove
	*/
	removeComponent<K extends keyof Cfg['components']>(
		entityId: number,
		componentName: K
	): void {
		this._entityManager.removeComponent(entityId, componentName);
	}

	/**
		* Check if an entity has a component
	*/
	hasComponent<K extends keyof Cfg['components']>(
		entityId: number,
		componentName: K
	): boolean {
		const component = this._entityManager.getComponent(entityId, componentName);
		return component !== undefined;
	}

	/**
		* Create an entity and add components to it in one call
		* @param components Object with component names as keys and component data as values
		* @returns The created entity with all components added
		*/
	spawn<T extends { [K in keyof Cfg['components']]?: Cfg['components'][K] }>(
		components: T & Record<Exclude<keyof T, keyof Cfg['components']>, never>,
		options?: { scope?: (keyof Cfg['screens'] & string) | null }
	): FilteredEntity<Cfg['components'], keyof T & keyof Cfg['components']> {
		const entity = this._entityManager.createEntity();
		this._entityManager.addComponents(entity.id, components);
		this._applyScreenScope(entity.id, options);
		return entity as FilteredEntity<Cfg['components'], keyof T & keyof Cfg['components']>;
	}

	/**
	 * Read the active scope hint set by the current screen-gated system tick.
	 * Returns `null` outside any system's process call, or when the active
	 * system is not gated to the current screen.
	 * @internal Used by CommandBuffer to capture intent at queue time.
	 */
	_getActiveScopeHint(): (keyof Cfg['screens'] & string) | null {
		return this._activeScopeHint;
	}

	/**
	 * Tag an entity as scoped to a screen.
	 *
	 * Scope resolution order:
	 *   1. Explicit `options.scope === null` → unscoped (opt-out from hint).
	 *   2. Explicit `options.scope: string` → scope to that screen.
	 *   3. No `scope` provided (or `undefined`) → fall back to active hint set
	 *      by the current screen-gated system tick. Otherwise unscoped.
	 *
	 * The entity is removed when its scoped screen exits.
	 */
	private _applyScreenScope(
		entityId: number,
		options: { scope?: (keyof Cfg['screens'] & string) | null } | undefined,
	): void {
		const screen = options?.scope !== undefined ? options.scope : this._activeScopeHint;
		if (screen === null) return;
		const set = this._screenScopedEntities.get(screen) ?? new Set<number>();
		set.add(entityId);
		this._screenScopedEntities.set(screen, set);
		this._entityScreenScope.set(entityId, screen);
	}

	/**
		* Get all entities with specific components
	*/
	getEntitiesWithQuery<
		WithComponents extends keyof Cfg['components'],
		WithoutComponents extends keyof Cfg['components'] = never
	>(
		withComponents: ReadonlyArray<WithComponents>,
		withoutComponents: ReadonlyArray<WithoutComponents> = [],
		changedComponents?: ReadonlyArray<keyof Cfg['components']>,
		parentHas?: ReadonlyArray<keyof Cfg['components']>,
	): Array<FilteredEntity<Cfg['components'], WithComponents, WithoutComponents>> {
		return this._entityManager.getEntitiesWithQuery(
			withComponents,
			withoutComponents,
			changedComponents,
			changedComponents ? this._changeThreshold : undefined,
			parentHas,
		);
	}

	/**
	 * Get the single entity matching a query. Throws if zero or more than one match.
	 * @param withComponents Components the entity must have
	 * @param withoutComponents Components the entity must not have
	 * @returns The single matching entity
	 * @throws If zero or more than one entity matches
	 */
	getSingleton<
		WithComponents extends keyof Cfg['components'],
		WithoutComponents extends keyof Cfg['components'] = never
	>(
		withComponents: ReadonlyArray<WithComponents>,
		withoutComponents: ReadonlyArray<WithoutComponents> = [],
	): FilteredEntity<Cfg['components'], WithComponents, WithoutComponents> {
		const results = this._entityManager.getEntitiesWithQuery(withComponents, withoutComponents);
		if (results.length === 0) {
			throw new Error(`getSingleton: no entity matches query with=[${String(withComponents)}] without=[${String(withoutComponents)}]`);
		}
		if (results.length > 1) {
			throw new Error(`getSingleton: expected 1 entity but found ${results.length} matching query with=[${String(withComponents)}] without=[${String(withoutComponents)}]`);
		}
		const result = results[0];
		if (!result) throw new Error('getSingleton: unexpected empty result');
		return result;
	}

	/**
	 * Get the single entity matching a query, or undefined if none match.
	 * Throws if more than one entity matches.
	 * @param withComponents Components the entity must have
	 * @param withoutComponents Components the entity must not have
	 * @returns The single matching entity, or undefined if none match
	 * @throws If more than one entity matches
	 */
	tryGetSingleton<
		WithComponents extends keyof Cfg['components'],
		WithoutComponents extends keyof Cfg['components'] = never
	>(
		withComponents: ReadonlyArray<WithComponents>,
		withoutComponents: ReadonlyArray<WithoutComponents> = [],
	): FilteredEntity<Cfg['components'], WithComponents, WithoutComponents> | undefined {
		const results = this._entityManager.getEntitiesWithQuery(withComponents, withoutComponents);
		if (results.length === 0) return undefined;
		if (results.length > 1) {
			throw new Error(`tryGetSingleton: expected 0 or 1 entity but found ${results.length} matching query with=[${String(withComponents)}] without=[${String(withoutComponents)}]`);
		}
		return results[0];
	}

	/**
	 * Remove an entity (and optionally its descendants)
	 * @param entityId Entity ID to remove
	 * @param options Options for removal (cascade: true by default)
	 * @returns true if entity was removed
	 */
	removeEntity(entityId: number, options?: RemoveEntityOptions): boolean {
		return this._entityManager.removeEntity(entityId, options);
	}

	// ==================== Hierarchy Methods ====================

	/**
	 * Create an entity as a child of another entity with initial components
	 * @param parentId The parent entity ID
	 * @param components Initial components to add
	 * @returns The created child entity
	 */
	spawnChild<T extends { [K in keyof Cfg['components']]?: Cfg['components'][K] }>(
		parentId: number,
		components: T & Record<Exclude<keyof T, keyof Cfg['components']>, never>,
		options?: { scope?: (keyof Cfg['screens'] & string) | null }
	): FilteredEntity<Cfg['components'], keyof T & keyof Cfg['components']> {
		const entity = this._entityManager.spawnChild(parentId, components);
		this._emitHierarchyChanged(entity.id, null, parentId);
		this._applyScreenScope(entity.id, options);
		return entity;
	}

	/**
	 * Set the parent of an entity
	 * @param childId The entity ID to set as a child
	 * @param parentId The entity ID to set as the parent
	 */
	setParent(childId: number, parentId: number): this {
		const oldParent = this._entityManager.getParent(childId);
		this._entityManager.setParent(childId, parentId);
		this._emitHierarchyChanged(childId, oldParent, parentId);
		return this;
	}

	/**
	 * Remove the parent relationship for an entity (orphan it)
	 * @param childId The entity ID to orphan
	 * @returns true if a parent was removed, false if entity had no parent
	 */
	removeParent(childId: number): boolean {
		const oldParent = this._entityManager.getParent(childId);
		const result = this._entityManager.removeParent(childId);
		if (result) {
			this._emitHierarchyChanged(childId, oldParent, null);
		}
		return result;
	}

	/**
	 * Get the parent of an entity
	 * @param entityId The entity ID to get the parent of
	 * @returns The parent entity ID, or null if no parent
	 */
	getParent(entityId: number): number | null {
		return this._entityManager.getParent(entityId);
	}

	/**
	 * Get all children of an entity in insertion order
	 * @param parentId The parent entity ID
	 * @returns Readonly array of child entity IDs
	 */
	getChildren(parentId: number): readonly number[] {
		return this._entityManager.getChildren(parentId);
	}

	/**
	 * Get a child at a specific index
	 * @param parentId The parent entity ID
	 * @param index The index of the child
	 * @returns The child entity ID, or null if index is out of bounds
	 */
	getChildAt(parentId: number, index: number): number | null {
		return this._entityManager.getChildAt(parentId, index);
	}

	/**
	 * Get the index of a child within its parent's children list
	 * @param parentId The parent entity ID
	 * @param childId The child entity ID to find
	 * @returns The index of the child, or -1 if not found
	 */
	getChildIndex(parentId: number, childId: number): number {
		return this._entityManager.getChildIndex(parentId, childId);
	}

	/**
	 * Get all ancestors of an entity in order [parent, grandparent, ...]
	 * @param entityId The entity ID to get ancestors of
	 * @returns Readonly array of ancestor entity IDs
	 */
	getAncestors(entityId: number): readonly number[] {
		return this._entityManager.getAncestors(entityId);
	}

	/**
	 * Get all descendants of an entity in depth-first order
	 * @param entityId The entity ID to get descendants of
	 * @returns Readonly array of descendant entity IDs
	 */
	getDescendants(entityId: number): readonly number[] {
		return this._entityManager.getDescendants(entityId);
	}

	/**
	 * Get the root ancestor of an entity (topmost parent), or self if no parent
	 * @param entityId The entity ID to get the root of
	 * @returns The root entity ID
	 */
	getRoot(entityId: number): number {
		return this._entityManager.getRoot(entityId);
	}

	/**
	 * Get siblings of an entity (other children of the same parent)
	 * @param entityId The entity ID to get siblings of
	 * @returns Readonly array of sibling entity IDs
	 */
	getSiblings(entityId: number): readonly number[] {
		return this._entityManager.getSiblings(entityId);
	}

	/**
	 * Check if an entity is a descendant of another entity
	 * @param entityId The potential descendant ID
	 * @param ancestorId The potential ancestor ID
	 * @returns true if entityId is a descendant of ancestorId
	 */
	isDescendantOf(entityId: number, ancestorId: number): boolean {
		return this._entityManager.isDescendantOf(entityId, ancestorId);
	}

	/**
	 * Check if an entity is an ancestor of another entity
	 * @param entityId The potential ancestor ID
	 * @param descendantId The potential descendant ID
	 * @returns true if entityId is an ancestor of descendantId
	 */
	isAncestorOf(entityId: number, descendantId: number): boolean {
		return this._entityManager.isAncestorOf(entityId, descendantId);
	}

	/**
	 * Get all root entities (entities that have children but no parent)
	 * @returns Readonly array of root entity IDs
	 */
	getRootEntities(): readonly number[] {
		return this._entityManager.getRootEntities();
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
		this._entityManager.forEachInHierarchy(callback, options);
	}

	/**
	 * Generator-based hierarchy traversal in parent-first (breadth-first) order.
	 * Supports early termination via break.
	 * @param options Optional traversal options (roots to filter to specific subtrees)
	 * @yields HierarchyEntry for each entity in parent-first order
	 */
	hierarchyIterator(options?: HierarchyIteratorOptions): Generator<HierarchyEntry, void, unknown> {
		return this._entityManager.hierarchyIterator(options);
	}

	/**
	 * Emit a hierarchy changed event
	 * @internal
	 */
	private _emitHierarchyChanged(entityId: number, oldParent: number | null, newParent: number | null): void {
		// Publish the event - if the user has declared hierarchyChanged in their EventTypes, it will be handled
		type HierarchyEventBus = EventBus<{ hierarchyChanged: { entityId: number; oldParent: number | null; newParent: number | null } }>;
		(this._eventBus as unknown as HierarchyEventBus).publish('hierarchyChanged', { entityId, oldParent, newParent });
	}

	/**
		* Get all installed plugin IDs
	*/
	get installedPlugins(): string[] {
		return Array.from(this._installedPlugins);
	}

	// Getters for the internal managers
	get entityManager() {
		return this._entityManager;
	}

	get eventBus() {
		this._finalizePendingBuilders();
		return this._eventBus;
	}

	/**
	 * Command buffer for queuing deferred structural changes.
	 * Commands are executed automatically at the end of each update() cycle.
	 *
	 * @example
	 * ```typescript
	 * // In a system or event handler
	 * ecs.commands.removeEntity(entityId);
	 * ecs.commands.spawn({ position: { x: 0, y: 0 } });
	 * ```
	 */
	get commands() {
		return this._commandBuffer;
	}

	/**
	 * The current tick number, incremented at the end of each update()
	 */
	get currentTick(): number {
		return this._currentTick;
	}

	/**
	 * The current change detection threshold.
	 * During system execution, this is the system's last-seen sequence.
	 * Between updates, this is the global sequence after command buffer playback.
	 * Manual change detection should compare: getChangeSeq(...) > changeThreshold
	 */
	get changeThreshold(): number {
		return this._changeThreshold;
	}

	// ==================== Diagnostics ====================

	/**
	 * Toggle diagnostics timing collection. When enabled, system and phase
	 * timings are recorded each frame. When disabled, timing maps are cleared
	 * and no overhead is incurred.
	 */
	enableDiagnostics(enabled: boolean): void {
		this._diagnosticsEnabled = enabled;
		if (!enabled) {
			this._systemTimings.clear();
			this._phaseTimings = {
				preUpdate: 0, fixedUpdate: 0, update: 0, postUpdate: 0, render: 0,
			};
		}
	}

	get diagnosticsEnabled(): boolean {
		return this._diagnosticsEnabled;
	}

	get systemTimings(): ReadonlyMap<string, number> {
		return this._systemTimings;
	}

	get phaseTimings(): Readonly<Record<SystemPhase, number>> {
		return this._phaseTimings;
	}

	get entityCount(): number {
		return this._entityManager.entityCount;
	}

	/**
	 * Mutate a component in place and automatically mark it as changed.
	 * Throws if the entity does not exist or does not have the component.
	 * @param entityId The entity ID
	 * @param componentName The component to mutate
	 * @param mutator A function that receives the component value for in-place mutation
	 * @returns The mutated component value
	 */
	mutateComponent<K extends keyof Cfg['components']>(
		entityId: number,
		componentName: K,
		mutator: (value: Cfg['components'][K]) => void
	): Cfg['components'][K] {
		const component = this._entityManager.getComponent(entityId, componentName);
		if (component === undefined) {
			throw new Error(`Entity ${entityId} does not have component "${String(componentName)}"`);
		}
		mutator(component);
		this._entityManager.markChanged(entityId, componentName);
		return component;
	}

	/**
	 * Mark a component as changed on an entity.
	 * Each call increments a global monotonic sequence; systems with changed
	 * queries will see the mark exactly once (on their next execution).
	 * @param entityId The entity ID
	 * @param componentName The component that was changed
	 */
	markChanged<K extends keyof Cfg['components']>(entityId: number, componentName: K): void {
		this._entityManager.markChanged(entityId, componentName);
	}

	// ==================== Component Dispose ====================

	/**
	 * Register a dispose callback for a component type.
	 * Called when a component is removed (explicit removal, entity destruction, or replacement).
	 * Later registrations replace earlier ones for the same component type.
	 * @param componentName The component type to register disposal for
	 * @param callback Function receiving the component value being disposed and the entity ID
	 */
	registerDispose<K extends keyof Cfg['components']>(
		componentName: K,
		callback: (ctx: { value: Cfg['components'][K]; entityId: number }) => void
	): void {
		this._entityManager.registerDispose(componentName, callback);
	}

	// ==================== Required Components ====================

	/**
	 * Register a required component relationship.
	 * When an entity gains `trigger`, the `required` component is auto-added
	 * (using `factory` for the default value) if not already present.
	 * Enforced at insertion time (spawn/addComponent) only — removal is unrestricted.
	 * @param trigger The component whose presence triggers auto-addition
	 * @param required The component to auto-add
	 * @param factory Function that creates the default value for the required component
	 */
	registerRequired<
		Trigger extends keyof Cfg['components'],
		Required extends keyof Cfg['components'],
	>(
		trigger: Trigger,
		required: Required,
		factory: (triggerValue: Cfg['components'][Trigger]) => Cfg['components'][Required]
	): void {
		if (String(trigger) === String(required)) {
			throw new Error(`Cannot require a component to depend on itself: '${String(trigger)}'`);
		}

		const existing = this._requiredComponents.get(trigger) ?? [];

		if (existing.some(r => r.component === required)) {
			throw new Error(
				`Required component '${String(required)}' already registered for trigger '${String(trigger)}'`
			);
		}

		this._checkRequiredCycle(trigger, required);

		existing.push({ component: required, factory: factory as (triggerValue: unknown) => unknown });
		this._requiredComponents.set(trigger, existing);
	}

	/**
	 * Check for circular dependencies in the required components graph.
	 * @throws Error if adding trigger→newRequired would create a cycle
	 */
	private _checkRequiredCycle(
		trigger: keyof Cfg['components'],
		newRequired: keyof Cfg['components']
	): void {
		checkRequiredCycle(
			trigger,
			newRequired,
			(component) => this._requiredComponents.get(component),
		);
	}

	// ==================== Component Lifecycle Hooks ====================

	/**
	 * Register a callback when a specific component is added to any entity
	 * @param componentName The component key
	 * @param handler Function receiving the new component value and the entity
	 * @returns Unsubscribe function to remove the callback
	 */
	onComponentAdded<K extends keyof Cfg['components']>(
		componentName: K,
		handler: (ctx: { value: Cfg['components'][K]; entity: Entity<Cfg['components']> }) => void
	): () => void {
		return this._entityManager.onComponentAdded(componentName, handler);
	}

	/**
	 * Register a callback when a specific component is removed from any entity
	 * @param componentName The component key
	 * @param handler Function receiving the old component value and the entity
	 * @returns Unsubscribe function to remove the callback
	 */
	onComponentRemoved<K extends keyof Cfg['components']>(
		componentName: K,
		handler: (ctx: { value: Cfg['components'][K]; entity: Entity<Cfg['components']> }) => void
	): () => void {
		return this._entityManager.onComponentRemoved(componentName, handler);
	}

	// ==================== Reactive Queries ====================

	/**
	 * Add a reactive query that triggers callbacks when entities enter/exit the query match.
	 * @param name Unique name for the query
	 * @param definition Query definition with with/without arrays and onEnter/onExit callbacks
	 */
	addReactiveQuery<
		WithComponents extends keyof Cfg['components'],
		WithoutComponents extends keyof Cfg['components'] = never,
		OptionalComponents extends keyof Cfg['components'] = never,
	>(
		name: ReactiveQueryNames,
		definition: ReactiveQueryDefinition<Cfg['components'], WithComponents, WithoutComponents, OptionalComponents>
	): void {
		this._reactiveQueryManager.addQuery(name, definition);
	}

	/**
	 * Remove a reactive query by name.
	 * @param name Name of the query to remove
	 * @returns true if the query existed and was removed, false otherwise
	 */
	removeReactiveQuery(name: ReactiveQueryNames): boolean {
		return this._reactiveQueryManager.removeQuery(name);
	}

	// ==================== Event Convenience Methods ====================

	/**
	 * Subscribe to an event (convenience wrapper for eventBus.subscribe)
	 * @param eventType The event type to subscribe to
	 * @param callback The callback to invoke when the event is published
	 * @returns An unsubscribe function
	 */
	on<E extends keyof Cfg['events']>(
		eventType: E,
		callback: (data: Cfg['events'][E]) => void
	): () => void {
		return this._eventBus.subscribe(eventType, callback);
	}

	/**
	 * Unsubscribe from an event by callback reference (convenience wrapper for eventBus.unsubscribe)
	 * @param eventType The event type to unsubscribe from
	 * @param callback The callback to remove
	 * @returns true if the callback was found and removed, false otherwise
	 */
	off<E extends keyof Cfg['events']>(
		eventType: E,
		callback: (data: Cfg['events'][E]) => void
	): boolean {
		return this._eventBus.unsubscribe(eventType, callback);
	}

	/**
	 * Register a hook that runs after all systems in update()
	 * @param callback The hook to call after all systems have processed
	 * @returns An unsubscribe function to remove the hook
	 */
	onPostUpdate(
		callback: (ctx: { ecs: ECSpresso<Cfg>; dt: number }) => void
	): () => void {
		this._postUpdateHooks.push(callback);
		return () => {
			const index = this._postUpdateHooks.indexOf(callback);
			if (index !== -1) {
				this._postUpdateHooks.splice(index, 1);
			}
		};
	}

	// ==================== Asset Management ====================

	private requireAssetManager(): AssetManager<Cfg['assets']> {
		if (!this._assetManager) {
			throw new Error('Asset manager not configured. Use withAssets() in builder.');
		}
		return this._assetManager;
	}

	/**
	 * Get a loaded asset by key. Throws if not loaded.
	 */
	getAsset<K extends keyof Cfg['assets']>(key: K): Cfg['assets'][K] {
		return this.requireAssetManager().get(key);
	}

	/**
	 * Get a loaded asset or undefined if not loaded
	 */
	tryGetAsset<K extends keyof Cfg['assets']>(key: K): Cfg['assets'][K] | undefined {
		return this._assetManager?.tryGet(key);
	}

	/**
	 * Get a handle to an asset with status information
	 */
	getAssetHandle<K extends keyof Cfg['assets']>(key: K): AssetHandle<Cfg['assets'][K]> {
		return this.requireAssetManager().getHandle(key);
	}

	/**
	 * Check if an asset is loaded
	 */
	isAssetLoaded<K extends keyof Cfg['assets']>(key: K): boolean {
		return this._assetManager?.isLoaded(key) ?? false;
	}

	/**
	 * Load a single asset
	 */
	async loadAsset<K extends keyof Cfg['assets']>(key: K): Promise<Cfg['assets'][K]> {
		return this.requireAssetManager().loadAsset(key);
	}

	/**
	 * Load all assets in a group
	 */
	async loadAssetGroup(groupName: AssetGroupNames): Promise<void> {
		return this.requireAssetManager().loadAssetGroup(groupName);
	}

	/**
	 * Check if all assets in a group are loaded
	 */
	isAssetGroupLoaded(groupName: AssetGroupNames): boolean {
		return this._assetManager?.isGroupLoaded(groupName) ?? false;
	}

	/**
	 * Get the loading progress of a group (0-1)
	 */
	getAssetGroupProgress(groupName: AssetGroupNames): number {
		return this._assetManager?.getGroupProgress(groupName) ?? 0;
	}

	// ==================== Screen Management ====================

	private requireScreenManager(): ScreenManager<Cfg['screens']> {
		if (!this._screenManager) {
			throw new Error('Screen manager not configured. Use withScreens() in builder.');
		}
		return this._screenManager;
	}

	/**
	 * Transition to a new screen, clearing the stack
	 */
	async setScreen<K extends keyof Cfg['screens']>(
		name: K,
		config: Cfg['screens'][K] extends ScreenDefinition<infer C, any> ? C : never
	): Promise<void> {
		return this.requireScreenManager().setScreen(name, config);
	}

	/**
	 * Push a screen onto the stack (overlay)
	 */
	async pushScreen<K extends keyof Cfg['screens']>(
		name: K,
		config: Cfg['screens'][K] extends ScreenDefinition<infer C, any> ? C : never
	): Promise<void> {
		return this.requireScreenManager().pushScreen(name, config);
	}

	/**
	 * Pop the current screen and return to the previous one
	 */
	async popScreen(): Promise<void> {
		return this.requireScreenManager().popScreen();
	}

	/**
	 * Get the current screen name
	 */
	getCurrentScreen(): keyof Cfg['screens'] | null {
		return this._screenManager?.getCurrentScreen() ?? null;
	}

	/**
	 * Get the current screen config (immutable), narrowed to a specific screen.
	 * Throws if the current screen doesn't match.
	 */
	getScreenConfig<K extends keyof Cfg['screens'] & string>(screen: K): Cfg['screens'][K] extends ScreenDefinition<infer C, any> ? Readonly<C> : never;
	/**
	 * Get the current screen config (immutable).
	 * Returns a union of all possible config types.
	 */
	getScreenConfig(): { [K in keyof Cfg['screens']]: Cfg['screens'][K] extends ScreenDefinition<infer C, any> ? Readonly<C> : never }[keyof Cfg['screens']];
	getScreenConfig(screen?: keyof Cfg['screens'] & string) {
		return this.requireScreenManager().getConfig(screen);
	}

	/**
	 * Get the current screen config narrowed to a specific screen, or undefined if not on that screen.
	 */
	tryGetScreenConfig<K extends keyof Cfg['screens'] & string>(screen: K): (Cfg['screens'][K] extends ScreenDefinition<infer C, any> ? Readonly<C> : never) | undefined;
	/**
	 * Get the current screen config or undefined.
	 * Returns a union of all possible config types, or undefined.
	 */
	tryGetScreenConfig(): { [K in keyof Cfg['screens']]: Cfg['screens'][K] extends ScreenDefinition<infer C, any> ? Readonly<C> : never }[keyof Cfg['screens']] | undefined;
	tryGetScreenConfig(screen?: keyof Cfg['screens'] & string) {
		return this._screenManager?.tryGetConfig(screen) ?? undefined;
	}

	/**
	 * Get the current screen state (mutable), narrowed to a specific screen.
	 * Throws if the current screen doesn't match.
	 */
	getScreenState<K extends keyof Cfg['screens'] & string>(screen: K): Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never;
	/**
	 * Get the current screen state (mutable).
	 * Returns a union of all possible state types.
	 */
	getScreenState(): { [K in keyof Cfg['screens']]: Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never }[keyof Cfg['screens']];
	getScreenState(screen?: keyof Cfg['screens'] & string) {
		return this.requireScreenManager().getState(screen);
	}

	/**
	 * Get the current screen state narrowed to a specific screen, or undefined if not on that screen.
	 */
	tryGetScreenState<K extends keyof Cfg['screens'] & string>(screen: K): (Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never) | undefined;
	/**
	 * Get the current screen state or undefined.
	 * Returns a union of all possible state types, or undefined.
	 */
	tryGetScreenState(): { [K in keyof Cfg['screens']]: Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never }[keyof Cfg['screens']] | undefined;
	tryGetScreenState(screen?: keyof Cfg['screens'] & string) {
		return this._screenManager?.tryGetState(screen) ?? undefined;
	}

	/**
	 * Update the current screen state, narrowed to a specific screen.
	 * Throws if the current screen doesn't match.
	 */
	updateScreenState<K extends keyof Cfg['screens'] & string>(
		screen: K,
		update: Partial<Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never> |
			((current: Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never) => Partial<Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never>)
	): void;
	/**
	 * Update the current screen state.
	 */
	updateScreenState<K extends keyof Cfg['screens']>(
		update: Partial<Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never> |
			((current: Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never) => Partial<Cfg['screens'][K] extends ScreenDefinition<any, infer S> ? S : never>)
	): void;
	updateScreenState(
		screenOrUpdate: unknown,
		maybeUpdate?: unknown,
	): void {
		if (typeof screenOrUpdate === 'string') {
			this.requireScreenManager().updateState(maybeUpdate, screenOrUpdate);
		} else {
			this.requireScreenManager().updateState(screenOrUpdate);
		}
	}

	/**
	 * Check if a screen is the current screen
	 */
	isCurrentScreen(screenName: keyof Cfg['screens']): boolean {
		return this._screenManager?.isCurrent(screenName) ?? false;
	}

	/**
	 * Check if a screen is active (current or in stack)
	 */
	isScreenActive(screenName: keyof Cfg['screens']): boolean {
		return this._screenManager?.isActive(screenName) ?? false;
	}

	/**
	 * Get the screen stack depth
	 */
	getScreenStackDepth(): number {
		return this._screenManager?.getStackDepth() ?? 0;
	}

	/**
	 * Subscribe to the `screenEnter` event for a specific screen. The handler
	 * fires only when that named screen becomes active (via `setScreen` or
	 * `pushScreen`). Multiple handlers can be registered for the same screen
	 * and fire in registration order.
	 *
	 * @returns A disposer function that unregisters the handler.
	 */
	onScreenEnter<K extends keyof Cfg['screens'] & string>(
		name: K,
		handler: (ctx: {
			config: Cfg['screens'][K] extends ScreenDefinition<infer C, any> ? C : never;
			ecs: ECSpresso<Cfg>;
		}) => void,
	): () => void {
		const bus = this._eventBus as unknown as EventBus<ScreenEvents<keyof Cfg['screens'] & string>>;
		const onEvent = (data: { screen: keyof Cfg['screens'] & string; config: unknown }) => {
			if (data.screen !== name) return;
			handler({
				config: data.config as Cfg['screens'][K] extends ScreenDefinition<infer C, any> ? C : never,
				ecs: this,
			});
		};
		const offEnter = bus.subscribe('screenEnter', onEvent);
		const offPush = bus.subscribe('screenPush', onEvent);
		return () => {
			offEnter();
			offPush();
		};
	}

	/**
	 * Subscribe to the `screenExit` event for a specific screen. The handler
	 * fires only when that named screen exits (via `setScreen` away, or
	 * `popScreen` if it was on the stack). Multiple handlers can be registered
	 * for the same screen and fire in registration order.
	 *
	 * @returns A disposer function that unregisters the handler.
	 */
	onScreenExit<K extends keyof Cfg['screens'] & string>(
		name: K,
		handler: (ctx: { ecs: ECSpresso<Cfg> }) => void,
	): () => void {
		const bus = this._eventBus as unknown as EventBus<ScreenEvents<keyof Cfg['screens'] & string>>;
		return bus.subscribe('screenExit', (data) => {
			if (data.screen !== name) return;
			handler({ ecs: this });
		});
	}

	// ==================== Internal Methods ====================

	/**
	 * Internal method to set the asset manager and drain pending plugin assets
	 * @internal Used by ECSpressoBuilder
	 */
	_setAssetManager(manager: AssetManager<Cfg['assets']>): void {
		this._assetManager = manager;
		for (const [key, definition] of this._pendingPluginAssets) {
			this._assetManager.register(key, definition as any);
		}
		this._pendingPluginAssets = [];
	}

	/**
	 * Internal method to set the screen manager and drain pending plugin screens
	 * @internal Used by ECSpressoBuilder
	 */
	_setScreenManager(manager: ScreenManager<Cfg['screens']>): void {
		this._screenManager = manager;
		for (const [name, definition] of this._pendingPluginScreens) {
			this._screenManager.register(name, definition as any);
		}
		this._pendingPluginScreens = [];
	}

	/** @internal */
	_hasPendingPluginAssets(): boolean {
		return this._pendingPluginAssets.length > 0;
	}

	/** @internal */
	_hasPendingPluginScreens(): boolean {
		return this._pendingPluginScreens.length > 0;
	}

	/**
	 * Internal method to set the fixed timestep interval
	 * @internal Used by ECSpressoBuilder
	 */
	_setFixedDt(dt: number): void {
		this._fixedDt = dt;
	}

	/**
	 * Register an asset definition for deferred registration.
	 * @internal Used by plugins that need to register assets
	 */
	_registerAsset(key: string, definition: AssetDefinition<unknown>): void {
		this._pendingPluginAssets.push([key, definition]);
	}

	/**
	 * Register a screen definition for deferred registration.
	 * @internal Used by plugins that need to register screens
	 */
	_registerScreen(name: string, definition: ScreenDefinition<any, any>): void {
		this._pendingPluginScreens.push([name, definition]);
	}

	/**
	 * Install a plugin into this ECSpresso instance.
	 * Deduplicates by plugin ID. Composite plugins call this in their install function.
	 *
	 * The overload enforces that the plugin's provided config is compatible with
	 * this world's accumulated config, and that its required config is satisfied.
	 * When a check fails the parameter resolves to a `PluginError<...>` sentinel
	 * whose template-literal message names the failing WorldConfig slot, making
	 * the resulting "not assignable" error self-describing.
	 */
	installPlugin<
		PCfg extends WorldConfig,
		PReq extends WorldConfig = EmptyConfig,
		BL extends string = never,
		BG extends string = never,
		BAG extends string = never,
		BRQ extends string = never,
	>(
		plugin: InstallPluginParam<Cfg, PCfg, PReq, BL, BG, BAG, BRQ>,
	): this;
	installPlugin(
		plugin: Plugin<WorldConfig, WorldConfig, string, string, string, string> | PluginError<string>,
	): this {
		// PluginError is uninhabitable at the value level — the overload only
		// resolves to it when the argument is rejected, so this runtime path
		// always sees a real Plugin.
		return this._installPluginUnchecked(plugin as Plugin<WorldConfig, WorldConfig, string, string, string, string>);
	}

	/**
	 * Install a plugin without enforcing compatibility constraints.
	 * @internal Used by the builder, which has already validated compatibility
	 * at `withPlugin` time via the builder's own constrained overload.
	 */
	_installPluginUnchecked(plugin: Plugin<WorldConfig, WorldConfig, string, string, string, string>): this {
		if (this._installedPlugins.has(plugin.id)) {
			return this;
		}
		this._installedPlugins.add(plugin.id);
		const disposers: Array<() => void> = [];
		this._pluginCleanups.set(plugin.id, disposers);
		const onCleanup = (fn: () => void) => {
			disposers.push(fn);
		};
		const previousDefaults = this._currentSystemDefaults;
		this._currentSystemDefaults = plugin.systemDefaults as SystemDefaults<Cfg> | undefined;
		try {
			plugin.install(this as unknown as ECSpresso<WorldConfig>, onCleanup);
		} finally {
			this._currentSystemDefaults = previousDefaults;
		}
		return this;
	}

	/**
	 * Uninstall a previously installed plugin by id. Runs registered cleanup
	 * disposers in reverse order and removes the plugin from `installedPlugins`.
	 * Returns `true` if the plugin was installed (and has now been removed),
	 * `false` if no plugin with that id was installed.
	 *
	 * Disposers that throw are caught and logged via `console.warn` so a single
	 * failing disposer does not prevent later ones from running.
	 */
	uninstallPlugin(id: string): boolean {
		if (!this._installedPlugins.has(id)) {
			return false;
		}
		const disposers = this._pluginCleanups.get(id);
		this._pluginCleanups.delete(id);
		this._installedPlugins.delete(id);
		if (disposers) {
			for (let i = disposers.length - 1; i >= 0; i--) {
				const fn = disposers[i];
				if (!fn) continue;
				try {
					fn();
				} catch (error) {
					console.warn(`Plugin '${id}' cleanup threw:`, error);
				}
			}
		}
		return true;
	}

	/**
	 * Uninstall every installed plugin, running their cleanup disposers.
	 * Plugins are uninstalled in reverse install order so a plugin that depends
	 * on another is torn down before its dependency.
	 *
	 * Does not touch resource disposal — callers that need async resource
	 * teardown should `await world.disposeResources()` separately.
	 */
	dispose(): void {
		const ids = Array.from(this._installedPlugins);
		for (let i = ids.length - 1; i >= 0; i--) {
			const id = ids[i];
			if (id !== undefined) this.uninstallPlugin(id);
		}
	}

	/**
	 * Create a plugin factory from the built world's types.
	 * Returns a definePlugin equivalent with no manual type parameters.
	 */
	pluginFactory(): <
		PL extends string = never,
		PG extends string = never,
		PAG extends string = never,
		PRQ extends string = never,
	>(config: {
		id: string;
		install: (world: ECSpresso<Cfg>) => void;
	}) => Plugin<Cfg, EmptyConfig, PL, PG, PAG, PRQ> {
		return ((config: { id: string; install: (world: ECSpresso<any>) => void }) =>
			definePlugin(config.id).install(config.install)
		) as unknown as ReturnType<
			ECSpresso<Cfg>['pluginFactory']
		>;
	}

	/**
	 * Call a helper factory with this world instance, inferring the full world type.
	 * Eliminates the need for a separate `type ECS = typeof ecs` ceremony.
	 *
	 * @example
	 * ```typescript
	 * const helpers = ecs.getHelpers(createStateMachineHelpers);
	 * ```
	 */
	getHelpers<H>(factory: (world: this) => H): H {
		return factory(this);
	}
}
