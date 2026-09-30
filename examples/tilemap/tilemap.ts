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

import { Assets, Graphics, Rectangle, RenderTexture, Sprite, Texture } from 'pixi.js';
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

// ==================== Constants ====================

const TILE_SIZE = 16;
const RENDER_SCALE = 2;
const TILE_PX = TILE_SIZE * RENDER_SCALE;

const MAP_W = 24;
const MAP_H = 16;
const MAP_PX_W = MAP_W * TILE_PX;
const MAP_PX_H = MAP_H * TILE_PX;

const TILESHEET_COLUMNS = 12;

const VIEWPORT_W = 800;
const VIEWPORT_H = 600;

const PLAYER_SPEED = 180;
const PLAYER_BOX = Math.floor(TILE_PX * 0.7);

// GIDs into Kenney Tiny Town `tilemap_packed.png` (12 cols × 11 rows, 16×16 tiles).
// GID 0 is empty; GID = tile-index + 1.
const GID_GRASS = 1;
const GID_GRASS_FLOWER = 3;
const GID_PATH = 26;
const GID_PINE_TREE = 4;
const GID_AUTUMN_TREE = 9;
const GID_FENCE = 43;
const GID_STONE = 42;

// 24×16 procedural map. Char legend:
//   `.` grass      `,` grass+flower   `p` path
//   `#` fence      `T` pine tree      `t` autumn tree
//   `S` player spawn (rendered as grass)
const MAP: readonly string[] = [
	'########################',
	'#.......T..............#',
	'#..,...................#',
	'#......ppppppppp.......#',
	'#......p.......p..T....#',
	'#..T...p...S...p.......#',
	'#......p.......p.......#',
	'#......ppppppppp.......#',
	'#.....,................#',
	'#........T.............#',
	'#.............t........#',
	'#...#####..............#',
	'#...#...#.......t......#',
	'#...#####..............#',
	'#...................T..#',
	'########################',
];

// ==================== Map Decode ====================

interface DecodedMap {
	ground: Uint32Array;
	decorations: Uint32Array;
	spawnTx: number;
	spawnTy: number;
}

const groundOverride: Record<string, number> = {
	',': GID_GRASS_FLOWER,
	'p': GID_PATH,
};

const decorGidFor: Record<string, number> = {
	'#': GID_FENCE,
	'T': GID_PINE_TREE,
	't': GID_AUTUMN_TREE,
};

function decodeMap(rows: readonly string[]): DecodedMap {
	const ground = new Uint32Array(MAP_W * MAP_H);
	const decorations = new Uint32Array(MAP_W * MAP_H);
	const spawn = { tx: Math.floor(MAP_W / 2), ty: Math.floor(MAP_H / 2) };

	rows.forEach((row, ty) => {
		Array.from(row).forEach((ch, tx) => {
			const idx = ty * MAP_W + tx;
			ground[idx] = groundOverride[ch] ?? GID_GRASS;
			const decor = decorGidFor[ch];
			if (decor !== undefined) decorations[idx] = decor;
			if (ch === 'S') {
				spawn.tx = tx;
				spawn.ty = ty;
			}
		});
	});

	return { ground, decorations, spawnTx: spawn.tx, spawnTy: spawn.ty };
}

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
	.build();

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');

// ==================== Tile Texture Atlas ====================

const tilesheet: Texture = await Assets.load('./assets/tilemap_packed.png');
tilesheet.source.scaleMode = 'nearest';

// Each tile is extracted into a dedicated RenderTexture. Using a sub-texture
// frame on the shared atlas lets GPU filtering sample adjacent tiles at the
// seam, producing visible 1-px bleed between neighbors; dedicated textures
// have no neighbors to bleed from.
const tileTextures = new Map<number, Texture>();

function tileTexture(gid: number): Texture {
	const cached = tileTextures.get(gid);
	if (cached) return cached;

	const id = gid - 1;
	const sx = (id % TILESHEET_COLUMNS) * TILE_SIZE;
	const sy = Math.floor(id / TILESHEET_COLUMNS) * TILE_SIZE;

	const slice = new Sprite(new Texture({
		source: tilesheet.source,
		frame: new Rectangle(sx, sy, TILE_SIZE, TILE_SIZE),
	}));
	const rt = RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE });
	rt.source.scaleMode = 'nearest';
	pixiApp.renderer.render({ container: slice, target: rt });
	slice.destroy();

	tileTextures.set(gid, rt);
	return rt;
}

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
	const sprite = new Sprite(tileTexture(gid));
	sprite.anchor.set(0, 0);
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

function createPlayerSprite(): Sprite {
	const gfx = new Graphics()
		.rect(0, 0, PLAYER_BOX, PLAYER_BOX)
		.fill(0xff4466)
		.stroke({ color: 0xffe0e0, width: 2 });
	const tex = pixiApp.renderer.generateTexture(gfx);
	gfx.destroy();
	const s = new Sprite(tex);
	s.anchor.set(0.5, 0.5);
	return s;
}

const playerStartX = spawnTx * TILE_PX + TILE_PX / 2;
const playerStartY = spawnTy * TILE_PX + TILE_PX / 2;

const player = ecs.spawn({
	sprite: createPlayerSprite(),
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
	.setProcessEach({ with: ['player', 'velocity'] }, ({ entity, resources: { inputState: input } }) => {
		const vx = (input.actions.isActive('moveRight') ? 1 : 0) - (input.actions.isActive('moveLeft') ? 1 : 0);
		const vy = (input.actions.isActive('moveDown') ? 1 : 0) - (input.actions.isActive('moveUp') ? 1 : 0);
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
	.addQuery('player', { with: ['player', 'velocity', 'localTransform', 'aabbCollider'] })
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
	.addQuery('player', { with: ['player', 'worldTransform'] })
	.setProcess(({ queries }) => {
		if (!coordsEl) return;
		const p = queries.player[0];
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
