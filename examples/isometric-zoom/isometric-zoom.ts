/**
 * Isometric Zoom Example
 *
 * Demonstrates:
 * - Isometric projection of a tile grid (diamond pattern)
 * - Cursor-centered zoom via mouse wheel (iso-aware, built into camera plugin)
 * - Built-in camera panning with keyboard
 * - Depth sorting so entities overlap correctly
 * - screenToIsoWorld coordinate conversion with zoom
 */

import { Graphics } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createGraphicsComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import { createCameraPlugin } from 'ecspresso/plugins/spatial/camera';
import {
	createIsoProjectionPlugin,
	screenToIsoWorld,
} from 'ecspresso/plugins/isometric/projection';
import { createIsoDepthSortPlugin } from 'ecspresso/plugins/isometric/depth-sort';

// ==================== Constants ====================

const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const GRID_SIZE = 16;
const PAN_SPEED = 5;
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;

const TILE_COLOR_A = 0x3a7d44;
const TILE_COLOR_B = 0x2d6a36;

// ==================== ECS Setup ====================

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: 0x1a1a2e,
		startLoop: true,
		camera: false,
	}))
	.withPlugin(createInputPlugin({
		actions: {
			panUp:    { keys: ['w', 'ArrowUp'] },
			panDown:  { keys: ['s', 'ArrowDown'] },
			panLeft:  { keys: ['a', 'ArrowLeft'] },
			panRight: { keys: ['d', 'ArrowRight'] },
		},
	}))
	.withPlugin(createCameraPlugin({
		viewportWidth: VIEWPORT_WIDTH,
		viewportHeight: VIEWPORT_HEIGHT,
		initial: { x: GRID_SIZE / 2, y: GRID_SIZE / 2 },
		zoom: { minZoom: 0.5, maxZoom: 3, zoomStep: 0.1 },
		pan: { speed: PAN_SPEED },
	}))
	.withPlugin(createIsoProjectionPlugin({
		tileWidth: TILE_WIDTH,
		tileHeight: TILE_HEIGHT,
		camera: true,
	}))
	.withPlugin(createIsoDepthSortPlugin())
	.withComponentTypes<{
		tile: true;
		scenery: true;
	}>()
	.build();

// ==================== Coordinate Display System ====================

const coordsEl = document.getElementById('coords');

ecs.addSystem('coord-display')
	.inPhase('render')
	.withResources(['cameraState', 'inputState', 'isoProjection', 'pixiApp'])
	.setProcess(({ resources: { cameraState, inputState: input, isoProjection: iso, pixiApp } }) => {
		if (!coordsEl) return;

		const mouseWorld = screenToIsoWorld(
			input.pointer.position.x,
			input.pointer.position.y,
			cameraState,
			iso,
			pixiApp.canvas,
		);

		coordsEl.textContent =
			`Camera: ${cameraState.x.toFixed(1)}, ${cameraState.y.toFixed(1)}\n` +
			`Mouse:  ${mouseWorld.x.toFixed(1)}, ${mouseWorld.y.toFixed(1)}\n` +
			`Zoom:   ${cameraState.zoom.toFixed(2)}x`;
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

// ==================== Scenery Drawing Helpers ====================

function createTree(size: number): Graphics {
	const g = new Graphics();
	g.circle(0, -size * 0.4, size * 0.6);
	g.fill({ color: 0x44aa44, alpha: 0.7 });
	g.rect(-size * 0.1, -size * 0.1, size * 0.2, size * 0.4);
	g.fill({ color: 0x886644, alpha: 0.8 });
	return g;
}

function createRock(size: number): Graphics {
	const g = new Graphics();
	g.ellipse(0, 0, size * 0.5, size * 0.35);
	g.fill({ color: 0x8888cc, alpha: 0.6 });
	return g;
}

function createBush(size: number): Graphics {
	const g = new Graphics();
	g.circle(-size * 0.2, 0, size * 0.35);
	g.circle(size * 0.2, 0, size * 0.3);
	g.circle(0, -size * 0.15, size * 0.3);
	g.fill({ color: 0x55bb55, alpha: 0.65 });
	return g;
}

function createPond(size: number): Graphics {
	const g = new Graphics();
	g.ellipse(0, 0, size * 0.6, size * 0.35);
	g.fill({ color: 0x44ccaa, alpha: 0.5 });
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

		// -- Scattered scenery --
		const sceneryData = [
			{ x: 2,    y: 1,    create: createTree, size: 18 },
			{ x: 5,    y: 3,    create: createRock, size: 22 },
			{ x: 10,   y: 2,    create: createBush, size: 16 },
			{ x: 3,    y: 7,    create: createTree, size: 20 },
			{ x: 8,    y: 5,    create: createRock, size: 26 },
			{ x: 12,   y: 8,    create: createBush, size: 14 },
			{ x: 4,    y: 4,    create: createTree, size: 16 },
			{ x: 7,    y: 7,    create: createPond, size: 28 },
			{ x: 14,   y: 3,    create: createTree, size: 22 },
			{ x: 11,   y: 6,    create: createRock, size: 28 },
			{ x: 13,   y: 1,    create: createBush, size: 15 },
			{ x: 9,    y: 11,   create: createPond, size: 30 },
			{ x: 14,   y: 14,   create: createTree, size: 18 },
			{ x: 2,    y: 13,   create: createRock, size: 24 },
			{ x: 6,    y: 12,   create: createBush, size: 17 },
			{ x: 10,   y: 10,   create: createTree, size: 22 },
			{ x: 13,   y: 12,   create: createPond, size: 26 },
			{ x: 5,    y: 9,    create: createRock, size: 20 },
			{ x: 1,    y: 5,    create: createTree, size: 15 },
			{ x: 15,   y: 7,    create: createBush, size: 19 },
			{ x: 7,    y: 14,   create: createTree, size: 21 },
			{ x: 12,   y: 4,    create: createRock, size: 18 },
		];

		for (const item of sceneryData) {
			ecs.spawn({
				...createGraphicsComponents(item.create(item.size), { x: item.x, y: item.y }),
				scenery: true,
				depthOffset: 0.5,
			});
		}
	});

// ==================== Start ====================

await ecs.initialize();
