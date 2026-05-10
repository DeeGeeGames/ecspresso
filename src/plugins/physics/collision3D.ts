/**
 * Collision 3D Plugin for ECSpresso
 *
 * Provides layer-based 3D collision detection with events.
 * Uses worldTransform3D for position (world-space collision).
 * Supports AABB3D and sphere colliders.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { Transform3DWorldConfig } from '../spatial/transform3D';
import {
	fillBaseColliderInfo3D,
	detectCollisions3D,
	AABB3D_SHAPE,
	type Contact3D,
	type BaseColliderInfo3D,
} from '../../utils/narrowphase3D';
import type { SpatialIndex3D } from '../../utils/spatial-hash3D';
import {
	defineCollisionLayers,
	createCollisionPairHandler,
	createCollisionLayer,
	type CollisionLayer,
	type LayerFactories,
	type LayersOf,
	type CollisionPairCallback,
} from './collision';

// Re-export dimension-agnostic layer utilities so consumers only need one import
export { defineCollisionLayers, createCollisionPairHandler, createCollisionLayer };
export type { CollisionLayer, LayerFactories, LayersOf, CollisionPairCallback };

// Re-export collider shapes (defined in spatial-index3D to avoid duplication)
export type { AABB3DCollider, SphereCollider } from '../spatial/spatial-index3D';
import type { AABB3DCollider, SphereCollider } from '../spatial/spatial-index3D';

// ==================== Component Types ====================

/**
 * Component types provided by the collision3D plugin.
 */
export interface Collision3DComponentTypes<L extends string = never> {
	aabb3DCollider: AABB3DCollider;
	sphereCollider: SphereCollider;
	collisionLayer: CollisionLayer<L>;
}

// ==================== Event Types ====================

/**
 * Event fired when two 3D entities collide.
 *
 * Normal components are flattened to avoid per-event allocation in the hot path.
 */
export interface Collision3DEvent<L extends string = never> {
	entityA: number;
	entityB: number;
	layerA: L;
	layerB: L;
	/** Contact normal X, pointing from entityA toward entityB */
	normalX: number;
	/** Contact normal Y, pointing from entityA toward entityB */
	normalY: number;
	/** Contact normal Z, pointing from entityA toward entityB */
	normalZ: number;
	/** Penetration depth (positive = overlapping) */
	depth: number;
}

/**
 * Event types provided by the collision3D plugin.
 */
export interface Collision3DEventTypes<L extends string = never> {
	collision3D: Collision3DEvent<L>;
}

// ==================== Plugin Options ====================

/**
 * Configuration options for the collision3D plugin.
 */
export interface Collision3DPluginOptions<G extends string = 'physics'> extends BasePluginOptions<G> {}

// ==================== Helper Functions ====================

export function createAABB3DCollider(
	width: number,
	height: number,
	depth: number,
	offsetX?: number,
	offsetY?: number,
	offsetZ?: number,
): { aabb3DCollider: AABB3DCollider } {
	const collider: AABB3DCollider = { width, height, depth };
	if (offsetX !== undefined) collider.offsetX = offsetX;
	if (offsetY !== undefined) collider.offsetY = offsetY;
	if (offsetZ !== undefined) collider.offsetZ = offsetZ;
	return { aabb3DCollider: collider };
}

export function createSphereCollider(
	radius: number,
	offsetX?: number,
	offsetY?: number,
	offsetZ?: number,
): { sphereCollider: SphereCollider } {
	const collider: SphereCollider = { radius };
	if (offsetX !== undefined) collider.offsetX = offsetX;
	if (offsetY !== undefined) collider.offsetY = offsetY;
	if (offsetZ !== undefined) collider.offsetZ = offsetZ;
	return { sphereCollider: collider };
}

// ==================== Module-level Collision Callback ====================

interface Collision3DEventBus<L extends string> {
	publish(event: 'collision3D', data: Collision3DEvent<L>): void;
}

/**
 * Module-level reusable collision event. Subscribers must consume synchronously —
 * same contract as the shared narrowphase Contact3D.
 */
const _collisionEvent: Collision3DEvent<string> = {
	entityA: 0, entityB: 0, layerA: '', layerB: '',
	normalX: 0, normalY: 0, normalZ: 0, depth: 0,
};

