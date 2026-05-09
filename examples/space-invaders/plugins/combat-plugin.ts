import { createTimer } from '../../../src/plugins/scripting/timers';
import { createCollisionPairHandler } from '../../../src/plugins/physics/collision';
import { definePlugin, type World } from '../types';
import type collisionLayers from '../collision-layers';

type Layer = keyof typeof collisionLayers;

/**
 * Handles game-specific collision responses and combat logic.
 * Collision detection is provided by the collision plugin.
 */
export default function createCombatPlugin() {
	return definePlugin({
		id: 'combat-plugin',
		install(world) {
			world.addSystem('combat')
				.inGroup('gameplay')
				.setEventHandlers({
					collision: createCollisionPairHandler<World, Layer>({
						'playerProjectile:enemy': (projectileId, enemyId, ecs) => {
							ecs.commands.removeEntity(projectileId);

							const enemyData = ecs.getComponent(enemyId, 'enemy');
							if (!enemyData) return;

							enemyData.health -= 1;

							if (enemyData.health <= 0) {
								ecs.commands.removeEntity(enemyId);

								const score = ecs.getResource('score');
								score.value += enemyData.points;
								ecs.eventBus.publish('updateScore', { points: score.value });

								const enemies = ecs.getEntitiesWithQuery(['enemy']);
								if (enemies.length === 1) {
									const gameState = ecs.getResource('gameState');
									if (gameState.status === 'playing') {
										ecs.eventBus.publish('levelComplete', { level: gameState.level });
									}
								}
							}
						},
						'enemyProjectile:player': (projectileId, playerId, ecs) => {
							ecs.commands.removeEntity(projectileId);
							ecs.commands.removeEntity(playerId);
							ecs.eventBus.publish('playerDeath', {});
						},
					}),

					playerDeath({ ecs }) {
						const gameState = ecs.getResource('gameState');
						gameState.lives -= 1;
						ecs.eventBus.publish('updateLives', { lives: gameState.lives });

						if (gameState.lives <= 0) {
							ecs.eventBus.publish('gameOver', {
								win: false,
								score: ecs.getResource('score').value,
							});
						} else {
							ecs.spawn({
								timers: {
									respawn: createTimer(1.0, {
										onComplete: ({ entityId }) => {
											ecs.eventBus.publish('playerRespawn');
											ecs.commands.removeEntity(entityId);
										},
									}),
								},
							});
						}
					},
				});
		},
	});
}
