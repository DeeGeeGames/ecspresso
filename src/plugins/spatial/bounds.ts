/**
 * Bounds Plugin for ECSpresso
 *
 * Provides screen bounds enforcement for entities with transforms.
 * Reads worldTransform for position checking; modifies localTransform for corrections.
 * Supports destroy, clamp, and wrap behaviors.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { TransformWorldConfig } from './transform';

// ==================== Component Types ====================

/**
 * Component that marks an entity for destruction when outside bounds.
 */
export interface DestroyOutOfBounds {
	/** Extra padding beyond bounds before destruction (default: 0) */
	padding?: number;
}

/**
 * Component that clamps an entity's position to stay within bounds.
 */
export interface ClampToBounds {
	/** Margin to shrink the valid area (default: 0) */
	margin?: number;
}

/**
 * Component that wraps an entity's position to the opposite edge.
 */
export interface WrapAtBounds {
	/** Padding beyond bounds before wrapping (default: 0) */
	padding?: number;
}

/**
 * Component types provided by the bounds plugin.
 * Included automatically via `.withPlugin(createBoundsPlugin())`.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransformPlugin())
 *   .withPlugin(createBoundsPlugin({ width: 800, height: 600 }))
 *   .withComponentTypes<{ sprite: Sprite }>()
 *   .build();
 * ```
 */
export interface BoundsComponentTypes {
	destroyOutOfBounds: DestroyOutOfBounds;
	clampToBounds: ClampToBounds;
	wrapAtBounds: WrapAtBounds;
}

// ==================== Resource Types ====================

/**
 * Bounds rectangle definition.
 */
export interface BoundsRect {
	/** Left edge x coordinate (default: 0) */
	x?: number;
	/** Top edge y coordinate (default: 0) */
	y?: number;
	/** Width of the bounds area */
	width: number;
	/** Height of the bounds area */
	height: number;
}

/**
 * Resource types provided by the bounds plugin.
 */
export interface BoundsResourceTypes {
	bounds: BoundsRect;
}

// ==================== Event Types ====================

/**
 * Event fired when an entity exits bounds.
 */
