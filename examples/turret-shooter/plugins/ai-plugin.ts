import { Vector3 } from 'three';
import { definePlugin } from '../types';

export default function createAIPlugin() {
	return definePlugin({
		id: 'ai-plugin',
		install(world) {
			// Enemy AI system — steer toward player. Player↔enemy contact is
			// handled by the collision-router in gameplay-plugin.
			world.addSystem('enemy-ai')
				.inGroup('gameplay')
				.addQuery('enemies', {
					with: ['enemy', 'localTransform3D', 'velocity']
				})
				.addQuery('players', {
					with: ['player', 'localTransform3D']
				})
				.setProcess(({ queries: { enemies, players } }) => {
					const playerEntity = players[0];
					if (!playerEntity) return;

					const playerTransform = playerEntity.components.localTransform3D;

					for (const enemy of enemies) {
						const { localTransform3D, velocity, enemy: enemyComponent } = enemy.components;

						if (enemyComponent.isDestroying) continue;

						const directionX = playerTransform.x - localTransform3D.x;
						const directionZ = playerTransform.z - localTransform3D.z;
						const distance = Math.sqrt(directionX * directionX + directionZ * directionZ);

						if (distance > 0) {
							const normalizedDirX = directionX / distance;
							const normalizedDirZ = directionZ / distance;

							localTransform3D.ry = Math.atan2(normalizedDirX, normalizedDirZ);

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
