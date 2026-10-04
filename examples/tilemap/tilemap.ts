/**
 * Tilemap Example
 *
 * Demonstrates the `createTilemapPlugin` plugin:
 * - Runtime map registration via `tilemaps.registerRuntime`
 * - Tile metadata driving the `isSolid` / `isWalkable` query API
 * - Auto-generated collision strips opted in via `collisionLayer`
 *
 * The plugin is data-only — `renderer2D` does not consume the `tilemap` component,
 * so this example renders the map by spawning one Sprite per non-empty tile.
 * Sub-textures into the Kenney "Tiny Town" spritesheet are cached per GID.
 *
 * (`registerAsset` is the alternative ingestion path when loading a Tiled `.tmj` file.)
 */

import { TILE_SIZE, RENDER_SCALE, TILE_PX, MAP_W, MAP_H, MAP_PX_W, MAP_PX_H, TILESHEET_COLUMNS, VIEWPORT_W, VIEWPORT_H, PLAYER_SPEED, PLAYER_BOX, GID_GRASS, GID_GRASS_FLOWER, GID_PATH, GID_PINE_TREE, GID_AUTUMN_TREE, GID_FENCE, GID_STONE, MAP, decodeMap } from './map';
import { createTilePresentation } from './scene';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createLocalTransform,
	createTransform,
} from 'ecspresso/plugins/rendering/renderer2D';
import { createTilemapPlugin } from 'ecspresso/plugins/rendering/tilemap';
import {
	createCollisionPlugin,
	createAABBCollider,
	defineCollisionLayers,
} from 'ecspresso/plugins/physics/collision';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import { createCameraPlugin } from 'ecspresso/plugins/spatial/camera';

// ==================== ECS ====================

const collisionLayers = defineCollisionLayers({
	tilemap: ['player'],
	player: ['tilemap'],
});

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: 0x2e3c2d,
		width: VIEWPORT_W,
		height: VIEWPORT_H,
		camera: true,
		renderLayers: ['ground', 'decorations', 'entities'],
	}))
	.withPlugin(createCollisionPlugin({ layers: collisionLayers }))
	.withPlugin(createTilemapPlugin({
		collisionLayer: 'tilemap',
		collidesWith: ['player'],
	}))
	.withPlugin(createInputPlugin({
		actions: {
			moveUp: { keys: ['w', 'ArrowUp'] },
			moveDown: { keys: ['s', 'ArrowDown'] },
			moveLeft: { keys: ['a', 'ArrowLeft'] },
			moveRight: { keys: ['d', 'ArrowRight'] },
		},
	}))
	.withPlugin(createCameraPlugin({
		viewportWidth: VIEWPORT_W,
		viewportHeight: VIEWPORT_H,
		initial: { x: MAP_PX_W / 2, y: MAP_PX_H / 2 },
		follow: { smoothing: 6 },
		bounds: {
			minX: VIEWPORT_W / 2,
			minY: VIEWPORT_H / 2,
			maxX: MAP_PX_W - VIEWPORT_W / 2,
			maxY: MAP_PX_H - VIEWPORT_H / 2,
		},
	}))
	.withComponentTypes<{
		player: true;
		velocity: { x: number; y: number };
	}>()
	.withResourceTypes<{ tilePresentation: Awaited<ReturnType<typeof createTilePresentation>> }>()
	.build();

ecs.addResource('tilePresentation', {
	dependsOn: ['pixiApp'],
	factory: (world) => createTilePresentation(world.getResource('pixiApp').renderer),
	onDispose: (presentation) => presentation.dispose(),
});

await ecs.initialize();
const presentation = ecs.getResource('tilePresentation');

// ==================== Map Registration ====================

const { ground, decorations, spawnTx, spawnTy } = decodeMap(MAP);

const tilemaps = ecs.getResource('tilemaps');
tilemaps.registerRuntime('village', {
	width: MAP_W,
	height: MAP_H,
	tileSize: TILE_PX,
	layers: [
		{ name: 'ground', tiles: ground },
		{ name: 'decorations', tiles: decorations },
	],
	tilesets: [{
		textureKey: 'tiny-town',
		columns: TILESHEET_COLUMNS,
		tileWidth: TILE_SIZE,
		tileHeight: TILE_SIZE,
	}],
	tileMetadata: {
		[GID_GRASS]: { walkable: true },
		[GID_GRASS_FLOWER]: { walkable: true },
		[GID_PATH]: { walkable: true },
		[GID_FENCE]: { solid: true },
		[GID_PINE_TREE]: { solid: true },
		[GID_AUTUMN_TREE]: { solid: true },
		[GID_STONE]: { solid: true },
	},
});

const village = tilemaps.get('village');
if (!village) throw new Error('village map failed to register');

// ==================== Tile Sprites ====================

