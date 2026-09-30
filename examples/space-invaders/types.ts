import type { Container, Text } from 'pixi.js';

export type TimerSlot = 'levelTransition' | 'descent' | 'respawn';

export interface AppComponents {
	player: boolean;
	enemy: { type: 'grunt' | 'elite' | 'boss'; points: number; health: number };
	projectile: { owner: 'player' | 'enemy'; damage: number };
}

export interface AppEvents {
	gameInit: true;
	gameStart: true;
	gamePause: true;
	gameResume: true;
	gameOver: { win: boolean; score: number };
	levelComplete: { level: number };
	playerShoot: {};
	playerDeath: {};
	enemyShoot: { enemyId: number };
	enemyMove: { direction: 'left' | 'right' | 'down' };
	playerRespawn: void;
	messageHide: void;
	levelTransitionComplete: void;
	descentComplete: void;
	updateScore: { points: number };
	updateLives: { lives: number };
}

export interface AppResources {
	uiContainer: Container;
	gameState: {
		status: 'ready' | 'playing' | 'paused' | 'gameOver';
		level: number;
		lives: number;
		playerDeathPending: boolean;
	};
	config: {
		playerSpeed: number;
		enemySpeed: number;
		projectileSpeed: number;
		enemiesPerRow: number;
		enemyRows: number;
		shootCooldown: number;
	};
	score: { value: number };
	enemyMovementState: {
		isMovingDown: boolean;
		currentDirection: 'left' | 'right';
		lastEdgeHit: 'left' | 'right' | null;
	};
	uiElements: {
		scoreText: Text;
		livesText: Text;
		messageText: Text;
	};
	uiState: {
		messageHideRemaining: number;
	};
}
