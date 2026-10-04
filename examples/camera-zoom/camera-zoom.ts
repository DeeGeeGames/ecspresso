import { createPointerTransform } from '../camera/pointer-coordinates';
import type { Application } from 'pixi.js';
/**
 * Camera Zoom Example
 *
 * Demonstrates:
 * - Cursor-centered zoom via mouse wheel
 * - Built-in camera panning with keyboard
 * - Camera bounds clamping to keep the view inside the world
 * - screenToWorld coordinate conversion showing zoom-aware mouse position
 * - Applying cameraState to the PixiJS rootContainer (renderer integration)
 */

import { createBeanGraphics, examplePalette } from '../brand';
import { Graphics, Container, Text, TextStyle } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createContainerComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import {
	createCameraPlugin,
	screenToWorld,
} from 'ecspresso/plugins/spatial/camera';

// ==================== Constants ====================

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 3000;
const PAN_SPEED = 400;
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;

// ==================== ECS Setup ====================

// Bind after initialization; pointer events arrive in CSS client coordinates.
const inputBinding: { app: Application | null } = { app: null };

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: examplePalette.background,
		startLoop: true,
		camera: true,
	}))
	.withPlugin(createInputPlugin({
		coordinateTransform: createPointerTransform(() => inputBinding.app),
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
		initial: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
		bounds: [0, 0, WORLD_WIDTH, WORLD_HEIGHT],
		zoom: { minZoom: .5, maxZoom: 3, zoomStep: 0.1 },
		pan: { speed: PAN_SPEED },
	}))
	.withComponentTypes<{
		scenery: true;
	}>()
	.build();

// ==================== Coordinate Display System ====================

const coordsEl = document.getElementById('coords');

ecs.addSystem('coord-display')
	.inPhase('render')
	.withResources(['cameraState', 'inputState'])
	.setProcess(({ resources: { cameraState: state, inputState: input } }) => {
		if (!coordsEl) return;

		const mouseWorld = screenToWorld(
			input.pointer.position.x,
			input.pointer.position.y,
			state,
		);

		coordsEl.textContent =
			`Camera: ${state.x.toFixed(0)}, ${state.y.toFixed(0)}\n` +
			`Mouse:  ${mouseWorld.x.toFixed(0)}, ${mouseWorld.y.toFixed(0)}\n` +
			`Zoom:   ${state.zoom.toFixed(2)}x`;
	});

// ==================== Initialization ====================

ecs.addSystem('init')
	.setOnInitialize((ecs) => {
		const rootContainer = ecs.getResource('rootContainer');

		const border = new Graphics();
		border.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
		border.stroke({ color: 0xc8956a, width: 2 });
		rootContainer.addChild(border);

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
		grid.stroke({ color: 0xecdcc8, width: 1 });
		rootContainer.addChild(grid);

		const sceneryData = [
			{ x: 300,  y: 200,  color: 0x9d683d, size: 30, label: 'Beans' },
			{ x: 800,  y: 400,  color: 0xc8956a, size: 40, label: 'Light roast' },
			{ x: 1500, y: 300,  color: 0xb85b3d, size: 25, label: 'Dark roast' },
			{ x: 400,  y: 1000, color: 0x9d683d, size: 35, label: 'Beans' },
			{ x: 1200, y: 800,  color: 0xc8956a, size: 45, label: 'Light roast' },
			{ x: 1700, y: 1200, color: 0xb85b3d, size: 20, label: 'Dark roast' },
			{ x: 600,  y: 700,  color: 0x9d683d, size: 28, label: 'Beans' },
			{ x: 1000, y: 1100, color: 0x6b4a33, size: 50, label: 'Roast batch' },
			{ x: 2500, y: 500,  color: 0x9d683d, size: 38, label: 'Beans' },
			{ x: 3200, y: 900,  color: 0xc8956a, size: 50, label: 'Light roast' },
			{ x: 3600, y: 200,  color: 0xb85b3d, size: 22, label: 'Dark roast' },
			{ x: 2800, y: 1600, color: 0x6b4a33, size: 55, label: 'Roast batch' },
			{ x: 3400, y: 2400, color: 0x9d683d, size: 32, label: 'Beans' },
			{ x: 500,  y: 2200, color: 0xc8956a, size: 42, label: 'Light roast' },
			{ x: 1800, y: 2600, color: 0xb85b3d, size: 28, label: 'Dark roast' },
			{ x: 2200, y: 2000, color: 0x9d683d, size: 40, label: 'Beans' },
			{ x: 3000, y: 2800, color: 0x6b4a33, size: 48, label: 'Roast batch' },
			{ x: 1000, y: 1800, color: 0xc8956a, size: 35, label: 'Light roast' },
		];

		for (const item of sceneryData) {
			const g = createBeanGraphics(item.size, item.color);

			const style = new TextStyle({ fontSize: 11, fill: 0x6b4a33, fontFamily: 'monospace' });
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
	});

// ==================== Start ====================

await ecs.initialize();
inputBinding.app = ecs.getResource('pixiApp');
