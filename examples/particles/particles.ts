/**
 * Particles Example
 *
 * Demonstrates the particle system plugin with procedurally generated textures.
 *
 * Features shown:
 *   - defineParticleEffect (custom configs)
 *   - Presets: explosion, smoke, fire, sparkle, trail
 *   - Burst emission (click to trigger)
 *   - Continuous emission
 *   - stopEmitter / resumeEmitter
 *   - Finite duration with onComplete events
 */

import { Graphics, Sprite, Text, TextStyle, Texture, type Renderer } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createSpriteComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import {
	createParticlePlugin,
	defineParticleEffect,
	createParticleEmitter,
	burstParticles,
	stopEmitter,
	resumeEmitter,
	particlePresets,
	type ParticleComponentTypes,
} from 'ecspresso/plugins/rendering/particles';

// ==================== Constants ====================

const SCREEN_W = 900;
const SCREEN_H = 600;

// ==================== Texture Generation ====================

function generateCircleTexture(renderer: Renderer, color: number, radius: number): Texture {
	const gfx = new Graphics();
	gfx.circle(radius, radius, radius).fill({ color, alpha: 1 });
	return renderer.generateTexture(gfx);
}

function generateSoftCircleTexture(renderer: Renderer, color: number, radius: number): Texture {
	const gfx = new Graphics();
	// Soft circle: bright center, fading edge
	gfx.circle(radius, radius, radius).fill({ color, alpha: 0.5 });
	gfx.circle(radius, radius, radius * 0.5).fill({ color, alpha: 0.8 });
	gfx.circle(radius, radius, radius * 0.2).fill({ color: 0xffffff, alpha: 0.9 });
	return renderer.generateTexture(gfx);
}

function generateSquareTexture(renderer: Renderer, color: number, size: number): Texture {
	const gfx = new Graphics();
	gfx.rect(0, 0, size, size).fill({ color });
	return renderer.generateTexture(gfx);
}

function generateStarTexture(renderer: Renderer, color: number, size: number): Texture {
	const gfx = new Graphics();
	const cx = size / 2;
	const cy = size / 2;
	const outerR = size / 2;
	const innerR = size / 5;
	const points = 5;

	gfx.moveTo(cx, cy - outerR);
	for (let i = 0; i < points; i++) {
		const outerAngle = (i * 2 * Math.PI) / points - Math.PI / 2;
		const innerAngle = outerAngle + Math.PI / points;
		gfx.lineTo(cx + Math.cos(outerAngle) * outerR, cy + Math.sin(outerAngle) * outerR);
		gfx.lineTo(cx + Math.cos(innerAngle) * innerR, cy + Math.sin(innerAngle) * innerR);
	}
	gfx.closePath().fill({ color });
	return renderer.generateTexture(gfx);
}

// ==================== ECS Setup ====================

const ecs = ECSpresso
	.create()
	.withPlugin(createRenderer2DPlugin({
		background: '#0a0a1a',
		width: SCREEN_W,
		height: SCREEN_H,
	}))
	.withPlugin(createParticlePlugin())
	.withComponentTypes<ParticleComponentTypes>()
	.build();

await ecs.initialize();

const pixiApp = ecs.getResource('pixiApp');
const renderer = pixiApp.renderer;

// Generate textures
const whiteCircle = generateCircleTexture(renderer, 0xffffff, 6);
const softCircle = generateSoftCircleTexture(renderer, 0xffffff, 8);
const smallSquare = generateSquareTexture(renderer, 0xffffff, 4);
const star = generateStarTexture(renderer, 0xffffff, 10);

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

// ==================== Section 1: Presets ====================

spawnLabel('Presets (click each to trigger burst)', 20, 15);

const presetConfigs = [
	{ name: 'explosion', config: particlePresets.explosion(softCircle), x: 80 },
	{ name: 'smoke', config: particlePresets.smoke(softCircle), x: 230 },
	{ name: 'fire', config: particlePresets.fire(softCircle), x: 380 },
	{ name: 'sparkle', config: particlePresets.sparkle(star), x: 530 },
	{ name: 'trail', config: particlePresets.trail(whiteCircle), x: 680 },
] as const;

