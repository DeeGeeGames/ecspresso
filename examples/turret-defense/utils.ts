import { Graphics, Sprite, type Texture } from 'pixi.js';
import { createLocalTransform } from '../../src/plugins/rendering/renderer2D';
import { createCircleCollider } from '../../src/plugins/physics/collision';
import { createMoveTarget, createMoveSpeed } from '../../src/plugins/physics/steering';
import { createDetector } from '../../src/plugins/ai/detection';
import { createHealth } from '../../src/plugins/combat/health';
import { createProjectile, createProjectileTarget } from '../../src/plugins/combat/projectile';
import { createRepeatingTimer } from '../../src/plugins/scripting/timers';
import { createDestroyOutOfBounds } from '../../src/plugins/spatial/bounds';
import collisionLayers from './collision-layers';
import { CENTER_X, CENTER_Y, type World } from './types';

// ==================== Texture Cache ====================

const textureCache = new Map<string, Texture>();

function getCachedTexture(ecs: World, key: string, draw: (g: Graphics) => void): Texture {
	const cached = textureCache.get(key);
	if (cached) return cached;

	const pixi = ecs.getResource('pixiApp');
	const graphics = new Graphics();
	draw(graphics);
	const texture = pixi.renderer.generateTexture(graphics);
	textureCache.set(key, texture);
	return texture;
}

function spriteFromCache(ecs: World, key: string, draw: (g: Graphics) => void): Sprite {
	const texture = getCachedTexture(ecs, key, draw);
	const sprite = new Sprite(texture);
	sprite.anchor.set(0.5, 0.5);
	return sprite;
}

// ==================== Sprite Factories ====================

export function createTurretSprite(ecs: World): Sprite {
	return spriteFromCache(ecs, 'turret', (g) => {
		g.circle(0, 0, 20).fill(0x4488FF)
			.rect(-3, -30, 6, 20).fill(0x88BBFF);
	});
}

export function createBaseSprite(ecs: World): Sprite {
	return spriteFromCache(ecs, 'base', (g) => {
		g.circle(0, 0, 30).fill({ color: 0x2244AA, alpha: 0.4 })
			.circle(0, 0, 30).stroke({ color: 0x4488FF, width: 2 });
	});
}

export type EnemyType = 'fast' | 'tank' | 'swarm';

const enemyColors: Record<EnemyType, number> = {
	fast: 0xFF4444,
	tank: 0xFF8800,
	swarm: 0xFFCC00,
};

const enemySizes: Record<EnemyType, number> = {
	fast: 8,
	tank: 16,
	swarm: 6,
};

export function createEnemySprite(ecs: World, type: EnemyType): Sprite {
	return spriteFromCache(ecs, `enemy-${type}`, (g) => {
		g.circle(0, 0, enemySizes[type]).fill(enemyColors[type]);
	});
}

export function createProjectileSprite(ecs: World): Sprite {
	return spriteFromCache(ecs, 'projectile', (g) => {
		g.circle(0, 0, 3).fill(0x00FFFF);
	});
}

export function createRangeIndicator(ecs: World, range: number): Sprite {
	return spriteFromCache(ecs, `range-${range}`, (g) => {
		g.circle(0, 0, range).stroke({ color: 0x4488FF, width: 1, alpha: 0.2 });
	});
}

// ==================== Spawn Helpers ====================

const DETECTION_RANGE = 350;

export function spawnTurret(ecs: World): number {
	const turretSprite = createTurretSprite(ecs);

	const turret = ecs.spawn({
		turret: true as const,
		sprite: turretSprite,
		...createLocalTransform(CENTER_X, CENTER_Y),
		...createDetector(DETECTION_RANGE, ['enemy']),
		timers: { fire: createRepeatingTimer(0.4) },
		renderLayer: 'turret',
	});

	// Range indicator as child
	const rangeSprite = createRangeIndicator(ecs, DETECTION_RANGE);
	ecs.spawnChild(turret.id, {
		sprite: rangeSprite,
		...createLocalTransform(0, 0),
		renderLayer: 'background',
	});

	return turret.id;
}

export function spawnBase(ecs: World): number {
	const baseSprite = createBaseSprite(ecs);

	const base = ecs.spawn({
		base: true as const,
		sprite: baseSprite,
		...createLocalTransform(CENTER_X, CENTER_Y),
		...createHealth(100),
		renderLayer: 'background',
	});

	return base.id;
}

interface EnemyConfig {
	health: number;
	speed: number;
	scoreValue: number;
}

const enemyConfigs: Record<EnemyType, EnemyConfig> = {
	fast: { health: 2, speed: 120, scoreValue: 15 },
	tank: { health: 8, speed: 40, scoreValue: 30 },
	swarm: { health: 1, speed: 80, scoreValue: 5 },
};

export function spawnEnemy(ecs: World, type: EnemyType): number {
	const config = enemyConfigs[type];
	const angle = Math.random() * Math.PI * 2;
	const spawnRadius = 450;
	const x = CENTER_X + Math.cos(angle) * spawnRadius;
	const y = CENTER_Y + Math.sin(angle) * spawnRadius;

	const sprite = createEnemySprite(ecs, type);

	const entity = ecs.spawn({
		enemy: { type, speed: config.speed, scoreValue: config.scoreValue },
		sprite,
		...createLocalTransform(x, y),
		...createHealth(config.health),
		...createMoveTarget(CENTER_X, CENTER_Y),
		...createMoveSpeed(config.speed),
		...createCircleCollider(enemySizes[type]),
		...collisionLayers.enemy(),
		renderLayer: 'enemies',
	});

	return entity.id;
}

export function spawnProjectileAt(
	ecs: World,
	fromX: number,
	fromY: number,
	targetId: number,
	sourceId: number,
): number {
	const sprite = createProjectileSprite(ecs);

	const entity = ecs.spawn({
		sprite,
		...createLocalTransform(fromX, fromY),
		...createProjectile(1, 500, sourceId),
		...createProjectileTarget(targetId),
		...createCircleCollider(4),
		...collisionLayers.turretProjectile(),
		...createDestroyOutOfBounds(50),
		renderLayer: 'projectiles',
	});

	return entity.id;
}
