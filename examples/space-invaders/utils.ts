import { Graphics, Sprite } from 'pixi.js';
import { createLocalTransform } from 'ecspresso/plugins/rendering/renderer2D';
import { createRigidBody } from 'ecspresso/plugins/physics/physics2D';
import { createAABBCollider } from 'ecspresso/plugins/physics/collision';
import { createClampToBounds } from 'ecspresso/plugins/spatial/bounds';
import collisionLayers from './collision-layers';
import type { Game } from './game';

/**
 * Spawns an enemy formation based on the current level
 */
export function spawnEnemyFormation(ecs: Game): void {
	const config = ecs.getResource('config');
	const gameState = ecs.getResource('gameState');
	const bounds = ecs.getResource('bounds');

	const enemiesPerRow = config.enemiesPerRow;
	const rows = config.enemyRows;
	const spacing = 60;
	const startX = (bounds.width - (enemiesPerRow - 1) * spacing) / 2;
	const startY = 80;

	const enemyConfigs: Record<
		'boss' | 'elite' | 'grunt',
		{ points: number; health: number; color: number }
	> = {
		boss: { points: 100 * gameState.level, health: 3, color: 0xFF0000 },
		elite: { points: 50 * gameState.level, health: 2, color: 0xFF00FF },
		grunt: { points: 20 * gameState.level, health: 1, color: 0xFFAA00 },
	};

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < enemiesPerRow; col++) {
			const enemyType: 'boss' | 'elite' | 'grunt' = row === 0 ? 'boss' : row < 2 ? 'elite' : 'grunt';
			const { points, health, color } = enemyConfigs[enemyType];

			const enemySprite = createEnemySprite(ecs, enemyType, color);

			ecs.spawn({
				enemy: { type: enemyType, points, health },
				sprite: enemySprite,
				...createLocalTransform(startX + col * spacing, startY + row * spacing),
				...createRigidBody('kinematic'),
				velocity: { x: config.enemySpeed, y: 0 },
				...createAABBCollider(enemySprite.width, enemySprite.height),
				...collisionLayers.enemy(),
				renderLayer: 'game',
			});
		}
	}
}

type EnemyType = 'grunt' | 'elite' | 'boss';

const enemyDrawers: Record<
	EnemyType,
	(graphics: Graphics, color: number) => void
> = {
	boss: (graphics, color) => {
		graphics
			.rect(-20, -20, 40, 40)
			.rect(-25, -10, 50, 20)
			.fill(color)
			.circle(-10, -5, 5)
			.circle(10, -5, 5)
			.fill(0xFFFFFF);
	},
	elite: (graphics, color) => {
		graphics
			.rect(-15, -15, 30, 30)
			.fill(color)
			.circle(-5, -5, 3)
			.circle(5, -5, 3)
			.fill(0xFFFFFF);
	},
	grunt: (graphics, color) => {
		graphics.rect(-10, -10, 20, 20).fill(color);
	},
};

export function createEnemySprite(
	ecs: Game,
	type: EnemyType,
	color: number,
): Sprite {
	const pixi = ecs.getResource('pixiApp');
	const graphics = new Graphics();
	enemyDrawers[type](graphics, color);

	const texture = pixi.renderer.generateTexture(graphics);
	const sprite = new Sprite(texture);
	sprite.anchor.set(0.5, 0.5);
	return sprite;
}

export function createPlayerSprite(ecs: Game): Sprite {
	const pixi = ecs.getResource('pixiApp');
	const graphics = new Graphics()
		.rect(-20, -10, 40, 20)
		.moveTo(-10, -10)
		.lineTo(10, -10)
		.lineTo(0, -25)
		.lineTo(-10, -10)
		.fill(0x00FF00);

	const texture = pixi.renderer.generateTexture(graphics);
	const sprite = new Sprite(texture);
	sprite.anchor.set(0.5, 0.5);
	return sprite;
}

export function createProjectileSprite(
	ecs: Game,
	owner: 'player' | 'enemy',
): Sprite {
	const pixi = ecs.getResource('pixiApp');
	const graphics = new Graphics()
		.rect(-2, -8, 4, 16)
		.fill(owner === 'player' ? 0x00FFFF : 0xFF0000);

	const texture = pixi.renderer.generateTexture(graphics);
	const sprite = new Sprite(texture);
	sprite.anchor.set(0.5, 0.5);
	return sprite;
}

export function spawnPlayer(ecs: Game): number {
	const bounds = ecs.getResource('bounds');
	const playerSprite = createPlayerSprite(ecs);

	const player = ecs.spawn({
		sprite: playerSprite,
		...createLocalTransform(bounds.width / 2, bounds.height - 80),
		player: true,
		...createRigidBody('kinematic'),
		velocity: { x: 0, y: 0 },
		...createAABBCollider(playerSprite.width, playerSprite.height),
		...collisionLayers.player(),
		...createClampToBounds(30),
		renderLayer: 'game',
	});

	return player.id;
}
