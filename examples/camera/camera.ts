/**
 * Camera Follow Example
 *
 * Demonstrates:
 * - Camera following a player entity with smooth tracking and deadzone
 * - Trauma-based screen shake triggered by spacebar
 * - Camera bounds clamping to keep the view inside the world
 * - worldToScreen / screenToWorld coordinate conversion
 * - Applying cameraState to the PixiJS rootContainer (renderer integration)
 */

import { Graphics, Container, Text, TextStyle } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createGraphicsComponents,
	createContainerComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import {
	createPhysics2DPlugin,
	createRigidBody,
} from 'ecspresso/plugins/physics/physics2D';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import {
	createCameraPlugin,
	screenToWorld,
} from 'ecspresso/plugins/spatial/camera';

// ==================== Constants ====================

const WORLD_WIDTH = 2000;
const WORLD_HEIGHT = 1500;
const PLAYER_SPEED = 250;
const PLAYER_SIZE = 16;
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;

// ==================== ECS Setup ====================

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: 0x1a1a2e,
		startLoop: true,
		camera: true,
	}))
	.withPlugin(createPhysics2DPlugin())
	.withPlugin(createInputPlugin({
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
		initial: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
		follow: { smoothing: 4, deadzoneX: 40, deadzoneY: 30 },
		shake: { traumaDecay: 1.5, maxOffsetX: 12, maxOffsetY: 12, maxRotation: 0.03 },
		bounds: [0, 0, WORLD_WIDTH, WORLD_HEIGHT],
	}))
	.withComponentTypes<{
		player: true;
		scenery: true;
	}>()
	.build();

// ==================== Player Input System ====================

ecs.addSystem('player-input')
	.inPhase('preUpdate')
	.addQuery('players', { with: ['player', 'velocity'] })
	.withResources(['inputState'])
	.setProcess(({ queries, resources: { inputState: input } }) => {
		for (const entity of queries.players) {
			const { velocity } = entity.components;
			velocity.x = 0;
			velocity.y = 0;
			if (input.actions.isActive('moveUp'))    velocity.y = -PLAYER_SPEED;
			if (input.actions.isActive('moveDown'))   velocity.y = PLAYER_SPEED;
			if (input.actions.isActive('moveLeft'))   velocity.x = -PLAYER_SPEED;
			if (input.actions.isActive('moveRight'))  velocity.x = PLAYER_SPEED;
		}
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
	.addQuery('players', { with: ['player', 'worldTransform'] })
	.withResources(['cameraState', 'inputState'])
	.setProcess(({ queries, resources: { cameraState: state, inputState: input } }) => {
		const el = document.getElementById('coords');
		if (!el) return;

		const first = queries.players[0];
		if (!first) return;

		const { worldTransform } = first.components;
		const mouseWorld = screenToWorld(
			input.pointer.position.x,
			input.pointer.position.y,
			state,
		);

		el.textContent =
			`Player: ${worldTransform.x.toFixed(0)}, ${worldTransform.y.toFixed(0)}\n` +
			`Mouse:  ${mouseWorld.x.toFixed(0)}, ${mouseWorld.y.toFixed(0)}`;
	});

// ==================== Initialization ====================

ecs.addSystem('init')
	.setOnInitialize((ecs) => {
		const rootContainer = ecs.getResource('rootContainer');

		// -- World border --
		const border = new Graphics();
		border.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
		border.stroke({ color: 0x334455, width: 2 });
		rootContainer.addChild(border);

		// -- Grid lines --
		const grid = new Graphics();
		const gridSpacing = 200;
		for (let x = gridSpacing; x < WORLD_WIDTH; x += gridSpacing) {
			grid.moveTo(x, 0);
			grid.lineTo(x, WORLD_HEIGHT);
		}
		for (let y = gridSpacing; y < WORLD_HEIGHT; y += gridSpacing) {
			grid.moveTo(0, y);
			grid.lineTo(WORLD_WIDTH, y);
		}
		grid.stroke({ color: 0x222233, width: 1 });
		rootContainer.addChild(grid);

		// -- Scattered scenery --
		const sceneryData = [
			{ x: 300, y: 200, color: 0x44aa44, size: 30, label: 'Tree' },
			{ x: 800, y: 400, color: 0x8888cc, size: 40, label: 'Rock' },
			{ x: 1500, y: 300, color: 0xcc6644, size: 25, label: 'Bush' },
			{ x: 400, y: 1000, color: 0x44aa44, size: 35, label: 'Tree' },
			{ x: 1200, y: 800, color: 0x8888cc, size: 45, label: 'Rock' },
			{ x: 1700, y: 1200, color: 0xcc6644, size: 20, label: 'Bush' },
			{ x: 600, y: 700, color: 0x44aa44, size: 28, label: 'Tree' },
			{ x: 1000, y: 1100, color: 0x44ccaa, size: 50, label: 'Pond' },
		];

		for (const item of sceneryData) {
			const g = new Graphics();
			g.circle(0, 0, item.size);
			g.fill({ color: item.color, alpha: 0.6 });

			const style = new TextStyle({ fontSize: 11, fill: 0x888888, fontFamily: 'monospace' });
			const label = new Text({ text: item.label, style });
			label.anchor.set(0.5);
			label.position.set(0, item.size + 10);

			const container = new Container();
			container.addChild(g, label);

			ecs.spawn({
				...createContainerComponents(container, { x: item.x, y: item.y }),
				scenery: true,
			});
		}

		// -- Player --
		const playerGraphics = new Graphics();
		playerGraphics.roundRect(-PLAYER_SIZE, -PLAYER_SIZE, PLAYER_SIZE * 2, PLAYER_SIZE * 2, 4);
		playerGraphics.fill(0x44bbee);
		// Direction indicator
		playerGraphics.moveTo(PLAYER_SIZE, 0);
		playerGraphics.lineTo(PLAYER_SIZE + 6, 0);
		playerGraphics.stroke({ color: 0x88ddff, width: 2 });

		const player = ecs.spawn({
			...createGraphicsComponents(playerGraphics, {
				x: WORLD_WIDTH / 2,
				y: WORLD_HEIGHT / 2,
			}),
			...createRigidBody('kinematic'),
			velocity: { x: 0, y: 0 },
			player: true,
		});

		// -- Follow the player --
		const cameraState = ecs.getResource('cameraState');
		cameraState.follow(player);
	});

// ==================== Start ====================

await ecs.initialize();
