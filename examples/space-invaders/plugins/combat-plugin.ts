import { createTimer } from 'ecspresso/plugins/scripting/timers';
import { createCollisionPairHandler } from 'ecspresso/plugins/physics/collision';
import type { Game } from '../game';
import type collisionLayers from '../collision-layers';

type Layer = keyof typeof collisionLayers;

/**
 * Handles game-specific collision responses and combat logic.
 * Collision detection is provided by the collision plugin.
 */
export default function registerCombat(world: Game): void {
	world.addSystem('combat')
		.inGroup('gameplay')
		.setEventHandlers({
			collision: createCollisionPairHandler<Game, Layer>({
				'playerProjectile:enemy': (projectileId, enemyId, ecs) => {
					ecs.commands.removeEntity(projectileId);

					const enemyData = ecs.getComponent(enemyId, 'enemy');
					if (!enemyData || enemyData.health <= 0) return;

					enemyData.health -= 1;
					if (enemyData.health > 0) return;

					ecs.commands.removeEntity(enemyId);

					const score = ecs.getResource('score');
					score.value += enemyData.points;
					ecs.eventBus.publish('updateScore', { points: score.value });

					const livingEnemies = ecs
						.getEntitiesWithQuery(['enemy'])
						.filter(({ components }) => components.enemy.health > 0);
					if (livingEnemies.length !== 0) return;

					const gameState = ecs.getResource('gameState');
					if (gameState.status !== 'playing') return;

					ecs.eventBus.publish('levelComplete', { level: gameState.level });
				},
				'enemyProjectile:player': (projectileId, playerId, ecs) => {
					ecs.commands.removeEntity(projectileId);
					if (ecs.getResource('gameState').playerDeathPending) return;

					ecs.commands.removeEntity(playerId);
					ecs.eventBus.publish('playerDeath', {});
				},
			}),

			playerDeath({ ecs }) {
				const gameState = ecs.getResource('gameState');
				if (gameState.playerDeathPending) return;

				gameState.playerDeathPending = true;
				gameState.lives -= 1;
				ecs.eventBus.publish('updateLives', { lives: gameState.lives });

				if (gameState.lives <= 0) {
					ecs.eventBus.publish('gameOver', {
						win: false,
						score: ecs.getResource('score').value,
					});
					return;
				}

				ecs.spawn({
					timers: {
						respawn: createTimer(1.0, {
							onComplete: ({ entityId }) => {
								gameState.playerDeathPending = false;
								ecs.eventBus.publish('playerRespawn');
								ecs.commands.removeEntity(entityId);
							},
						}),
					},
				});
			},
		});
}
