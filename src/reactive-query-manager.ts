import type { Entity, FilteredEntity } from "./types";
import type EntityManager from "./entity-manager";
import type ECSpresso from "./ecspresso";
import type { WorldConfig } from "./type-utils";
import { entityMatchesShape } from "./query-match";

type ComponentKey<Cfg extends WorldConfig> = keyof Cfg['components'];
type AnyFilteredEntity<Cfg extends WorldConfig> = FilteredEntity<
	Cfg['components'],
	ComponentKey<Cfg>,
	ComponentKey<Cfg>,
	ComponentKey<Cfg>
>;

export type ReactiveQueryEnterContext<
	Cfg extends WorldConfig,
	WithComponents extends ComponentKey<Cfg> = ComponentKey<Cfg>,
	WithoutComponents extends ComponentKey<Cfg> = never,
	OptionalComponents extends ComponentKey<Cfg> = never,
> = {
	entity: FilteredEntity<Cfg['components'], WithComponents, WithoutComponents, OptionalComponents>;
	ecs: ECSpresso<Cfg>;
};

export type ReactiveQueryExitContext<Cfg extends WorldConfig> = {
	entityId: number;
	ecs: ECSpresso<Cfg>;
};

/**
 * Definition for a reactive query with enter/exit callbacks
 */
export interface ReactiveQueryDefinition<
	Cfg extends WorldConfig,
	WithComponents extends ComponentKey<Cfg> = ComponentKey<Cfg>,
	WithoutComponents extends ComponentKey<Cfg> = never,
	OptionalComponents extends ComponentKey<Cfg> = never,
> {
	/** Components the entity must have */
	with: ReadonlyArray<WithComponents>;
	/** Components the entity must not have */
	without?: ReadonlyArray<WithoutComponents>;
	/** Components to include in the entity type but not require for matching */
	optional?: ReadonlyArray<OptionalComponents>;
	/** Components the entity's direct parent must have */
	parentHas?: ReadonlyArray<ComponentKey<Cfg>>;
	/** Called when an entity starts matching the query */
	onEnter?: (ctx: ReactiveQueryEnterContext<Cfg, WithComponents, WithoutComponents, OptionalComponents>) => void;
	/** Called when an entity stops matching the query (receives just the ID since entity may be gone) */
	onExit?: (ctx: ReactiveQueryExitContext<Cfg>) => void;
}

type StoredReactiveQueryDefinition<Cfg extends WorldConfig> = {
	with: ReadonlyArray<ComponentKey<Cfg>>;
	without?: ReadonlyArray<ComponentKey<Cfg>>;
	optional?: ReadonlyArray<ComponentKey<Cfg>>;
	parentHas?: ReadonlyArray<ComponentKey<Cfg>>;
	onEnter?: (ctx: { entity: AnyFilteredEntity<Cfg>; ecs: ECSpresso<Cfg> }) => void;
	onExit?: (ctx: ReactiveQueryExitContext<Cfg>) => void;
};

interface StoredQuery<Cfg extends WorldConfig> {
	definition: StoredReactiveQueryDefinition<Cfg>;
	matchingEntities: Set<number>;
}

/**
 * Manages reactive queries that trigger callbacks when entities enter/exit query matches
 */
export default class ReactiveQueryManager<Cfg extends WorldConfig, QueryNames extends string = string> {
	private queries: Map<string, StoredQuery<Cfg>> = new Map();
	private entityManager: EntityManager<Cfg['components']>;
	private ecs: ECSpresso<Cfg>;
	/** Whether any registered query uses parentHas */
	private _hasParentHasQueries: boolean = false;

	constructor(entityManager: EntityManager<Cfg['components']>, ecs: ECSpresso<Cfg>) {
		this.entityManager = entityManager;
		this.ecs = ecs;
	}

	/**
	 * Whether any registered reactive query uses parentHas filters
	 */
	get hasParentHasQueries(): boolean {
		return this._hasParentHasQueries;
	}

	/**
	 * Add a reactive query
	 * @param name Unique name for the query
	 * @param definition Query definition with callbacks
	 */
	addQuery<
		WithComponents extends ComponentKey<Cfg>,
		WithoutComponents extends ComponentKey<Cfg> = never,
		OptionalComponents extends ComponentKey<Cfg> = never,
	>(
		name: QueryNames,
		definition: ReactiveQueryDefinition<Cfg, WithComponents, WithoutComponents, OptionalComponents>
	): void {
		const storedQuery: StoredQuery<Cfg> = {
			definition: definition as unknown as StoredReactiveQueryDefinition<Cfg>,
			matchingEntities: new Set(),
		};

		this.queries.set(name, storedQuery);

		// Update parentHas flag
		if (definition.parentHas?.length) {
			this._hasParentHasQueries = true;
		}

		// Check existing entities for initial matches
		const existingMatches = this.entityManager.getEntitiesWithQuery(
			definition.with as ReadonlyArray<ComponentKey<Cfg>>,
			(definition.without ?? []) as ReadonlyArray<ComponentKey<Cfg>>
		);

		for (const entity of existingMatches) {
			if (this.entityMatchesQuery(entity, storedQuery.definition)) {
				storedQuery.matchingEntities.add(entity.id);
				this._fireEnter(storedQuery.definition, entity);
			}
		}
	}

