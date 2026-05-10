/**
 * Collision Plugin for ECSpresso
 *
 * Provides layer-based collision detection with events.
 * Uses worldTransform for position (world-space collision).
 * Supports AABB and circle colliders.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { TransformWorldConfig } from '../spatial/transform';
import { fillBaseColliderInfo, detectCollisions, createBroadphaseScratch, AABB_SHAPE, type Contact, type BaseColliderInfo } from '../../utils/narrowphase';
import type { SpatialIndex } from '../../utils/spatial-hash';

// ==================== Component Types ====================

/**
 * Axis-Aligned Bounding Box collider.
 */
export interface AABBCollider {
	/** Width of the bounding box */
	width: number;
	/** Height of the bounding box */
	height: number;
	/** X offset from entity position (default: 0) */
	offsetX?: number;
	/** Y offset from entity position (default: 0) */
	offsetY?: number;
}

/**
 * Circle collider.
 */
export interface CircleCollider {
	/** Radius of the circle */
	radius: number;
	/** X offset from entity position (default: 0) */
	offsetX?: number;
	/** Y offset from entity position (default: 0) */
	offsetY?: number;
}

/**
 * Collision layer configuration.
 */
export interface CollisionLayer<L extends string = never> {
	/** The layer this entity belongs to */
	layer: L;
	/** Layers this entity can collide with */
	collidesWith: readonly L[];
}

/**
 * Component types provided by the collision plugin.
 * Included automatically via `.withPlugin(createCollisionPlugin())`.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createCollisionPlugin())
 *   .withComponentTypes<{ sprite: Sprite; enemy: boolean }>()
 *   .build();
 * ```
 */
export interface CollisionComponentTypes<L extends string = never> {
	aabbCollider: AABBCollider;
	circleCollider: CircleCollider;
	collisionLayer: CollisionLayer<L>;
}

// ==================== Event Types ====================

/**
 * Event fired when two entities collide.
 *
 * Normal components are flattened (`normalX`/`normalY`) rather than nested
 * in a sub-object to avoid a per-event allocation in the collision hot path.
 */
export interface CollisionEvent<L extends string = never> {
	/** First entity in the collision */
	entityA: number;
	/** Second entity in the collision */
	entityB: number;
	/** Layer of the first entity */
	layerA: L;
	/** Layer of the second entity */
	layerB: L;
	/** Contact normal X, pointing from entityA toward entityB */
	normalX: number;
	/** Contact normal Y, pointing from entityA toward entityB */
	normalY: number;
	/** Penetration depth (positive = overlapping) */
	depth: number;
}

/**
 * Event types provided by the collision plugin.
 */
export interface CollisionEventTypes<L extends string = never> {
	collision: CollisionEvent<L>;
}

// ==================== Plugin Options ====================

/**
 * Configuration options for the collision plugin.
 */
export interface CollisionPluginOptions<G extends string = 'physics'> extends BasePluginOptions<G> {
	/** Name of the collision event (default: 'collision') */
	collisionEventName?: string;
}

// ==================== Helper Functions ====================

/**
 * Create an AABB collider component.
 *
 * @param width Width of the bounding box
 * @param height Height of the bounding box
 * @param offsetX X offset from entity position
 * @param offsetY Y offset from entity position
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createAABBCollider(50, 30),
 * });
 * ```
 */
export function createAABBCollider(
	width: number,
	height: number,
	offsetX?: number,
	offsetY?: number
): { aabbCollider: AABBCollider } {
	const collider: AABBCollider = { width, height };
	if (offsetX !== undefined) collider.offsetX = offsetX;
	if (offsetY !== undefined) collider.offsetY = offsetY;
	return { aabbCollider: collider };
}

/**
 * Create a circle collider component.
 *
 * @param radius Radius of the circle
 * @param offsetX X offset from entity position
 * @param offsetY Y offset from entity position
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createCircleCollider(25),
 * });
 * ```
 */
export function createCircleCollider(
	radius: number,
	offsetX?: number,
	offsetY?: number
): { circleCollider: CircleCollider } {
	const collider: CircleCollider = { radius };
	if (offsetX !== undefined) collider.offsetX = offsetX;
	if (offsetY !== undefined) collider.offsetY = offsetY;
	return { circleCollider: collider };
}