const presetEntities: Array<{ id: number; x: number; config: ReturnType<typeof defineParticleEffect> }> = [];

presetConfigs.forEach(({ name, config, x }) => {
	spawnSmallLabel(name, x - 20, 42);

	const entity = ecs.spawn({
		...createParticleEmitter(config, { playing: true }),
		localTransform: { x, y: 100, rotation: 0, scaleX: 1, scaleY: 1 },
		worldTransform: { x, y: 100, rotation: 0, scaleX: 1, scaleY: 1 },
	});

	// Trigger initial burst for explosion preset
	if (name === 'explosion') {
		burstParticles(ecs, entity.id);
	}

	presetEntities.push({ id: entity.id, x, config });
});

// Click to burst in preset area
pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const clickX = e.clientX - rect.left;
	const clickY = e.clientY - rect.top;

	if (clickY > 30 && clickY < 170) {
		presetEntities.forEach(({ id, x, config }) => {
			if (Math.abs(clickX - x) < 60) {
				if (burstParticles(ecs, id, config.burstCount || 10)) return;

				ecs.addComponent(id, 'particleEmitter', createParticleEmitter(config).particleEmitter);
				burstParticles(ecs, id, config.burstCount || 10);
			}
		});
	}
});

// ==================== Section 2: Custom Effects ====================

spawnLabel('Custom Effects', 20, 180);

// Fountain - upward particles with gravity pulling them down
spawnSmallLabel('fountain', 50, 205);
const fountainConfig = defineParticleEffect({
	maxParticles: 80,
	texture: whiteCircle,
	spawnRate: 40,
	duration: -1,
	lifetime: [1, 2],
	speed: [150, 250],
	angle: [-Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3],
	gravity: { x: 0, y: 300 },
	startSize: [0.3, 0.6],
	endSize: 0.1,
	startAlpha: 1,
	endAlpha: 0.2,
	startTint: 0x4fc3f7,
	endTint: 0x0d47a1,
});

ecs.spawn({
	...createParticleEmitter(fountainConfig),
	localTransform: { x: 80, y: 340, rotation: 0, scaleX: 1, scaleY: 1 },
	worldTransform: { x: 80, y: 340, rotation: 0, scaleX: 1, scaleY: 1 },
});

// Confetti - colorful squares falling with rotation
spawnSmallLabel('confetti', 210, 205);
const confettiConfig = defineParticleEffect({
	maxParticles: 60,
	texture: smallSquare,
	spawnRate: 25,
	duration: -1,
	lifetime: [2, 4],
	speed: [30, 80],
	angle: [Math.PI / 2 - 0.8, Math.PI / 2 + 0.8],
	gravity: { x: 0, y: 20 },
	startSize: [0.5, 1.5],
	endSize: [0.3, 0.8],
	startAlpha: 1,
	endAlpha: 0,
	startTint: 0xff4081,
	endTint: 0x7c4dff,
	rotationSpeed: [-3, 3],
});

ecs.spawn({
	...createParticleEmitter(confettiConfig),
	localTransform: { x: 240, y: 220, rotation: 0, scaleX: 1, scaleY: 1 },
	worldTransform: { x: 240, y: 220, rotation: 0, scaleX: 1, scaleY: 1 },
});

// Fireflies - slow moving sparkles
spawnSmallLabel('fireflies', 370, 205);
const fireflyConfig = defineParticleEffect({
	maxParticles: 25,
	texture: star,
	spawnRate: 5,
	duration: -1,
	lifetime: [2, 5],
	speed: [5, 20],
	angle: [0, Math.PI * 2],
	startSize: [0.2, 0.5],
	endSize: [0.1, 0.3],
	startAlpha: [0, 0.5],
	endAlpha: [0.8, 1],
	startTint: 0xffeb3b,
	endTint: 0x76ff03,
	emissionShape: 'circle',
	emissionRadius: 50,
});

