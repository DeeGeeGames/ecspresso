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

import { Graphics, Sprite, Text, TextStyle, Texture, type Renderer } from 'pixi.js';
import ECSpresso from 'ecspresso';
import { firstOf } from '../utils';
import {
	createRenderer2DPlugin,
	createSpriteComponents,
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
	type SpriteAnimationComponentTypes,
} from 'ecspresso/plugins/rendering/sprite-animation';

// ==================== Constants ====================

const SCREEN_W = 900;
const SCREEN_H = 600;
const FRAME_SIZE = 48;

// ==================== Texture Generation ====================

/** Draw a stick figure at a given walk phase (0-3) */
function drawStickFigure(
	gfx: Graphics,
	color: number,
	phase: number,
): Graphics {
	const cx = FRAME_SIZE / 2;
	const headY = 10;
	const bodyTop = 16;
	const bodyBottom = 30;
	const legLen = 14;

	// Head
	gfx.circle(cx, headY, 6).fill(color);
	// Body
	gfx.moveTo(cx, bodyTop).lineTo(cx, bodyBottom).stroke({ color, width: 2 });

	// Arms — swing based on phase
	const armSwing = Math.sin((phase / 4) * Math.PI * 2) * 8;
	gfx.moveTo(cx, bodyTop + 4)
		.lineTo(cx - 10, bodyTop + 10 + armSwing)
		.stroke({ color, width: 2 });
	gfx.moveTo(cx, bodyTop + 4)
		.lineTo(cx + 10, bodyTop + 10 - armSwing)
		.stroke({ color, width: 2 });

	// Legs — alternate based on phase
	const legSwing = Math.sin((phase / 4) * Math.PI * 2) * 10;
	gfx.moveTo(cx, bodyBottom)
		.lineTo(cx - 4 + legSwing, bodyBottom + legLen)
		.stroke({ color, width: 2 });
	gfx.moveTo(cx, bodyBottom)
		.lineTo(cx + 4 - legSwing, bodyBottom + legLen)
		.stroke({ color, width: 2 });

	return gfx;
}

/** Generate walk-cycle textures for a stick figure */
function generateWalkFrames(renderer: Renderer, color: number, frameCount: number): Texture[] {
	return Array.from({ length: frameCount }, (_, i) => {
		const gfx = new Graphics();
		drawStickFigure(gfx, color, i);
		return renderer.generateTexture(gfx);
	});
}

/** Generate a pulsing circle animation (for coin / collectible) */
function generatePulseFrames(renderer: Renderer, color: number, frameCount: number): Texture[] {
	return Array.from({ length: frameCount }, (_, i) => {
		const gfx = new Graphics();
		const t = i / frameCount;
		const radius = 12 + Math.sin(t * Math.PI * 2) * 4;
		const alpha = 0.6 + Math.sin(t * Math.PI * 2) * 0.4;
		gfx.circle(FRAME_SIZE / 2, FRAME_SIZE / 2, radius).fill({ color, alpha });
		return renderer.generateTexture(gfx);
	});
}

/** Generate an explosion animation (expanding ring that fades) */
function generateExplosionFrames(renderer: Renderer, frameCount: number): Texture[] {
	return Array.from({ length: frameCount }, (_, i) => {
		const gfx = new Graphics();
		const t = i / (frameCount - 1);
		const radius = 6 + t * 20;
		const alpha = 1 - t;
		// Outer ring
		gfx.circle(FRAME_SIZE / 2, FRAME_SIZE / 2, radius)
			.fill({ color: 0xff4400, alpha: alpha * 0.3 });
		gfx.circle(FRAME_SIZE / 2, FRAME_SIZE / 2, radius * 0.7)
			.fill({ color: 0xffaa00, alpha: alpha * 0.6 });
		// Core
		gfx.circle(FRAME_SIZE / 2, FRAME_SIZE / 2, radius * 0.3)
			.fill({ color: 0xffffcc, alpha });
		return renderer.generateTexture(gfx);
	});
}

