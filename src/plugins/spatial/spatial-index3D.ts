/**
 * Spatial Index 3D Plugin for ECSpresso
 *
 * Provides a uniform-grid spatial hash for broadphase collision detection
 * and proximity queries in 3D. Rebuilds the grid each frame from entity
 * transforms. Replaces O(n²) brute-force with O(n·d) where d = local density.
 *
 * Standalone usage: queryBox / queryRadius for proximity queries.
 * Automatic acceleration: collision3D and physics3D plugins detect the
 * spatialIndex3D resource at runtime and use it for broadphase when present.
 */

import { definePlugin } from 'ecspresso';
import type { SystemPhase } from 'ecspresso';
import type { Transform3DComponentTypes } from './transform3D';
import {
	type SpatialEntry3D,
	type SpatialHashGrid3D,
	type SpatialIndex3D,
	createGrid3D,
	clearGrid3D,
	insertEntity3D,
	gridQueryBox3D,
	gridQueryRadius3D,
	getLiveEntry3D,
} from '../../utils/spatial-hash3D';

// ==================== Collider Component Types ====================

/**
 * 3D axis-aligned bounding box collider component.
 * Defined here (spatial layer) so collision3D can import rather than redefine.
 */
export interface AABB3DCollider {
	width: number;
	height: number;
	depth: number;
	offsetX?: number;
	offsetY?: number;
	offsetZ?: number;
}

/**
 * Sphere collider component.
 * Defined here (spatial layer) so collision3D can import rather than redefine.
 */
export interface SphereCollider {
	radius: number;
	offsetX?: number;
	offsetY?: number;
	offsetZ?: number;
}

export interface Spatial3DColliderComponentTypes {
	aabb3DCollider: AABB3DCollider;
	sphereCollider: SphereCollider;
}

// ==================== Resource API ====================

export interface SpatialIndex3DResourceTypes {
	spatialIndex3D: SpatialIndex3D;
}

function createSpatialIndex3DResource(grid: SpatialHashGrid3D): SpatialIndex3D {
	return {
		grid,
		queryBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number[] {
			const out: number[] = [];
			gridQueryBox3D(grid, minX, minY, minZ, maxX, maxY, maxZ, out);
			return out;
		},
		queryBoxInto(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, result: number[], minId?: number): void {
			gridQueryBox3D(grid, minX, minY, minZ, maxX, maxY, maxZ, result, minId);
		},
		queryRadius(cx: number, cy: number, cz: number, radius: number): number[] {
			const out: number[] = [];
			gridQueryRadius3D(grid, cx, cy, cz, radius, out);
			return out;
		},
		queryRadiusInto(cx: number, cy: number, cz: number, radius: number, result: number[]): void {
			gridQueryRadius3D(grid, cx, cy, cz, radius, result);
		},
		getEntry(entityId: number): SpatialEntry3D | undefined {
			return getLiveEntry3D(grid, entityId);
		},
	};
}

// ==================== Component Types ====================

type SpatialIndex3DComponentTypes = Transform3DComponentTypes & Spatial3DColliderComponentTypes;

// ==================== Plugin Options ====================

export type SpatialIndex3DPhase = 'fixedUpdate' | 'postUpdate';
type SpatialIndex3DLabel = `spatial-index3D-rebuild-${SpatialIndex3DPhase}`;

export interface SpatialIndex3DPluginOptions<G extends string = 'spatialIndex3D'> {
	/** Cell size for the spatial hash grid (default: 64) */
	cellSize?: number;
	/** System group name (default: 'spatialIndex3D') */
	systemGroup?: G;
	/** Priority for rebuild systems (default: 2000, before collision) */
	priority?: number;
	/** Phases to register rebuild systems in (default: ['fixedUpdate', 'postUpdate']) */
	phases?: ReadonlyArray<SpatialIndex3DPhase>;
}

// ==================== Plugin Factory ====================

/**
 * Create a 3D spatial index plugin for ECSpresso.
 *
 * Provides a uniform-grid spatial hash that accelerates 3D collision detection.
 * When installed alongside the collision3D or physics3D plugins, they
 * automatically use the spatial index for broadphase instead of O(n²)
 * brute-force.
 *
 * Also provides proximity query methods for game logic (e.g. "find all
 * enemies within 200 units").
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransform3DPlugin())
 *   .withPlugin(createCollision3DPlugin({ layers }))
 *   .withPlugin(createSpatialIndex3DPlugin({ cellSize: 128 }))
 *   .build();
 *
 * // Proximity query in a system:
 * const si = ecs.getResource('spatialIndex3D');
 * const nearby = si.queryRadius(playerX, playerY, playerZ, 200);
 * ```
 */
export function createSpatialIndex3DPlugin<G extends string = 'spatialIndex3D'>(
	options?: SpatialIndex3DPluginOptions<G>,
) {
	const {
		cellSize = 64,
		systemGroup = 'spatialIndex3D',
		priority = 2000,
		phases = ['fixedUpdate', 'postUpdate'] as const,
	} = options ?? {};

	const grid = createGrid3D(cellSize);
	const resource = createSpatialIndex3DResource(grid);

	return definePlugin('spatialIndex3D')
		.withComponentTypes<SpatialIndex3DComponentTypes>()
		.withResourceTypes<SpatialIndex3DResourceTypes>()
		.withLabels<SpatialIndex3DLabel>()
		.withGroups<G>()
		.install((world) => {
			world.addResource('spatialIndex3D', resource);

			// Register a rebuild system for each requested phase
			for (const phase of phases) {
				const transformComponent = phase === 'fixedUpdate' ? 'localTransform3D' : 'worldTransform3D';

				world
					.addSystem(`spatial-index3D-rebuild-${phase}`)
					.setPriority(priority)
					.inPhase(phase as SystemPhase)
					.inGroup(systemGroup)
					.addQuery('aabbWith', {
						with: [transformComponent, 'aabb3DCollider'],
					})
					.addQuery('sphereOnly', {
						with: [transformComponent, 'sphereCollider'],
						without: ['aabb3DCollider'],
					})
					.runWhenEmpty()
					.setProcess(({ queries }) => {
						clearGrid3D(grid);

						// AABB-precedence: aabbWith covers both aabb-only AND
						// entities carrying both colliders. Sphere-only is its own
						// query. Matches collision3D / physics3D semantic.
						for (const entity of queries.aabbWith) {
							const transform = entity.components[transformComponent];
							const { aabb3DCollider } = entity.components;
							insertEntity3D(
								grid, entity.id,
								transform.x + (aabb3DCollider.offsetX ?? 0),
								transform.y + (aabb3DCollider.offsetY ?? 0),
								transform.z + (aabb3DCollider.offsetZ ?? 0),
								aabb3DCollider.width / 2, aabb3DCollider.height / 2, aabb3DCollider.depth / 2,
							);
						}

						for (const entity of queries.sphereOnly) {
							const transform = entity.components[transformComponent];
							const { sphereCollider } = entity.components;
							const r = sphereCollider.radius;
							insertEntity3D(
								grid, entity.id,
								transform.x + (sphereCollider.offsetX ?? 0),
								transform.y + (sphereCollider.offsetY ?? 0),
								transform.z + (sphereCollider.offsetZ ?? 0),
								r, r, r,
							);
						}
					});
			}
		});
}
