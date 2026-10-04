import { createPointerTransform } from '../camera/pointer-coordinates';
import type { Application } from 'pixi.js';
/**
 * Isometric Example
 *
 * Demonstrates:
 * - Isometric projection of a tile grid (diamond pattern)
 * - Player movement in Cartesian world space, projected to isometric screen coords
 * - Depth sorting so entities overlap correctly
 * - Camera following the player through the isometric projection
 * - screenToIsoWorld coordinate conversion
 * - Trauma-based screen shake triggered by spacebar
 */

import { Graphics } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createGraphicsComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import {
	createPhysics2DPlugin,
	createRigidBody,
} from 'ecspresso/plugins/physics/physics2D';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import {
	createCameraPlugin,
} from 'ecspresso/plugins/spatial/camera';
import {
	createIsoProjectionPlugin,
	screenToIsoWorld,
} from 'ecspresso/plugins/isometric/projection';
import { createIsoDepthSortPlugin } from 'ecspresso/plugins/isometric/depth-sort';

// ==================== Constants ====================

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const GRID_SIZE = 10;
const PLAYER_SPEED = 3;
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;

const TILE_COLOR_A = 0x3a7d44;
const TILE_COLOR_B = 0x2d6a36;
const PLAYER_COLOR = 0x44bbee;

// ==================== ECS Setup ====================

// Bind after initialization; pointer events arrive in CSS client coordinates.
const inputBinding: { app: Application | null } = { app: null };

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: 0x1a1a2e,
		startLoop: true,
		camera: false,
	}))
	.withPlugin(createPhysics2DPlugin())
	.withPlugin(createInputPlugin({
		coordinateTransform: createPointerTransform(() => inputBinding.app, true),
		actions: {
			moveUp:    { keys: ['w', 'ArrowUp'] },
			moveDown:  { keys: ['s', 'ArrowDown'] },
			moveLeft:  { keys: ['a', 'ArrowLeft'] },
			moveRight: { keys: ['d', 'ArrowRight'] },
			shake:     { keys: [' '] },
		},
	}))
	.withPlugin(createCameraPlugin({
		viewportWidth: VIEWPORT_WIDTH,
		viewportHeight: VIEWPORT_HEIGHT,
		initial: { x: GRID_SIZE / 2, y: GRID_SIZE / 2 },
		follow: { smoothing: 4 },
		shake: { traumaDecay: 1.5, maxOffsetX: 12, maxOffsetY: 12, maxRotation: 0.03 },
	}))
	.withPlugin(createIsoProjectionPlugin({
		tileWidth: TILE_WIDTH,
		tileHeight: TILE_HEIGHT,
		camera: true,
	}))
	.withPlugin(createIsoDepthSortPlugin())
	.withComponentTypes<{
		player: true;
		tile: true;
	}>()
	.build();

// Iso projection owns the renderer camera transform; keep camera algorithms
// informed of the actual viewport even though renderer2D camera mode is disabled.
ecs.addSystem('camera-viewport')
	.inPhase('preUpdate')
	.withResources(['cameraState', 'pixiApp'])
	.setProcess(({ resources: { cameraState, pixiApp } }) => {
		cameraState.viewportWidth = pixiApp.screen.width;
		cameraState.viewportHeight = pixiApp.screen.height;
	});

// ==================== Player Input System ====================

ecs.addSystem('player-input')
	.inPhase('preUpdate')
	.withResources(['inputState'])
	.setProcessEach({ with: ['player', 'velocity'], mutates: ['velocity'] }, ({ entity, resources: { inputState: input } }) => {
		const { velocity } = entity.components;
		velocity.x = 0;
		velocity.y = 0;
		if (input.actions.isActive('moveUp'))    velocity.y = -PLAYER_SPEED;
		if (input.actions.isActive('moveDown'))   velocity.y = PLAYER_SPEED;
		if (input.actions.isActive('moveLeft'))   velocity.x = -PLAYER_SPEED;
		if (input.actions.isActive('moveRight'))  velocity.x = PLAYER_SPEED;
	});

// ==================== Shake Trigger System ====================

ecs.addSystem('shake-trigger')
	.inPhase('preUpdate')
	.withResources(['inputState', 'cameraState'])
	.setProcess(({ resources: { inputState: input, cameraState } }) => {
		if (input.actions.justActivated('shake')) {
			cameraState.addTrauma(0.6);
		}
	});

// ==================== Coordinate Display System ====================

ecs.addSystem('coord-display')
	.inPhase('render')
	.addSingleton('player', { with: ['player', 'worldTransform'] })
	.withResources(['cameraState', 'inputState', 'isoProjection', 'pixiApp'])
	.setProcess(({ queries, resources: { cameraState, inputState: input, isoProjection: iso, pixiApp } }) => {
		const el = document.getElementById('coords');
		if (!el) return;

		const first = queries.player;
		if (!first) return;

		const { worldTransform } = first.components;

		const mouseWorld = screenToIsoWorld(
			input.pointer.position.x,
			input.pointer.position.y,
			cameraState,
			iso,
			pixiApp.canvas,
		);

		el.textContent =
			`Player: ${worldTransform.x.toFixed(1)}, ${worldTransform.y.toFixed(1)}\n` +
			`Mouse:  ${mouseWorld.x.toFixed(1)}, ${mouseWorld.y.toFixed(1)}`;
	});

// ==================== Tile Drawing Helper ====================

function createTileDiamond(color: number): Graphics {
	const g = new Graphics();
	g.moveTo(0, -TILE_HEIGHT / 2);
	g.lineTo(TILE_WIDTH / 2, 0);
	g.lineTo(0, TILE_HEIGHT / 2);
	g.lineTo(-TILE_WIDTH / 2, 0);
	g.closePath();
	g.fill({ color, alpha: 0.8 });
	g.stroke({ color: 0x224422, width: 1 });
	return g;
}

function createPlayerDiamond(): Graphics {
	const size = 0.4;
	const g = new Graphics();
	g.moveTo(0, -TILE_HEIGHT * size);
	g.lineTo(TILE_WIDTH * size, 0);
	g.lineTo(0, TILE_HEIGHT * size);
	g.lineTo(-TILE_WIDTH * size, 0);
	g.closePath();
	g.fill(PLAYER_COLOR);
	g.stroke({ color: 0x88ddff, width: 1 });
	return g;
}

// ==================== Initialization ====================

ecs.addSystem('init')
	.setOnInitialize((ecs) => {
		// -- Tile grid --
		for (let gx = 0; gx < GRID_SIZE; gx++) {
			for (let gy = 0; gy < GRID_SIZE; gy++) {
				const color = (gx + gy) % 2 === 0 ? TILE_COLOR_A : TILE_COLOR_B;
				ecs.spawn({
					...createGraphicsComponents(createTileDiamond(color), { x: gx, y: gy }),
					tile: true,
					depthOffset: -1000,
				});
			}
		}

		// -- Player --
		const player = ecs.spawn({
			...createGraphicsComponents(createPlayerDiamond(), {
				x: GRID_SIZE / 2,
				y: GRID_SIZE / 2,
			}),
			...createRigidBody('kinematic'),
			velocity: { x: 0, y: 0 },
			player: true,
			depthOffset: 0.5,
		});

		// -- Camera follow --
		const cameraState = ecs.getResource('cameraState');
		cameraState.follow(player);
	});

// ==================== Start ====================

await ecs.initialize();
inputBinding.app = ecs.getResource('pixiApp');
