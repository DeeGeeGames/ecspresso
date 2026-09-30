import { createLocalTransform } from 'ecspresso/plugins/rendering/renderer2D';
import { createRigidBody } from 'ecspresso/plugins/physics/physics2D';
import { createAABBCollider } from 'ecspresso/plugins/physics/collision';
import { createDestroyOutOfBounds } from 'ecspresso/plugins/spatial/bounds';
import type { Game } from '../game';
import { createProjectileSprite, spawnPlayer } from '../utils';
import collisionLayers from '../collision-layers';

type ProjectileOwner = 'player' | 'enemy';

const PROJECTILE_CONFIG = {
	player: {
		yOffset: -20,
		yVelocity: -400,
		layer: collisionLayers.playerProjectile,
	},
	enemy: {
		yOffset: 20,
		yVelocity: 400,
		layer: collisionLayers.enemyProjectile,
	},
} as const;

function spawnProjectile(ecs: Game, owner: ProjectileOwner, x: number, y: number): void {
	const projectileConfig = PROJECTILE_CONFIG[owner];
	const projectileSprite = createProjectileSprite(ecs, owner);

	ecs.spawn({
		sprite: projectileSprite,
		...createLocalTransform(x, y + projectileConfig.yOffset),
		...createRigidBody('kinematic'),
		velocity: { x: 0, y: projectileConfig.yVelocity },
		projectile: { owner, damage: 1 },
		...createAABBCollider(
			projectileSprite.width,
			projectileSprite.height,
		),
		...projectileConfig.layer(),
		...createDestroyOutOfBounds(20),
		renderLayer: 'game',
	});
}

/**
 * Handles entity spawning in response to game events.
 */
export default function registerSpawner(world: Game): void {
	world.addSystem('entity-spawner')
		.setEventHandlers({
			gameInit({ ecs }) {
				spawnPlayer(ecs);
			},

			playerShoot({ ecs }) {
				const [player] = ecs.getEntitiesWithQuery(['player', 'worldTransform']);
				if (!player) return;

				spawnProjectile(
					ecs,
					'player',
					player.components.worldTransform.x,
					player.components.worldTransform.y,
				);
			},

			enemyShoot({ data, ecs }) {
				const worldTransform = ecs.getComponent(data.enemyId, 'worldTransform');
				if (!worldTransform) return;

				spawnProjectile(ecs, 'enemy', worldTransform.x, worldTransform.y);
			},

			playerRespawn({ ecs }) {
				const gameState = ecs.getResource('gameState');
				if (gameState.status === 'playing') {
					spawnPlayer(ecs);
				}
			},
		});
}