/**
 * Create a collision layer component.
 *
 * @param layer The layer this entity belongs to
 * @param collidesWith Layers this entity can collide with
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createAABBCollider(50, 30),
 *   ...createCollisionLayer('player', ['enemy', 'obstacle']),
 * });
 * ```
 */
export function createCollisionLayer<L extends string>(
	layer: L,
	collidesWith: readonly L[]
): Pick<CollisionComponentTypes<L>, 'collisionLayer'> {
	return {
		collisionLayer: { layer, collidesWith },
	};
}

/**
 * Layer factory result from defineCollisionLayers.
 */
export type LayerFactories<T extends Record<string, readonly string[]>> = {
	[K in keyof T]: () => Pick<CollisionComponentTypes<Extract<keyof T, string>>, 'collisionLayer'>;
};

/**
 * Extract layer names from a `defineCollisionLayers` result for use with
 * `createCollisionPairHandler`'s `L` type parameter.
 *
 * @example
 * ```typescript
 * const layers = defineCollisionLayers({ player: ['enemy'], enemy: ['player'] });
 * type Layer = LayersOf<typeof layers>;
 * const handler = createCollisionPairHandler<ECS, Layer>({
 *   'player:enemy': (playerId, enemyId, ecs) => { ... },
 * });
 * ```
 */
export type LayersOf<T> = Extract<keyof T, string>;

/**
 * Define collision layer relationships and get factory functions.
 *
 * @param rules Object mapping layer names to arrays of layers they collide with
 * @returns Object with factory functions for each layer
 *
 * @example
 * ```typescript
 * const layers = defineCollisionLayers({
 *   player: ['enemy', 'enemyProjectile'],
 *   playerProjectile: ['enemy'],
 *   enemy: ['playerProjectile'],
 *   enemyProjectile: ['player'],
 * });
 *
 * // Usage
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createAABBCollider(50, 30),
 *   ...layers.player(),
 * });
 * ```
 */
/**
 * Validates that all `collidesWith` values reference actual layer keys.
 * Catches typos at compile time.
 */
type ValidateCollidesWith<T> = {
	[K in keyof T]: T[K] extends readonly (infer V)[]
		? [V] extends [Extract<keyof T, string>] ? T[K] : readonly Extract<keyof T, string>[]
		: never;
};

export function defineCollisionLayers<const T extends Record<string, readonly string[]>>(
	rules: T & ValidateCollidesWith<T>
): LayerFactories<T> {
	type L = Extract<keyof T, string>;
	const factories = {} as LayerFactories<T>;

	for (const layer of Object.keys(rules) as Array<L>) {
		const collidesWith = rules[layer] as readonly L[];
		factories[layer] = () => createCollisionLayer<L>(layer, collidesWith);
	}

	return factories;
}

// ==================== Collision Pair Handler ====================

/**
 * Callback for a collision pair handler.
 *
 * @param firstEntityId Entity belonging to the first layer in the pair key
 * @param secondEntityId Entity belonging to the second layer in the pair key
 * @param ecs The ECS world instance (passed through from the subscriber)
 */
export type CollisionPairCallback<W = unknown> = (
	firstEntityId: number,
	secondEntityId: number,
	ecs: W,
) => void;

interface PairEntry<W> {
	callback: CollisionPairCallback<W>;
	swapped: boolean;
}

function parsePairKey(key: string): [string, string] {
	const colonIndex = key.indexOf(':');
	if (colonIndex === -1) {
		throw new Error(`Invalid collision pair key "${key}": must contain a colon separator (e.g. "player:enemy")`);
	}
	const layerA = key.slice(0, colonIndex);
	const layerB = key.slice(colonIndex + 1);
	if (layerA === '' || layerB === '') {
		throw new Error(`Invalid collision pair key "${key}": layer names must not be empty`);
	}
	return [layerA, layerB];
}

