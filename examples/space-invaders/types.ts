import { Container, Text } from 'pixi.js';
import ECSpresso from '../../src';
import type { TimerComponentTypes } from '../../src/plugins/scripting/timers';
import type { TransformComponentTypes } from '../../src/plugins/spatial/transform';
import type { Physics2DComponentTypes } from '../../src/plugins/physics/physics2D';
import type { BoundsComponentTypes } from '../../src/plugins/spatial/bounds';
import type { CollisionComponentTypes, CollisionEventTypes, LayersOf } from '../../src/plugins/physics/collision';
import type collisionLayers from './collision-layers';
import type { Renderer2DComponentTypes, Renderer2DResourceTypes } from '../../src/plugins/rendering/renderer2D';
import type { InputResourceTypes } from '../../src/plugins/input/input';

type Layer = LayersOf<typeof collisionLayers>;

export type TimerSlot = 'levelTransition' | 'descent' | 'respawn' | 'hide';

export const builder = ECSpresso.create()
	.withComponentTypes<
		TimerComponentTypes<TimerSlot> &
		TransformComponentTypes &
		Physics2DComponentTypes<Layer> &
		BoundsComponentTypes &
		CollisionComponentTypes<Layer> &
		Renderer2DComponentTypes &
		{
			player: boolean;
			enemy: { type: 'grunt' | 'elite' | 'boss'; points: number; health: number };
			projectile: { owner: 'player' | 'enemy'; damage: number };
		}
	>()
	.withEventTypes<
		CollisionEventTypes<Layer> &
		{
			// Game state
			gameInit: true;
			gameStart: true;
			gamePause: true;
			gameResume: true;
			gameOver: { win: boolean; score: number };
			levelComplete: { level: number };

			// Gameplay
			playerShoot: {};
			playerDeath: {};
			enemyShoot: { enemyId: number };
			enemyMove: { direction: 'left' | 'right' | 'down' };

			// Timer completions
			playerRespawn: void;
			messageHide: void;
			levelTransitionComplete: void;
			descentComplete: void;

			// UI
			updateScore: { points: number };
			updateLives: { lives: number };
		}
	>()
	.withResourceTypes<
		Renderer2DResourceTypes &
		InputResourceTypes &
		{
			uiContainer: Container;

			gameState: {
				status: 'ready' | 'playing' | 'paused' | 'gameOver';
				level: number;
				lives: number;
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
		}
	>();

export const definePlugin = builder.pluginFactory();

export type World = ReturnType<typeof builder.build>;
