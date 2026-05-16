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
import { createCameraPlugin, screenToWorld } from '../../src/plugins/spatial/camera';
import { createInputPlugin } from '../../src/plugins/input/input';

import {
	SCREEN_W,
	SCREEN_H,
	WORLD_W,
	WORLD_H,
	BALL_RADIUS,
	SPAWN_RATE,
	COLORS,
	createCollisionToggle,
	createEntityCountInput,
} from './shared';

export type StartOptions = {
	initialCount: number;
	onCountChange: (count: number) => void;
};

export async function startECSpresso(options: StartOptions): Promise<() => void> {
	const layers = defineCollisionLayers({ ball: ['ball'] });

	const ecs = ECSpresso.create()
		.withPlugin(createRenderer2DPlugin({
			background: '#1a1a2e',
			camera: true,
			screenScale: {
				width: SCREEN_W,
				height: SCREEN_H,
				mode: 'fit',
			},
		}))
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
			zoom: { minZoom: .5, maxZoom: 2, zoomStep: .1 },
		}))
		.withComponentTypes<{ radius: number; color: number }>()
		.build();

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

	const pointerState = { down: false, x: 0, y: 0 };

	ecs
		.addSystem('continuous-spawn')
		.inPhase('preUpdate')
		.withResources(['cameraState'])
		.setProcess(({ resources: { cameraState } }) => {
			if (!pointerState.down) return;
			const world = screenToWorld(
				pointerState.x + (Math.random() - 0.5) * 40,
				pointerState.y + (Math.random() - 0.5) * 40,
				cameraState,
			);
			for (let i = 0; i < SPAWN_RATE; i++) {
				spawnBall(world.x, world.y);
			}
		});

	await ecs.initialize();

	const pixiApp = ecs.getResource('pixiApp');
	const viewport: ViewportScale = ecs.getResource('viewportScale');

	const ballTextures = COLORS.map(color =>
		pixiApp.renderer.generateTexture(
			new Graphics().circle(0, 0, BALL_RADIUS).fill(color),
		),
	);

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

	for (let i = 0; i < options.initialCount; i++) {
		spawnBall(
			BALL_RADIUS + Math.random() * (WORLD_W - BALL_RADIUS * 2),
			BALL_RADIUS + Math.random() * (WORLD_H - BALL_RADIUS * 2),
		);
	}

	const canvas = pixiApp.canvas;

	function updatePointerPosition(e: PointerEvent) {
		const { x, y } = clientToLogical(e.clientX, e.clientY, canvas, viewport);
		pointerState.x = x;
		pointerState.y = y;
	}

	const onPointerDown = (e: PointerEvent) => { pointerState.down = true; updatePointerPosition(e); };
	const onPointerMove = (e: PointerEvent) => { if (pointerState.down) updatePointerPosition(e); };
	const onPointerUp = () => { pointerState.down = false; };

	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointermove', onPointerMove);
	canvas.addEventListener('pointerup', onPointerUp);
	canvas.addEventListener('pointerleave', onPointerUp);

	const cleanupToggle = createCollisionToggle((enabled) => {
		if (enabled) {
			ecs.enableSystemGroup('collision');
			ecs.enableSystemGroup('spatialIndex');
		} else {
			ecs.disableSystemGroup('collision');
			ecs.disableSystemGroup('spatialIndex');
		}
	});

	const cleanupCountInput = createEntityCountInput({
		getCount: () => ecs.getEntitiesWithQuery(['radius']).length,
		spawnAt: spawnBall,
		removeMany: (count) => {
			const balls = ecs.getEntitiesWithQuery(['radius']);
			balls.slice(-count).forEach(b => ecs.removeEntity(b.id));
		},
		onChange: options.onCountChange,
	});

	const cleanupOverlay = createDiagnosticsOverlay(ecs, {
		position: 'top-right',
		showSystemTimings: true,
		maxSystemsShown: 8,
	});

	return function destroy() {
		canvas.removeEventListener('pointerdown', onPointerDown);
		canvas.removeEventListener('pointermove', onPointerMove);
		canvas.removeEventListener('pointerup', onPointerUp);
		canvas.removeEventListener('pointerleave', onPointerUp);
		cleanupOverlay();
		cleanupCountInput();
		cleanupToggle();
		ecs.dispose();
		ballTextures.forEach(t => t.destroy(true));
		pixiApp.destroy(true, { children: true, texture: true });
	};
}