/**
 * Create a collision pair handler that routes collision events to
 * layer-pair-specific callbacks.
 *
 * Registering `"a:b"` automatically handles both `(layerA=a, layerB=b)` and
 * `(layerA=b, layerB=a)`. Entity arguments are swapped to match the declared
 * key order. If both `"a:b"` and `"b:a"` are explicitly registered, each gets
 * its own handler with no implicit reverse.
 *
 * @typeParam W - The ECS world type (e.g. `ECSpresso<C, E, R>`). Defaults to `unknown`.
 * @typeParam L - Union of valid layer names. Defaults to `string`.
 *   Provide specific layer names for compile-time key validation:
 *   `createCollisionPairHandler<ECS, keyof typeof layers>({...})`
 *
 * @param pairs Object mapping `"layerA:layerB"` keys to callbacks
 * @returns A dispatch function to call with collision event data and ECS instance
 *
 * @example
 * ```typescript
 * // Basic usage:
 * const handler = createCollisionPairHandler<ECS>({
 *   'playerProjectile:enemy': (projectileId, enemyId, ecs) => {
 *     ecs.commands.removeEntity(projectileId);
 *   },
 * });
 *
 * // With layer name validation:
 * const layers = defineCollisionLayers({ player: ['enemy'], enemy: ['player'] });
 * type Layer = LayersOf<typeof layers>;
 * const handler = createCollisionPairHandler<ECS, Layer>({
 *   'player:enemy': (playerId, enemyId, ecs) => { ... },
 * });
 *
 * ecs.eventBus.subscribe('collision', (data) => handler({ data, ecs }));
 * ```
 */
export function createCollisionPairHandler<W = unknown, L extends string = string>(
	pairs: { [K in `${L}:${L}`]?: CollisionPairCallback<W> }
): (ctx: { data: CollisionEvent<L>; ecs: W }) => void;
export function createCollisionPairHandler<W = unknown>(
	pairs: Record<string, CollisionPairCallback<W> | undefined>
): (ctx: { data: CollisionEvent<string>; ecs: W }) => void {
	const lookup = new Map<string, PairEntry<W>>();
	const explicitKeys = new Set<string>();

	// First pass: collect all explicit keys
	for (const key of Object.keys(pairs)) {
		parsePairKey(key); // validate
		explicitKeys.add(key);
	}

	// Second pass: build lookup with forward + conditional reverse entries
	for (const key of Object.keys(pairs)) {
		const [layerA, layerB] = parsePairKey(key);
		const callback = pairs[key];
		if (!callback) continue;

		// Forward entry
		lookup.set(key, { callback, swapped: false });

		// Reverse entry (only if the reverse key wasn't explicitly registered
		// and it's not a self-collision where forward === reverse)
		const reverseKey = `${layerB}:${layerA}`;
		if (reverseKey !== key && !explicitKeys.has(reverseKey)) {
			lookup.set(reverseKey, { callback, swapped: true });
		}
	}

	return function collisionPairDispatch({ data: event, ecs }: { data: CollisionEvent<string>; ecs: W }): void {
		const entry = lookup.get(event.layerA + ':' + event.layerB);
		if (!entry) return;

		if (entry.swapped) {
			entry.callback(event.entityB, event.entityA, ecs);
		} else {
			entry.callback(event.entityA, event.entityB, ecs);
		}
	};
}

// ==================== Dependency Types ====================

// ==================== Module-level Collision Callback ====================

interface CollisionEventBus<L extends string> {
	publish(event: 'collision', data: CollisionEvent<L>): void;
}

/**
 * Module-level reusable collision event. Subscribers must consume
 * synchronously — same contract as the shared narrowphase Contact.
 */
const _collisionEvent: CollisionEvent<string> = {
	entityA: 0, entityB: 0, layerA: '', layerB: '',
	normalX: 0, normalY: 0, depth: 0,
};

function onCollisionDetected<L extends string>(
	a: BaseColliderInfo<L>,
	b: BaseColliderInfo<L>,
	contact: Contact,
	eventBus: CollisionEventBus<L>,
): void {
	_collisionEvent.entityA = a.entityId;
	_collisionEvent.entityB = b.entityId;
	_collisionEvent.layerA = a.layer;
	_collisionEvent.layerB = b.layer;
	_collisionEvent.normalX = contact.normalX;
	_collisionEvent.normalY = contact.normalY;
	_collisionEvent.depth = contact.depth;
	eventBus.publish('collision', _collisionEvent as CollisionEvent<L>);
}

