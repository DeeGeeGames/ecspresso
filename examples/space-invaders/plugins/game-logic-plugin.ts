import { createTimer } from '../../../src/plugins/scripting/timers';
import { definePlugin } from '../types';
import { spawnEnemyFormation } from '../utils';

const DIRECTION_VELOCITIES: Record<string, { x: number; y: number }> = {
	'left': { x: -1, y: 0 },
	'right': { x: 1, y: 0 },
	'down': { x: 0, y: 2 },
};

export default function createGameLogicPlugin() {
	return definePlugin({
		id: 'game-logic-plugin',
		install(world) {
			world.addSystem('game-state')
				.setEventHandlers({
					gameInit({ ecs }) {
						const gameState = ecs.getResource('gameState');
						const score = ecs.getResource('score');

						gameState.status = 'ready';
						gameState.level = 1;
						gameState.lives = 3;
						score.value = 0;

						ecs.eventBus.publish('updateScore', { points: 0 });
						ecs.eventBus.publish('updateLives', { lives: gameState.lives });
					},

					gameStart({ ecs }) {
						const gameState = ecs.getResource('gameState');
						gameState.status = 'playing';
						ecs.enableSystemGroup('gameplay');

						const movementState = ecs.getResource('enemyMovementState');
						movementState.isMovingDown = false;
						movementState.currentDirection = 'right';
						movementState.lastEdgeHit = null;

						spawnEnemyFormation(ecs);
						ecs.eventBus.publish('enemyMove', { direction: 'right' });
					},

					gamePause({ ecs }) {
						ecs.getResource('gameState').status = 'paused';
						ecs.disableSystemGroup('gameplay');
					},

					gameResume({ ecs }) {
						ecs.getResource('gameState').status = 'playing';
						ecs.enableSystemGroup('gameplay');
					},

					gameOver({ ecs }) {
						ecs.getResource('gameState').status = 'gameOver';
						ecs.disableSystemGroup('gameplay');
					},

					levelComplete({ ecs }) {
						ecs.getResource('gameState').level += 1;
						ecs.spawn({
							timers: {
								levelTransition: createTimer(1.5, {
									onComplete: ({ entityId }) => {
										ecs.eventBus.publish('levelTransitionComplete');
										ecs.commands.removeEntity(entityId);
									},
								}),
							},
						});
					},

					levelTransitionComplete({ ecs }) {
						const gameState = ecs.getResource('gameState');
						if (gameState.status !== 'playing') return;

						const movementState = ecs.getResource('enemyMovementState');
						movementState.isMovingDown = false;
						movementState.currentDirection = 'right';
						movementState.lastEdgeHit = null;

						spawnEnemyFormation(ecs);
						ecs.eventBus.publish('enemyMove', { direction: 'right' });
					},

					descentComplete({ ecs }) {
						const movementState = ecs.getResource('enemyMovementState');
						const enemies = ecs.getEntitiesWithQuery(['enemy', 'worldTransform']);

						let minX = Number.MAX_VALUE;
						for (const enemy of enemies) {
							minX = Math.min(minX, enemy.components.worldTransform.x);
						}

						movementState.isMovingDown = false;
						movementState.currentDirection = minX < 30 ? 'right' : 'left';
						ecs.eventBus.publish('enemyMove', { direction: movementState.currentDirection });
					},

					enemyMove({ data, ecs }) {
						const config = ecs.getResource('config');
						const gameState = ecs.getResource('gameState');
						const enemies = ecs.getEntitiesWithQuery(['enemy', 'velocity']);

						const speedMultiplier = 1.0 + (gameState.level - 1) * 0.2;
						const baseSpeed = config.enemySpeed * speedMultiplier;
						const velocityMultiplier = DIRECTION_VELOCITIES[data.direction];
						if (!velocityMultiplier) return;

						for (const enemy of enemies) {
							const { velocity } = enemy.components;
							velocity.x = velocityMultiplier.x * baseSpeed;
							velocity.y = velocityMultiplier.y * baseSpeed;
						}
					}
				});
			world.addSystem('enemy-controller')
				.inGroup('gameplay')
				.addQuery('enemies', { with: ['enemy', 'worldTransform'] })
				.withResources(['gameState', 'enemyMovementState', 'bounds', 'score'])
				.setProcess(({ queries: { enemies }, dt, ecs, resources: { gameState, enemyMovementState: movementState, bounds, score } }) => {
					if (enemies.length === 0) return;

					let minX = Number.MAX_VALUE;
					let maxX = Number.MIN_VALUE;
					let maxY = Number.MIN_VALUE;

					for (const enemy of enemies) {
						const { worldTransform } = enemy.components;
						minX = Math.min(minX, worldTransform.x);
						maxX = Math.max(maxX, worldTransform.x);
						maxY = Math.max(maxY, worldTransform.y);
					}

					// Game over if enemies reach bottom
					if (maxY > bounds.height - 100) {
						ecs.eventBus.publish('gameOver', { win: false, score: score.value });
						return;
					}

					// Check for edge hit and trigger descent
					const padding = 30;
					const currentEdge = minX < padding ? 'left' : maxX > bounds.width - padding ? 'right' : null;
					const shouldDescend = currentEdge !== null &&
						currentEdge !== movementState.lastEdgeHit &&
						!movementState.isMovingDown;

					if (shouldDescend) {
						movementState.lastEdgeHit = currentEdge;
						movementState.isMovingDown = true;
						ecs.eventBus.publish('enemyMove', { direction: 'down' });
						ecs.spawn({
							timers: {
								descent: createTimer(0.5, {
									onComplete: ({ entityId }) => {
										ecs.eventBus.publish('descentComplete');
										ecs.commands.removeEntity(entityId);
									},
								}),
							},
						});
					}

					// Random enemy shooting
					if (Math.random() < 0.02 * dt * gameState.level) {
						const randomIndex = Math.floor(Math.random() * enemies.length);
						const randomEnemy = enemies[randomIndex];
						if (randomEnemy) {
							ecs.eventBus.publish('enemyShoot', { enemyId: randomEnemy.id });
						}
					}
				});
			world.addSystem('player-input')
				.inGroup('gameplay')
				.inPhase('preUpdate')
				.withResources(['inputState', 'config'])
				.setProcessEach({ with: ['player', 'velocity'] }, ({ entity, resources: { inputState: input, config } }) => {
					entity.components.velocity.x = input.actions.isActive('moveLeft') ? -config.playerSpeed
						: input.actions.isActive('moveRight') ? config.playerSpeed
						: 0;
				});
		},
	});
}
