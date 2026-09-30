/**
 * Coroutine Plugin Example
 *
 * Demonstrates a scripted "boss entrance" sequence using generator-based coroutines.
 * Shows: sequential steps, waitSeconds, parallel, frame-by-frame interpolation,
 * and replay via re-spawning.
 */

import { Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createSpriteComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import {
	createCoroutinePlugin,
	createCoroutine,
	waitSeconds,
	parallel,
	type CoroutineGenerator,
} from 'ecspresso/plugins/scripting/coroutine';

// ==================== Constants ====================

const SCREEN_W = 600;
const SCREEN_H = 500;
const CENTER_X = SCREEN_W / 2;
const CENTER_Y = SCREEN_H / 2;
const CIRCLE_RADIUS = 40;
const CIRCLE_COLOR = 0xe53935;

// ==================== ECS Setup ====================

const ecs = ECSpresso
	.create()
	.withPlugin(createRenderer2DPlugin({
		background: '#1a1a2e',
		width: SCREEN_W,
		height: SCREEN_H,
	}))
	.withPlugin(createCoroutinePlugin())
	.build();

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');

// ==================== Sprite Factories ====================

function makeCircleSprite(): Sprite {
	const gfx = new Graphics().circle(0, 0, CIRCLE_RADIUS).fill(CIRCLE_COLOR);
	return new Sprite(pixiApp.renderer.generateTexture(gfx));
}

const textStyle = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 28,
	fontWeight: 'bold',
	fill: '#ffffff',
	align: 'center',
});

function makeTextSprite(msg: string): Sprite {
	const text = new Text({ text: msg, style: textStyle });
	return new Sprite(pixiApp.renderer.generateTexture(text));
}

// ==================== Interpolation Helper ====================

function* lerp(
	get: () => number,
	set: (v: number) => void,
	target: number,
	duration: number,
): CoroutineGenerator {
	const start = get();
	let elapsed = 0;
	while (elapsed < duration) {
		const dt: number = yield;
		elapsed += dt;
		const t = Math.min(elapsed / duration, 1);
		// Ease out quad
		const eased = 1 - (1 - t) * (1 - t);
		set(start + (target - start) * eased);
	}
	set(target);
}

// ==================== Boss Entrance Sequence ====================

function* bossEntrance(
	circleSprite: Sprite,
	circleEntityId: number,
	spawnedIds: number[],
): CoroutineGenerator {
	try {
		// Step 1: Slide in from top
		yield* lerp(
			() => ecs.getComponent(circleEntityId, 'localTransform')?.y ?? -60,
			(v) => { ecs.mutateComponent(circleEntityId, 'localTransform', (c) => { c.y = v; }); },
			CENTER_Y - 80,
			0.8,
		);

		// Step 2: Pause
		yield* waitSeconds(0.4);

		// Step 3: Flash 3 times
		for (let i = 0; i < 3; i++) {
			circleSprite.alpha = 0.2;
			yield* waitSeconds(0.1);
			circleSprite.alpha = 1.0;
			yield* waitSeconds(0.1);
		}

		// Step 4: Show "GET READY!" text
		const readySprite = makeTextSprite('GET READY!');
		const textEntity = ecs.spawn({
			...createSpriteComponents(readySprite, {
				x: CENTER_X - readySprite.width / 2,
				y: CENTER_Y + 40,
			}),
		});
		spawnedIds.push(textEntity.id);

		yield* waitSeconds(0.6);

		// Step 5: Parallel — circle moves to center + grows
		yield* parallel(
			lerp(
				() => ecs.getComponent(circleEntityId, 'localTransform')?.y ?? CENTER_Y - 80,
				(v) => { ecs.mutateComponent(circleEntityId, 'localTransform', (c) => { c.y = v; }); },
				CENTER_Y,
				0.5,
			),
			lerp(
				() => ecs.getComponent(circleEntityId, 'localTransform')?.scaleX ?? 1,
				(v) => { ecs.mutateComponent(circleEntityId, 'localTransform', (c) => { c.scaleX = v; c.scaleY = v; }); },
				1.5,
				0.5,
			),
		);

		// Step 6: Change text to "FIGHT!"
		const textLocal = ecs.getComponent(textEntity.id, 'localTransform');
		ecs.removeEntity(textEntity.id);

		const fightSprite = makeTextSprite('FIGHT!');
		const fightEntity = ecs.spawn({
			...createSpriteComponents(fightSprite, {
				x: CENTER_X - fightSprite.width / 2,
				y: textLocal?.y ?? CENTER_Y + 40,
			}),
		});
		spawnedIds.push(fightEntity.id);

		yield* waitSeconds(1.0);

		// Step 7: Circle shrinks and exits downward
		yield* parallel(
			lerp(
				() => ecs.getComponent(circleEntityId, 'localTransform')?.scaleX ?? 1.5,
				(v) => { ecs.mutateComponent(circleEntityId, 'localTransform', (c) => { c.scaleX = v; c.scaleY = v; }); },
				0.3,
				0.6,
			),
			lerp(
				() => ecs.getComponent(circleEntityId, 'localTransform')?.y ?? CENTER_Y,
				(v) => { ecs.mutateComponent(circleEntityId, 'localTransform', (c) => { c.y = v; }); },
				SCREEN_H + 60,
				0.6,
			),
		);

		// Clean up text
		yield* waitSeconds(0.3);
		ecs.removeEntity(fightEntity.id);
	} finally {
		// Cleanup on cancellation: remove any entities spawned during the sequence
		for (const id of spawnedIds) {
			ecs.removeEntity(id);
		}
	}
}

// ==================== Spawning ====================

function startSequence() {
	const spawnedIds: number[] = [];

	const circleSprite = makeCircleSprite();
	const circleEntity = ecs.spawn({
		...createSpriteComponents(circleSprite, {
			x: CENTER_X - CIRCLE_RADIUS,
			y: -CIRCLE_RADIUS * 2,
		}, {
			anchor: { x: 0.5, y: 0.5 },
		}),
	});
	spawnedIds.push(circleEntity.id);

	// Coroutine entity drives the sequence; shares spawnedIds for cleanup
	const coroutineEntity = ecs.spawn({
		...createCoroutine(bossEntrance(circleSprite, circleEntity.id, spawnedIds)),
	});

	return [coroutineEntity.id, circleEntity.id];
}

let activeIds = startSequence();

// ==================== Replay Button ====================

document.getElementById('replay-btn')?.addEventListener('click', () => {
	// Remove the coroutine entity (triggers finally → cleanup) and circle
	for (const id of activeIds) {
		ecs.removeEntity(id);
	}
	activeIds = startSequence();
});