export interface EntityOutOfBoundsEvent {
	/** The entity that exited bounds */
	entityId: number;
	/** The edge the entity exited through */
	exitEdge: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Event types provided by the bounds plugin.
 */
export interface BoundsEventTypes {
	entityOutOfBounds: EntityOutOfBoundsEvent;
}

// ==================== Plugin Options ====================

/**
 * Configuration options for the bounds plugin.
 */
export interface BoundsPluginOptions<G extends string = 'physics'> extends BasePluginOptions<G> {
	/** Resource key for bounds rectangle (default: 'bounds') */
	boundsResourceKey?: string;
	/** Whether to auto-remove entities when out of bounds (default: true) */
	autoRemove?: boolean;
}

// ==================== Helper Functions ====================

/**
 * Create a bounds rectangle resource.
 *
 * @param width The width of the bounds area
 * @param height The height of the bounds area
 * @param x The left edge x coordinate (default: 0)
 * @param y The top edge y coordinate (default: 0)
 * @returns Bounds rectangle suitable for use as a resource
 *
 * @example
 * ```typescript
 * ECSpresso.create()
 *   .withResource('bounds', createBounds(800, 600))
 *   .build();
 * ```
 */
export function createBounds(width: number, height: number, x?: number, y?: number): BoundsRect {
	const bounds: BoundsRect = { width, height };
	if (x !== undefined) bounds.x = x;
	if (y !== undefined) bounds.y = y;
	return bounds;
}

/**
 * Create a destroyOutOfBounds component.
 *
 * @param padding Extra padding beyond bounds before destruction
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createDestroyOutOfBounds(20),
 * });
 * ```
 */
export function createDestroyOutOfBounds(padding?: number): Pick<BoundsComponentTypes, 'destroyOutOfBounds'> {
	return {
		destroyOutOfBounds: padding !== undefined ? { padding } : {},
	};
}

/**
 * Create a clampToBounds component.
 *
 * @param margin Margin to shrink the valid area
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createClampToBounds(30),
 * });
 * ```
 */
export function createClampToBounds(margin?: number): Pick<BoundsComponentTypes, 'clampToBounds'> {
	return {
		clampToBounds: margin !== undefined ? { margin } : {},
	};
}

/**
 * Create a wrapAtBounds component.
 *
 * @param padding Padding beyond bounds before wrapping
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createWrapAtBounds(10),
 * });
 * ```
 */
export function createWrapAtBounds(padding?: number): Pick<BoundsComponentTypes, 'wrapAtBounds'> {
	return {
		wrapAtBounds: padding !== undefined ? { padding } : {},
	};
}

// ==================== Dependency Types ====================

// ==================== Plugin Factory ====================

/**
 * Create a bounds plugin for ECSpresso.
 *
 * This plugin provides:
 * - Destroy out of bounds system - removes entities that exit bounds
 * - Clamp to bounds system - constrains entities within bounds
 * - Wrap at bounds system - wraps entities to opposite edge
 *
 * Uses worldTransform for position checking (world-space) and modifies
 * localTransform for corrections. Works best with entities that don't
 * have parent transforms (orphan entities).
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso
 *   .create<Components, Events, Resources>()
 *   .withResource('bounds', createBounds(800, 600))
 *   .withPlugin(createTransformPlugin())
 *   .withPlugin(createBoundsPlugin())
 *   .build();
 *
 * // Entity that gets destroyed when leaving screen
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createDestroyOutOfBounds(),
 * });
 * ```
 */
export function createBoundsPlugin<ResourceTypes extends BoundsResourceTypes = BoundsResourceTypes, G extends string = 'physics'>(
	options?: BoundsPluginOptions<G>
) {
	const {
		systemGroup = 'physics',
		priority = 50,
		boundsResourceKey = 'bounds',
		autoRemove = true,
		phase = 'postUpdate',
	} = options ?? {};

	return definePlugin('bounds')
		.withComponentTypes<BoundsComponentTypes>()
		.withEventTypes<BoundsEventTypes>()
		.withResourceTypes<ResourceTypes>()
		.withLabels<'bounds-destroy' | 'bounds-clamp' | 'bounds-wrap'>()
		.withGroups<G>()
		.requires<TransformWorldConfig>()
		.install((world) => {
			// Destroy out of bounds system
			world
				.addSystem('bounds-destroy')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('entities', {
					with: ['worldTransform', 'destroyOutOfBounds'],
				})
				.setProcess(({ queries, ecs }) => {
					const bounds = ecs.getResource(boundsResourceKey as keyof ResourceTypes) as BoundsRect;
					const minX = bounds.x ?? 0;
					const minY = bounds.y ?? 0;
					const maxX = minX + bounds.width;
					const maxY = minY + bounds.height;

					for (const entity of queries.entities) {
						const { worldTransform, destroyOutOfBounds } = entity.components;
						const padding = destroyOutOfBounds.padding ?? 0;

						const exitEdge = getExitEdge(worldTransform, minX, minY, maxX, maxY, padding);
						if (!exitEdge) continue;

						ecs.eventBus.publish('entityOutOfBounds', {
							entityId: entity.id,
							exitEdge,
						});

						if (autoRemove) {
							ecs.commands.removeEntity(entity.id);
						}
					}
				});

			// Clamp to bounds system
			world
				.addSystem('bounds-clamp')
				.setPriority(priority - 1)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('entities', {
					with: ['localTransform', 'worldTransform', 'clampToBounds'],
				})
				.setProcess(({ queries, ecs }) => {
					const bounds = ecs.getResource(boundsResourceKey as keyof ResourceTypes) as BoundsRect;
					const minX = bounds.x ?? 0;
					const minY = bounds.y ?? 0;
					const maxX = minX + bounds.width;
					const maxY = minY + bounds.height;

					for (const entity of queries.entities) {
						const { localTransform, worldTransform, clampToBounds } = entity.components;
						const margin = clampToBounds.margin ?? 0;

						const clampedMinX = minX + margin;
						const clampedMinY = minY + margin;
						const clampedMaxX = maxX - margin;
						const clampedMaxY = maxY - margin;

						// Calculate world-space correction and apply to local transform
						// For entities without parents, this is equivalent to direct position clamping
						let deltaX = 0;
						let deltaY = 0;

						if (worldTransform.x < clampedMinX) deltaX = clampedMinX - worldTransform.x;
						if (worldTransform.x > clampedMaxX) deltaX = clampedMaxX - worldTransform.x;
						if (worldTransform.y < clampedMinY) deltaY = clampedMinY - worldTransform.y;
						if (worldTransform.y > clampedMaxY) deltaY = clampedMaxY - worldTransform.y;

						if (deltaX !== 0 || deltaY !== 0) {
							localTransform.x += deltaX;
							localTransform.y += deltaY;
							ecs.markChanged(entity.id, 'localTransform');
						}
					}
				});

			// Wrap at bounds system
			world
				.addSystem('bounds-wrap')
				.setPriority(priority - 2)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('entities', {
					with: ['localTransform', 'worldTransform', 'wrapAtBounds'],
				})
				.setProcess(({ queries, ecs }) => {
					const bounds = ecs.getResource(boundsResourceKey as keyof ResourceTypes) as BoundsRect;
					const minX = bounds.x ?? 0;
					const minY = bounds.y ?? 0;
					const maxX = minX + bounds.width;
					const maxY = minY + bounds.height;

					for (const entity of queries.entities) {
						const { localTransform, worldTransform, wrapAtBounds } = entity.components;
						const padding = wrapAtBounds.padding ?? 0;

						let deltaX = 0;
						let deltaY = 0;
						const boundsWidth = maxX - minX;
						const boundsHeight = maxY - minY;

						// Wrap horizontally
						if (worldTransform.x > maxX + padding) {
							deltaX = -(boundsWidth + 2 * padding);
						} else if (worldTransform.x < minX - padding) {
							deltaX = boundsWidth + 2 * padding;
						}

						// Wrap vertically
						if (worldTransform.y > maxY + padding) {
							deltaY = -(boundsHeight + 2 * padding);
						} else if (worldTransform.y < minY - padding) {
							deltaY = boundsHeight + 2 * padding;
						}

						if (deltaX !== 0 || deltaY !== 0) {
							localTransform.x += deltaX;
							localTransform.y += deltaY;
							ecs.markChanged(entity.id, 'localTransform');
						}
					}
				});
		});
}

/**
 * Determine which edge an entity has exited through, if any.
 */
function getExitEdge(
	transform: { x: number; y: number },
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
	padding: number
): 'top' | 'bottom' | 'left' | 'right' | null {
	if (transform.x > maxX + padding) return 'right';
	if (transform.x < minX - padding) return 'left';
	if (transform.y > maxY + padding) return 'bottom';
	if (transform.y < minY - padding) return 'top';
	return null;
}