// ==================== Plugin Factory ====================

/**
 * Create a collision plugin for ECSpresso.
 *
 * This plugin provides:
 * - Collision detection between entities with colliders
 * - AABB-AABB, circle-circle, and AABB-circle collision
 * - Layer-based filtering for collision pairs
 * - Deduplication of A-B / B-A collisions
 * - Automatic broadphase acceleration when spatialIndex resource is present
 *
 * Uses worldTransform for position (world-space collision detection).
 * The `layers` parameter is required for type inference — at runtime the
 * plugin does not consume it.
 *
 * @example
 * ```typescript
 * const layers = defineCollisionLayers({ player: ['enemy'], enemy: ['player'] });
 * const ecs = ECSpresso
 *   .create()
 *   .withPlugin(createTransformPlugin())
 *   .withPlugin(createCollisionPlugin({ layers }))
 *   .build();
 *
 * // Entity with collision
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createAABBCollider(50, 30),
 *   ...layers.player(),
 * });
 * ```
 */
export function createCollisionPlugin<L extends string, G extends string = 'physics'>(
	options: CollisionPluginOptions<G> & { layers: LayerFactories<Record<L, readonly string[]>> }
) {
	const {
		systemGroup = 'physics',
		priority = 0,
		phase = 'postUpdate',
	} = options;

	return definePlugin('collision')
		.withComponentTypes<CollisionComponentTypes<L>>()
		.withEventTypes<CollisionEventTypes<L>>()
		.withLabels<'collision-detection'>()
		.withGroups<G>()
		.requires<TransformWorldConfig>()
		.install((world) => {
			// Grow-only pool of BaseColliderInfo slots reused across frames.
			// Steady-state: zero allocations per frame once the pool is warm.
			const colliderPool: BaseColliderInfo<L>[] = [];
			const broadphaseScratch = createBroadphaseScratch<BaseColliderInfo<L>>();
			// Cached spatial index reference (resolved once on first frame).
			let cachedSI: SpatialIndex | undefined;
			let siResolved = false;

			world
				.addSystem('collision-detection')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('collidables', {
					with: ['worldTransform', 'collisionLayer'],
				})
				.setProcess(({ queries, ecs }) => {
					let count = 0;

					// TODO(perf): collider shape is discovered via two ecs.getComponent
					// calls per entity per frame because the query can't express
					// "aabbCollider OR circleCollider". Splitting into two queries
					// (aabb-bearing, circle-bearing) would eliminate these lookups at
					// the cost of two pool-fill passes. Keep in sync with collision3D.
					for (const entity of queries.collidables) {
						const { worldTransform, collisionLayer } = entity.components;
						const aabb = ecs.getComponent(entity.id, 'aabbCollider');
						const circle = aabb ? undefined : ecs.getComponent(entity.id, 'circleCollider');
						if (!aabb && !circle) continue;

						let slot = colliderPool[count];
						if (!slot) {
							slot = {
								entityId: entity.id,
								x: worldTransform.x,
								y: worldTransform.y,
								layer: collisionLayer.layer,
								collidesWith: collisionLayer.collidesWith,
								layerBit: 0,
								collidesWithMask: 0,
								shape: AABB_SHAPE,
								halfWidth: 0,
								halfHeight: 0,
								radius: 0,
							};
							colliderPool[count] = slot;
						}

						if (!fillBaseColliderInfo(
							slot,
							entity.id, worldTransform.x, worldTransform.y,
							collisionLayer.layer, collisionLayer.collidesWith,
							aabb, circle,
						)) continue;

						count++;
					}

					if (!siResolved) {
						cachedSI = ecs.tryGetResource<SpatialIndex>('spatialIndex');
						siResolved = true;
					}
					detectCollisions(colliderPool, count, broadphaseScratch, cachedSI, onCollisionDetected<L>, ecs.eventBus);
				});
		});
}

