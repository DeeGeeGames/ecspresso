/**
 * ECS world setup — bouncing balls with score/health resources.
 * The game itself is simple; the point is demonstrating React UI subscriptions.
 */
import { Graphics, Sprite } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createLocalTransform,
} from 'ecspresso/plugins/rendering/renderer2D';

// ── World definition ──

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: '#1a1a2e',
	}))
	.withComponentTypes<{
		velocity: { x: number; y: number };
		radius: number;
	}>()
	.withResourceTypes<{
		score: number;
		health: number;
		ballCount: number;
		paused: boolean;
	}>()
	.withEventTypes<{
		ballBounced: { entityId: number };
		healthChanged: { prev: number; next: number };
	}>()
	.build();

export type ECS = typeof ecs;

// ── Systems ──

ecs.addSystem('movement')
	.withResources(['paused'])
	.setProcessEach({ with: ['localTransform', 'velocity'], mutates: ['localTransform'] }, ({ entity, dt, resources: { paused } }) => {
		if (paused) return false;
		const { localTransform, velocity } = entity.components;
		localTransform.x += velocity.x * dt;
		localTransform.y += velocity.y * dt;
	});

ecs.addSystem('bounce')
	.withResources(['bounds', 'paused'])
	.setProcessEach({ with: ['localTransform', 'velocity', 'radius'], mutates: ['localTransform', 'velocity'] }, ({ entity, resources: { bounds, paused }, ecs }) => {
		if (paused) return false;
		const { localTransform, velocity, radius } = entity.components;
		const nextX = Math.max(radius, Math.min(bounds.width - radius, localTransform.x));
		const nextY = Math.max(radius, Math.min(bounds.height - radius, localTransform.y));
		const bouncedX = (localTransform.x < radius && velocity.x < 0)
			|| (localTransform.x > bounds.width - radius && velocity.x > 0);
		const bouncedY = (localTransform.y < radius && velocity.y < 0)
			|| (localTransform.y > bounds.height - radius && velocity.y > 0);
		const clamped = nextX !== localTransform.x || nextY !== localTransform.y;
		if (!clamped && !bouncedX && !bouncedY) return false;
		localTransform.x = nextX;
		localTransform.y = nextY;
		if (bouncedX) velocity.x *= -1;
		if (bouncedY) velocity.y *= -1;
		if (bouncedX || bouncedY) {
			ecs.setResource('score', ecs.getResource('score') + 1);
			ecs.eventBus.publish('ballBounced', { entityId: entity.id });
		}
	});

// Slowly drain health to give the health bar something to show
ecs.addSystem('healthDrain')
	.withResources(['paused'])
	.setProcess(({ ecs, dt, resources: { paused } }) => {
		if (paused) return;
		const prev = ecs.getResource('health');
		const next = Math.max(0, prev - 2 * dt);
		if (next !== prev) {
			ecs.setResource('health', next);
			ecs.eventBus.publish('healthChanged', { prev, next });
		}
	});

// ── Initialization ──

export async function initGame(): Promise<typeof ecs> {
	ecs.setResource('score', 0);
	ecs.setResource('health', 100);
	ecs.setResource('ballCount', 0);
	ecs.setResource('paused', false);

	await ecs.initialize();

	const pixiApp = ecs.getResource('pixiApp');

	// Spawn a few bouncing balls
	const colors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa29bfe, 0x6c5ce7];
	for (let i = 0; i < 5; i++) {
		const r = 15 + Math.random() * 20;
		const color = colors[i % colors.length];
		const sprite = new Sprite(
			pixiApp.renderer.generateTexture(
				new Graphics().circle(0, 0, r).fill(color),
			),
		);
		sprite.anchor.set(0.5, 0.5);

		ecs.spawn({
			sprite,
			...createLocalTransform(
				r + Math.random() * (pixiApp.screen.width - 2 * r),
				r + Math.random() * (pixiApp.screen.height - 2 * r),
			),
			velocity: {
				x: (150 + Math.random() * 200) * (Math.random() > 0.5 ? 1 : -1),
				y: (150 + Math.random() * 200) * (Math.random() > 0.5 ? 1 : -1),
			},
			radius: r,
		});
	}
	ecs.setResource('ballCount', 5);

	return ecs;
}
