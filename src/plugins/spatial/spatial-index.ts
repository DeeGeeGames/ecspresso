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
	getLiveEntry,
} from '../../utils/spatial-hash';

// ==================== Resource API ====================

export interface SpatialIndexResourceTypes {
	spatialIndex: SpatialIndex;
}

function createSpatialIndexResource(grid: SpatialHashGrid): SpatialIndex {
	return {
		grid,
		queryRect(minX: number, minY: number, maxX: number, maxY: number): number[] {
			const out: number[] = [];
			gridQueryRect(grid, minX, minY, maxX, maxY, out);
			return out;
		},
		queryRectInto(minX: number, minY: number, maxX: number, maxY: number, result: number[], minId?: number): void {
			gridQueryRect(grid, minX, minY, maxX, maxY, result, minId);
		},
		queryRadius(cx: number, cy: number, radius: number): number[] {
			const out: number[] = [];
			gridQueryRadius(grid, cx, cy, radius, out);
			return out;
		},
		queryRadiusInto(cx: number, cy: number, radius: number, result: number[]): void {
			gridQueryRadius(grid, cx, cy, radius, result);
		},
		getEntry(entityId: number): SpatialEntry | undefined {
			return getLiveEntry(grid, entityId);
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
					.addQuery('aabbOnly', {
						with: [transformComponent, 'aabbCollider'],
						without: ['circleCollider'],
					})
					.addQuery('circleOnly', {
						with: [transformComponent, 'circleCollider'],
						without: ['aabbCollider'],
					})
					.addQuery('both', {
						with: [transformComponent, 'aabbCollider', 'circleCollider'],
					})
					.setProcess(({ queries }) => {
						clearGrid(grid);

						for (const entity of queries.aabbOnly) {
							const transform = entity.components[transformComponent];
							const { aabbCollider } = entity.components;
							const x = transform.x + (aabbCollider.offsetX ?? 0);
							const y = transform.y + (aabbCollider.offsetY ?? 0);
							insertEntity(grid, entity.id, x, y, aabbCollider.width / 2, aabbCollider.height / 2);
						}

						for (const entity of queries.circleOnly) {
							const transform = entity.components[transformComponent];
							const { circleCollider } = entity.components;
							const x = transform.x + (circleCollider.offsetX ?? 0);
							const y = transform.y + (circleCollider.offsetY ?? 0);
							insertEntity(grid, entity.id, x, y, circleCollider.radius, circleCollider.radius);
						}

						// Conservative broadphase: stack both offsets and take the
						// larger half-extent in each axis. Preserves the previous
						// "both colliders" behavior exactly.
						for (const entity of queries.both) {
							const transform = entity.components[transformComponent];
							const { aabbCollider, circleCollider } = entity.components;
							const x = transform.x + (aabbCollider.offsetX ?? 0) + (circleCollider.offsetX ?? 0);
							const y = transform.y + (aabbCollider.offsetY ?? 0) + (circleCollider.offsetY ?? 0);
							const halfW = Math.max(aabbCollider.width / 2, circleCollider.radius);
							const halfH = Math.max(aabbCollider.height / 2, circleCollider.radius);
							insertEntity(grid, entity.id, x, y, halfW, halfH);
						}
					});
			}
		});
}
