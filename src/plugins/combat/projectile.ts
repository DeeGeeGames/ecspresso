/**
 * Projectile Plugin for ECSpresso
 *
 * Provides projectile movement (homing and linear) and collision integration.
 * Homing projectiles track a target entity's position each frame.
 * Linear projectiles move in a fixed direction.
 * When a collision involves a projectile, a `projectileHit` event is published
 * and a `damage` event is forwarded to the target (if the health plugin is present).
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { WorldConfigFrom } from 'ecspresso';
import type { TransformWorldConfig } from '../spatial/transform';
import type { CollisionEventTypes } from '../physics/collision';
import type { DamageEvent } from './health';

// ==================== Component Types ====================

/**
 * Core projectile data.
 */
export interface Projectile {
	damage: number;
	speed: number;
	/** Entity that fired this projectile */
	sourceId: number;
}

/**
 * Homing target — projectile tracks this entity's position each frame.
 */
export interface ProjectileTarget {
	entityId: number;
}

/**
 * Fixed direction for non-homing projectiles (normalized).
 */
export interface ProjectileDirection {
	x: number;
	y: number;
}

/**
 * Component types provided by the projectile plugin.
 */
export interface ProjectileComponentTypes {
	projectile: Projectile;
	projectileTarget: ProjectileTarget;
	projectileDirection: ProjectileDirection;
}

// ==================== Event Types ====================

/**
 * Event fired when a projectile hits a target via collision.
 */
export interface ProjectileHitEvent {
	projectileId: number;
	targetId: number;
	damage: number;
}

/**
 * Event types provided by the projectile plugin.
 */
export interface ProjectileEventTypes {
	projectileHit: ProjectileHitEvent;
	damage: DamageEvent;
}

// ==================== WorldConfig ====================

/**
 * WorldConfig representing the projectile plugin's provided types.
 */
export type ProjectileWorldConfig = WorldConfigFrom<ProjectileComponentTypes, ProjectileEventTypes>;

// ==================== Plugin Options ====================

export interface ProjectilePluginOptions<G extends string = 'combat'> extends BasePluginOptions<G> {
	/**
	 * Whether to auto-publish `damage` events on hit.
	 * Requires the health plugin to be installed. (default: true)
	 */
	publishDamage?: boolean;
}

// ==================== Helper Functions ====================

/**
 * Create a projectile component.
 *
 * @param damage Damage dealt on hit
 * @param speed Movement speed in pixels per second
 * @param sourceId Entity that fired this projectile
 * @returns Component object suitable for spreading into spawn()
 */
export function createProjectile(
	damage: number,
	speed: number,
	sourceId: number,
): Pick<ProjectileComponentTypes, 'projectile'> {
	return { projectile: { damage, speed, sourceId } };
}

/**
 * Create a homing projectile target component.
 *
 * @param entityId Target entity to track
 * @returns Component object suitable for spreading into spawn()
 */
export function createProjectileTarget(entityId: number): Pick<ProjectileComponentTypes, 'projectileTarget'> {
	return { projectileTarget: { entityId } };
}

/**
 * Create a fixed-direction projectile component (auto-normalizes).
 *
 * @param x Direction x
 * @param y Direction y
 * @returns Component object suitable for spreading into spawn()
 */
export function createProjectileDirection(x: number, y: number): Pick<ProjectileComponentTypes, 'projectileDirection'> {
	const len = Math.sqrt(x * x + y * y);
	if (len === 0) return { projectileDirection: { x: 0, y: -1 } };
	return { projectileDirection: { x: x / len, y: y / len } };
}

// ==================== Plugin Factory ====================

/**
 * Create a projectile plugin for ECSpresso.
 *
 * Provides homing and linear projectile movement systems, plus
 * automatic collision-to-damage integration.
 *
 * @example
 * ```typescript
 * // Spawn a homing projectile:
 * ecs.spawn({
 *   ...createProjectile(10, 400, turretId),
 *   ...createProjectileTarget(enemyId),
 *   ...createLocalTransform(x, y),
 *   ...createCircleCollider(4),
 *   ...collisionLayers.turretProjectile(),
 *   sprite: bulletSprite,
 *   renderLayer: 'projectiles',
 * });
 * ```
 */
