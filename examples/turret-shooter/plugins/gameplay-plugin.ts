import { createTimer } from '../../../src/plugins/scripting/timers';
import { createCollisionPairHandler } from '../../../src/plugins/physics/collision3D';
import { definePlugin, type CollisionLayerName, type World } from '../types';

export default function createGameplayPlugin() {
	return definePlugin({
		id: 'gameplay-plugin',
		install(world) {
			// Lifetime system
			world.addSystem('lifetime')
				.inGroup('gameplay')
				.setProcessEach({ with: ['lifetime'] }, ({ entity, dt, ecs }) => {
					entity.components.lifetime.remaining -= dt;

					if (entity.components.lifetime.remaining <= 0) {
						ecs.eventBus.publish('entityDestroyed', {
							entityId: entity.id
						});
					}
				});

			// Collision routing — collision3D plugin handles broadphase + narrowphase
			// and publishes events. The pair handler dispatches by layer pair and
			// normalizes entity argument order to match the registered key.
			const dispatchCollision = createCollisionPairHandler<World, CollisionLayerName>({
				'projectile:enemy': (projectileId, enemyId, ecs) => {
					const projectileComponent = ecs.getComponent(projectileId, 'projectile');
					const enemyComponent = ecs.getComponent(enemyId, 'enemy');
					if (!projectileComponent || !enemyComponent || enemyComponent.isDestroying) return;
					if (projectileComponent.owner !== 'player') return;

					enemyComponent.health -= projectileComponent.damage;
					ecs.eventBus.publish('entityDestroyed', { entityId: projectileId });

					if (enemyComponent.health <= 0) {
						const waveManager = ecs.getResource('waveManager');
						ecs.eventBus.publish('enemyDestroyed', {
							entityId: enemyId,
							points: enemyComponent.scoreValue,
						});
						ecs.eventBus.publish('updateScore', {
							points: enemyComponent.scoreValue,
						});

						waveManager.enemiesRemaining--;
						if (waveManager.enemiesRemaining <= 0) {
							ecs.eventBus.publish('waveComplete', {
								wave: waveManager.currentWave,
							});
						}
					}
				},
				'enemy:player': (enemyId, _playerId, ecs) => {
					const enemyComponent = ecs.getComponent(enemyId, 'enemy');
					if (!enemyComponent || enemyComponent.isDestroying) return;

					enemyComponent.isDestroying = true;
					const velocity = ecs.getComponent(enemyId, 'velocity');
					if (velocity) {
						velocity.x = 0;
						velocity.y = 0;
						velocity.z = 0;
					}

					ecs.eventBus.publish('playerHit', {
						damage: enemyComponent.attackDamage * 0.1,
					});
					ecs.eventBus.publish('enemyDestroyed', {
						entityId: enemyId,
						points: Math.floor(enemyComponent.scoreValue / 2),
					});

					ecs.addComponent(enemyId, 'timers', { destroy: createTimer(0.5) });
					ecs.addComponent(enemyId, 'pendingDestroy', true);
				},
			});

			world.addSystem('collision-router')
				.inGroup('gameplay')
				.setEventHandlers({
					// Event handlers fire even when the system's group is disabled
					// (subscriptions live on the bus, not gated by enabledGroups),
					// so we guard explicitly to ignore stray collisions during pause.
					collision3D({ data, ecs }) {
						if (ecs.getResource('gameState').status !== 'playing') return;
						dispatchCollision({ data, ecs });
					},
				});
		},
	});
}