	/**
	 * Remove a reactive query
	 * @param name Name of the query to remove
	 * @returns true if the query existed and was removed
	 */
	removeQuery(name: QueryNames): boolean {
		const result = this.queries.delete(name);

		// Recalculate parentHas flag
		if (result) {
			this._recalcParentHasFlag();
		}

		return result;
	}

	/** @internal Release query definitions and their entity tracking. */
	clear(): void {
		this.queries.clear();
		this._hasParentHasQueries = false;
	}

	private entityMatchesQuery(
		entity: Entity<Cfg['components']>,
		definition: StoredReactiveQueryDefinition<Cfg>
	): boolean {
		return entityMatchesShape(
			entity,
			definition.with,
			definition.without,
			definition.parentHas,
			this.entityManager,
		);
	}

	private _fireEnter(
		definition: StoredReactiveQueryDefinition<Cfg>,
		entity: Entity<Cfg['components']>,
	): void {
		definition.onEnter?.({
			entity: entity as AnyFilteredEntity<Cfg>,
			ecs: this.ecs,
		});
	}

	private _fireExit(definition: StoredReactiveQueryDefinition<Cfg>, entityId: number): void {
		definition.onExit?.({ entityId, ecs: this.ecs });
	}

	/**
	 * Apply enter/exit transitions for a single query against an entity.
	 * Fires onEnter when entity starts matching, onExit when it stops.
	 */
	private _applyQueryTransition(entity: Entity<Cfg['components']>, query: StoredQuery<Cfg>): void {
		const wasMatching = query.matchingEntities.has(entity.id);
		const nowMatches = this.entityMatchesQuery(entity, query.definition);

		if (!wasMatching && nowMatches) {
			query.matchingEntities.add(entity.id);
			this._fireEnter(query.definition, entity);
		} else if (wasMatching && !nowMatches) {
			query.matchingEntities.delete(entity.id);
			this._fireExit(query.definition, entity.id);
		}
	}

	/**
	 * Called when a component is added to an entity
	 * Checks all queries for potential enter/exit events
	 */
	onComponentAdded(entity: Entity<Cfg['components']>, _componentName: keyof Cfg['components']): void {
		for (const [, query] of this.queries) {
			this._applyQueryTransition(entity, query);
		}

		if (this._hasParentHasQueries) {
			this._recheckChildren(entity.id);
		}
	}

	/**
	 * Called when a component is removed from an entity
	 * Checks all queries for potential enter/exit events
	 */
	onComponentRemoved(entity: Entity<Cfg['components']>, _componentName: keyof Cfg['components']): void {
		for (const [, query] of this.queries) {
			this._applyQueryTransition(entity, query);
		}

		if (this._hasParentHasQueries) {
			this._recheckChildren(entity.id);
		}
	}

	/**
	 * Called when an entity is removed
	 * Triggers onExit for all queries the entity was matching
	 */
	onEntityRemoved(entityId: number): void {
		for (const [_name, query] of this.queries) {
			if (query.matchingEntities.has(entityId)) {
				query.matchingEntities.delete(entityId);
				this._fireExit(query.definition, entityId);
			}
		}
	}

	/**
	 * Recheck an entity against all queries (used after batch component additions)
	 * Fires enter/exit callbacks as appropriate based on current state vs tracked state
	 */
	recheckEntity(entity: Entity<Cfg['components']>): void {
		for (const [, query] of this.queries) {
			this._applyQueryTransition(entity, query);
		}
	}

	/**
	 * Recheck an entity and its children against all queries.
	 * Used after component mutations to handle both the entity's own queries
	 * and parentHas queries on its children.
	 */
	recheckEntityAndChildren(entity: Entity<Cfg['components']>): void {
		this.recheckEntity(entity);
		if (this._hasParentHasQueries) {
			this._recheckChildren(entity.id);
		}
	}

	/**
	 * Recheck all children of a parent entity against parentHas queries.
	 * Called when a component is added/removed from a parent entity.
	 */
	private _recheckChildren(parentId: number): void {
		const children = this.entityManager.getChildren(parentId);
		for (const childId of children) {
			const childEntity = this.entityManager.getEntity(childId);
			if (childEntity) {
				this.recheckEntity(childEntity);
			}
		}
	}

	/**
	 * Recalculate the _hasParentHasQueries flag from all registered queries
	 */
	private _recalcParentHasFlag(): void {
		this._hasParentHasQueries = false;
		for (const [, query] of this.queries) {
			if (query.definition.parentHas?.length) {
				this._hasParentHasQueries = true;
				return;
			}
		}
	}
}