export function createProjectilePlugin<G extends string = 'combat'>(
	options?: ProjectilePluginOptions<G>,
) {
	const {
		systemGroup = 'combat',
		priority = 300,
		phase = 'update',
		publishDamage = true,
	} = options ?? {};

	return definePlugin('projectile')
		.withComponentTypes<ProjectileComponentTypes>()
		.withEventTypes<ProjectileEventTypes>()
		.withLabels<'projectile-homing' | 'projectile-linear' | 'projectile-collision'>()
		.withGroups<G>()
		.requires<
			TransformWorldConfig &
			WorldConfigFrom<{}, CollisionEventTypes<string>>
		>()
		.install((world) => {
			// Homing projectiles — track target position each frame
			world
				.addSystem('projectile-homing')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('homing', {
					with: ['projectile', 'projectileTarget', 'localTransform'],
				})
				.setProcess(({ queries, ecs, dt }) => {
					for (const entity of queries.homing) {
						const { projectile, projectileTarget, localTransform } = entity.components;

						// Target no longer exists — remove projectile
						if (!ecs.getEntity(projectileTarget.entityId)) {
							ecs.commands.removeEntity(entity.id);
							continue;
						}

						const targetTransform = ecs.getComponent(projectileTarget.entityId, 'worldTransform');
						if (!targetTransform) {
							ecs.commands.removeEntity(entity.id);
							continue;
						}

						const dx = targetTransform.x - localTransform.x;
						const dy = targetTransform.y - localTransform.y;
						const distSq = dx * dx + dy * dy;
						const step = projectile.speed * dt;

						if (distSq <= step * step) {
							localTransform.x = targetTransform.x;
							localTransform.y = targetTransform.y;
						} else {
							const dist = Math.sqrt(distSq);
							localTransform.x += (dx / dist) * step;
							localTransform.y += (dy / dist) * step;
							localTransform.rotation = Math.atan2(dy, dx);
						}
						ecs.markChanged(entity.id, 'localTransform');
					}
				});

			// Linear projectiles — move in fixed direction
			world
				.addSystem('projectile-linear')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('linear', {
					with: ['projectile', 'projectileDirection', 'localTransform'],
				})
				.setProcess(({ queries, dt }) => {
					for (const entity of queries.linear) {
						const { projectile, projectileDirection, localTransform } = entity.components;
						const step = projectile.speed * dt;
						localTransform.x += projectileDirection.x * step;
						localTransform.y += projectileDirection.y * step;
					}
				});

			// Collision integration — route collision events to projectileHit + damage
			world
				.addSystem('projectile-collision')
				.inGroup(systemGroup)
				.setEventHandlers({
					collision({ data, ecs }) {
						if (!ecs.getEntity(data.entityA) || !ecs.getEntity(data.entityB)) return;

						const projectileA = ecs.getComponent(data.entityA, 'projectile');
						const projectileB = ecs.getComponent(data.entityB, 'projectile');

						const isAProjectile = projectileA !== undefined;
						const projectileData = isAProjectile ? projectileA : projectileB;
						if (!projectileData) return;

						const projectileId = isAProjectile ? data.entityA : data.entityB;
						const targetId = isAProjectile ? data.entityB : data.entityA;

						// Don't hit the entity that fired this projectile
						if (targetId === projectileData.sourceId) return;

						ecs.eventBus.publish('projectileHit', {
							projectileId,
							targetId,
							damage: projectileData.damage,
						});

						if (publishDamage) {
							ecs.eventBus.publish('damage', {
								entityId: targetId,
								amount: projectileData.damage,
								sourceId: projectileData.sourceId,
							});
						}

						ecs.commands.removeEntity(projectileId);
					},
				});
		});
}
