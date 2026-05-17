/**
 * Health Plugin for ECSpresso
 *
 * Provides a standard health/damage/death lifecycle.
 * Entities with a `health` component can receive `damage` events.
 * When health reaches zero, an `entityDied` event is published.
 * The plugin does NOT remove dead entities — game-specific logic
 * decides when and how to handle death (animations, loot, etc).
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { WorldConfigFrom } from 'ecspresso';

// ==================== Component Types ====================

/**
 * Health state for an entity.
 */
export interface Health {
	current: number;
	max: number;
}

/**
 * Component types provided by the health plugin.
 */
export interface HealthComponentTypes {
	health: Health;
}

// ==================== Event Types ====================

/**
 * Event requesting damage to an entity.
 */
export interface DamageEvent {
	entityId: number;
	amount: number;
	sourceId?: number;
}

/**
 * Event fired when an entity's health reaches zero.
 */
export interface EntityDiedEvent {
	entityId: number;
	killerId?: number;
}

/**
 * Event types provided by the health plugin.
 */
export interface HealthEventTypes {
	damage: DamageEvent;
	entityDied: EntityDiedEvent;
}

// ==================== WorldConfig ====================

/**
 * WorldConfig representing the health plugin's provided types.
 * Used as the `Requires` type parameter by plugins that depend on health.
 */
export type HealthWorldConfig = WorldConfigFrom<HealthComponentTypes, HealthEventTypes>;

// ==================== Plugin Options ====================

export interface HealthPluginOptions<G extends string = 'combat'> extends BasePluginOptions<G> {}

// ==================== Helper Functions ====================

/**
 * Create a health component at full HP.
 *
 * @param max Maximum (and initial) health
 * @returns Component object suitable for spreading into spawn()
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createHealth(100),
 *   ...createLocalTransform(200, 300),
 * });
 * ```
 */
export function createHealth(max: number): Pick<HealthComponentTypes, 'health'> {
	return { health: { current: max, max } };
}

/**
 * Create a health component with a specific current value.
 *
 * @param current Current health
 * @param max Maximum health
 * @returns Component object suitable for spreading into spawn()
 */
export function createHealthWith(current: number, max: number): Pick<HealthComponentTypes, 'health'> {
	return { health: { current, max } };
}

// ==================== Plugin Factory ====================

/**
 * Create a health plugin for ECSpresso.
 *
 * Provides event-driven damage processing. Subscribe to `damage` events
 * to deal damage, and listen to `entityDied` events to react to deaths.
 *
 * @example
 * ```typescript
 * const ecs = ECSpresso.create()
 *   .withPlugin(createHealthPlugin())
 *   .build();
 *
 * // Deal damage:
 * ecs.eventBus.publish('damage', { entityId: targetId, amount: 25 });
 *
 * // React to death:
 * ecs.on('entityDied', ({ entityId }) => {
 *   ecs.commands.removeEntity(entityId);
 * });
 * ```
 */
export function createHealthPlugin<G extends string = 'combat'>(
	options?: HealthPluginOptions<G>,
) {
	const {
		systemGroup = 'combat',
	} = options ?? {};

	return definePlugin('health')
		.withComponentTypes<HealthComponentTypes>()
		.withEventTypes<HealthEventTypes>()
		.withLabels<'health-damage'>()
		.withGroups<G>()
		.install((world) => {
			world
				.addSystem('health-damage')
				.inGroup(systemGroup)
				.setEventHandlers({
					damage({ data, ecs }) {
						const health = ecs.getComponent(data.entityId, 'health');
						if (!health) return;
						if (health.current <= 0) return;

						health.current = Math.max(0, health.current - data.amount);
						ecs.markChanged(data.entityId, 'health');

						if (health.current <= 0) {
							ecs.eventBus.publish('entityDied', {
								entityId: data.entityId,
								killerId: data.sourceId,
							});
						}
					},
				});
		});
}
