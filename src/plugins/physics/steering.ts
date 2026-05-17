/**
 * Steering Plugin for ECSpresso
 *
 * Provides simple move-to-target behavior with arrival detection.
 * Entities with a `moveTarget` component move toward the target position
 * at their configured `moveSpeed`. The `moveTarget` component is removed
 * on arrival and an `arriveAtTarget` event is published.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { WorldConfigFrom } from 'ecspresso';
import type { TransformWorldConfig } from '../spatial/transform';

// ==================== Component Types ====================

/**
 * Target position for an entity to move toward.
 * Removed automatically when the entity arrives.
 */
export interface MoveTarget {
	x: number;
	y: number;
}

/**
 * Component types provided by the steering plugin.
 */
export interface SteeringComponentTypes {
	moveTarget: MoveTarget;
	moveSpeed: number;
}

// ==================== Event Types ====================

/**
 * Event fired when an entity arrives at its move target.
 */
export interface ArriveAtTargetEvent {
	entityId: number;
}

/**
 * Event types provided by the steering plugin.
 */
export interface SteeringEventTypes {
	arriveAtTarget: ArriveAtTargetEvent;
}

// ==================== WorldConfig ====================

/**
 * WorldConfig representing the steering plugin's provided types.
 * Used as the `Requires` type parameter by plugins that depend on steering.
 */
export type SteeringWorldConfig = WorldConfigFrom<SteeringComponentTypes, SteeringEventTypes>;

// ==================== Plugin Options ====================

/**
 * Configuration options for the steering plugin.
 */
export interface SteeringPluginOptions<G extends string = 'steering'> extends BasePluginOptions<G> {
	/** Distance threshold to consider arrival (default: 2) */
	arrivalThreshold?: number;
}

// ==================== Helper Functions ====================

/**
 * Create a moveTarget component.
 *
 * @param x Target x position
 * @param y Target y position
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.addComponent(entityId, 'moveTarget', createMoveTarget(200, 300).moveTarget);
 * ```
 */
export function createMoveTarget(x: number, y: number): Pick<SteeringComponentTypes, 'moveTarget'> {
	return { moveTarget: { x, y } };
}

/**
 * Create a moveSpeed component.
 *
 * @param speed Movement speed in pixels per second
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(100, 200),
 *   ...createMoveSpeed(150),
 * });
 * ```
 */
export function createMoveSpeed(speed: number): Pick<SteeringComponentTypes, 'moveSpeed'> {
	return { moveSpeed: speed };
}

// ==================== Plugin Factory ====================

/**
 * Create a steering plugin for ECSpresso.
 *
 * Provides a `move-to-target` system that moves entities with `moveTarget`
 * and `moveSpeed` components toward their target position. On arrival,
 * the `moveTarget` component is removed and an `arriveAtTarget` event is published.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransformPlugin())
 *   .withPlugin(createSteeringPlugin())
 *   .build();
 *
 * await ecs.initialize();
 *
 * ecs.spawn({
 *   ...createTransform(0, 0),
 *   ...createMoveSpeed(100),
 *   ...createMoveTarget(200, 200),
 * });
 * ```
 */
export function createSteeringPlugin<G extends string = 'steering'>(
	options?: SteeringPluginOptions<G>
) {
	const {
		systemGroup = 'steering',
		priority = 100,
		phase = 'update',
		arrivalThreshold = 2,
	} = options ?? {};

	const arrivalThresholdSq = arrivalThreshold * arrivalThreshold;

	return definePlugin('steering')
		.withComponentTypes<SteeringComponentTypes>()
		.withEventTypes<SteeringEventTypes>()
		.withLabels<'move-to-target'>()
		.withGroups<G>()
		.requires<TransformWorldConfig>()
		.install((world) => {
			world
				.addSystem('move-to-target')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('movers', {
					with: ['localTransform', 'moveTarget', 'moveSpeed'],
				})
				.setProcess(({ queries, ecs, dt }) => {
					for (const entity of queries.movers) {
						const { localTransform, moveTarget, moveSpeed } = entity.components;

						const dx = moveTarget.x - localTransform.x;
						const dy = moveTarget.y - localTransform.y;
						const distSq = dx * dx + dy * dy;

						if (distSq <= arrivalThresholdSq) {
							localTransform.x = moveTarget.x;
							localTransform.y = moveTarget.y;
							ecs.markChanged(entity.id, 'localTransform');
							ecs.commands.removeComponent(entity.id, 'moveTarget');
							ecs.eventBus.publish('arriveAtTarget', { entityId: entity.id });
							continue;
						}

						const dist = Math.sqrt(distSq);
						const step = Math.min(moveSpeed * dt, dist);
						localTransform.x += (dx / dist) * step;
						localTransform.y += (dy / dist) * step;
						ecs.markChanged(entity.id, 'localTransform');
					}
				});
		});
}
