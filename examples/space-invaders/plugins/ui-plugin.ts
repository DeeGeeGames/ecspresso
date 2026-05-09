import { Container, Text, TextStyle } from 'pixi.js';
import { createTimer } from '../../../src/plugins/scripting/timers';
import { definePlugin } from '../types';

export default function createUIPlugin() {
	return definePlugin({
		id: 'ui-plugin',
		install(world) {
			world.addSystem('ui-manager')
				.setOnInitialize((ecs) => {
					const rootContainer = ecs.getResource('rootContainer');
					const bounds = ecs.getResource('bounds');

					// Create UI container (renders above game layer, inside viewport scaling)
					const uiContainer = new Container();
					rootContainer.addChild(uiContainer);
					ecs.addResource('uiContainer', uiContainer);

					const scoreText = new Text({
						x: 0,
						y: 0,
						text: 'Score: 0',
						style: new TextStyle({
							fontFamily: 'Arial',
							fontSize: 24,
							fontWeight: 'bold',
							fill: '#FFFFFF',
						}),
					});

					const livesText = new Text({
						x: bounds.width - 120,
						y: 20,
						text: 'Lives: 3',
						style: new TextStyle({
							fontFamily: 'Arial',
							fontSize: 24,
							fontWeight: 'bold',
							fill: '#00FF00',
						}),
					});

					const messageText = new Text({
						text: 'SPACE INVADERS',
						style: new TextStyle({
							fontFamily: 'Arial',
							fontSize: 36,
							fontWeight: 'bold',
							fill: '#FFFFFF',
						})
					});
					messageText.x = (bounds.width - messageText.width) / 2;
					messageText.y = bounds.height / 2 - 50;

					// Add texts to the UI container
					uiContainer.addChild(scoreText);
					uiContainer.addChild(livesText);
					uiContainer.addChild(messageText);

					// Store UI elements in resources
					ecs.addResource('uiElements', {
						scoreText,
						livesText,
						messageText
					});
				})
				.setEventHandlers({
					// Update score display
					updateScore({ data, ecs }) {
						const uiElements = ecs.getResource('uiElements');
						uiElements.scoreText.text = `Score: ${data.points}`;
					},

					// Update lives display
					updateLives({ data, ecs }) {
						const uiElements = ecs.getResource('uiElements');
						uiElements.livesText.text = `Lives: ${data.lives}`;
					},

					// Handle game state changes
					gameInit({ ecs }) {
						const uiElements = ecs.getResource('uiElements');
						const bounds = ecs.getResource('bounds');

						uiElements.messageText.text = 'PRESS P TO START';
						uiElements.messageText.x = (bounds.width - uiElements.messageText.width) / 2;
						uiElements.messageText.y = bounds.height / 2 - 50;
						uiElements.messageText.visible = true;
					},

					gameStart({ ecs }) {
						const uiElements = ecs.getResource('uiElements');
						uiElements.messageText.visible = false;
					},

					gamePause({ ecs }) {
						const uiElements = ecs.getResource('uiElements');
						const bounds = ecs.getResource('bounds');

						uiElements.messageText.text = 'PAUSED';
						uiElements.messageText.x = (bounds.width - uiElements.messageText.width) / 2;
						uiElements.messageText.y = bounds.height / 2 - 50;
						uiElements.messageText.visible = true;
					},

					gameResume({ ecs }) {
						const uiElements = ecs.getResource('uiElements');
						uiElements.messageText.visible = false;
					},

					gameOver({ data, ecs }) {
						const uiElements = ecs.getResource('uiElements');
						const bounds = ecs.getResource('bounds');

						uiElements.messageText.text = data.win
							? `YOU WIN!\nFINAL SCORE: ${data.score}`
							: `GAME OVER\nFINAL SCORE: ${data.score}`;

						uiElements.messageText.x = (bounds.width - uiElements.messageText.width) / 2;
						uiElements.messageText.y = bounds.height / 2 - 50;
						uiElements.messageText.visible = true;
					},

					levelComplete({ data, ecs }) {
						const uiElements = ecs.getResource('uiElements');
						const bounds = ecs.getResource('bounds');

						uiElements.messageText.text = `LEVEL ${data.level} COMPLETE!`;
						uiElements.messageText.x = (bounds.width - uiElements.messageText.width) / 2;
						uiElements.messageText.y = bounds.height / 2 - 50;
						uiElements.messageText.visible = true;

						// Spawn timer to hide message after delay with event-based completion
						ecs.spawn({
							timers: {
									hide: createTimer(1.5, {
										onComplete: ({ entityId }) => {
											ecs.eventBus.publish('messageHide');
											ecs.commands.removeEntity(entityId);
										},
									}),
								},
						});
					},

					messageHide({ ecs }) {
						const gameState = ecs.getResource('gameState');
						if (gameState.status === 'playing') {
							const uiElements = ecs.getResource('uiElements');
							uiElements.messageText.visible = false;
						}
					}
				});
		},
	});
}