/** Generate a spinning square animation */
function generateSpinFrames(renderer: Renderer, color: number, frameCount: number): Texture[] {
	return Array.from({ length: frameCount }, (_, i) => {
		const gfx = new Graphics();
		const t = i / frameCount;
		const cx = FRAME_SIZE / 2;
		const cy = FRAME_SIZE / 2;
		const scaleX = Math.cos(t * Math.PI * 2);
		const halfW = 10 * Math.abs(scaleX);
		const halfH = 10;
		gfx.rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2).fill(color);
		return renderer.generateTexture(gfx);
	});
}

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
	.withComponentTypes<SpriteAnimationComponentTypes>()
	.withEventTypes<AppEvents>()
	.build();

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');
const renderer = pixiApp.renderer;

// ==================== Label Helper ====================

const labelStyle = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 13,
	fill: '#aaaaaa',
});

const smallLabelStyle = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 11,
	fill: '#666666',
});

function spawnLabel(text: string, x: number, y: number) {
	const textObj = new Text({ text, style: labelStyle });
	const sprite = new Sprite(renderer.generateTexture(textObj));
	ecs.spawn(createSpriteComponents(sprite, { x, y }));
}

function spawnSmallLabel(text: string, x: number, y: number) {
	const textObj = new Text({ text, style: smallLabelStyle });
	const sprite = new Sprite(renderer.generateTexture(textObj));
	ecs.spawn(createSpriteComponents(sprite, { x, y }));
}

// ==================== Section 1: Loop Modes ====================

spawnLabel('Loop Modes', 20, 20);

// Loop
const loopFrames = generatePulseFrames(renderer, 0x4fc3f7, 12);
const loopSet = defineSpriteAnimation('pulse-loop', {
	frames: loopFrames,
	frameDuration: 0.08,
	loop: 'loop',
});

spawnSmallLabel('loop', 90, 70);
ecs.spawn({
	...createSpriteComponents(new Sprite(firstOf(loopFrames)), { x: 100, y: 90 }),
	...createSpriteAnimation(loopSet),
});

// PingPong
const ppFrames = generateSpinFrames(renderer, 0xba68c8, 8);
const ppSet = defineSpriteAnimation('spin-pp', {
	frames: ppFrames,
	frameDuration: 0.1,
	loop: 'pingPong',
});

spawnSmallLabel('pingPong', 220, 70);
ecs.spawn({
	...createSpriteComponents(new Sprite(firstOf(ppFrames)), { x: 240, y: 90 }),
	...createSpriteAnimation(ppSet),
});

// Once (explosion — click to replay)
const explosionFrames = generateExplosionFrames(renderer, 10);
const explosionSet = defineSpriteAnimation('explosion', {
	frames: explosionFrames,
	frameDuration: 0.06,
	loop: 'once',
});

spawnSmallLabel('once (click to replay)', 350, 70);
const explosionEntity = ecs.spawn({
	...createSpriteComponents(new Sprite(firstOf(explosionFrames)), { x: 400, y: 90 }),
	...createSpriteAnimation(explosionSet, { onComplete: (data) => ecs.eventBus.publish('explosionDone', data) }),
});

// Click to respawn explosion animation
pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	// Check if click is near the explosion area
	if (x > 340 && x < 460 && y > 60 && y < 140) {
		// Re-add the animation component to replay
		ecs.addComponent(
			explosionEntity.id,
			'spriteAnimation',
			createSpriteAnimation(explosionSet, { onComplete: (data) => ecs.eventBus.publish('explosionDone', data) }).spriteAnimation,
		);
	}
});

// ==================== Section 2: Named Animations ====================

spawnLabel('Named Animations (click character to cycle)', 20, 170);

const idleFrames = generateWalkFrames(renderer, 0x81c784, 4);
const walkFrames = generateWalkFrames(renderer, 0xffb74d, 8);
const runFrames = generateWalkFrames(renderer, 0xf06292, 6);

const characterSet = defineSpriteAnimations('character', {
	idle: { frames: idleFrames, frameDuration: 0.25, loop: 'loop' },
	walk: { frames: walkFrames, frameDuration: 0.12, loop: 'loop' },
	run: { frames: runFrames, frameDuration: 0.06, loop: 'loop' },
});

const animationNames = ['idle', 'walk', 'run'] as const;
let currentAnimIndex = 0;

