import { Container, Text, TextStyle } from 'pixi.js';
import type { Game } from '../game';

interface MessageBounds {
	width: number;
	height: number;
}

function showMessage(messageText: Text, bounds: MessageBounds, text: string): void {
	messageText.text = text;
	messageText.x = (bounds.width - messageText.width) / 2;
	messageText.y = bounds.height / 2 - 50;
	messageText.visible = true;
}

export default function registerUI(world: Game): void {
	world.addSystem('ui-message-timer')
		.withResources(['uiState'])
		.setProcess(({ dt, ecs, resources: { uiState } }) => {
			if (uiState.messageHideRemaining <= 0) return;
			uiState.messageHideRemaining = Math.max(0, uiState.messageHideRemaining - dt);
			if (uiState.messageHideRemaining === 0) ecs.eventBus.publish('messageHide');
		});

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
				}),
			});
			showMessage(messageText, bounds, 'SPACE INVADERS');

			// Add texts to the UI container
			uiContainer.addChild(scoreText);
			uiContainer.addChild(livesText);
			uiContainer.addChild(messageText);

			// Store UI elements in resources
			ecs.addResource('uiElements', {
				scoreText,
				livesText,
				messageText,
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
				ecs.getResource('uiState').messageHideRemaining = 0;
				const uiElements = ecs.getResource('uiElements');
				const bounds = ecs.getResource('bounds');

				showMessage(uiElements.messageText, bounds, 'PRESS P TO START');
			},

			gameStart({ ecs }) {
				ecs.getResource('uiState').messageHideRemaining = 0;
				const uiElements = ecs.getResource('uiElements');
				uiElements.messageText.visible = false;
			},

			gamePause({ ecs }) {
				const uiElements = ecs.getResource('uiElements');
				const bounds = ecs.getResource('bounds');

				showMessage(uiElements.messageText, bounds, 'PAUSED');
			},

			gameResume({ ecs }) {
				ecs.getResource('uiState').messageHideRemaining = 0;
				const uiElements = ecs.getResource('uiElements');
				uiElements.messageText.visible = false;
			},

			gameOver({ data, ecs }) {
				ecs.getResource('uiState').messageHideRemaining = 0;
				const uiElements = ecs.getResource('uiElements');
				const bounds = ecs.getResource('bounds');
				const message = data.win ? `YOU WIN!\nFINAL SCORE: ${data.score}` : `GAME OVER\nFINAL SCORE: ${data.score}`;

				showMessage(uiElements.messageText, bounds, message);
			},

			levelComplete({ data, ecs }) {
				const uiElements = ecs.getResource('uiElements');
				const bounds = ecs.getResource('bounds');

				showMessage(uiElements.messageText, bounds, `LEVEL ${data.level} COMPLETE!`);
				ecs.getResource('uiState').messageHideRemaining = 1.5;
			},

			messageHide({ ecs }) {
				const gameState = ecs.getResource('gameState');
				if (gameState.status === 'playing') {
					const uiElements = ecs.getResource('uiElements');
					uiElements.messageText.visible = false;
				}
			},
		});
}
