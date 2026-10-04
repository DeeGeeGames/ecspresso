/**
 * Sprite Animation Example
 *
 * Demonstrates the sprite animation plugin with procedurally generated frames.
 *
 * Features shown:
 *   - defineSpriteAnimation (single clip)
 *   - defineSpriteAnimations (named clips with switching)
 *   - Loop modes: loop, once, pingPong
 *   - playAnimation / stopAnimation / resumeAnimation
 *   - Completion events (onComplete)
 *   - Speed control
 */

import { Sprite, Text } from 'pixi.js';
import { createSceneAssets, generateWalkFrames, generatePulseFrames, generateExplosionFrames, generateSpinFrames, labelStyle, smallLabelStyle, indicatorStyle, infoStyle } from './scene';
import ECSpresso from 'ecspresso';
import { firstOf } from '../utils';
import {
	createRenderer2DPlugin,
	createSpriteComponents,
	createContainerComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import {
	createSpriteAnimationPlugin,
	defineSpriteAnimation,
	defineSpriteAnimations,
	createSpriteAnimation,
	playAnimation,
	stopAnimation,
	resumeAnimation,
	type SpriteAnimationEventData,
} from 'ecspresso/plugins/rendering/sprite-animation';

// ==================== Constants ====================

const SCREEN_W = 900;
const SCREEN_H = 600;

// ==================== ECS Setup ====================

interface AppEvents {
	explosionDone: SpriteAnimationEventData;
}

const ecs = ECSpresso
	.create()
	.withPlugin(createRenderer2DPlugin({
		background: '#1a1a2e',
		width: SCREEN_W,
		height: SCREEN_H,
	}))
	.withPlugin(createSpriteAnimationPlugin())
	.withEventTypes<AppEvents>()
	.withResourceTypes<{ sceneAssets: ReturnType<typeof createSceneAssets> }>()
	.build();

ecs.addResource('sceneAssets', {
	factory: createSceneAssets,
	dependsOn: ['pixiApp'],
	onDispose: (assets) => assets.dispose(),
});

await ecs.initialize();
const assets = ecs.getResource('sceneAssets');

const pixiApp = ecs.getResource('pixiApp');
const renderer = pixiApp.renderer;

// ==================== Label Helper ====================

function spawnLabel(text: string, x: number, y: number) {
	const label = assets.own(new Text({ text, style: labelStyle }));
	ecs.spawn(createContainerComponents(label, { x, y }));
}

function spawnSmallLabel(text: string, x: number, y: number) {
	const label = assets.own(new Text({ text, style: smallLabelStyle }));
	ecs.spawn(createContainerComponents(label, { x, y }));
}

// ==================== Section 1: Loop Modes ====================

spawnLabel('Loop Modes', 20, 20);

// Loop
const loopFrames = assets.frames(generatePulseFrames(renderer, 0x4fc3f7, 12));
const loopSet = defineSpriteAnimation('pulse-loop', {
	frames: loopFrames,
	frameDuration: 0.08,
	loop: 'loop',
});

spawnSmallLabel('loop', 90, 70);
ecs.spawn({
	...createSpriteComponents(assets.own(new Sprite(firstOf(loopFrames))), { x: 100, y: 90 }),
	...createSpriteAnimation(loopSet),
});

// PingPong
const ppFrames = assets.frames(generateSpinFrames(renderer, 0xba68c8, 8));
const ppSet = defineSpriteAnimation('spin-pp', {
	frames: ppFrames,
	frameDuration: 0.1,
	loop: 'pingPong',
});

spawnSmallLabel('pingPong', 220, 70);
ecs.spawn({
	...createSpriteComponents(assets.own(new Sprite(firstOf(ppFrames))), { x: 240, y: 90 }),
	...createSpriteAnimation(ppSet),
});

// Once (explosion — click to replay)
const explosionFrames = assets.frames(generateExplosionFrames(renderer, 10));
const explosionSet = defineSpriteAnimation('explosion', {
	frames: explosionFrames,
	frameDuration: 0.06,
	loop: 'once',
});

spawnSmallLabel('once (click to replay)', 350, 70);
const explosionEntity = ecs.spawn({
	...createSpriteComponents(assets.own(new Sprite(firstOf(explosionFrames))), { x: 400, y: 90 }),
	...createSpriteAnimation(explosionSet, { onComplete: (data) => ecs.eventBus.publish('explosionDone', data) }),
});

// Click to respawn explosion animation
pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const x = (e.clientX - rect.left) * SCREEN_W / rect.width;
	const y = (e.clientY - rect.top) * SCREEN_H / rect.height;

	// Check if click is near the explosion area
	if (x > 340 && x < 460 && y > 60 && y < 140) {
		// Re-add the animation component to replay
		ecs.addComponent(
			explosionEntity.id,
			'spriteAnimation',
			createSpriteAnimation(explosionSet, { onComplete: (data) => ecs.eventBus.publish('explosionDone', data) }).spriteAnimation,
		);
	}
}, { signal: assets.listeners.signal });

// ==================== Section 2: Named Animations ====================

spawnLabel('Named Animations (click character to cycle)', 20, 170);

const idleFrames = assets.frames(generateWalkFrames(renderer, 0x81c784, 4));
const walkFrames = assets.frames(generateWalkFrames(renderer, 0xffb74d, 8));
const runFrames = assets.frames(generateWalkFrames(renderer, 0xf06292, 6));

