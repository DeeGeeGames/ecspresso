import { createTimer, createRepeatingTimer } from '../../../src/plugins/scripting/timers';
import { definePlugin } from '../types';
import { updateUI } from '../utils';

export default function createGameStatePlugin() {
	return definePlugin({
		id: 'game-state-plugin',
		install(world) {
			// Game state system
			world.addSystem('game-state')
				.setEventHandlers({
					gameStart({ ecs }) {
						// Update game state to playing
						const gameState = ecs.getResource('gameState');
						gameState.status = 'playing';

						// Enable gameplay systems
						ecs.enableSystemGroup('gameplay');

						// Get player's initial rotation
						const playerEntities = ecs.entityManager.getEntitiesWithQuery(['player', 'localTransform3D']);
						if (playerEntities.length > 0) {
							const playerEntity = playerEntities[0];
							if (playerEntity) {
								ecs.addResource('playerInitialRotation', {
									y: playerEntity.components.localTransform3D.ry
								});
							}
						}

						// Initialize first wave
						const waveManager = ecs.getResource('waveManager');
						const config = ecs.getResource('config');
						waveManager.currentWave = 1;
						waveManager.enemiesRemaining = config.enemiesPerWave;
						waveManager.waveStartTime = performance.now() / 1000;

						// Spawn enemy spawner entity with repeating timer
						const spawnInterval = 1 / config.enemySpawnRate;
						ecs.spawn({
							timers: { spawn: createRepeatingTimer(spawnInterval) },
							enemySpawner: true,
						});

						// Show wave start message and create timer to hide it
						const uiElements = ecs.getResource('uiElements');
						if (uiElements.messageElement) {
							uiElements.messageElement.innerText = `WAVE ${waveManager.currentWave}`;
							uiElements.messageElement.style.opacity = '1';
							uiElements.messageElement.style.top = '25%';
							ecs.spawn({
								timers: { hide: createTimer(2) },
								messageTimer: true,
							});
						}

						// Update UI
						ecs.eventBus.publish('updateWave', { wave: waveManager.currentWave });
					},
					gamePause({ ecs }) {
						// Pause the game
						const gameState = ecs.getResource('gameState');
						gameState.status = 'paused';

						// Disable gameplay systems
						ecs.disableSystemGroup('gameplay');

						// Explicitly pause radar sweep
						const radarSweep = document.getElementById('radar-sweep') as HTMLDivElement;
						if (radarSweep) {
							radarSweep.style.animationPlayState = 'paused';
						}

						// Show pause message
						const uiElements = ecs.getResource('uiElements');
						if (uiElements.messageElement) {
							uiElements.messageElement.innerText = 'PAUSED';
							uiElements.messageElement.style.opacity = '1';
							// Position the message higher on the screen (between middle and top)
							uiElements.messageElement.style.top = '25%';
						}
					},
					gameResume({ ecs }) {
						// Resume the game
						const gameState = ecs.getResource('gameState');
						gameState.status = 'playing';

						// Enable gameplay systems
						ecs.enableSystemGroup('gameplay');

						// Explicitly resume radar sweep
						const radarSweep = document.getElementById('radar-sweep') as HTMLDivElement;
						if (radarSweep) {
							radarSweep.style.animationPlayState = 'running';
						}

						// Hide pause message
						const uiElements = ecs.getResource('uiElements');
						if (uiElements.messageElement) {
							uiElements.messageElement.style.opacity = '0';
							// Don't reset position as all messages should be at 25%
						}
					},
					playerHit({ data, ecs }) {
						// Get player
						const playerEntities = ecs.entityManager.getEntitiesWithQuery(['player']);
						if (playerEntities.length === 0) return;

						const playerEntity = playerEntities[0];
						if (!playerEntity) return;

						const player = playerEntity.components.player;

						// Reduce player health
						player.health -= data.damage;
						if (player.health < 0) player.health = 0;

						// Update health display
						ecs.eventBus.publish('updateHealth', {
							health: player.health
						});

						// Check if player is dead
						if (player.health <= 0) {
							// Game over
							ecs.eventBus.publish('gameOver', {
								win: false,
								score: ecs.getResource('gameState').score
							});
						}
					},
					updateScore({ data, ecs }) {
						// Update score
						const gameState = ecs.getResource('gameState');
						gameState.score += data.points;

						// Update UI
						updateUI(ecs);
					},
					updateHealth({ ecs }) {
						// Update UI
						updateUI(ecs);
					},
					updateWave({ ecs }) {
						// Update UI
						updateUI(ecs);
					},
					waveComplete({ ecs }) {
						const waveManager = ecs.getResource('waveManager');
						const config = ecs.getResource('config');

						// Check if all waves are complete
						if (waveManager.currentWave >= config.waveCount) {
							// Game completed
							ecs.eventBus.publish('gameOver', {
								win: true,
								score: ecs.getResource('gameState').score
							});
							return;
						}

						// Start next wave
						waveManager.currentWave++;
						waveManager.enemiesRemaining = config.enemiesPerWave * waveManager.currentWave;
						waveManager.waveStartTime = performance.now() / 1000;

						// Show wave start message and create timer to hide it
						const uiElements = ecs.getResource('uiElements');
						if (uiElements.messageElement) {
							uiElements.messageElement.innerText = `WAVE ${waveManager.currentWave}`;
							uiElements.messageElement.style.opacity = '1';
							uiElements.messageElement.style.top = '25%';
							ecs.spawn({
								timers: { hide: createTimer(2) },
								messageTimer: true,
							});
						}

						// Update UI
						ecs.eventBus.publish('updateWave', { wave: waveManager.currentWave });
					},
					gameOver({ data, ecs }) {
						// Update game state
						const gameState = ecs.getResource('gameState');
						gameState.status = 'gameOver';

						// Disable gameplay systems
						ecs.disableSystemGroup('gameplay');

						// Pause radar sweep
						const radarSweep = document.getElementById('radar-sweep') as HTMLDivElement;
						if (radarSweep) {
							radarSweep.style.animationPlayState = 'paused';
						}

						// Show game over message
						const uiElements = ecs.getResource('uiElements');
						if (uiElements.messageElement) {
							uiElements.messageElement.innerText = data.win
								? `YOU WIN!\nFinal Score: ${data.score}`
								: `GAME OVER\nFinal Score: ${data.score}`;
							uiElements.messageElement.style.opacity = '1';
							uiElements.messageElement.style.top = '25%';
							uiElements.messageElement.style.whiteSpace = 'pre';
						}
					},
					enemyDestroyed({ data, ecs }) {
						const entity = ecs.entityManager.getEntity(data.entityId);
						if (!entity) return;

						// Visual effects and destruction timing only —
						// score/wave tracking is handled by gameplay-plugin's collision system
						if (entity.components.enemy) {
							entity.components.enemy.isDestroying = true;

							if (entity.components.localTransform3D) {
								entity.components.localTransform3D.sx = 1.5;
								entity.components.localTransform3D.sy = 1.5;
								entity.components.localTransform3D.sz = 1.5;
							}

							// Enemies reaching the player already have pendingDestroy from ai-plugin
							if (!entity.components.pendingDestroy) {
								ecs.addComponent(data.entityId, 'timers', { destroy: createTimer(0.2) });
								ecs.addComponent(data.entityId, 'pendingDestroy', true);
							}
						}
					}
				});
				// Message timer system - hides messages after their timer finishes
				world.addSystem('message-timer')
				.withResources(['uiElements'])
				.setProcessEach({ with: ['timers', 'messageTimer'] }, ({ entity, ecs, resources: { uiElements } }) => {
					if (entity.components.timers['hide']?.justFinished) {
						// Hide the message
						if (uiElements.messageElement) {
							uiElements.messageElement.style.opacity = '0';
						}

						// Remove the timer entity
						ecs.removeEntity(entity.id);
					}
				});
		},
	});
}