function onCollisionDetected3D<L extends string>(
	a: BaseColliderInfo3D<L>,
	b: BaseColliderInfo3D<L>,
	contact: Contact3D,
	eventBus: Collision3DEventBus<L>,
): void {
	_collisionEvent.entityA = a.entityId;
	_collisionEvent.entityB = b.entityId;
	_collisionEvent.layerA = a.layer;
	_collisionEvent.layerB = b.layer;
	_collisionEvent.normalX = contact.normalX;
	_collisionEvent.normalY = contact.normalY;
	_collisionEvent.normalZ = contact.normalZ;
	_collisionEvent.depth = contact.depth;
	eventBus.publish('collision3D', _collisionEvent as Collision3DEvent<L>);
}

// ==================== Plugin Factory ====================

/**
 * Create a 3D collision plugin for ECSpresso.
 *
 * Provides layer-based collision detection between entities with 3D colliders,
 * publishing `collision3D` events on contact. Supports AABB3D-AABB3D,
 * sphere-sphere, and AABB3D-sphere tests. Automatically uses the
 * `spatialIndex3D` resource for broadphase when present.
 *
 * @example
 * ```typescript
 * const layers = defineCollisionLayers({ player: ['enemy'], enemy: ['player'] });
 * const ecs = ECSpresso
 *   .create()
 *   .withPlugin(createTransform3DPlugin())
 *   .withPlugin(createCollision3DPlugin({ layers }))
 *   .build();
 *
 * ecs.eventBus.subscribe('collision3D', (data) => {
 *   console.log(data.entityA, data.entityB, data.normalZ);
 * });
 * ```
 */
export function createCollision3DPlugin<L extends string, G extends string = 'physics'>(
	options: Collision3DPluginOptions<G> & { layers: LayerFactories<Record<L, readonly string[]>> },
) {
	const {
		systemGroup = 'physics',
		priority = 0,
		phase = 'postUpdate',
	} = options;

	return definePlugin('collision3D')
		.withComponentTypes<Collision3DComponentTypes<L>>()
		.withEventTypes<Collision3DEventTypes<L>>()
		.withLabels<'collision3D-detection'>()
		.withGroups<G>()
		.requires<Transform3DWorldConfig>()
		.install((world) => {
			// Grow-only pool of BaseColliderInfo3D slots reused across frames.
			const colliderPool: BaseColliderInfo3D<L>[] = [];
			// Reusable entityId → collider lookup for the broadphase path.
			const broadphaseMap = new Map<number, BaseColliderInfo3D<L>>();
			// Cached spatial index reference (resolved once on first frame).
			let cachedSI: SpatialIndex3D | undefined;
			let siResolved = false;

			world
				.addSystem('collision3D-detection')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('collidables', {
					with: ['worldTransform3D', 'collisionLayer'],
				})
				.setProcess(({ queries, ecs }) => {
					let count = 0;

					// TODO(perf): collider shape is discovered via two ecs.getComponent
					// calls per entity per frame because the query can't express
					// "aabb3DCollider OR sphereCollider". Splitting into two queries
					// (aabb-bearing, sphere-bearing) would eliminate these lookups at
					// the cost of two pool-fill passes. Keep in sync with physics3D.
					for (const entity of queries.collidables) {
						const { worldTransform3D, collisionLayer } = entity.components;
						const aabb = ecs.getComponent(entity.id, 'aabb3DCollider');
						const sphere = aabb ? undefined : ecs.getComponent(entity.id, 'sphereCollider');
						if (!aabb && !sphere) continue;

						let slot = colliderPool[count];
						if (!slot) {
							slot = {
								entityId: entity.id,
								x: worldTransform3D.x,
								y: worldTransform3D.y,
								z: worldTransform3D.z,
								layer: collisionLayer.layer,
								collidesWith: collisionLayer.collidesWith,
								layerBit: 0,
								collidesWithMask: 0,
								shape: AABB3D_SHAPE,
								halfWidth: 0,
								halfHeight: 0,
								halfDepth: 0,
								radius: 0,
							};
							colliderPool[count] = slot;
						}

						if (!fillBaseColliderInfo3D(
							slot,
							entity.id, worldTransform3D.x, worldTransform3D.y, worldTransform3D.z,
							collisionLayer.layer, collisionLayer.collidesWith,
							aabb, sphere,
						)) continue;

						count++;
					}

					if (!siResolved) {
						cachedSI = ecs.tryGetResource<SpatialIndex3D>('spatialIndex3D');
						siResolved = true;
					}
					detectCollisions3D(colliderPool, count, broadphaseMap, cachedSI, onCollisionDetected3D<L>, ecs.eventBus);
				});
		});
}