const characterSet = defineSpriteAnimations('character', {
	idle: { frames: idleFrames, frameDuration: 0.25, loop: 'loop' },
	walk: { frames: walkFrames, frameDuration: 0.12, loop: 'loop' },
	run: { frames: runFrames, frameDuration: 0.06, loop: 'loop' },
});

const animationNames = ['idle', 'walk', 'run'] as const;
let currentAnimIndex = 0;

const characterEntity = ecs.spawn({
	...createSpriteComponents(assets.own(new Sprite(firstOf(idleFrames))), { x: 100, y: 210 }, { scale: 2 }),
	...createSpriteAnimation(characterSet, { initial: 'idle' }),
});

spawnSmallLabel('idle (green)', 180, 200);
spawnSmallLabel('walk (orange)', 180, 218);
spawnSmallLabel('run (pink)', 180, 236);

// Current animation indicator
const indicatorText = assets.own(new Text({ text: '> idle', style: indicatorStyle }));
ecs.spawn(createContainerComponents(indicatorText, { x: 100, y: 270 }));

pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const x = (e.clientX - rect.left) * SCREEN_W / rect.width;
	const y = (e.clientY - rect.top) * SCREEN_H / rect.height;

	// Check if click is near the character area
	if (x > 40 && x < 260 && y > 180 && y < 300) {
		currentAnimIndex = (currentAnimIndex + 1) % animationNames.length;
		const nextAnim = animationNames[currentAnimIndex];
		if (!nextAnim) throw new Error('Invalid animation index');
		playAnimation(ecs, characterEntity.id, nextAnim);

		indicatorText.text = `> ${nextAnim}`;
	}
}, { signal: assets.listeners.signal });

// ==================== Section 3: Speed Control ====================

spawnLabel('Speed Control', 500, 170);

const speedFrames = assets.frames(generatePulseFrames(renderer, 0xfff176, 12));
const speedSet = defineSpriteAnimation('speed-demo', {
	frames: speedFrames,
	frameDuration: 0.1,
	loop: 'loop',
});

const speeds = [0.25, 0.5, 1, 2, 4];
speeds.forEach((speed, i) => {
	const x = 520 + i * 70;
	spawnSmallLabel(`${speed}x`, x + 10, 200);
	ecs.spawn({
		...createSpriteComponents(assets.own(new Sprite(firstOf(speedFrames))), { x: x + 15, y: 220 }),
		...createSpriteAnimation(speedSet, { speed }),
	});
});

// ==================== Section 4: Finite Loops ====================

spawnLabel('Finite Loops (click to restart)', 20, 340);

const loopCountFrames = assets.frames(generateSpinFrames(renderer, 0xe57373, 8));
const loopCountSet = defineSpriteAnimation('finite', {
	frames: loopCountFrames,
	frameDuration: 0.1,
	loop: 'loop',
});

const finiteLoopCounts = [1, 3, 5];
const finiteEntities: number[] = [];

finiteLoopCounts.forEach((count, i) => {
	const x = 60 + i * 120;
	spawnSmallLabel(`${count} loop${count > 1 ? 's' : ''}`, x - 10, 370);
	const entity = ecs.spawn({
		...createSpriteComponents(assets.own(new Sprite(firstOf(loopCountFrames))), { x, y: 400 }),
		...createSpriteAnimation(loopCountSet, { totalLoops: count }),
	});
	finiteEntities.push(entity.id);
});

// Click to restart finite loops
pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const y = (e.clientY - rect.top) * SCREEN_H / rect.height;

	if (y > 360 && y < 460) {
		finiteEntities.forEach((id, i) => {
			// Re-add animation to restart
			ecs.addComponent(
				id,
				'spriteAnimation',
				createSpriteAnimation(loopCountSet, { totalLoops: finiteLoopCounts[i] }).spriteAnimation,
			);
		});
	}
}, { signal: assets.listeners.signal });

// ==================== Section 5: Pause / Resume ====================

spawnLabel('Pause / Resume (click to toggle)', 500, 340);

const pauseFrames = assets.frames(generateWalkFrames(renderer, 0x4fc3f7, 8));
const pauseSet = defineSpriteAnimation('pause-demo', {
	frames: pauseFrames,
	frameDuration: 0.1,
	loop: 'loop',
});

const pauseEntity = ecs.spawn({
	...createSpriteComponents(assets.own(new Sprite(firstOf(pauseFrames))), { x: 620, y: 400 }, { scale: 2 }),
	...createSpriteAnimation(pauseSet),
});

let paused = false;
const pauseIndicatorText = assets.own(new Text({ text: 'playing', style: indicatorStyle }));
ecs.spawn(createContainerComponents(pauseIndicatorText, { x: 600, y: 470 }));

pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const x = (e.clientX - rect.left) * SCREEN_W / rect.width;
	const y = (e.clientY - rect.top) * SCREEN_H / rect.height;

	if (x > 500 && y > 360 && y < 500) {
		paused = !paused;
		if (paused) {
			stopAnimation(ecs, pauseEntity.id);
		} else {
			resumeAnimation(ecs, pauseEntity.id);
		}

		pauseIndicatorText.text = paused ? 'paused' : 'playing';
	}
}, { signal: assets.listeners.signal });

// ==================== Info ====================

const infoText = assets.own(new Text({
	text: 'All frames generated procedurally from PixiJS Graphics. No external sprite sheets needed.',
	style: infoStyle,
}));
ecs.spawn(createContainerComponents(infoText, { x: 20, y: SCREEN_H - 25 }));
