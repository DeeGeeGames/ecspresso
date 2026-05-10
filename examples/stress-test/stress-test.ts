import { Graphics, Sprite } from 'pixi.js';
import ECSpresso from "../../src";
import {
	createRenderer2DPlugin,
	createSpriteComponents,
	clientToLogical,
	type ViewportScale,
} from "../../src/plugins/rendering/renderer2D";
import {
	createPhysics2DPlugin,
	createRigidBody,
} from "../../src/plugins/physics/physics2D";
import {
	defineCollisionLayers,
	createCircleCollider,
} from "../../src/plugins/physics/collision";
import { createSpatialIndexPlugin } from "../../src/plugins/spatial/spatial-index";
import {
	createDiagnosticsPlugin,
	createDiagnosticsOverlay,
} from "../../src/plugins/debug/diagnostics";
import { createCameraPlugin, screenToWorld } from 'ecspresso/plugins/spatial/camera';
import { createInputPlugin } from 'ecspresso/plugins/input/input';

// -- Constants --

const SCREEN_W = 1920;
const SCREEN_H = 1080;
const WORLD_W = SCREEN_W * 4;
const WORLD_H = SCREEN_H * 4;
const BALL_RADIUS = 3;
const SPAWN_RATE = 5; // balls per frame while held
const COLORS = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0xa29bfe, 0xfd79a8, 0x00cec9, 0xe17055];

// -- Collision layers --

const layers = defineCollisionLayers({
	ball: ['ball'],
});

// -- ECS setup --

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: '#1a1a2e',
		camera: true,
		screenScale: {
			width: SCREEN_W,
			height: SCREEN_H,
			mode: 'fit',
		}
	}))
	// Broadphase acceleration. Physics2D collision runs in fixedUpdate only,
	// so only register the rebuild there (default would also rebuild in postUpdate).
	.withPlugin(createSpatialIndexPlugin({ cellSize: 64, phases: ['fixedUpdate'] }))
	.withPlugin(createPhysics2DPlugin({ collisionSystemGroup: 'collision', layers }))
	.withPlugin(createDiagnosticsPlugin())
	.withPlugin(createInputPlugin({
		actions: {
			panUp:    { keys: ['w', 'ArrowUp'] },
			panDown:  { keys: ['s', 'ArrowDown'] },
			panLeft:  { keys: ['a', 'ArrowLeft'] },
			panRight: { keys: ['d', 'ArrowRight'] },
		},
	}))
	.withPlugin(createCameraPlugin({
		viewportWidth: SCREEN_W,
		viewportHeight: SCREEN_H,
		initial: { x: SCREEN_W, y: SCREEN_H },
		bounds: [0, 0, WORLD_W, WORLD_H],
		pan: { speed: 5 },
		zoom: {
			minZoom: .5,
			maxZoom: 2,
			zoomStep: .1,
		}
	}))
	.withComponentTypes<{ radius: number; color: number }>()
	.build();

// Bounce system
ecs
	.addSystem('bounce')
	.inPhase('postUpdate')
	.setProcessEach({ with: ['localTransform', 'velocity', 'radius'] }, ({ entity }) => {
		const { localTransform, velocity, radius } = entity.components;

		if (localTransform.x < radius) {
			localTransform.x = radius;
			velocity.x = Math.abs(velocity.x);
		} else if (localTransform.x > WORLD_W - radius) {
			localTransform.x = WORLD_W - radius;
			velocity.x = -Math.abs(velocity.x);
		}

		if (localTransform.y < radius) {
			localTransform.y = radius;
			velocity.y = Math.abs(velocity.y);
		} else if (localTransform.y > WORLD_H - radius) {
			localTransform.y = WORLD_H - radius;
			velocity.y = -Math.abs(velocity.y);
		}
	});

// Continuous spawning system — reads pointer state each frame
const pointerState = { down: false, x: 0, y: 0 };

ecs
	.addSystem('continuous-spawn')
	.inPhase('preUpdate')
	.withResources(['cameraState'])
	.setProcess(({resources: { cameraState }}) => {
		if (!pointerState.down) return;
		const world = screenToWorld(
			pointerState.x + (Math.random() - 0.5) * 40,
			pointerState.y + (Math.random() - 0.5) * 40,
			cameraState,
		)
		for (let i = 0; i < SPAWN_RATE; i++) {
			spawnBall(world.x, world.y);
		}
	});

// Initialize
await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');
const viewport: ViewportScale = ecs.getResource('viewportScale');

// Pre-generate one texture per color so PixiJS can batch sprites sharing the same texture
const ballTextures = COLORS.map(color =>
	pixiApp.renderer.generateTexture(
		new Graphics().circle(0, 0, BALL_RADIUS).fill(color),
	),
);

// -- Ball spawning --

function spawnBall(x: number, y: number) {
	const colorIndex = Math.floor(Math.random() * COLORS.length);
	const color = COLORS[colorIndex]!;
	const sprite = new Sprite(ballTextures[colorIndex]);

	ecs.spawn({
		...createSpriteComponents(sprite, { x, y }, { anchor: { x: 0.5, y: 0.5 } }),
		...createRigidBody('dynamic', { mass: 1, restitution: 1.01, drag: 0.01 }),
		...createCircleCollider(BALL_RADIUS),
		...layers.ball(),
		velocity: {
			x: (Math.random() - 0.5) * 400,
			y: (Math.random() - 0.5) * 200,
		},
		radius: BALL_RADIUS,
		color,
	});
}

// Spawn initial batch
for (let i = 0; i < 50; i++) {
	spawnBall(
		BALL_RADIUS + Math.random() * (WORLD_W - BALL_RADIUS * 2),
		BALL_RADIUS + Math.random() * (WORLD_H / 2),
	);
}

// -- Pointer tracking --

const canvas = pixiApp.canvas;

function updatePointerPosition(e: PointerEvent) {
	const { x, y } = clientToLogical(e.clientX, e.clientY, canvas, viewport);
	pointerState.x = x;
	pointerState.y = y;
}

canvas.addEventListener('pointerdown', (e: PointerEvent) => {
	pointerState.down = true;
	updatePointerPosition(e);
});

canvas.addEventListener('pointermove', (e: PointerEvent) => {
	if (pointerState.down) updatePointerPosition(e);
});

canvas.addEventListener('pointerup', () => { pointerState.down = false; });
canvas.addEventListener('pointerleave', () => { pointerState.down = false; });

// -- Collision toggle --

const toggleBtn = document.createElement('button');
toggleBtn.textContent = 'Collision: ON';
toggleBtn.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:999999;padding:6px 14px;font:13px/1 monospace;background:#2a2a3e;color:#0f0;border:1px solid #555;border-radius:4px;cursor:pointer';

toggleBtn.addEventListener('click', () => {
	const enabled = ecs.isSystemGroupEnabled('collision');
	if (enabled) {
		ecs.disableSystemGroup('collision');
		ecs.disableSystemGroup('spatialIndex');
		toggleBtn.textContent = 'Collision: OFF';
		toggleBtn.style.color = '#f55';
	} else {
		ecs.enableSystemGroup('collision');
		ecs.enableSystemGroup('spatialIndex');
		toggleBtn.textContent = 'Collision: ON';
		toggleBtn.style.color = '#0f0';
	}
});

document.body.appendChild(toggleBtn);

// -- Stress test overlay --

const cleanupOverlay = createDiagnosticsOverlay(ecs, {
	position: 'top-right',
	showSystemTimings: true,
	maxSystemsShown: 8,
});

// Clean up on page unload
window.addEventListener('beforeunload', cleanupOverlay);