const characterEntity = ecs.spawn({
	...createSpriteComponents(new Sprite(firstOf(idleFrames)), { x: 100, y: 210 }, { scale: 2 }),
	...createSpriteAnimation(characterSet, { initial: 'idle' }),
});

spawnSmallLabel('idle (green)', 180, 200);
spawnSmallLabel('walk (orange)', 180, 218);
spawnSmallLabel('run (pink)', 180, 236);

// Current animation indicator
const indicatorStyle = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 14,
	fill: '#ffffff',
});

const indicatorText = new Text({ text: '> idle', style: indicatorStyle });
const indicatorSprite = new Sprite(renderer.generateTexture(indicatorText));
const indicatorEntity = ecs.spawn(
	createSpriteComponents(indicatorSprite, { x: 100, y: 270 }),
);

pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	// Check if click is near the character area
	if (x > 40 && x < 260 && y > 180 && y < 300) {
		currentAnimIndex = (currentAnimIndex + 1) % animationNames.length;
		const nextAnim = animationNames[currentAnimIndex];
		if (!nextAnim) throw new Error('Invalid animation index');
		playAnimation(ecs, characterEntity.id, nextAnim);

		// Update indicator
		const newText = new Text({ text: `> ${nextAnim}`, style: indicatorStyle });
		const newSprite = new Sprite(renderer.generateTexture(newText));
		ecs.addComponent(indicatorEntity.id, 'sprite', newSprite);
	}
});

// ==================== Section 3: Speed Control ====================

spawnLabel('Speed Control', 500, 170);

const speedFrames = generatePulseFrames(renderer, 0xfff176, 12);
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
		...createSpriteComponents(new Sprite(firstOf(speedFrames)), { x: x + 15, y: 220 }),
		...createSpriteAnimation(speedSet, { speed }),
	});
});

// ==================== Section 4: Finite Loops ====================

spawnLabel('Finite Loops (click to restart)', 20, 340);

const loopCountFrames = generateSpinFrames(renderer, 0xe57373, 8);
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
		...createSpriteComponents(new Sprite(firstOf(loopCountFrames)), { x, y: 400 }),
		...createSpriteAnimation(loopCountSet, { totalLoops: count }),
	});
	finiteEntities.push(entity.id);
});

// Click to restart finite loops
pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const y = e.clientY - rect.top;

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
});

// ==================== Section 5: Pause / Resume ====================

spawnLabel('Pause / Resume (click to toggle)', 500, 340);

const pauseFrames = generateWalkFrames(renderer, 0x4fc3f7, 8);
const pauseSet = defineSpriteAnimation('pause-demo', {
	frames: pauseFrames,
	frameDuration: 0.1,
	loop: 'loop',
});

const pauseEntity = ecs.spawn({
	...createSpriteComponents(new Sprite(firstOf(pauseFrames)), { x: 620, y: 400 }, { scale: 2 }),
	...createSpriteAnimation(pauseSet),
});

let paused = false;
const pauseIndicatorText = new Text({ text: 'playing', style: indicatorStyle });
const pauseIndicatorSprite = new Sprite(renderer.generateTexture(pauseIndicatorText));
const pauseIndicatorEntity = ecs.spawn(
	createSpriteComponents(pauseIndicatorSprite, { x: 600, y: 470 }),
);

pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const x = e.clientX - rect.left;
	const y = e.clientY - rect.top;

	if (x > 500 && y > 360 && y < 500) {
		paused = !paused;
		if (paused) {
			stopAnimation(ecs, pauseEntity.id);
		} else {
			resumeAnimation(ecs, pauseEntity.id);
		}

		const newText = new Text({
			text: paused ? 'paused' : 'playing',
			style: indicatorStyle,
		});
		const newSprite = new Sprite(renderer.generateTexture(newText));
		ecs.addComponent(pauseIndicatorEntity.id, 'sprite', newSprite);
	}
});

// ==================== Info ====================

const infoStyle = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 11,
	fill: '#555555',
});
const infoText = new Text({
	text: 'All frames generated procedurally from PixiJS Graphics. No external sprite sheets needed.',
	style: infoStyle,
});
const infoSprite = new Sprite(renderer.generateTexture(infoText));
ecs.spawn(createSpriteComponents(infoSprite, { x: 20, y: SCREEN_H - 25 }));
