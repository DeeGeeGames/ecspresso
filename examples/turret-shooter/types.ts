import { Vector3, type Object3D } from 'three';
import ECSpresso, { type SystemRegistrarOf } from 'ecspresso';
import {
	createCollision3DPlugin,
	defineCollisionLayers,
	type LayersOf,
} from 'ecspresso/plugins/physics/collision3D';
import { createRenderer3DPlugin } from 'ecspresso/plugins/rendering/renderer3D';
import { createTimerPlugin } from 'ecspresso/plugins/scripting/timers';
import { createSpatialIndex3DPlugin } from 'ecspresso/plugins/spatial/spatial-index3D';

export const collisionLayers = defineCollisionLayers({
	player: ['enemy'],
	enemy: ['player', 'projectile'],
	projectile: ['enemy'],
});

export type CollisionLayerName = LayersOf<typeof collisionLayers>;
export type TimerSlot = 'spawn' | 'hide' | 'destroy';

interface GameComponents {
	enemySpawner: true;
	pendingDestroy: true;
	messageTimer: true;
	velocity: {
		x: number;
		y: number;
		z: number;
	};
	player: {
		health: number;
		maxHealth: number;
		lastShotTime: number;
		fireRate: number;
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
	lifetime: {
		remaining: number;
	};
	radarBlip: {
		type: 'ground' | 'air';
		distance: number;
		angle: number;
	};
}

interface GameEvents {
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

interface GameResources {
	gameState: {
		status: 'ready' | 'playing' | 'paused' | 'gameOver';
		wave: number;
		score: number;
	};
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
	config: {
		playerFireRate: number;
		playerProjectileSpeed: number;
		playerProjectileDamage: number;
		maxEnemies: number;
		enemySpawnRate: number;
		waveCount: number;
		enemiesPerWave: number;
	};
	assets: {
		models: Record<string, Object3D>;
		textures: Record<string, unknown>;
	};
	waveManager: {
		currentWave: number;
		enemiesRemaining: number;
		waveStartTime: number;
	};
	uiElements: {
		scoreElement: HTMLElement | null;
		healthElement: HTMLElement | null;
		waveElement: HTMLElement | null;
		messageElement: HTMLElement | null;
		radarElement: HTMLElement | null;
	};
	radar: {
		range: number;
		updateFrequency: number;
		lastUpdateTime: number;
	};
	playerInitialRotation: {
		y: number;
	};
	eventListeners: {
		mousemove: (event: MouseEvent) => void;
		mousedown: (event: MouseEvent) => void;
		mouseup: (event: MouseEvent) => void;
		keydown: (event: KeyboardEvent) => void;
		keyup: (event: KeyboardEvent) => void;
		contextmenu: (event: MouseEvent) => void;
	};
}

export function createGame() {
	return ECSpresso.create()
		.withPlugin(createRenderer3DPlugin({
			container: '#game-container',
			width: window.innerWidth,
			height: window.innerHeight,
			antialias: true,
			shadows: true,
			startLoop: false,
			cameraOptions: {
				fov: 75,
				near: 0.1,
				far: 1000,
				position: { x: 0, y: 5, z: 0 },
				lookAt: { x: 0, y: 5, z: -10 },
			},
		}))
		.withPlugin(createTimerPlugin<TimerSlot>())
		.withPlugin(createSpatialIndex3DPlugin())
		.withPlugin(createCollision3DPlugin({ layers: collisionLayers }))
		.withComponentTypes<GameComponents>()
		.withEventTypes<GameEvents>()
		.withResourceTypes<GameResources>()
		.build();
}

export type World = ReturnType<typeof createGame>;
export type GameSystemRegistrar = SystemRegistrarOf<World>;
