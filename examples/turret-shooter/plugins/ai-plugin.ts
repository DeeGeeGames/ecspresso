import { Vector3 } from 'three';
import { createTimer } from '../../../src/plugins/scripting/timers';
import { definePlugin } from '../types';

export default function createAIPlugin() {
	return definePlugin({
		id: 'ai-plugin',
		install(world) {
			// Enemy AI system
			world.addSystem('enemy-ai')
				.inGroup('gameplay')
				.addQuery('enemies', {
					with: ['enemy', 'localTransform3D', 'velocity']
				})
				.setProcess(({ queries: { enemies }, ecs }) => {
					const playerEntities = ecs.entityManager.getEntitiesWithQuery(['player', 'localTransform3D']);

					if (playerEntities.length === 0) return;

					const playerEntity = playerEntities[0];
					if (!playerEntity) return;

					const playerTransform = playerEntity.components.localTransform3D;

					for (const enemy of enemies) {
						const { localTransform3D, velocity, enemy: enemyComponent } = enemy.components;

						// Skip enemies already marked for destruction
						if (enemyComponent.isDestroying) continue;

						// Calculate direction to player
						const directionX = playerTransform.x - localTransform3D.x;
						const directionZ = playerTransform.z - localTransform3D.z;
						const distance = Math.sqrt(directionX * directionX + directionZ * directionZ);

						// Skip if enemy is too close to player
						const minDistance = 10;
						if (distance < minDistance) {
							// Damage player and mark for destruction
							if (!enemyComponent.isDestroying) {
								enemyComponent.isDestroying = true;

								// Stop movement
								velocity.x = 0;
								velocity.y = 0;
								velocity.z = 0;

								// Deal damage to player
								ecs.eventBus.publish('playerHit', {
									damage: enemyComponent.attackDamage * 0.1
								});

								// Create destruction effect and award score
								ecs.eventBus.publish('enemyDestroyed', {
									entityId: enemy.id,
									points: Math.floor(enemyComponent.scoreValue / 2)
								});

								// Add timer for pending destruction
								ecs.addComponent(enemy.id, 'timers', { destroy: createTimer(0.5) });
								ecs.addComponent(enemy.id, 'pendingDestroy', true);
							}
						} else {
							// Normalize direction
							const normalizedDirX = directionX / distance;
							const normalizedDirZ = directionZ / distance;

							// Calculate rotation to face player
							localTransform3D.ry = Math.atan2(normalizedDirX, normalizedDirZ);

							// Update velocity to move towards player
							velocity.x = normalizedDirX * enemyComponent.speed;
							velocity.z = normalizedDirZ * enemyComponent.speed;
						}

						// Air enemies bob up/down
						if (enemyComponent.type === 'air') {
							localTransform3D.y = 15 + Math.sin(performance.now() / 1000) * 3;
						}
					}
				})
				.setOnInitialize((ecs) => {
					ecs.addResource('playerInitialRotation', { y: 0 });
				});

			// Pending destroy system
			world.addSystem('pending-destroy')
				.inGroup('gameplay')
				.setProcessEach({ with: ['timers', 'pendingDestroy'] }, ({ entity, ecs }) => {
					if (entity.components.timers['destroy']?.justFinished) {
						ecs.eventBus.publish('entityDestroyed', {
							entityId: entity.id
						});
					}
				});

			// Spawn timer system
			world.addSystem('spawn-timer')
				.inGroup('gameplay')
				.inPhase('preUpdate')
				.withResources(['waveManager', 'config', 'playerInitialRotation'])
				.setProcessEach({ with: ['timers', 'enemySpawner'] }, ({ entity: spawner, ecs, resources: { waveManager, config, playerInitialRotation } }) => {
					if (!spawner.components.timers['spawn']?.justFinished) return;

					if (waveManager.enemiesRemaining > 0) {
						const enemies = ecs.entityManager.getEntitiesWithQuery(['enemy']);

						if (enemies.length < config.maxEnemies) {
							const isGroundEnemy = Math.random() < 0.7;
							const enemyType = isGroundEnemy ? 'ground' : 'air';

							const baseAngle = playerInitialRotation.y;
							const randomOffset = (Math.random() - 0.5) * (Math.PI / 3);
							const angle = baseAngle + Math.PI + randomOffset;
							const spawnDistance = 180 + Math.random() * 40;

							const spawnX = Math.sin(angle) * spawnDistance;
							const spawnZ = Math.cos(angle) * spawnDistance;

							ecs.eventBus.publish('enemySpawn', {
								type: enemyType,
								position: new Vector3(spawnX, 0, spawnZ)
							});
						}
					}
				});
		},
	});
}
