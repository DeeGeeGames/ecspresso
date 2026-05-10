/**
 * Spatial Index Plugin for ECSpresso
 *
 * Provides a uniform-grid spatial hash for broadphase collision detection
 * and proximity queries. Replaces O(n²) brute-force with O(n·d) where
 * d = local density.
 *
 * Standalone usage: queryRect / queryRadius for proximity queries.
 * Automatic acceleration: collision and physics2D plugins detect the
 * spatialIndex resource at runtime and use it for broadphase when present.
 */

import { definePlugin } from 'ecspresso';
import type { SystemPhase } from 'ecspresso';
import type { TransformComponentTypes } from './transform';
import type { CollisionComponentTypes } from '../physics/collision';
import {
	type SpatialEntry,
	type SpatialHashGrid,
	type SpatialIndex,
	createGrid,
	clearGrid,
	insertEntity,
	gridQueryRect,
	gridQueryRadius,
} from '../../utils/spatial-hash';

// Module-scoped reusable set to reduce GC pressure
const _reusableQuerySet = new Set<number>();

// ==================== Resource API ====================

export interface SpatialIndexResourceTypes {
	spatialIndex: SpatialIndex;
}

function createSpatialIndexResource(grid: SpatialHashGrid): SpatialIndex {
	return {
		grid,
		queryRect(minX: number, minY: number, maxX: number, maxY: number): number[] {
			_reusableQuerySet.clear();
			gridQueryRect(grid, minX, minY, maxX, maxY, _reusableQuerySet);
			return Array.from(_reusableQuerySet);
		},
		queryRectInto(minX: number, minY: number, maxX: number, maxY: number, result: Set<number>, minId?: number): void {
			gridQueryRect(grid, minX, minY, maxX, maxY, result, minId);
		},
		queryRadius(cx: number, cy: number, radius: number): number[] {
			_reusableQuerySet.clear();
			gridQueryRadius(grid, cx, cy, radius, _reusableQuerySet);
			return Array.from(_reusableQuerySet);
		},
		queryRadiusInto(cx: number, cy: number, radius: number, result: Set<number>): void {
			gridQueryRadius(grid, cx, cy, radius, result);
		},
		getEntry(entityId: number): SpatialEntry | undefined {
			return grid.entries.get(entityId);
		},
	};
}

// ==================== Component Types ====================

type SpatialIndexComponentTypes =
	TransformComponentTypes & Pick<CollisionComponentTypes<string>, 'aabbCollider' | 'circleCollider'>;

// ==================== Plugin Options ====================

export type SpatialIndexPhase = 'fixedUpdate' | 'postUpdate';
type SpatialIndexLabel = `spatial-index-rebuild-${SpatialIndexPhase}`;

export interface SpatialIndexPluginOptions<G extends string = 'spatialIndex'> {
	/** Cell size for the spatial hash grid (default: 64) */
	cellSize?: number;
	/** System group name (default: 'spatialIndex') */
	systemGroup?: G;
	/** Priority for rebuild systems (default: 2000, before collision) */
	priority?: number;
	/** Phases to register rebuild systems in (default: ['fixedUpdate', 'postUpdate']) */
	phases?: ReadonlyArray<SpatialIndexPhase>;
}

// ==================== Plugin Factory ====================

/**
 * Create a spatial index plugin for ECSpresso.
 *
 * Provides a uniform-grid spatial hash that accelerates collision detection.
 * When installed alongside the collision or physics2D plugins, they
 * automatically use the spatial index for broadphase instead of O(n²)
 * brute-force.
 *
 * Also provides proximity query methods for game logic (e.g. "find all
 * enemies within 200 units").
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransformPlugin())
 *   .withPlugin(createCollisionPlugin({ layers }))
 *   .withPlugin(createSpatialIndexPlugin({ cellSize: 128 }))
 *   .build();
 *
 * // Proximity query in a system:
 * const si = ecs.getResource('spatialIndex');
 * const nearby = si.queryRadius(playerX, playerY, 200);
 * ```
 */
export function createSpatialIndexPlugin<G extends string = 'spatialIndex'>(
	options?: SpatialIndexPluginOptions<G>,
) {
	const {
		cellSize = 64,
		systemGroup = 'spatialIndex',
		priority = 2000,
		phases = ['fixedUpdate', 'postUpdate'] as const,
	} = options ?? {};

	const grid = createGrid(cellSize);
	const resource = createSpatialIndexResource(grid);

	return definePlugin('spatialIndex')
		.withComponentTypes<SpatialIndexComponentTypes>()
		.withResourceTypes<SpatialIndexResourceTypes>()
		.withLabels<SpatialIndexLabel>()
		.withGroups<G>()
		.install((world) => {
			world.addResource('spatialIndex', resource);

			// Register a rebuild system for each requested phase
			for (const phase of phases) {
				const transformComponent = phase === 'fixedUpdate' ? 'localTransform' : 'worldTransform';

				world
					.addSystem(`spatial-index-rebuild-${phase}`)
					.setPriority(priority)
					.inPhase(phase as SystemPhase)
					.inGroup(systemGroup)
					.addQuery('transforms', {
						with: [transformComponent],
					})
					.setProcess(({ queries, ecs }) => {
						clearGrid(grid);

						for (const entity of queries.transforms) {
							const transform = entity.components[transformComponent];
							const aabb = ecs.getComponent(entity.id, 'aabbCollider');
							const circle = ecs.getComponent(entity.id, 'circleCollider');

							// Only insert entities that have a collider
							if (!aabb && !circle) continue;

							let x = transform.x;
							let y = transform.y;
							let halfW = 0;
							let halfH = 0;

							if (aabb) {
								x += aabb.offsetX ?? 0;
								y += aabb.offsetY ?? 0;
								halfW = aabb.width / 2;
								halfH = aabb.height / 2;
							}

							if (circle) {
								x += circle.offsetX ?? 0;
								y += circle.offsetY ?? 0;
								// Circle: use radius as half-extent in both dimensions
								halfW = Math.max(halfW, circle.radius);
								halfH = Math.max(halfH, circle.radius);
							}

							insertEntity(grid, entity.id, x, y, halfW, halfH);
						}
					});
			}
		});
}