function spawnTileSprite(gid: number, tx: number, ty: number, layer: 'ground' | 'decorations'): void {
	const sprite = presentation.createTileSprite(gid);
	// Scale must come from the transform component — the renderer2D sync
	// system overwrites sprite.scale from worldTransform.scaleX/Y every frame.
	ecs.spawn({
		sprite,
		...createTransform(tx * TILE_PX, ty * TILE_PX, { scale: RENDER_SCALE }),
		renderLayer: layer,
	});
}

for (let ty = 0; ty < MAP_H; ty++) {
	for (let tx = 0; tx < MAP_W; tx++) {
		const idx = ty * MAP_W + tx;
		const g = ground[idx] ?? 0;
		if (g !== 0) spawnTileSprite(g, tx, ty, 'ground');
		const d = decorations[idx] ?? 0;
		if (d !== 0) spawnTileSprite(d, tx, ty, 'decorations');
	}
}

// ==================== Player ====================

const playerStartX = spawnTx * TILE_PX + TILE_PX / 2;
const playerStartY = spawnTy * TILE_PX + TILE_PX / 2;

const player = ecs.spawn({
	sprite: presentation.createPlayerSprite(),
	...createLocalTransform(playerStartX, playerStartY),
	renderLayer: 'entities',
	velocity: { x: 0, y: 0 },
	...createAABBCollider(PLAYER_BOX, PLAYER_BOX),
	...collisionLayers.player(),
	player: true as const,
});

ecs.getResource('cameraState').follow(player.id);

// ==================== Input → Velocity ====================

ecs.addSystem('player-input')
	.inPhase('preUpdate')
	.withResources(['inputState'])
	.setProcessEach({ with: ['player', 'velocity'], mutates: ['velocity'] }, ({ entity, resources: { inputState: input } }) => {
		const vx = (input.actions.isActive('moveRight') ? 1 : 0) - (input.actions.isActive('moveLeft') ? 1 : 0);
		const vy = (input.actions.isActive('moveDown') ? 1 : 0) - (input.actions.isActive('moveUp') ? 1 : 0);
		if (entity.components.velocity.x === vx * PLAYER_SPEED && entity.components.velocity.y === vy * PLAYER_SPEED) return false;
		entity.components.velocity.x = vx * PLAYER_SPEED;
		entity.components.velocity.y = vy * PLAYER_SPEED;
	});

// ==================== Movement + Tilemap Collision ====================

// Axis-separated sweep against the plugin's auto-generated collision strips.
// Iterating `tilemapCollider` entities (one per strip) is why the plugin
// merges contiguous solid runs at registration.
type WallQueryEntity = {
	components: {
		worldTransform: { x: number; y: number };
		aabbCollider: { width: number; height: number };
	};
};

function overlapsAnyStrip(px: number, py: number, pw: number, ph: number, walls: Iterable<WallQueryEntity>): boolean {
	const phx = pw / 2;
	const phy = ph / 2;
	for (const w of walls) {
		const { x, y } = w.components.worldTransform;
		const { width, height } = w.components.aabbCollider;
		if (Math.abs(px - x) < phx + width / 2 && Math.abs(py - y) < phy + height / 2) return true;
	}
	return false;
}

ecs.addSystem('player-move')
	.inPhase('update')
	.addQuery('player', { with: ['player', 'velocity', 'localTransform', 'aabbCollider'], mutates: ['localTransform'] })
	.addQuery('walls', { with: ['tilemapCollider', 'aabbCollider', 'worldTransform'] })
	.setProcess(({ queries, dt }) => {
		for (const p of queries.player) {
			const { velocity, localTransform, aabbCollider } = p.components;

			const nextX = localTransform.x + velocity.x * dt;
			if (!overlapsAnyStrip(nextX, localTransform.y, aabbCollider.width, aabbCollider.height, queries.walls)) {
				localTransform.x = nextX;
			}

			const nextY = localTransform.y + velocity.y * dt;
			if (!overlapsAnyStrip(localTransform.x, nextY, aabbCollider.width, aabbCollider.height, queries.walls)) {
				localTransform.y = nextY;
			}
		}
	});

// ==================== Info Overlay ====================

const coordsEl = document.getElementById('coords');

ecs.addSystem('info-overlay')
	.inPhase('render')
	.addSingleton('player', { with: ['player', 'worldTransform'] })
	.setProcess(({ queries }) => {
		if (!coordsEl) return;
		// A singleton query returns the first match or undefined; it does not enforce uniqueness.
		const p = queries.player;
		if (!p) return;

		const { x, y } = p.components.worldTransform;
		const { tx, ty } = village.worldToTile(x, y);
		const solid = village.isSolid(tx, ty);
		const walkable = village.isWalkable(tx, ty);

		coordsEl.textContent =
			`player   ${x.toFixed(0).padStart(5)}, ${y.toFixed(0).padStart(5)}\n` +
			`tile     ${String(tx).padStart(5)}, ${String(ty).padStart(5)}\n` +
			`solid    ${solid}\n` +
			`walkable ${walkable}`;
	});