ecs.spawn({
	...createParticleEmitter(fireflyConfig),
	localTransform: { x: 410, y: 300, rotation: 0, scaleX: 1, scaleY: 1 },
	worldTransform: { x: 410, y: 300, rotation: 0, scaleX: 1, scaleY: 1 },
});

// ==================== Section 3: Burst on Click ====================

spawnLabel('Click anywhere below to spawn explosion', 520, 180);

const burstConfig = defineParticleEffect({
	maxParticles: 40,
	texture: softCircle,
	spawnRate: 0,
	burstCount: 30,
	duration: 2,
	lifetime: [0.3, 1],
	speed: [80, 250],
	angle: [0, Math.PI * 2],
	startSize: [0.3, 0.8],
	endSize: 0.05,
	startAlpha: 1,
	endAlpha: 0,
	startTint: 0xffab40,
	endTint: 0xd50000,
});

pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const clickX = e.clientX - rect.left;
	const clickY = e.clientY - rect.top;

	// Spawn explosion in the right-side area
	if (clickX > 510 && clickY > 200) {
		const entity = ecs.spawn({
			...createParticleEmitter(burstConfig, {
				onComplete: ({ entityId }) => ecs.commands.removeEntity(entityId),
			}),
			localTransform: { x: clickX, y: clickY, rotation: 0, scaleX: 1, scaleY: 1 },
			worldTransform: { x: clickX, y: clickY, rotation: 0, scaleX: 1, scaleY: 1 },
		});
		burstParticles(ecs, entity.id);
	}
});

// ==================== Section 4: Pause / Resume ====================

spawnLabel('Pause / Resume (click to toggle)', 20, 420);

const pauseConfig = defineParticleEffect({
	maxParticles: 50,
	texture: whiteCircle,
	spawnRate: 15,
	duration: -1,
	lifetime: [1, 2],
	speed: [30, 80],
	angle: [-Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5],
	startSize: [0.3, 0.7],
	endSize: 0.1,
	startAlpha: 0.8,
	endAlpha: 0,
	startTint: 0xce93d8,
	endTint: 0x4a148c,
});

const pauseEntity = ecs.spawn({
	...createParticleEmitter(pauseConfig),
	localTransform: { x: 120, y: 530, rotation: 0, scaleX: 1, scaleY: 1 },
	worldTransform: { x: 120, y: 530, rotation: 0, scaleX: 1, scaleY: 1 },
});

const indicatorStyle = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 14,
	fill: '#ffffff',
});

const indicatorText = new Text({ text: 'playing', style: indicatorStyle });
const indicatorSprite = new Sprite(renderer.generateTexture(indicatorText));
ecs.spawn(
	createSpriteComponents(indicatorSprite, { x: 60, y: 555 }),
);

pixiApp.canvas.addEventListener('click', (e) => {
	const rect = pixiApp.canvas.getBoundingClientRect();
	const clickX = e.clientX - rect.left;
	const clickY = e.clientY - rect.top;

	if (clickX >= 250 || clickY <= 420) return;
	const emitter = ecs.getComponent(pauseEntity.id, 'particleEmitter');
	if (!emitter) return;
	const paused = emitter.playing;
	const toggleEmitter = paused ? stopEmitter : resumeEmitter;
	toggleEmitter(ecs, pauseEntity.id);
	indicatorText.text = paused ? 'paused' : 'playing';
	const previousTexture = indicatorSprite.texture;
	indicatorSprite.texture = renderer.generateTexture(indicatorText);
	previousTexture.destroy(true);
});

// ==================== Info ====================

const infoStyle = new TextStyle({
	fontFamily: 'monospace',
	fontSize: 11,
	fill: '#555555',
});
const infoText = new Text({
	text: 'Particles live outside the ECS in pre-allocated pools. Zero GC allocation per frame.',
	style: infoStyle,
});
const infoSprite = new Sprite(renderer.generateTexture(infoText));
ecs.spawn(createSpriteComponents(infoSprite, { x: 20, y: SCREEN_H - 20 }));
