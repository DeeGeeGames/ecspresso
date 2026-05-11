import {
	Vector3
} from 'three';
import ECSpresso from '../../src';
import type { TimerComponentTypes } from '../../src/plugins/scripting/timers';
import type { Renderer3DComponentTypes, Renderer3DResourceTypes, Renderer3DEventTypes } from '../../src/plugins/rendering/renderer3D';
import {
	defineCollisionLayers,
	type Collision3DComponentTypes,
	type Collision3DEventTypes,
	type LayersOf,
} from '../../src/plugins/physics/collision3D';

export const collisionLayers = defineCollisionLayers({
	player: ['enemy'],
	enemy: ['player', 'projectile'],
	projectile: ['enemy'],
});

export type CollisionLayerName = LayersOf<typeof collisionLayers>;

export type TimerSlot = 'spawn' | 'hide' | 'destroy';

export const builder = ECSpresso.create()
	.withComponentTypes<
		TimerComponentTypes<TimerSlot> &
		Renderer3DComponentTypes &
		Collision3DComponentTypes<CollisionLayerName> &
		{
			// Timer tags
			enemySpawner: true;
			pendingDestroy: true;
			messageTimer: true;

			// 3D velocity and movement
			velocity: {
				x: number;
				y: number;
				z: number;
			};

			// Game object types
			player: {
				health: number;
				maxHealth: number;
				lastShotTime: number;
				fireRate: number; // shots per second
			};
			enemy: {
				type: 'ground' | 'air';
				health: number;
				speed: number;
				attackDamage: number;
				scoreValue: number;
				isDestroying?: boolean;
			};
			projectile: {
				owner: 'player';
				damage: number;
				speed: number;
			};

			// Additional components
			lifetime: {
				remaining: number;
			};
			radarBlip: {
				type: 'ground' | 'air';
				distance: number;
				angle: number;
			};
		}
	>()
	.withEventTypes<
		Renderer3DEventTypes &
		Collision3DEventTypes<CollisionLayerName> &
		{
			// Game state events
			gameInit: true;
			gameStart: true;
			gamePause: true;
			gameResume: true;
			gameOver: {
				win: boolean;
				score: number;
			};
			waveComplete: {
				wave: number;
			};

			// Input events
			inputMouseMove: {
				x: number;
				y: number;
			};
			inputMouseDown: {
				button: number;
			};
			inputMouseUp: {
				button: number;
			};
			inputKeyDown: {
				key: string;
			};
			inputKeyUp: {
				key: string;
			};

			// Gameplay events
			playerShoot: {
				direction: Vector3;
			};
			playerHit: {
				damage: number;
			};
			enemySpawn: {
				type: 'ground' | 'air';
				position: Vector3;
			};
			enemyDestroyed: {
				entityId: number;
				points: number;
			};
			entityDestroyed: {
				entityId: number;
			};

			// UI events
			updateScore: {
				points: number;
			};
			updateHealth: {
				health: number;
			};
			updateWave: {
				wave: number;
			};
		}
	>()
	.withResourceTypes<
		Renderer3DResourceTypes &
		{
			// Game state
			gameState: {
				status: 'ready' | 'playing' | 'paused' | 'gameOver';
				wave: number;
				score: number;
			};

			// Player input
			input: {
				mousePosition: {
					x: number;
					y: number;
				};
				mouseButtons: {
					left: boolean;
					right: boolean;
					middle: boolean;
				};
				keys: Record<string, boolean>;
			};

			// Game configuration
			config: {
				playerFireRate: number;
				playerProjectileSpeed: number;
				playerProjectileDamage: number;
				maxEnemies: number;
				enemySpawnRate: number; // enemies per second
				waveCount: number;
				enemiesPerWave: number;
			};

			// Game assets
			assets: {
				models: Record<string, import('three').Object3D>;
				textures: Record<string, unknown>;
			};

			// Wave management
			waveManager: {
				currentWave: number;
				enemiesRemaining: number;
				waveStartTime: number;
			};

			// UI elements
			uiElements: {
				scoreElement: HTMLElement | null;
				healthElement: HTMLElement | null;
				waveElement: HTMLElement | null;
				messageElement: HTMLElement | null;
				radarElement: HTMLElement | null;
			};

			// Radar system
			radar: {
				range: number;
				updateFrequency: number;
				lastUpdateTime: number;
			};

			// Player initial rotation (for enemy spawn direction)
			playerInitialRotation: {
				y: number;
			};

			// Event listeners (for cleanup)
			eventListeners: {
				mousemove: (event: MouseEvent) => void;
				mousedown: (event: MouseEvent) => void;
				mouseup: (event: MouseEvent) => void;
				keydown: (event: KeyboardEvent) => void;
				keyup: (event: KeyboardEvent) => void;
				contextmenu: (event: MouseEvent) => void;
			};
		}
	>();

export const definePlugin = builder.pluginFactory();

export type World = ReturnType<typeof builder.build>;
